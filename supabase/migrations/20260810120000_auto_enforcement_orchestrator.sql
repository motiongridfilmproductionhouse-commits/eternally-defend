-- Auto-Enforcement Orchestrator Database Migration

-- 1. Client Enforcement Settings
CREATE TABLE IF NOT EXISTS public.client_enforcement_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  automatic_enforcement_enabled BOOLEAN NOT NULL DEFAULT false,
  enforcement_basis_policies JSONB NOT NULL DEFAULT '{
    "copyright": "AUTO",
    "impersonation": "AUTO",
    "deepfake": "AUTO",
    "privacy": "REVIEW",
    "harassment": "REVIEW",
    "legal_escalation": "MANUAL"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_enforcement_settings TO authenticated;
GRANT ALL ON public.client_enforcement_settings TO service_role;
ALTER TABLE public.client_enforcement_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own enforcement settings" ON public.client_enforcement_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Asset Enforcement Settings
CREATE TABLE IF NOT EXISTS public.asset_enforcement_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protected_asset_id TEXT NOT NULL,
  auto_protect BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, protected_asset_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_enforcement_settings TO authenticated;
GRANT ALL ON public.asset_enforcement_settings TO service_role;
ALTER TABLE public.asset_enforcement_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own asset settings" ON public.asset_enforcement_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Enforcement Connectors Registry
CREATE TABLE IF NOT EXISTS public.enforcement_connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  domain_pattern TEXT,
  supported_basis TEXT[] NOT NULL DEFAULT '{}',
  submission_method TEXT NOT NULL DEFAULT 'HUMAN_REQUIRED',
  endpoint TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  automation_allowed BOOLEAN NOT NULL DEFAULT true,
  requires_login BOOLEAN NOT NULL DEFAULT false,
  requires_human BOOLEAN NOT NULL DEFAULT false,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 100,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.enforcement_connectors TO authenticated;
GRANT ALL ON public.enforcement_connectors TO service_role;
ALTER TABLE public.enforcement_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view connectors" ON public.enforcement_connectors
  FOR SELECT TO authenticated USING (true);

-- Seed Default Connectors
INSERT INTO public.enforcement_connectors (id, name, platform, domain_pattern, supported_basis, submission_method, active, automation_allowed, requires_human, rate_limit_per_minute, rate_limit_per_hour)
VALUES
  ('youtube_copyright_connector', 'YouTube Copyright Connector', 'YouTube', 'youtube.com|youtu.be', ARRAY['COPYRIGHT'], 'APPROVED_INTEGRATION', true, true, false, 5, 50),
  ('google_search_delist_connector', 'Google Search Delisting Connector', 'Google', 'google.com', ARRAY['SEARCH_ENGINE_COPYRIGHT', 'COPYRIGHT', 'PRIVACY'], 'APPROVED_INTEGRATION', true, true, false, 10, 100),
  ('email_dmca_connector', 'Automated Email DMCA Connector', 'Email', '*', ARRAY['COPYRIGHT', 'WEBSITE_COPYRIGHT', 'IMPERSONATION', 'DEEPFAKE'], 'EMAIL', true, true, false, 20, 200),
  ('host_abuse_connector', 'Hosting Provider Abuse Connector', 'Host', '*', ARRAY['HOST_ESCALATION', 'WEBSITE_COPYRIGHT', 'NCII'], 'EMAIL', true, true, false, 10, 100),
  ('platform_report_connector', 'Platform Policy Webform Adapter', 'GenericPlatform', '*', ARRAY['PLATFORM_POLICY', 'IMPERSONATION', 'HARASSMENT'], 'SUPPORTED_REPORTING_WORKFLOW', true, false, true, 5, 30)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  supported_basis = EXCLUDED.supported_basis,
  submission_method = EXCLUDED.submission_method;

-- 4. Domain Enforcement Routes Intelligence Database
CREATE TABLE IF NOT EXISTS public.domain_enforcement_routes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  copyright_email TEXT,
  abuse_email TEXT,
  reporting_url TEXT,
  hosting_provider TEXT,
  registrar TEXT,
  supported_basis TEXT[] NOT NULL DEFAULT '{"COPYRIGHT","WEBSITE_COPYRIGHT"}'::text[],
  preferred_method TEXT NOT NULL DEFAULT 'EMAIL',
  automation_allowed BOOLEAN NOT NULL DEFAULT true,
  requires_human BOOLEAN NOT NULL DEFAULT false,
  previous_success_count INTEGER NOT NULL DEFAULT 0,
  previous_failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.domain_enforcement_routes TO authenticated;
GRANT ALL ON public.domain_enforcement_routes TO service_role;
ALTER TABLE public.domain_enforcement_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view domain routes" ON public.domain_enforcement_routes
  FOR SELECT TO authenticated USING (true);

