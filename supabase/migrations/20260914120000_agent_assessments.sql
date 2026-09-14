-- Additive: no changes to auth, signup invites, client access policies or onboarding gates.
CREATE TABLE public.agent_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_pricing_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT false,
  minimum_pages integer NOT NULL DEFAULT 5 CHECK (minimum_pages >= 3),
  minimum_domains integer NOT NULL DEFAULT 2 CHECK (minimum_domains >= 2),
  base_annual numeric NOT NULL DEFAULT 0 CHECK (base_annual BETWEEN 0 AND 100000000),
  annual_per_domain numeric NOT NULL DEFAULT 0 CHECK (annual_per_domain BETWEEN 0 AND 10000000),
  review_minutes_per_page_month numeric NOT NULL DEFAULT 0 CHECK (review_minutes_per_page_month BETWEEN 0 AND 10000),
  hourly_review_rate numeric NOT NULL DEFAULT 0 CHECK (hourly_review_rate BETWEEN 0 AND 1000000),
  range_margin numeric NOT NULL DEFAULT 0.2 CHECK (range_margin BETWEEN 0 AND 0.5),
  CHECK (NOT enabled OR base_annual > 0)
);
-- No invented commercial coefficients: an administrator must configure and enable pricing.
INSERT INTO public.agent_pricing_policy DEFAULT VALUES;
CREATE TABLE public.agent_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES auth.users(id),
  artist_name text NOT NULL CHECK (length(artist_name) BETWEEN 2 AND 120),
  official_profile_url text,
  dedup_key text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SCANNING','ANALYZING','READY','FAILED','REVIEW_REQUIRED','EXPIRED')),
  stage text NOT NULL DEFAULT 'Queued for discovery',
  signals jsonb, pricing jsonb, discovery jsonb, policy_snapshot jsonb,
  reason text,
  client_user_id uuid REFERENCES auth.users(id),
  conversion_status text NOT NULL DEFAULT 'PENDING' CHECK (conversion_status IN ('PENDING','SCANNED','VIEWED','INTERESTED','LOGIN_STARTED','SIGNED_UP','ONBOARDING_STARTED','ACTIVATED','DECLINED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'READY' OR pricing IS NOT NULL),
  CHECK (status NOT IN ('FAILED','REVIEW_REQUIRED','EXPIRED') OR pricing IS NULL)
);
CREATE INDEX ON public.agent_assessments(agent_id, created_at DESC);
CREATE INDEX ON public.agent_assessments(client_user_id);
CREATE TABLE public.agent_assessment_handoffs (
  assessment_id uuid PRIMARY KEY REFERENCES public.agent_assessments(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  claimed_by uuid REFERENCES auth.users(id), claimed_at timestamptz
);
CREATE TABLE public.agent_assessment_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assessment_id uuid REFERENCES public.agent_assessments(id),
  actor_id uuid, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_pricing_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assessment_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assessment_audit ENABLE ROW LEVEL SECURITY;
-- All access is via authenticated server functions; service credential never reaches the browser.
REVOKE ALL ON public.agent_memberships, public.agent_pricing_policy, public.agent_assessments, public.agent_assessment_handoffs, public.agent_assessment_audit FROM anon, authenticated;
GRANT ALL ON public.agent_memberships, public.agent_pricing_policy, public.agent_assessments, public.agent_assessment_handoffs, public.agent_assessment_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agent_assessment_audit_id_seq TO service_role;

CREATE FUNCTION public.agent_assessment_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER agent_assessment_updated BEFORE UPDATE ON public.agent_assessments FOR EACH ROW EXECUTE FUNCTION public.agent_assessment_changed();
CREATE FUNCTION public.agent_assessment_audited() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.agent_assessment_audit(assessment_id, actor_id, action)
  VALUES (NEW.id, auth.uid(), TG_OP || ':' || NEW.status || ':' || NEW.stage || ':' || NEW.conversion_status);
  RETURN NEW;
END $$;
CREATE TRIGGER agent_assessment_audit AFTER INSERT OR UPDATE ON public.agent_assessments FOR EACH ROW EXECUTE FUNCTION public.agent_assessment_audited();

-- Serialized per actor: duplicate and rate checks cannot race across server instances.
CREATE FUNCTION public.agent_create_assessment(p_actor uuid, p_name text, p_url text, p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing uuid; result uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));
  IF NOT (EXISTS (SELECT 1 FROM agent_memberships WHERE user_id=p_actor AND active)
    OR has_role(p_actor,'admin') OR has_role(p_actor,'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT id INTO existing FROM agent_assessments WHERE agent_id=p_actor AND dedup_key=p_key
    AND created_at > now()-interval '24 hours' AND status NOT IN ('FAILED','EXPIRED') ORDER BY created_at DESC LIMIT 1;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  IF (SELECT count(*) FROM agent_assessments WHERE agent_id=p_actor AND created_at > now()-interval '1 hour') >= 10
     OR (SELECT count(*) FROM agent_assessments WHERE agent_id=p_actor AND created_at > now()-interval '1 day') >= 40
  THEN RAISE EXCEPTION 'Assessment limit reached. Please try again later.'; END IF;
  INSERT INTO agent_assessments(agent_id,artist_name,official_profile_url,dedup_key)
    VALUES(p_actor,p_name,p_url,p_key) RETURNING id INTO result;
  INSERT INTO agent_assessment_audit(assessment_id,actor_id,action) VALUES(result,p_actor,'SCAN_REQUESTED');
  RETURN result;
END $$;

-- Tokens are one assessment / one client; replays are idempotent only for that client.
CREATE FUNCTION public.agent_claim_assessment(p_hash text, p_client uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h agent_assessment_handoffs; a agent_assessments;
BEGIN
  SELECT * INTO h FROM agent_assessment_handoffs WHERE token_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR h.expires_at <= now() OR (h.claimed_by IS NOT NULL AND h.claimed_by <> p_client) THEN RAISE EXCEPTION 'Invalid or expired assessment reference.'; END IF;
  SELECT * INTO a FROM agent_assessments WHERE id=h.assessment_id FOR UPDATE;
  IF a.agent_id=p_client OR EXISTS(SELECT 1 FROM agent_memberships WHERE user_id=p_client AND active)
     OR has_role(p_client,'admin') OR has_role(p_client,'super_admin') THEN RAISE EXCEPTION 'Use the client account to continue.'; END IF;
  IF a.status <> 'READY' OR (a.client_user_id IS NOT NULL AND a.client_user_id <> p_client) THEN RAISE EXCEPTION 'Assessment cannot be linked.'; END IF;
  IF h.claimed_by = p_client THEN RETURN a.id; END IF;
  UPDATE agent_assessment_handoffs SET claimed_by=p_client,claimed_at=now() WHERE assessment_id=a.id;
  UPDATE agent_assessments SET client_user_id=p_client, conversion_status=CASE
    WHEN EXISTS(SELECT 1 FROM client_profiles WHERE user_id=p_client AND onboarding_completed) THEN 'ACTIVATED'
    WHEN EXISTS(SELECT 1 FROM onboarding_progress WHERE user_id=p_client) THEN 'ONBOARDING_STARTED'
    ELSE 'SIGNED_UP' END WHERE id=a.id;
  INSERT INTO agent_assessment_audit(assessment_id,actor_id,action) VALUES(a.id,p_client,'ASSESSMENT_LINKED');
  RETURN a.id;
END $$;

-- Observe existing lifecycle changes without altering how onboarding completes.
CREATE FUNCTION public.agent_observe_client_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'client_profiles' THEN
    IF NEW.onboarding_completed THEN
      UPDATE agent_assessments SET conversion_status='ACTIVATED' WHERE client_user_id=NEW.user_id AND conversion_status <> 'ACTIVATED';
    END IF;
  ELSE
    UPDATE agent_assessments SET conversion_status='ONBOARDING_STARTED' WHERE client_user_id=NEW.user_id AND conversion_status IN ('SIGNED_UP','LOGIN_STARTED','INTERESTED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_client_activated AFTER INSERT OR UPDATE OF onboarding_completed ON public.client_profiles FOR EACH ROW EXECUTE FUNCTION public.agent_observe_client_lifecycle();
CREATE TRIGGER agent_client_onboarding AFTER INSERT ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.agent_observe_client_lifecycle();
REVOKE ALL ON FUNCTION public.agent_create_assessment(uuid,text,text,text), public.agent_claim_assessment(text,uuid), public.agent_assessment_changed(), public.agent_assessment_audited(), public.agent_observe_client_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_create_assessment(uuid,text,text,text), public.agent_claim_assessment(text,uuid) TO service_role;

CREATE FUNCTION public.agent_update_configuration(p_actor uuid, p_change jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (has_role(p_actor,'admin') OR has_role(p_actor,'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_change->>'kind' = 'member' THEN
    INSERT INTO agent_memberships(user_id, active) VALUES((p_change->>'user_id')::uuid,(p_change->>'active')::boolean)
      ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,updated_at=now();
  ELSIF p_change->>'kind' = 'pricing' THEN
    UPDATE agent_pricing_policy SET version=version+1,
      enabled=(p_change->'policy'->>'enabled')::boolean,
      minimum_pages=(p_change->'policy'->>'minimum_pages')::integer,
      minimum_domains=(p_change->'policy'->>'minimum_domains')::integer,
      base_annual=(p_change->'policy'->>'base_annual')::numeric,
      annual_per_domain=(p_change->'policy'->>'annual_per_domain')::numeric,
      review_minutes_per_page_month=(p_change->'policy'->>'review_minutes_per_page_month')::numeric,
      hourly_review_rate=(p_change->'policy'->>'hourly_review_rate')::numeric,
      range_margin=(p_change->'policy'->>'range_margin')::numeric WHERE id=true;
  ELSE RAISE EXCEPTION 'Invalid configuration action'; END IF;
  INSERT INTO agent_assessment_audit(actor_id,action) VALUES(p_actor, 'ADMIN_CONFIG:' || p_change::text);
END $$;
REVOKE ALL ON FUNCTION public.agent_update_configuration(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_update_configuration(uuid,jsonb) TO service_role;
