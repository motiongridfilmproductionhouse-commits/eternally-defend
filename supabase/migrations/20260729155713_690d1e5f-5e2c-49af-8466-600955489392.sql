CREATE TABLE public.copyright_youtube_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.copyright_scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  channel_id TEXT,
  channel_title TEXT,
  channel_url TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMPTZ,
  view_count BIGINT,
  like_count BIGINT,
  comment_count BIGINT,
  duration_seconds INTEGER,
  matched_query TEXT,
  content_category TEXT,
  copyright_usage TEXT NOT NULL DEFAULT 'none',
  copyright_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment TEXT NOT NULL DEFAULT 'neutral',
  sentiment_score INTEGER,
  risk_score INTEGER NOT NULL DEFAULT 0,
  same_day_release BOOLEAN NOT NULL DEFAULT false,
  ai_summary TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, video_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_youtube_videos TO authenticated;
GRANT ALL ON public.copyright_youtube_videos TO service_role;

ALTER TABLE public.copyright_youtube_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own monitored videos"
ON public.copyright_youtube_videos FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cyv_scan ON public.copyright_youtube_videos (scan_id, risk_score DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cyv_updated_at BEFORE UPDATE ON public.copyright_youtube_videos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();