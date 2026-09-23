-- Pre-Enrollment Intelligence — no service-role dependency.
--
-- The staff pre-enrollment feature must run with only SUPABASE_URL and
-- SUPABASE_PUBLISHABLE_KEY. Three access paths replace the service-role client:
--
--   1. Staff-driven steps use the staff member's own session (existing staff
--      RLS policies already cover every table the runner writes).
--   2. The background worker uses the publishable key and presents the managed
--      `prospect_scan_worker` token (internal_cron_secrets) in the
--      `x-prospect-worker-token` request header. RLS policies below admit that
--      header on the prospect scan tables only; the token check runs inside the
--      database, so the token is never readable by any client role.
--   3. Enrollment hand-off consumption runs through SECURITY DEFINER functions
--      that check auth.uid() (client owns the package) or the staff role.

-- ---------------------------------------------------------------------------
-- 1. Worker credential checks (token never leaves the database)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospect_worker_token_valid(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(length(_token), 0) >= 32 AND EXISTS (
    SELECT 1 FROM public.internal_cron_secrets s
    WHERE s.name = 'prospect_scan_worker' AND s.token = _token
  );
$$;
REVOKE ALL ON FUNCTION public.prospect_worker_token_valid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prospect_worker_token_valid(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_prospect_worker()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  presented text;
BEGIN
  BEGIN
    presented := current_setting('request.headers', true)::json ->> 'x-prospect-worker-token';
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  RETURN public.prospect_worker_token_valid(presented);
END;
$$;
REVOKE ALL ON FUNCTION public.is_prospect_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_prospect_worker() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Worker access to the scan tables (publishable key + worker header only)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.prospect_identities TO anon;
GRANT SELECT, UPDATE ON public.prospect_scans TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_scan_sources TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_scan_capabilities TO anon;
GRANT SELECT, INSERT ON public.prospect_scan_events TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.prospect_scan_events_id_seq TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_discoveries TO anon;
GRANT SELECT, INSERT ON public.prospect_discovery_observations TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_findings TO anon;
GRANT SELECT, INSERT ON public.prospect_finding_evidence TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_propagation_clusters TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_cluster_members TO anon;
GRANT SELECT, INSERT ON public.prospect_risk_scores TO anon;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('prospect_identities',            'SELECT'),
      ('prospect_scans',                 'SELECT'),
      ('prospect_scans',                 'UPDATE'),
      ('prospect_scan_sources',          'ALL'),
      ('prospect_scan_capabilities',     'ALL'),
      ('prospect_scan_events',           'SELECT'),
      ('prospect_scan_events',           'INSERT'),
      ('prospect_discoveries',           'SELECT'),
      ('prospect_discoveries',           'INSERT'),
      ('prospect_discoveries',           'UPDATE'),
      ('prospect_discovery_observations','SELECT'),
      ('prospect_discovery_observations','INSERT'),
      ('prospect_findings',              'ALL'),
      ('prospect_finding_evidence',      'SELECT'),
      ('prospect_finding_evidence',      'INSERT'),
      ('prospect_propagation_clusters',  'ALL'),
      ('prospect_cluster_members',       'ALL'),
      ('prospect_risk_scores',           'SELECT'),
      ('prospect_risk_scores',           'INSERT')
    ) AS v(tbl, op)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Worker ' || lower(t.op) || ' ' || t.tbl, t.tbl);
    IF t.op = 'SELECT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING ((SELECT public.is_prospect_worker()))',
        'Worker ' || lower(t.op) || ' ' || t.tbl, t.tbl);
    ELSIF t.op = 'INSERT' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK ((SELECT public.is_prospect_worker()))',
        'Worker ' || lower(t.op) || ' ' || t.tbl, t.tbl);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR %s TO anon USING ((SELECT public.is_prospect_worker())) WITH CHECK ((SELECT public.is_prospect_worker()))',
        'Worker ' || lower(t.op) || ' ' || t.tbl, t.tbl, t.op);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Immediate worker kick when a scan is created (token read in-database)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prospect_scans_dispatch_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tok text;
