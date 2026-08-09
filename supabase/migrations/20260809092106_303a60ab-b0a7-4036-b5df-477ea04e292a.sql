CREATE TABLE public.youtube_removal_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  language_hint TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  queries TEXT[] NOT NULL DEFAULT '{}',
  discovered_count INTEGER NOT NULL DEFAULT 0,
  verified_count INTEGER NOT NULL DEFAULT 0,
  excluded_news_count INTEGER NOT NULL DEFAULT 0,
  not_subject_count INTEGER NOT NULL DEFAULT 0,
  actionable_count INTEGER NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_stage TEXT,
  failure_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_removal_scans TO authenticated;
GRANT ALL ON public.youtube_removal_scans TO service_role;
ALTER TABLE public.youtube_removal_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own youtube removal scans" ON public.youtube_removal_scans
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_youtube_removal_scans_updated_at BEFORE UPDATE ON public.youtube_removal_scans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.youtube_removal_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.youtube_removal_scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  channel_id TEXT,
  channel_title TEXT,
  channel_url TEXT,
  published_at TIMESTAMPTZ,
  thumbnail_url TEXT,
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  duration_seconds INTEGER,
  is_unavailable BOOLEAN NOT NULL DEFAULT false,
  discovery_queries TEXT[] NOT NULL DEFAULT '{}',
  subject_status TEXT NOT NULL DEFAULT 'verified',
  subject_confidence INTEGER NOT NULL DEFAULT 0,
  verification_reason TEXT,
  channel_class TEXT NOT NULL DEFAULT 'independent',
  content_types TEXT[] NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'low',
  removal_potential TEXT NOT NULL DEFAULT 'not_eligible',
  potential_violation TEXT,
  problematic_claim TEXT,
  assessment_reason TEXT,
  recommended_action TEXT,
  recommended_route TEXT,
  evidence_needed TEXT,
  evidence_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_verified BOOLEAN NOT NULL DEFAULT false,
  transcript_state TEXT,
  transcript_language TEXT,
  priority_score INTEGER NOT NULL DEFAULT 0,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, video_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_removal_findings TO authenticated;
GRANT ALL ON public.youtube_removal_findings TO service_role;
ALTER TABLE public.youtube_removal_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own youtube removal findings" ON public.youtube_removal_findings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_youtube_removal_findings_updated_at BEFORE UPDATE ON public.youtube_removal_findings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_yt_removal_findings_scan ON public.youtube_removal_findings (scan_id, priority_score DESC);
CREATE INDEX idx_yt_removal_scans_user ON public.youtube_removal_scans (user_id, created_at DESC);