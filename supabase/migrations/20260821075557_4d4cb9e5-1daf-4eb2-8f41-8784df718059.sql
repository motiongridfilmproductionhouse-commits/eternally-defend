ALTER TABLE public.protection_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS protection_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS continuous_monitoring_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorization_id uuid,
  ADD COLUMN IF NOT EXISTS authorization_level text;

ALTER TABLE public.protection_targets
  ADD COLUMN IF NOT EXISTS initial_scan_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_scan_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_scan_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS initial_scan_ref text,
  ADD COLUMN IF NOT EXISTS evidence_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS enforcement_case_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorization_id uuid;