BEGIN
  SELECT token INTO tok FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker';
  IF tok IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://project--cee11c03-c063-46d5-9436-8e007b1b3e97.lovable.app/api/public/hooks/prospect-scan-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || tok
        ),
        body := jsonb_build_object('scan_id', NEW.id, 'hop', 0)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never block scan creation; pg_cron resumes the scan within a minute.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_scans_dispatch_worker() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prospect_scans_dispatch_worker ON public.prospect_scans;
CREATE TRIGGER trg_prospect_scans_dispatch_worker
  AFTER INSERT ON public.prospect_scans
  FOR EACH ROW EXECUTE FUNCTION public.prospect_scans_dispatch_worker();

-- ---------------------------------------------------------------------------
-- 4. Enrollment hand-off consumption without the service role
-- ---------------------------------------------------------------------------

-- Internal: import a package's transferred, human-verified, identity-matched
-- findings (with evidence references) into the client's review-only table.
-- Idempotent via UNIQUE (client_user_id, prospect_finding_id). Not callable
-- by any client role directly.
CREATE OR REPLACE FUNCTION public._prospect_import_package_findings(_package_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg public.prospect_enrollment_packages%ROWTYPE;
  inserted integer := 0;
BEGIN
  SELECT * INTO pkg FROM public.prospect_enrollment_packages WHERE id = _package_id;
  IF pkg.id IS NULL OR pkg.client_user_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH ins AS (
    INSERT INTO public.client_prospect_findings (
      package_id, client_user_id, prospect_scan_id, prospect_finding_id,
      stage_key, category, severity, detection_reason, confidence,
      source_url, canonical_url, platform, title, discovery_method,
      identity_confidence, finding_state, verified_by, verified_at, evidence_refs
    )
    SELECT
      pkg.id, pkg.client_user_id, f.scan_id, f.id,
      f.stage_key, f.category, f.severity, f.detection_reason, f.confidence,
      d.original_url, d.canonical_url, d.platform, d.title, d.discovery_method,
      d.identity_confidence, f.state::text, f.verified_by, f.verified_at,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'evidence_id', e.id,
                 'source_url', e.source_url,
                 'capture_path', e.capture_path,
                 'capture_kind', e.capture_kind,
                 'content_hash', e.content_hash,
                 'observed_at', e.observed_at
               ) ORDER BY e.observed_at)
        FROM public.prospect_finding_evidence e
        WHERE e.finding_id = f.id
      ), '[]'::jsonb)
    FROM public.prospect_enrollment_transfers t
    JOIN public.prospect_findings f ON f.id = t.finding_id
    JOIN public.prospect_discoveries d ON d.id = f.discovery_id
    WHERE t.scan_id = pkg.scan_id
      AND t.target_table = 'enrollment_finding'
      AND f.state::text IN ('VERIFIED', 'ESCALATED')
      AND d.identity_bucket::text = 'MATCHED'
    ON CONFLICT (client_user_id, prospect_finding_id) DO NOTHING
    RETURNING id, prospect_finding_id
  ), linked AS (
    UPDATE public.prospect_enrollment_transfers t
       SET target_id = ins.id, target_user_id = pkg.client_user_id
      FROM ins
     WHERE t.scan_id = pkg.scan_id
       AND t.target_table = 'enrollment_finding'
       AND t.finding_id = ins.prospect_finding_id
    RETURNING t.id
  )
  SELECT count(*) INTO inserted FROM ins;

  UPDATE public.prospect_enrollment_transfers
     SET target_user_id = pkg.client_user_id, target_id = pkg.id
   WHERE scan_id = pkg.scan_id
     AND target_table = 'enrollment_identity'
     AND target_user_id IS NULL;

  UPDATE public.prospect_enrollment_packages
     SET findings_imported = (
       SELECT count(*) FROM public.client_prospect_findings c WHERE c.package_id = pkg.id
     )
   WHERE id = pkg.id;

  RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public._prospect_import_package_findings(uuid) FROM PUBLIC, anon, authenticated;

