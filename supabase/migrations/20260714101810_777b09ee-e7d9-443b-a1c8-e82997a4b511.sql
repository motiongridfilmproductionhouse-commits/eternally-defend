
-- =========================================================================
-- Roles infrastructure (per user-roles standard)
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'analyst', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own roles" ON public.user_roles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- =========================================================================
-- Shared triggers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================================================================
-- Reusable macro: user-owned table policy set
-- =========================================================================

-- protected_assets: client-uploaded logos/photos/artwork for matching
CREATE TABLE IF NOT EXISTS public.protected_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logo','photo','product','artwork','watermark','frame','other')),
  storage_path TEXT,
  source_url TEXT,
  phash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protected_assets TO authenticated;
GRANT ALL ON public.protected_assets TO service_role;
ALTER TABLE public.protected_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own protected_assets" ON public.protected_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_protected_assets_updated BEFORE UPDATE ON public.protected_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- multimedia_analysis_jobs: parent job
CREATE TABLE IF NOT EXISTS public.multimedia_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('youtube_meta','upload_video','upload_audio','upload_image','screenshot','url')),
  source_ref TEXT NOT NULL,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_name TEXT,
  target_aliases TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','partial','completed','failed','cancelled')),
  stage_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress_message TEXT,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  reputation_score NUMERIC(5,2),
  risk_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_estimate_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_kind, source_ref)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.multimedia_analysis_jobs TO authenticated;
GRANT ALL ON public.multimedia_analysis_jobs TO service_role;
ALTER TABLE public.multimedia_analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs" ON public.multimedia_analysis_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_mm_jobs_updated BEFORE UPDATE ON public.multimedia_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_mm_jobs_user_status ON public.multimedia_analysis_jobs(user_id, status);

-- evidence_frames
CREATE TABLE IF NOT EXISTS public.evidence_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  timestamp_seconds NUMERIC(10,3),
  frame_url TEXT,
  frame_hash TEXT,
  storage_path TEXT,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_frames TO authenticated;
GRANT ALL ON public.evidence_frames TO service_role;
ALTER TABLE public.evidence_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own frames" ON public.evidence_frames FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_frames_job ON public.evidence_frames(job_id);

-- video_annotations
CREATE TABLE IF NOT EXISTS public.video_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  annotation_type TEXT NOT NULL,
  label TEXT,
  start_seconds NUMERIC(10,3),
  end_seconds NUMERIC(10,3),
  confidence NUMERIC(5,4),
  bounding_box JSONB,
  shot_number INTEGER,
  evidence_frame_id UUID REFERENCES public.evidence_frames(id) ON DELETE SET NULL,
  protected_asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL,
  severity TEXT CHECK (severity IN ('low','medium','high','critical')),
  requires_review BOOLEAN NOT NULL DEFAULT true,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_annotations TO authenticated;
GRANT ALL ON public.video_annotations TO service_role;
ALTER TABLE public.video_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own video_annotations" ON public.video_annotations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_va_job ON public.video_annotations(job_id, start_seconds);

