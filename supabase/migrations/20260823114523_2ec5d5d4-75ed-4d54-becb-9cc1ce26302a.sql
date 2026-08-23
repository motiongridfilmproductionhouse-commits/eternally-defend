ALTER TABLE public.generated_reports
  ADD COLUMN IF NOT EXISTS module_key text,
  ADD COLUMN IF NOT EXISTS scan_id uuid,
  ADD COLUMN IF NOT EXISTS run_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS discovered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligible_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS not_eligible_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS generated_reports_scan_run_uniq
  ON public.generated_reports (user_id, module_key, scan_id)
  WHERE module_key IS NOT NULL AND scan_id IS NOT NULL;