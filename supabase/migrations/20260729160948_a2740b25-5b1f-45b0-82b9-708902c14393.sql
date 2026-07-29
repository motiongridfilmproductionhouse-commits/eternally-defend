ALTER TABLE public.copyright_youtube_videos
  ADD COLUMN IF NOT EXISTS is_release_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_type text,
  ADD COLUMN IF NOT EXISTS reputation_impact text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS reputation_impact_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS key_statements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS misleading_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comment_samples jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_timestamps jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_cyv_release_review
  ON public.copyright_youtube_videos (scan_id, reputation_impact_score DESC)
  WHERE is_release_review;