-- transcription_jobs (long-running op state)
CREATE TABLE IF NOT EXISTS public.transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  operation_name TEXT,
  language_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  audio_uri TEXT,
  duration_seconds NUMERIC(10,3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcription_jobs TO authenticated;
GRANT ALL ON public.transcription_jobs TO service_role;
ALTER TABLE public.transcription_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transcription_jobs" ON public.transcription_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_tj_updated BEFORE UPDATE ON public.transcription_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- transcript_segments
CREATE TABLE IF NOT EXISTS public.transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  transcription_job_id UUID REFERENCES public.transcription_jobs(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,
  start_seconds NUMERIC(10,3) NOT NULL,
  end_seconds NUMERIC(10,3) NOT NULL,
  speaker_tag TEXT,
  language_code TEXT,
  original_text TEXT NOT NULL,
  confidence NUMERIC(5,4),
  mentioned_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment TEXT,
  threat_category TEXT,
  reputation_impact NUMERIC(5,2),
  copyright_relevance NUMERIC(5,2),
  fact_check_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_segments TO authenticated;
GRANT ALL ON public.transcript_segments TO service_role;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transcript_segments" ON public.transcript_segments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_ts_job ON public.transcript_segments(job_id, start_seconds);

-- speaker_segments
CREATE TABLE IF NOT EXISTS public.speaker_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  speaker_tag TEXT NOT NULL,
  start_seconds NUMERIC(10,3) NOT NULL,
  end_seconds NUMERIC(10,3) NOT NULL,
  confidence NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.speaker_segments TO authenticated;
GRANT ALL ON public.speaker_segments TO service_role;
ALTER TABLE public.speaker_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own speaker_segments" ON public.speaker_segments FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- visual_detections
CREATE TABLE IF NOT EXISTS public.visual_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  evidence_frame_id UUID REFERENCES public.evidence_frames(id) ON DELETE SET NULL,
  detection_type TEXT NOT NULL,
  label TEXT,
  confidence NUMERIC(5,4),
  bounding_box JSONB,
  safe_search JSONB,
  face_present BOOLEAN,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visual_detections TO authenticated;
GRANT ALL ON public.visual_detections TO service_role;
ALTER TABLE public.visual_detections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own visual_detections" ON public.visual_detections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_vd_job ON public.visual_detections(job_id);

-- ocr_results
CREATE TABLE IF NOT EXISTS public.ocr_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  evidence_frame_id UUID REFERENCES public.evidence_frames(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  language_code TEXT,
  confidence NUMERIC(5,4),
  bounding_boxes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ocr_results TO authenticated;
GRANT ALL ON public.ocr_results TO service_role;
ALTER TABLE public.ocr_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ocr_results" ON public.ocr_results FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- protected_asset_matches
CREATE TABLE IF NOT EXISTS public.protected_asset_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  protected_asset_id UUID NOT NULL REFERENCES public.protected_assets(id) ON DELETE CASCADE,
  evidence_frame_id UUID REFERENCES public.evidence_frames(id) ON DELETE SET NULL,
  match_type TEXT NOT NULL,
  similarity NUMERIC(5,4) NOT NULL,
  ocr_name_match BOOLEAN NOT NULL DEFAULT false,
  copyright_risk NUMERIC(5,2),
  impersonation_risk NUMERIC(5,2),
  fake_ad_indicator BOOLEAN NOT NULL DEFAULT false,
  requires_review BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protected_asset_matches TO authenticated;
GRANT ALL ON public.protected_asset_matches TO service_role;
ALTER TABLE public.protected_asset_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own asset_matches" ON public.protected_asset_matches FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- translations
CREATE TABLE IF NOT EXISTS public.translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ref UUID,
  detected_language TEXT,
  target_language TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  confidence NUMERIC(5,4),
  provider TEXT NOT NULL,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translations TO authenticated;
GRANT ALL ON public.translations TO service_role;
ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own translations" ON public.translations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- extracted_claims
CREATE TABLE IF NOT EXISTS public.extracted_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  transcript_segment_id UUID REFERENCES public.transcript_segments(id) ON DELETE CASCADE,
  original_statement TEXT NOT NULL,
  extracted_claim TEXT NOT NULL,
  claimant TEXT,
  language TEXT,
  fact_check_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extracted_claims TO authenticated;
GRANT ALL ON public.extracted_claims TO service_role;
ALTER TABLE public.extracted_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own extracted_claims" ON public.extracted_claims FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- fact_check_matches
CREATE TABLE IF NOT EXISTS public.fact_check_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  extracted_claim_id UUID NOT NULL REFERENCES public.extracted_claims(id) ON DELETE CASCADE,
  publisher_name TEXT,
  publisher_site TEXT,
  review_title TEXT,
  review_url TEXT,
  review_date TIMESTAMPTZ,
  textual_rating TEXT,
  language TEXT,
  reviewed_claim TEXT,
  match_confidence NUMERIC(5,4),
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_check_matches TO authenticated;
GRANT ALL ON public.fact_check_matches TO service_role;
ALTER TABLE public.fact_check_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own fact_check_matches" ON public.fact_check_matches FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- timestamp_findings (canonical timeline row)
CREATE TABLE IF NOT EXISTS public.timestamp_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL,
  start_seconds NUMERIC(10,3) NOT NULL,
  end_seconds NUMERIC(10,3),
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT,
  transcript_excerpt TEXT,
  original_language TEXT,
  translation TEXT,
  speaker TEXT,
  evidence_frame_id UUID REFERENCES public.evidence_frames(id) ON DELETE SET NULL,
  transcript_segment_id UUID REFERENCES public.transcript_segments(id) ON DELETE SET NULL,
  video_annotation_id UUID REFERENCES public.video_annotations(id) ON DELETE SET NULL,
  visual_detection_id UUID REFERENCES public.visual_detections(id) ON DELETE SET NULL,
  extracted_claim_id UUID REFERENCES public.extracted_claims(id) ON DELETE SET NULL,
  fact_check_status TEXT,
  confidence NUMERIC(5,4),
  detection_reason TEXT,
  youtube_deep_link TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','confirmed','false_positive','sent_to_radar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timestamp_findings TO authenticated;
GRANT ALL ON public.timestamp_findings TO service_role;
ALTER TABLE public.timestamp_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own timestamp_findings" ON public.timestamp_findings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_tf_updated BEFORE UPDATE ON public.timestamp_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_tf_job ON public.timestamp_findings(job_id, start_seconds);

-- multimedia_errors
CREATE TABLE IF NOT EXISTS public.multimedia_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.multimedia_analysis_jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  provider TEXT,
  error_code TEXT,
  error_message TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.multimedia_errors TO authenticated;
GRANT ALL ON public.multimedia_errors TO service_role;
ALTER TABLE public.multimedia_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own multimedia_errors" ON public.multimedia_errors FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- api_usage
CREATE TABLE IF NOT EXISTS public.api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.multimedia_analysis_jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  units NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL,
  cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage TO authenticated;
GRANT ALL ON public.api_usage TO service_role;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own api_usage" ON public.api_usage FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