-- Client: link packages issued with an invitation this account redeemed, then
-- return every package linked to the caller.
CREATE OR REPLACE FUNCTION public.prospect_claim_my_packages()
RETURNS TABLE (
  id uuid,
  scan_id uuid,
  identity_snapshot jsonb,
  profile_prefilled_at timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.prospect_enrollment_packages p
     SET client_user_id = uid, status = 'LINKED', linked_at = now()
   WHERE p.client_user_id IS NULL
     AND p.invite_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.signup_invite_redemptions r
       WHERE r.invite_id = p.invite_id AND r.user_id = uid
     );
  RETURN QUERY
    SELECT p.id, p.scan_id, p.identity_snapshot, p.profile_prefilled_at, p.status
      FROM public.prospect_enrollment_packages p
     WHERE p.client_user_id = uid
     ORDER BY p.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_claim_my_packages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_claim_my_packages() TO authenticated;

-- Client: record that the caller's own profile was pre-filled from a package.
CREATE OR REPLACE FUNCTION public.prospect_mark_my_package_prefilled(_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.prospect_enrollment_packages
     SET profile_prefilled_at = coalesce(profile_prefilled_at, now()),
         applied_at = coalesce(applied_at, now()),
         status = 'APPLIED'
   WHERE id = _package_id
     AND client_user_id = auth.uid();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_mark_my_package_prefilled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_mark_my_package_prefilled(uuid) TO authenticated;

-- Client: import findings for every package linked to the caller.
CREATE OR REPLACE FUNCTION public.prospect_import_my_findings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  pkg_id uuid;
  total integer := 0;
BEGIN
  IF uid IS NULL THEN
    RETURN 0;
  END IF;
  FOR pkg_id IN
    SELECT p.id FROM public.prospect_enrollment_packages p WHERE p.client_user_id = uid
  LOOP
    total := total + public._prospect_import_package_findings(pkg_id);
  END LOOP;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_import_my_findings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_import_my_findings() TO authenticated;

-- Staff: deliver newly selected findings to an already-linked client.
CREATE OR REPLACE FUNCTION public.prospect_import_package_findings(_package_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_prospect_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff role required' USING ERRCODE = '42501';
  END IF;
  RETURN public._prospect_import_package_findings(_package_id);
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_import_package_findings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_import_package_findings(uuid) TO authenticated;

-- Staff admin: link a package to an existing client account by the email on
-- the client's onboarding profile. Returns the client user id, or NULL when no
-- single client profile uses that email.
CREATE OR REPLACE FUNCTION public.prospect_link_package_to_client_email(_package_id uuid, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target uuid;
  matches integer;
  current_owner uuid;
BEGIN
  IF NOT public.is_prospect_staff(caller)
     OR NOT (public.has_role(caller, 'admin') OR public.has_role(caller, 'super_admin')) THEN
    RAISE EXCEPTION 'admin staff role required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), min(cp.user_id::text)::uuid INTO matches, target
    FROM public.client_profiles cp
   WHERE lower(cp.email) = lower(trim(_email));
  IF matches <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT client_user_id INTO current_owner
    FROM public.prospect_enrollment_packages WHERE id = _package_id;
  IF current_owner IS NOT NULL AND current_owner <> target THEN
    RAISE EXCEPTION 'This enrollment package is already linked to a different account.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.prospect_enrollment_packages
     SET client_user_id = target, status = 'LINKED', linked_at = coalesce(linked_at, now())
   WHERE id = _package_id AND client_user_id IS NULL;

  PERFORM public._prospect_import_package_findings(_package_id);
  RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_link_package_to_client_email(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prospect_link_package_to_client_email(uuid, text) TO authenticated;
