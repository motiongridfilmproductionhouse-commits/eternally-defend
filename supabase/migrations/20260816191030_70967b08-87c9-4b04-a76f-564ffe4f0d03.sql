CREATE TABLE IF NOT EXISTS public.deepfake_google_images_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL,
  user_id UUID NOT NULL,
  identity_id UUID,
  query TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expiry TIMESTAMPTZ,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deepfake_google_images_jobs_scan_query_key UNIQUE (scan_id, query)
);

CREATE INDEX IF NOT EXISTS idx_dgij_scan_status
  ON public.deepfake_google_images_jobs (scan_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_dgij_user
  ON public.deepfake_google_images_jobs (user_id, created_at DESC);

GRANT SELECT ON public.deepfake_google_images_jobs TO authenticated;
GRANT ALL ON public.deepfake_google_images_jobs TO service_role;

ALTER TABLE public.deepfake_google_images_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own image investigation jobs"
  ON public.deepfake_google_images_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_dgij_updated
BEFORE UPDATE ON public.deepfake_google_images_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.deepfake_worker_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL,
  worker_execution_id TEXT NOT NULL,
  request_id TEXT,
  event_name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_category TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dwe_scan_created
  ON public.deepfake_worker_events (scan_id, created_at);

GRANT SELECT ON public.deepfake_worker_events TO authenticated;
GRANT ALL ON public.deepfake_worker_events TO service_role;

ALTER TABLE public.deepfake_worker_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read worker events"
  ON public.deepfake_worker_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_deepfake_worker_events_append_only
BEFORE UPDATE OR DELETE ON public.deepfake_worker_events
FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();