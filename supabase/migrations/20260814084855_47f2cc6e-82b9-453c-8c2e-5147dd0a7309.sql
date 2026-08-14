CREATE TABLE IF NOT EXISTS public.enforcement_recipient_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('ADDRESS', 'DOMAIN')),
  value text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  approved_by uuid,
  approved_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enforcement_recipient_allowlist_value_key
  ON public.enforcement_recipient_allowlist (entry_type, lower(value));

GRANT SELECT ON public.enforcement_recipient_allowlist TO authenticated;
GRANT ALL ON public.enforcement_recipient_allowlist TO service_role;
ALTER TABLE public.enforcement_recipient_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read recipient allowlist"
  ON public.enforcement_recipient_allowlist FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "admins manage recipient allowlist"
  ON public.enforcement_recipient_allowlist FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_enforcement_recipient_allowlist_updated
  BEFORE UPDATE ON public.enforcement_recipient_allowlist
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.enforcement_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'RESEND',
  event_type text NOT NULL,
  normalized_type text NOT NULL,
  provider_message_id text,
  recipient text,
  user_id uuid,
  case_id uuid,
  delivery_id uuid,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enforcement_provider_events_dedupe
  ON public.enforcement_provider_events (provider, coalesce(provider_message_id, ''), event_type, occurred_at);
CREATE INDEX IF NOT EXISTS enforcement_provider_events_recent
  ON public.enforcement_provider_events (created_at DESC);

GRANT SELECT ON public.enforcement_provider_events TO authenticated;
GRANT ALL ON public.enforcement_provider_events TO service_role;
ALTER TABLE public.enforcement_provider_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own provider events read"
  ON public.enforcement_provider_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.enforcement_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'RESEND_WEBHOOK',
  active boolean NOT NULL DEFAULT true,
  provider_event_id uuid REFERENCES public.enforcement_provider_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS enforcement_suppressions_email_key
  ON public.enforcement_suppressions (lower(email));

GRANT SELECT ON public.enforcement_suppressions TO authenticated;
GRANT ALL ON public.enforcement_suppressions TO service_role;
ALTER TABLE public.enforcement_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read suppressions"
  ON public.enforcement_suppressions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_enforcement_suppressions_updated
  BEFORE UPDATE ON public.enforcement_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.enforcement_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforcement_audit_append_only() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_enforcement_events_append_only ON public.enforcement_events;
CREATE TRIGGER trg_enforcement_events_append_only
  BEFORE UPDATE OR DELETE ON public.enforcement_events
  FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();

DROP TRIGGER IF EXISTS trg_enforcement_email_deliveries_append_only ON public.enforcement_email_deliveries;
CREATE TRIGGER trg_enforcement_email_deliveries_append_only
  BEFORE UPDATE OR DELETE ON public.enforcement_email_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();

DROP TRIGGER IF EXISTS trg_production_submission_snapshots_append_only ON public.production_submission_snapshots;
CREATE TRIGGER trg_production_submission_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.production_submission_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();

DROP TRIGGER IF EXISTS trg_enforcement_provider_events_append_only ON public.enforcement_provider_events;
CREATE TRIGGER trg_enforcement_provider_events_append_only
  BEFORE UPDATE OR DELETE ON public.enforcement_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();

CREATE OR REPLACE FUNCTION public.claim_next_enforcement_job(p_worker_id text)
RETURNS SETOF public.enforcement_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  SELECT id INTO v_job_id
  FROM public.enforcement_jobs
  WHERE status = 'queued'
    AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.enforcement_jobs
  SET status = 'processing',
      locked_by = p_worker_id,
      locked_at = now(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = v_job_id
    AND status = 'queued'
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_enforcement_job(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_next_enforcement_job(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_enforcement_job(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_route_outcome(p_domain text, p_outcome text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.domain_enforcement_routes
  SET notes = left('last_outcome=' || p_outcome || ' @ ' || now()::text, 500),
      updated_at = now()
  WHERE domain = p_domain;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_route_outcome(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_route_outcome(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_route_outcome(text, text) TO service_role;