-- Seed initial domain intel
INSERT INTO public.domain_enforcement_routes (domain, copyright_email, abuse_email, reporting_url, hosting_provider, preferred_method, automation_allowed)
VALUES
  ('youtube.com', 'copyright@youtube.com', 'abuse@youtube.com', 'https://www.youtube.com/copyright_complaint_form', 'Google LLC', 'APPROVED_INTEGRATION', true),
  ('youtu.be', 'copyright@youtube.com', 'abuse@youtube.com', 'https://www.youtube.com/copyright_complaint_form', 'Google LLC', 'APPROVED_INTEGRATION', true),
  ('vimeo.com', 'dmca@vimeo.com', 'abuse@vimeo.com', 'https://vimeo.com/dmca', 'Vimeo Inc', 'EMAIL', true),
  ('dailymotion.com', 'notifications@dailymotion.com', 'abuse@dailymotion.com', 'https://www.dailymotion.com/legal/copyright', 'Dailymotion', 'EMAIL', true),
  ('cloudflare.com', 'abusedmca@cloudflare.com', 'abuse@cloudflare.com', 'https://www.cloudflare.com/abuse/', 'Cloudflare Inc', 'EMAIL', true)
ON CONFLICT (domain) DO NOTHING;

-- 5. Enforcement Cases
CREATE TABLE IF NOT EXISTS public.enforcement_cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  parent_case_id UUID REFERENCES public.enforcement_cases(id) ON DELETE SET NULL,
  protected_asset_id TEXT,
  target_url TEXT NOT NULL,
  domain TEXT,
  platform TEXT,
  enforcement_basis TEXT NOT NULL,
  eligibility_status TEXT NOT NULL DEFAULT 'AUTO_ELIGIBLE', -- AUTO_ELIGIBLE, REVIEW_REQUIRED, NOT_ELIGIBLE
  eligibility_reason JSONB NOT NULL DEFAULT '{}'::jsonb,
  authorization_status TEXT NOT NULL DEFAULT 'VERIFIED',
  selected_route TEXT,
  connector_id TEXT REFERENCES public.enforcement_connectors(id),
  status TEXT NOT NULL DEFAULT 'DETECTED', -- DETECTED, VERIFIED, ELIGIBLE, QUEUED, SUBMITTED, ACKNOWLEDGED, UNDER_REVIEW, STILL_LIVE, SEARCH_DELISTED, CONTENT_REMOVED, SOURCE_REMOVED, REJECTED, FAILED, ESCALATION_REQUIRED, HUMAN_ACTION_REQUIRED
  batch_id UUID,
  idempotency_key TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_verification_at TIMESTAMPTZ,
  last_verification_at TIMESTAMPTZ,
  verification_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  reupload_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_cases TO authenticated;
GRANT ALL ON public.enforcement_cases TO service_role;
ALTER TABLE public.enforcement_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own enforcement cases" ON public.enforcement_cases
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_enforcement_cases_user ON public.enforcement_cases (user_id, status);
CREATE INDEX idx_enforcement_cases_idempotency ON public.enforcement_cases (idempotency_key);
CREATE INDEX idx_enforcement_cases_next_verification ON public.enforcement_cases (next_verification_at) WHERE next_verification_at IS NOT NULL;

-- 6. Enforcement Jobs Queue
CREATE TABLE IF NOT EXISTS public.enforcement_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL, -- AUTO_ENFORCEMENT_EVALUATE, AUTO_ENFORCEMENT_SUBMIT, AUTO_ENFORCEMENT_STATUS_CHECK, AUTO_ENFORCEMENT_RETRY, AUTO_ENFORCEMENT_ESCALATION, AUTO_ENFORCEMENT_REUPLOAD_SCAN
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, processing, completed, failed, cancelled
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_jobs TO authenticated;
GRANT ALL ON public.enforcement_jobs TO service_role;
ALTER TABLE public.enforcement_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own enforcement jobs" ON public.enforcement_jobs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_enforcement_jobs_poll ON public.enforcement_jobs (status, scheduled_at) WHERE status = 'queued';

-- 7. Immutable Enforcement Events Audit Trail
CREATE TABLE IF NOT EXISTS public.enforcement_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- FINDING_RECEIVED, ELIGIBILITY_STARTED, RIGHTS_VERIFIED, AUTO_ELIGIBLE, ROUTE_SELECTED, NOTICE_PREPARED, QUEUED, SUBMISSION_ATTEMPTED, SUBMITTED, STATUS_CHECKED, STILL_LIVE, DELISTED, SOURCE_REMOVED, REJECTED, RETRY_SCHEDULED, ESCALATION_REQUIRED, REUPLOAD_DETECTED, REVIEW_REQUESTED, REVIEW_DECIDED, DEMO_MODE_BLOCKED
  actor_type TEXT NOT NULL DEFAULT 'SYSTEM', -- SYSTEM, WORKER, HUMAN
  worker_id TEXT,
  connector_id TEXT,
  previous_state TEXT,
  new_state TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.enforcement_events TO authenticated;
GRANT ALL ON public.enforcement_events TO service_role;
ALTER TABLE public.enforcement_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own enforcement events" ON public.enforcement_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own enforcement events" ON public.enforcement_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_enforcement_events_case ON public.enforcement_events (case_id, created_at DESC);
CREATE INDEX idx_enforcement_events_user ON public.enforcement_events (user_id, created_at DESC);

-- 8. Human Review Queue
CREATE TABLE IF NOT EXISTS public.enforcement_review_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CHANGED_BASIS
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_notes TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_review_queue TO authenticated;
GRANT ALL ON public.enforcement_review_queue TO service_role;
ALTER TABLE public.enforcement_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own review queue" ON public.enforcement_review_queue
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
