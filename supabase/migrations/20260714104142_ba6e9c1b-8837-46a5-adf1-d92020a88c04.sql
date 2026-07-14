
-- Ensure admin role exists in enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'app_role' AND e.enumlabel = 'admin') THEN
    ALTER TYPE public.app_role ADD VALUE 'admin';
  END IF;
END $$;

-- Authorised media uploads
CREATE TABLE IF NOT EXISTS public.multimedia_uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.multimedia_analysis_jobs(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  permission_confirmed BOOLEAN NOT NULL DEFAULT false,
  retention_policy TEXT NOT NULL DEFAULT '30d',
  retention_until TIMESTAMPTZ,
  organization TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.multimedia_uploads TO authenticated;
GRANT ALL ON public.multimedia_uploads TO service_role;
ALTER TABLE public.multimedia_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own uploads" ON public.multimedia_uploads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_uploads_updated BEFORE UPDATE ON public.multimedia_uploads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Caption / transcript imports
CREATE TABLE IF NOT EXISTS public.caption_imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  filename TEXT,
  format TEXT NOT NULL,
  transcript_source TEXT NOT NULL DEFAULT 'user_uploaded',
  raw_text TEXT NOT NULL,
  segment_count INT NOT NULL DEFAULT 0,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caption_imports TO authenticated;
GRANT ALL ON public.caption_imports TO service_role;
ALTER TABLE public.caption_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own captions" ON public.caption_imports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_captions_updated BEFORE UPDATE ON public.caption_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Provider health checks (admin visibility)
CREATE TABLE IF NOT EXISTS public.provider_health_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INT,
  error_message TEXT,
  diagnostic JSONB DEFAULT '{}'::jsonb,
  checked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.provider_health_checks TO authenticated;
GRANT ALL ON public.provider_health_checks TO service_role;
ALTER TABLE public.provider_health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read all health checks" ON public.provider_health_checks
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users read own health checks" ON public.provider_health_checks
  FOR SELECT USING (auth.uid() = checked_by);
CREATE POLICY "Auth users insert health checks" ON public.provider_health_checks
  FOR INSERT WITH CHECK (auth.uid() = checked_by);

-- Finding review audit history
CREATE TABLE IF NOT EXISTS public.finding_review_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finding_id UUID NOT NULL REFERENCES public.timestamp_findings(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  from_severity TEXT,
  to_severity TEXT,
  notes TEXT,
  action TEXT NOT NULL DEFAULT 'status_change',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.finding_review_history TO authenticated;
GRANT ALL ON public.finding_review_history TO service_role;
ALTER TABLE public.finding_review_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read history of own findings" ON public.finding_review_history
  FOR SELECT USING (auth.uid() = reviewer_id OR EXISTS (
    SELECT 1 FROM public.timestamp_findings tf WHERE tf.id = finding_id AND tf.user_id = auth.uid()
  ));
CREATE POLICY "Reviewers write history" ON public.finding_review_history
  FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- Narrative clusters
CREATE TABLE IF NOT EXISTS public.narrative_clusters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  narrative_summary TEXT,
  source_count INT NOT NULL DEFAULT 0,
  combined_reach BIGINT NOT NULL DEFAULT 0,
  dominant_source TEXT,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latest_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, cluster_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.narrative_clusters TO authenticated;
GRANT ALL ON public.narrative_clusters TO service_role;
ALTER TABLE public.narrative_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own clusters" ON public.narrative_clusters
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_clusters_updated BEFORE UPDATE ON public.narrative_clusters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Quota usage
CREATE TABLE IF NOT EXISTS public.quota_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  analyses_count INT NOT NULL DEFAULT 0,
  api_calls_count INT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  cost_cents INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, usage_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quota_usage TO authenticated;
GRANT ALL ON public.quota_usage TO service_role;
ALTER TABLE public.quota_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own quota" ON public.quota_usage
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own quota" ON public.quota_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own quota" ON public.quota_usage
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_quota_updated BEFORE UPDATE ON public.quota_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend timestamp_findings for review workflow + provenance
ALTER TABLE public.timestamp_findings
  ADD COLUMN IF NOT EXISTS end_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS speaker TEXT,
  ADD COLUMN IF NOT EXISTS timestamp_source TEXT NOT NULL DEFAULT 'synthetic',
  ADD COLUMN IF NOT EXISTS evidence_source TEXT,
  ADD COLUMN IF NOT EXISTS human_review_status TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewer_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES public.narrative_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contributing_signals JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_version TEXT DEFAULT 'mm-v1';

-- Extend multimedia_analysis_jobs
ALTER TABLE public.multimedia_analysis_jobs
  ADD COLUMN IF NOT EXISTS estimated_cost_cents INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost_cents INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS api_calls_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_explanations JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confidence_by_axis JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS canceled_reason TEXT;
