
-- Extend enforcement_requests
ALTER TABLE public.enforcement_requests
  ADD COLUMN IF NOT EXISTS submission_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS platform TEXT;

-- enforcement_targets
CREATE TABLE IF NOT EXISTS public.enforcement_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID NOT NULL REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  target_url TEXT NOT NULL,
  channel_url TEXT,
  channel_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_targets TO authenticated;
GRANT ALL ON public.enforcement_targets TO service_role;
ALTER TABLE public.enforcement_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement_targets" ON public.enforcement_targets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- enforcement_evidence
CREATE TABLE IF NOT EXISTS public.enforcement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID NOT NULL REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  reference TEXT,
  storage_path TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_evidence TO authenticated;
GRANT ALL ON public.enforcement_evidence TO service_role;
ALTER TABLE public.enforcement_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement_evidence" ON public.enforcement_evidence FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- enforcement_status_history
CREATE TABLE IF NOT EXISTS public.enforcement_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID NOT NULL REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_status_history TO authenticated;
GRANT ALL ON public.enforcement_status_history TO service_role;
ALTER TABLE public.enforcement_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement_status_history" ON public.enforcement_status_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- enforcement_actions (audit log)
CREATE TABLE IF NOT EXISTS public.enforcement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  target_url TEXT,
  platform TEXT,
  evidence_ids UUID[] NOT NULL DEFAULT '{}',
  generated_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  submission_status TEXT,
  actor_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_actions TO authenticated;
GRANT ALL ON public.enforcement_actions TO service_role;
ALTER TABLE public.enforcement_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement_actions" ON public.enforcement_actions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- platform_reports
CREATE TABLE IF NOT EXISTS public.platform_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  report_type TEXT NOT NULL,
  form_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  submission_status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  external_reference TEXT,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_reports TO authenticated;
GRANT ALL ON public.platform_reports TO service_role;
ALTER TABLE public.platform_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own platform_reports" ON public.platform_reports FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- dmca_submissions
CREATE TABLE IF NOT EXISTS public.dmca_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  copyright_basis TEXT NOT NULL,
  protected_asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL,
  submission_status TEXT NOT NULL DEFAULT 'draft',
  package_path TEXT,
  external_reference TEXT,
  submitted_at TIMESTAMPTZ,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dmca_submissions TO authenticated;
GRANT ALL ON public.dmca_submissions TO service_role;
ALTER TABLE public.dmca_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own dmca_submissions" ON public.dmca_submissions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- legal_cases
CREATE TABLE IF NOT EXISTS public.legal_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE SET NULL,
  case_number TEXT,
  stage TEXT NOT NULL DEFAULT 'Legal Review',
  attorney TEXT,
  package_path TEXT,
  filed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_cases TO authenticated;
GRANT ALL ON public.legal_cases TO service_role;
ALTER TABLE public.legal_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own legal_cases" ON public.legal_cases FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE TRIGGER trg_enforcement_targets_updated BEFORE UPDATE ON public.enforcement_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_platform_reports_updated BEFORE UPDATE ON public.platform_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dmca_submissions_updated BEFORE UPDATE ON public.dmca_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_legal_cases_updated BEFORE UPDATE ON public.legal_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
