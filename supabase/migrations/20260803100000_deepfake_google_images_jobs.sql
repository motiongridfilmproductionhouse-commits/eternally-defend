-- Independent Google Images investigation job queue for Deepfake Intelligence.
-- Each row is one Google Images search query processed by a background worker.

CREATE TABLE IF NOT EXISTS public.deepfake_google_images_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.deepfake_scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  identity_id UUID NULL,
  query TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'partial', 'completed', 'failed', 'retryable')),
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  lease_owner TEXT NULL,
  lease_expiry TIMESTAMPTZ NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deepfake_google_images_jobs_scan_query_unique UNIQUE (scan_id, query)
);

CREATE INDEX IF NOT EXISTS idx_deepfake_google_images_jobs_scan_status
  ON public.deepfake_google_images_jobs (scan_id, status);

CREATE INDEX IF NOT EXISTS idx_deepfake_google_images_jobs_lease
  ON public.deepfake_google_images_jobs (status, lease_expiry)
  WHERE status IN ('queued', 'running', 'retryable');

CREATE INDEX IF NOT EXISTS idx_deepfake_google_images_jobs_claim
  ON public.deepfake_google_images_jobs (scan_id, priority, created_at)
  WHERE status IN ('queued', 'retryable');

COMMENT ON TABLE public.deepfake_google_images_jobs IS
  'Background Google Images investigation jobs — one row per search query.';

ALTER TABLE public.deepfake_google_images_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY deepfake_google_images_jobs_select_own
  ON public.deepfake_google_images_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY deepfake_google_images_jobs_service_all
  ON public.deepfake_google_images_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
