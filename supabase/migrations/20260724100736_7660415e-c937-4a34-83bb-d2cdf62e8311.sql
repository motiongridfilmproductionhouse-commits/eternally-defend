-- Enums
DO $$ BEGIN CREATE TYPE public.automation_platform AS ENUM ('youtube'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.automation_adapter AS ENUM ('youtube_copyright','youtube_community'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.automation_job_status AS ENUM ('queued','running','review_ready','submitted','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.platform_credential_status AS ENUM ('active','expired','login_required'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. platform_credentials
CREATE TABLE IF NOT EXISTS public.platform_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform public.automation_platform NOT NULL,
  label text,
  storage_state_ciphertext text NOT NULL,
  login_email_ciphertext text,
  mfa_hint text,
  status public.platform_credential_status NOT NULL DEFAULT 'active',
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_credentials TO authenticated;
GRANT ALL ON public.platform_credentials TO service_role;
ALTER TABLE public.platform_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own credentials read"   ON public.platform_credentials FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own credentials insert" ON public.platform_credentials FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own credentials update" ON public.platform_credentials FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own credentials delete" ON public.platform_credentials FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_platform_credentials_updated BEFORE UPDATE ON public.platform_credentials FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. automation_jobs
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id uuid NOT NULL REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  platform public.automation_platform NOT NULL,
  adapter public.automation_adapter NOT NULL,
  status public.automation_job_status NOT NULL DEFAULT 'queued',
  worker_id text,
  attempts int NOT NULL DEFAULT 0,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_summary_json jsonb,
  review_bundle_path text,
  cdp_ws_url text,
  cdp_expires_at timestamptz,
  error_json jsonb,
  last_screenshot_path text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_user_created ON public.automation_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_status ON public.automation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_request ON public.automation_jobs (enforcement_request_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_jobs TO authenticated;
GRANT ALL ON public.automation_jobs TO service_role;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs read"   ON public.automation_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own jobs insert" ON public.automation_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs update" ON public.automation_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_automation_jobs_updated BEFORE UPDATE ON public.automation_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. automation_events (audit log — insert-only for owner)
CREATE TABLE IF NOT EXISTS public.automation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.automation_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  platform public.automation_platform,
  duration_ms int,
  result text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshot_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_events_job_created ON public.automation_events (job_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_automation_events_user ON public.automation_events (user_id, created_at DESC);
GRANT SELECT, INSERT ON public.automation_events TO authenticated;
GRANT ALL ON public.automation_events TO service_role;
ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read"   ON public.automation_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.automation_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4. Extend enforcement_requests
ALTER TABLE public.enforcement_requests
  ADD COLUMN IF NOT EXISTS automation_job_id uuid REFERENCES public.automation_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_status public.automation_job_status,
  ADD COLUMN IF NOT EXISTS human_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS human_submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;