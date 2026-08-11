-- 1. client_enforcement_settings
CREATE TABLE public.client_enforcement_settings (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  automatic_enforcement_enabled BOOLEAN NOT NULL DEFAULT false,
  production_enforcement_approved BOOLEAN NOT NULL DEFAULT false,
  enforcement_basis_policies JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_enforcement_settings TO authenticated;
GRANT ALL ON public.client_enforcement_settings TO service_role;
ALTER TABLE public.client_enforcement_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement settings" ON public.client_enforcement_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_client_enforcement_settings_updated BEFORE UPDATE ON public.client_enforcement_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. asset_enforcement_settings
CREATE TABLE public.asset_enforcement_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL,
  production_enforcement_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_enforcement_settings TO authenticated;
GRANT ALL ON public.asset_enforcement_settings TO service_role;
ALTER TABLE public.asset_enforcement_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own asset enforcement settings" ON public.asset_enforcement_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_asset_enforcement_settings_updated BEFORE UPDATE ON public.asset_enforcement_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. domain_enforcement_routes (shared directory)
CREATE TABLE public.domain_enforcement_routes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  contact TEXT,
  copyright_email TEXT,
  abuse_email TEXT,
  contact_type TEXT DEFAULT 'COPYRIGHT',
  preferred_method TEXT DEFAULT 'EMAIL',
  verification_status TEXT NOT NULL DEFAULT 'DISCOVERED_UNVERIFIED',
  verification_method TEXT,
  source_url TEXT,
  confidence NUMERIC DEFAULT 0,
  notes TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.domain_enforcement_routes TO authenticated;
GRANT ALL ON public.domain_enforcement_routes TO service_role;
ALTER TABLE public.domain_enforcement_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read routes" ON public.domain_enforcement_routes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated add routes" ON public.domain_enforcement_routes
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update routes" ON public.domain_enforcement_routes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_domain_enforcement_routes_updated BEFORE UPDATE ON public.domain_enforcement_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. enforcement_cases
CREATE TABLE public.enforcement_cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  protected_asset_id UUID,
  target_url TEXT NOT NULL,
  domain TEXT,
  platform TEXT,
  enforcement_basis TEXT,
  eligibility_status TEXT,
  eligibility_reason JSONB,
  authorization_status TEXT,
  selected_route TEXT,
  connector_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  reupload_count INTEGER NOT NULL DEFAULT 0,
  next_verification_at TIMESTAMPTZ,
  last_verification_at TIMESTAMPTZ,
  verification_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enforcement_cases_user_created ON public.enforcement_cases (user_id, created_at DESC);
CREATE UNIQUE INDEX idx_enforcement_cases_dedupe ON public.enforcement_cases (user_id, target_url, enforcement_basis);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_cases TO authenticated;
GRANT ALL ON public.enforcement_cases TO service_role;
ALTER TABLE public.enforcement_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement cases" ON public.enforcement_cases
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_enforcement_cases_updated BEFORE UPDATE ON public.enforcement_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. enforcement_events
CREATE TABLE public.enforcement_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protected_asset_id UUID,
  authorization_id UUID,
  target_url TEXT,
  enforcement_basis TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'SYSTEM',
  connector_id TEXT,
  worker_id TEXT,
  previous_state TEXT,
  new_state TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enforcement_events_user_created ON public.enforcement_events (user_id, created_at DESC);
CREATE INDEX idx_enforcement_events_case ON public.enforcement_events (case_id);
GRANT SELECT, INSERT ON public.enforcement_events TO authenticated;
GRANT ALL ON public.enforcement_events TO service_role;
ALTER TABLE public.enforcement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement events read" ON public.enforcement_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own enforcement events write" ON public.enforcement_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 6. enforcement_jobs
CREATE TABLE public.enforcement_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enforcement_jobs_queue ON public.enforcement_jobs (status, scheduled_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_jobs TO authenticated;
GRANT ALL ON public.enforcement_jobs TO service_role;
ALTER TABLE public.enforcement_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement jobs" ON public.enforcement_jobs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_enforcement_jobs_updated BEFORE UPDATE ON public.enforcement_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. enforcement_review_queue
CREATE TABLE public.enforcement_review_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason JSONB,
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  reviewer_id UUID,
  reviewer_notes TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enforcement_review_queue_user ON public.enforcement_review_queue (user_id, review_status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_review_queue TO authenticated;
GRANT ALL ON public.enforcement_review_queue TO service_role;
ALTER TABLE public.enforcement_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement review queue" ON public.enforcement_review_queue
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_enforcement_review_queue_updated BEFORE UPDATE ON public.enforcement_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. production_submission_snapshots
CREATE TABLE public.production_submission_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protected_asset_id UUID,
  authorization_id UUID,
  copyright_owner TEXT,
  target_url TEXT NOT NULL,
  target_domain TEXT,
  enforcement_basis TEXT,
  verified_route JSONB,
  recipient TEXT,
  notice_subject TEXT,
  notice_hash TEXT,
  worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_production_submission_snapshots_case ON public.production_submission_snapshots (case_id);
GRANT SELECT, INSERT ON public.production_submission_snapshots TO authenticated;
GRANT ALL ON public.production_submission_snapshots TO service_role;
ALTER TABLE public.production_submission_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own submission snapshots read" ON public.production_submission_snapshots
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own submission snapshots write" ON public.production_submission_snapshots
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);