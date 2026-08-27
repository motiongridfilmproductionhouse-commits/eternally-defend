-- Approved YouTube Sources: lets a customer register a YouTube channel or
-- video as known-legitimate content for their protected identity. Approved
-- channels are polled for new uploads; every video under an approved source
-- is still run through the existing face-match + synthetic-detection gates
-- (see src/lib/protection/sources/analyze-approved-video.server.ts) — a
-- genuine appearance is classified legitimate (no alert), a manipulated one
-- is still flagged through the existing evidence/case-prep pipeline.
--
-- Purely additive: no existing table, RLS policy, or enforcement gate is
-- touched by this migration.

CREATE TABLE IF NOT EXISTS public.approved_youtube_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('channel', 'video')),
  input_url TEXT NOT NULL,
  youtube_channel_id TEXT,
  youtube_video_id TEXT,
  uploads_playlist_id TEXT,
  title TEXT,
  thumbnail_url TEXT,
  channel_title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
  last_polled_at TIMESTAMPTZ,
  next_poll_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS approved_youtube_sources_user_video_idx
  ON public.approved_youtube_sources(user_id, youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approved_youtube_sources_user_channel_idx
  ON public.approved_youtube_sources(user_id, youtube_channel_id)
  WHERE source_kind = 'channel' AND youtube_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS approved_youtube_sources_due_poll_idx
  ON public.approved_youtube_sources(next_poll_at)
  WHERE source_kind = 'channel' AND status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approved_youtube_sources TO authenticated;
GRANT ALL ON public.approved_youtube_sources TO service_role;
ALTER TABLE public.approved_youtube_sources ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own approved youtube sources" ON public.approved_youtube_sources
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- source_id intentionally has NO cascade-delete behavior: approved sources
-- are soft-deleted (status='removed') by the app, never hard-deleted, so
-- that historical video/classification rows here — including any tied to a
-- verified/probable deepfake finding and the evidence/case it produced —
-- are never destroyed by a customer removing the source that surfaced them.
CREATE TABLE IF NOT EXISTS public.approved_source_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.approved_youtube_sources(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  url TEXT,
  published_at TIMESTAMPTZ,
  analysis_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (analysis_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  analysis_error TEXT,
  face_match BOOLEAN,
  face_similarity NUMERIC,
  is_synthetic BOOLEAN,
  synthetic_confidence NUMERIC,
  classification TEXT
    CHECK (classification IN (
      'legitimate_appearance', 'verified_deepfake', 'probable_deepfake',
      'not_subject', 'needs_review'
    )),
  automated_finding_evidence_id UUID REFERENCES public.automated_finding_evidence(id) ON DELETE SET NULL,
  analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, youtube_video_id)
);

CREATE INDEX IF NOT EXISTS approved_source_videos_user_idx
  ON public.approved_source_videos(user_id);
CREATE INDEX IF NOT EXISTS approved_source_videos_source_idx
  ON public.approved_source_videos(source_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approved_source_videos TO authenticated;
GRANT ALL ON public.approved_source_videos TO service_role;
ALTER TABLE public.approved_source_videos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own approved source videos" ON public.approved_source_videos
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
-- AND table_name IN ('approved_youtube_sources','approved_source_videos');
--
-- Confirm no existing table/row was touched.
-- SELECT count(*) FROM public.channel_watches;           -- unchanged from before
-- SELECT count(*) FROM public.deepfake_target_profiles;  -- unchanged from before
-- SELECT count(*) FROM public.automated_finding_evidence; -- unchanged from before
