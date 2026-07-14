
-- =========================================================
-- 1) video_creator_profiles
-- =========================================================
CREATE TABLE public.video_creator_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organisation_id UUID,
  protection_profile_id UUID,
  platform TEXT NOT NULL DEFAULT 'youtube',
  channel_id TEXT NOT NULL,
  channel_url TEXT,
  channel_handle TEXT,
  channel_name TEXT,
  profile_image_url TEXT,
  description TEXT,
  country TEXT,
  channel_created_at TIMESTAMPTZ,
  subscriber_count BIGINT,
  total_view_count BIGINT,
  video_count BIGINT,
  -- Derived intelligence
  influence_score NUMERIC(5,2),
  credibility_score NUMERIC(5,2),
  threat_amplification_score NUMERIC(5,2),
  findings_count INT NOT NULL DEFAULT 0,
  critical_findings_count INT NOT NULL DEFAULT 0,
  repeated_allegation_count INT NOT NULL DEFAULT 0,
  estimated_total_reach BIGINT,
  first_detected_at TIMESTAMPTZ,
  latest_detected_at TIMESTAMPTZ,
  monitoring_enabled BOOLEAN NOT NULL DEFAULT false,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, channel_id)
);
CREATE INDEX idx_vcp_user ON public.video_creator_profiles(user_id);
CREATE INDEX idx_vcp_channel ON public.video_creator_profiles(platform, channel_id);
CREATE INDEX idx_vcp_org ON public.video_creator_profiles(organisation_id);
CREATE INDEX idx_vcp_monitoring ON public.video_creator_profiles(monitoring_enabled) WHERE monitoring_enabled = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_creator_profiles TO authenticated;
GRANT ALL ON public.video_creator_profiles TO service_role;
ALTER TABLE public.video_creator_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own creator profiles" ON public.video_creator_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_vcp_updated BEFORE UPDATE ON public.video_creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 2) video_creator_risk_history
-- =========================================================
CREATE TABLE public.video_creator_risk_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  creator_profile_id UUID NOT NULL REFERENCES public.video_creator_profiles(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  findings_count INT NOT NULL DEFAULT 0,
  critical_findings_count INT NOT NULL DEFAULT 0,
  estimated_total_reach BIGINT,
  dominant_risk_category TEXT,
  influence_score NUMERIC(5,2),
  threat_amplification_score NUMERIC(5,2),
  reason TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vcrh_creator ON public.video_creator_risk_history(creator_profile_id, snapshot_at DESC);
CREATE INDEX idx_vcrh_user ON public.video_creator_risk_history(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_creator_risk_history TO authenticated;
GRANT ALL ON public.video_creator_risk_history TO service_role;
ALTER TABLE public.video_creator_risk_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own creator risk history" ON public.video_creator_risk_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 3) video_transcript_segments
--    Parsed timestamped caption/transcript rows per video.
-- =========================================================
CREATE TABLE public.video_transcript_segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organisation_id UUID,
  platform TEXT NOT NULL DEFAULT 'youtube',
  video_id TEXT NOT NULL,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  source TEXT NOT NULL, -- 'youtube_caption' | 'vtt' | 'srt' | 'stt'
  language TEXT,
  is_auto_generated BOOLEAN,
  start_seconds NUMERIC(10,3) NOT NULL,
  end_seconds NUMERIC(10,3) NOT NULL,
  text TEXT NOT NULL,
  translated_text TEXT,
  translation_language TEXT,
  speaker_label TEXT,
  confidence NUMERIC(5,2),
  coverage_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vts_video ON public.video_transcript_segments(platform, video_id, start_seconds);
CREATE INDEX idx_vts_user ON public.video_transcript_segments(user_id);
CREATE INDEX idx_vts_scan_hit ON public.video_transcript_segments(scan_hit_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_transcript_segments TO authenticated;
GRANT ALL ON public.video_transcript_segments TO service_role;
ALTER TABLE public.video_transcript_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transcript segments" ON public.video_transcript_segments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- 4) video_timestamp_findings
-- =========================================================
CREATE TABLE public.video_timestamp_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organisation_id UUID,
  protection_profile_id UUID,
  scan_id UUID REFERENCES public.scans(id) ON DELETE SET NULL,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  creator_profile_id UUID REFERENCES public.video_creator_profiles(id) ON DELETE SET NULL,
  platform TEXT NOT NULL DEFAULT 'youtube',
  video_id TEXT NOT NULL,
  video_url TEXT,
  channel_id TEXT,
  channel_url TEXT,
  channel_name TEXT,
  segment_id UUID REFERENCES public.video_transcript_segments(id) ON DELETE SET NULL,
  start_seconds NUMERIC(10,3) NOT NULL,
  end_seconds NUMERIC(10,3) NOT NULL,
  start_time_display TEXT, -- '00:04:21'
  end_time_display TEXT,
  speaker_label TEXT,
  original_text TEXT NOT NULL,
  original_language TEXT,
  translated_text TEXT,
  translation_language TEXT,
  context_before TEXT,
  context_after TEXT,
  matched_entity TEXT,
  claim_summary TEXT,
  -- Category the AI assigned: direct_allegation | quoted_allegation | opinion | criticism |
  -- news_reporting | satire | denial | response_clarification | harassment |
  -- potentially_defamatory | insufficient_evidence
  context_type TEXT NOT NULL DEFAULT 'insufficient_evidence',
  speaker_stance TEXT, -- 'supports' | 'rejects' | 'quotes' | 'neutral'
  risk_category TEXT, -- e.g. 'potential_defamation', 'harassment', 'impersonation'
  severity TEXT, -- 'low' | 'medium' | 'high' | 'critical'
  confidence NUMERIC(5,2),
  evidence_source TEXT, -- 'timestamped_transcript' | 'auto_caption' | 'stt' | 'metadata_only'
  watch_exact_moment_url TEXT,
  -- Human review workflow
  review_status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | false_positive | legal_review
  reviewer_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vtf_user ON public.video_timestamp_findings(user_id);
CREATE INDEX idx_vtf_video ON public.video_timestamp_findings(platform, video_id, start_seconds);
CREATE INDEX idx_vtf_creator ON public.video_timestamp_findings(creator_profile_id);
CREATE INDEX idx_vtf_scan ON public.video_timestamp_findings(scan_id);
CREATE INDEX idx_vtf_scan_hit ON public.video_timestamp_findings(scan_hit_id);
CREATE INDEX idx_vtf_review_status ON public.video_timestamp_findings(review_status);
CREATE INDEX idx_vtf_severity ON public.video_timestamp_findings(severity);
CREATE INDEX idx_vtf_context_type ON public.video_timestamp_findings(context_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_timestamp_findings TO authenticated;
GRANT ALL ON public.video_timestamp_findings TO service_role;
ALTER TABLE public.video_timestamp_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own timestamp findings" ON public.video_timestamp_findings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_vtf_updated BEFORE UPDATE ON public.video_timestamp_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- 5) video_analysis_jobs
--    Per-video state tracking so scans can resume / retry.
-- =========================================================
CREATE TABLE public.video_analysis_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organisation_id UUID,
  platform TEXT NOT NULL DEFAULT 'youtube',
  video_id TEXT NOT NULL,
  scan_id UUID REFERENCES public.scans(id) ON DELETE SET NULL,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  -- captions_state: unknown | captions_analysed | partial_captions | captions_unavailable | metadata_only
  captions_state TEXT NOT NULL DEFAULT 'unknown',
  -- audio_state: not_run | audio_analysis_available | audio_analysis_not_authorised | running | failed
  audio_state TEXT NOT NULL DEFAULT 'not_run',
  audio_analysis_authorised BOOLEAN NOT NULL DEFAULT false,
  -- analysis_state: queued | running | completed | failed | skipped
  analysis_state TEXT NOT NULL DEFAULT 'queued',
  transcript_segment_count INT NOT NULL DEFAULT 0,
  finding_count INT NOT NULL DEFAULT 0,
  caption_language TEXT,
  caption_source TEXT,
  coverage_pct NUMERIC(5,2),
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, video_id, scan_id)
);
CREATE INDEX idx_vaj_user ON public.video_analysis_jobs(user_id);
CREATE INDEX idx_vaj_video ON public.video_analysis_jobs(platform, video_id);
CREATE INDEX idx_vaj_scan ON public.video_analysis_jobs(scan_id);
CREATE INDEX idx_vaj_state ON public.video_analysis_jobs(analysis_state);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_analysis_jobs TO authenticated;
GRANT ALL ON public.video_analysis_jobs TO service_role;
ALTER TABLE public.video_analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own analysis jobs" ON public.video_analysis_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_vaj_updated BEFORE UPDATE ON public.video_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
