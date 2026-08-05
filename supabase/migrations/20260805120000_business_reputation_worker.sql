-- Isolated Business Reputation worker runtime on the backwards-compatible
-- scans/scan_hits tables. Existing scan types keep their current behavior.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS scan_type TEXT NOT NULL DEFAULT 'legacy_web',
  ADD COLUMN IF NOT EXISTS scan_run_token UUID,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scan_checkpoint JSONB,
  ADD COLUMN IF NOT EXISTS discovery_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS brand_profile JSONB,
  ADD COLUMN IF NOT EXISTS query_plan JSONB,
  ADD COLUMN IF NOT EXISTS report_summary JSONB;

ALTER TABLE public.scans DROP CONSTRAINT IF EXISTS scans_status_check;
ALTER TABLE public.scans ADD CONSTRAINT scans_status_check
  CHECK (status IN ('queued','running','completed','completed_with_warnings','partial','failed','cancelled'));

ALTER TABLE public.scans
  DROP CONSTRAINT IF EXISTS business_scans_checkpoint_size_check;
ALTER TABLE public.scans ADD CONSTRAINT business_scans_checkpoint_size_check
  CHECK (scan_type <> 'business_reputation' OR scan_checkpoint IS NULL OR pg_column_size(scan_checkpoint) <= 262144);

CREATE INDEX IF NOT EXISTS idx_scans_business_type
  ON public.scans(user_id, created_at DESC)
  WHERE scan_type = 'business_reputation';
CREATE INDEX IF NOT EXISTS idx_scans_business_lease
  ON public.scans(lease_expires_at)
  WHERE scan_type = 'business_reputation' AND status = 'running';

CREATE TABLE IF NOT EXISTS public.business_reputation_worker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_execution_id TEXT NOT NULL,
  request_id TEXT,
  event_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_reputation_finding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('new','reappeared','removed','changed','rediscovered')),
  previous_scan_id UUID REFERENCES public.scans(id) ON DELETE SET NULL,
  previous_url TEXT,
  current_url TEXT,
  previous_severity TEXT,
  current_severity TEXT,
  previous_engagement BIGINT,
  current_engagement BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_finding_history_scan
  ON public.business_reputation_finding_history(scan_id, created_at DESC);
ALTER TABLE public.business_reputation_finding_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own business finding history" ON public.business_reputation_finding_history;
CREATE POLICY "own business finding history" ON public.business_reputation_finding_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.business_reputation_finding_history TO authenticated;
GRANT ALL ON public.business_reputation_finding_history TO service_role;

CREATE TABLE IF NOT EXISTS public.business_reputation_finding_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, finding_key)
);
ALTER TABLE public.business_reputation_finding_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own business finding snapshots" ON public.business_reputation_finding_snapshots;
CREATE POLICY "own business finding snapshots" ON public.business_reputation_finding_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.business_reputation_finding_snapshots TO authenticated;
GRANT ALL ON public.business_reputation_finding_snapshots TO service_role;

CREATE INDEX IF NOT EXISTS idx_business_worker_events_scan
  ON public.business_reputation_worker_events(scan_id, created_at DESC);
ALTER TABLE public.business_reputation_worker_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own business worker events" ON public.business_reputation_worker_events;
CREATE POLICY "own business worker events" ON public.business_reputation_worker_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.business_reputation_worker_events TO authenticated;
GRANT ALL ON public.business_reputation_worker_events TO service_role;

COMMENT ON COLUMN public.scans.brand_profile IS 'Confirmed Google Places business profile used as the discovery subject.';
COMMENT ON COLUMN public.scans.query_plan IS 'Server-generated Business Reputation query plan derived from brand_profile.';

CREATE OR REPLACE FUNCTION public.business_scans_protect_runtime_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.scan_type = 'business_reputation'
     AND coalesce(auth.role(), '') <> 'service_role'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.scan_type IS DISTINCT FROM OLD.scan_type
       OR NEW.scan_run_token IS DISTINCT FROM OLD.scan_run_token OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at
       OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at OR NEW.scan_checkpoint IS DISTINCT FROM OLD.scan_checkpoint
       OR NEW.discovery_metrics IS DISTINCT FROM OLD.discovery_metrics OR NEW.brand_profile IS DISTINCT FROM OLD.brand_profile
       OR NEW.query_plan IS DISTINCT FROM OLD.query_plan) THEN
    RAISE EXCEPTION 'business reputation scan runtime fields are server-managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_scans_protect_runtime_fields ON public.scans;
CREATE TRIGGER business_scans_protect_runtime_fields BEFORE UPDATE ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.business_scans_protect_runtime_fields();
