-- Staff Pre-Enrollment Intelligence — runner hardening.
--
-- 1. Makes the staff grant and the private evidence bucket reproducible from
--    migrations (they were previously applied directly to the live database).
-- 2. One discovery row per canonical URL per scan: providers return different
--    titles/snippets for the same page, so the (url, fingerprint) key alone could
--    count one page twice.
-- 3. Identity-bucket changes on a stored discovery require an audited staff
--    decision (identity review), mirroring the finding-state guard.
-- 4. A finding that reached a human decision state can only leave it through
--    another audited staff decision.

-- 1a. Private evidence bucket (idempotent).
INSERT INTO storage.buckets (id, name, public)
VALUES ('prospect-evidence', 'prospect-evidence', false)
ON CONFLICT (id) DO NOTHING;

-- 1b. Initial staff account, through the existing role system (no-op if the
--     auth user does not exist yet or already holds the role).
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'staff'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'hellosreehari@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. One row per canonical URL per scan.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_discoveries_scan_canonical_uidx
  ON public.prospect_discoveries (scan_id, canonical_url);

-- Distinct-content lookups for propagation clustering.
CREATE INDEX IF NOT EXISTS prospect_discoveries_fingerprint_idx
  ON public.prospect_discoveries (scan_id, content_fingerprint)
  WHERE content_fingerprint <> '';

-- 3. Discovery guard: provenance immutable; identity changes need a staff decision.
CREATE OR REPLACE FUNCTION public.prospect_discoveries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prospect_discoveries is append-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.scan_id IS DISTINCT FROM OLD.scan_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.original_url IS DISTINCT FROM OLD.original_url
     OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url
     OR NEW.content_fingerprint IS DISTINCT FROM OLD.content_fingerprint
     OR NEW.discovery_method IS DISTINCT FROM OLD.discovery_method
     OR NEW.family_key IS DISTINCT FROM OLD.family_key
     OR NEW.retrieved_at IS DISTINCT FROM OLD.retrieved_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.identity_confidence IS DISTINCT FROM OLD.identity_confidence
     OR NEW.identity_factors IS DISTINCT FROM OLD.identity_factors THEN
    RAISE EXCEPTION 'prospect_discoveries provenance and identity-evidence columns are immutable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.identity_bucket IS DISTINCT FROM OLD.identity_bucket THEN
    IF NEW.identity_approved_by IS NULL OR NEW.identity_approved_at IS NULL THEN
      RAISE EXCEPTION 'prospect_discoveries: identity change requires a staff reviewer'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_prospect_staff(NEW.identity_approved_by) THEN
      RAISE EXCEPTION 'prospect_discoveries: identity reviewer must be staff' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.prospect_staff_decisions d
      WHERE d.discovery_id = NEW.id
        AND d.actor_id = NEW.identity_approved_by
        AND d.action = 'identity_review'
        AND d.new_state = NEW.identity_bucket::text
    ) THEN
      RAISE EXCEPTION 'prospect_discoveries: an audited identity-review decision must accompany the change'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Finding guard: human states need an audited staff decision, both entering
--    and leaving them.
CREATE OR REPLACE FUNCTION public.prospect_findings_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  human_states text[] := ARRAY['VERIFIED','REJECTED','ESCALATED'];
BEGIN
  IF NEW.state::text = ANY (human_states)
     OR (TG_OP = 'UPDATE' AND OLD.state::text = ANY (human_states) AND NEW.state IS DISTINCT FROM OLD.state) THEN
    IF NEW.verified_by IS NULL OR NEW.verified_at IS NULL THEN
      RAISE EXCEPTION 'prospect_findings: % requires a staff actor (verified_by/verified_at)', NEW.state
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_prospect_staff(NEW.verified_by) THEN
      RAISE EXCEPTION 'prospect_findings: verified_by must be a staff user' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.prospect_staff_decisions d
      WHERE d.finding_id = NEW.id AND d.actor_id = NEW.verified_by AND d.new_state = NEW.state::text
    ) THEN
      RAISE EXCEPTION 'prospect_findings: an audited staff decision must accompany state %', NEW.state
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Realtime for live counters that read these tables.
DO $$ BEGIN
  ALTER TABLE public.prospect_scans REPLICA IDENTITY FULL;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.prospect_scans;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Display + provenance columns used by the live runner.
ALTER TABLE public.prospect_discoveries
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS media_kind text;
ALTER TABLE public.prospect_discovery_observations
  ADD COLUMN IF NOT EXISTS query_purpose text,
  ADD COLUMN IF NOT EXISTS discovery_method text;

-- 6. Step lease: the runner advances in short, resumable steps (serverless-safe);
--    a lease guarantees only one step runs for a scan at a time.
ALTER TABLE public.prospect_scans
  ADD COLUMN IF NOT EXISTS worker_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS worker_lease_id text;

-- Unit-record lookups (detail->>'unit') for resumable steps.
CREATE INDEX IF NOT EXISTS prospect_scan_events_unit_idx
  ON public.prospect_scan_events (scan_id, id)
  WHERE (detail ->> 'unit') IS NOT NULL;
