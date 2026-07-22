
-- Enums
CREATE TYPE public.channel_watch_priority AS ENUM ('critical','high','standard','low');
CREATE TYPE public.channel_watch_status AS ENUM ('active','paused','error');
CREATE TYPE public.channel_watch_analysis_status AS ENUM ('pending','running','completed','failed','skipped');
CREATE TYPE public.channel_watch_review_status AS ENUM ('not_required','pending','approved','dismissed','escalated');
CREATE TYPE public.channel_watch_classification AS ENUM (
  'not_relevant','informational','commentary_no_violation',
  'potential_harm','potential_copyright','potential_impersonation',
  'potential_privacy','potential_manipulated','potential_harassment',
  'potential_false_allegation'
);

-- 1. channel_watches
CREATE TABLE public.channel_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  channel_title text,
  handle text,
  avatar_url text,
  channel_url text,
  description text,
  subscriber_count bigint,
  video_count bigint,
  uploads_playlist_id text,
  reason text,
  priority public.channel_watch_priority NOT NULL DEFAULT 'standard',
  notes text,
  status public.channel_watch_status NOT NULL DEFAULT 'active',
  last_error text,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  last_video_published_at timestamptz,
  firecrawl_monitor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_watches TO authenticated;
GRANT ALL ON public.channel_watches TO service_role;
ALTER TABLE public.channel_watches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own channel_watches" ON public.channel_watches
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. channel_watch_videos
CREATE TABLE public.channel_watch_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watch_id uuid NOT NULL REFERENCES public.channel_watches(id) ON DELETE CASCADE,
  video_id text NOT NULL,
  title text,
  description text,
  thumbnail_url text,
  url text,
  published_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  is_baseline boolean NOT NULL DEFAULT false,
  duration_seconds integer,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  mention_match jsonb NOT NULL DEFAULT '{}'::jsonb,
  protected_asset_similarity jsonb NOT NULL DEFAULT '{}'::jsonb,
  deepfake_indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis_status public.channel_watch_analysis_status NOT NULL DEFAULT 'pending',
  analysis_error text,
  classification public.channel_watch_classification,
  risk_score integer,
  virality_score integer,
  review_status public.channel_watch_review_status NOT NULL DEFAULT 'not_required',
  review_note text,
  reupload_of_video_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watch_id, video_id)
);
CREATE INDEX channel_watch_videos_user_idx ON public.channel_watch_videos(user_id, detected_at DESC);
CREATE INDEX channel_watch_videos_watch_idx ON public.channel_watch_videos(watch_id, published_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_watch_videos TO authenticated;
GRANT ALL ON public.channel_watch_videos TO service_role;
ALTER TABLE public.channel_watch_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own channel_watch_videos" ON public.channel_watch_videos
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. channel_watch_events
CREATE TABLE public.channel_watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  watch_id uuid REFERENCES public.channel_watches(id) ON DELETE CASCADE,
  video_id uuid REFERENCES public.channel_watch_videos(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channel_watch_events_user_idx ON public.channel_watch_events(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_watch_events TO authenticated;
GRANT ALL ON public.channel_watch_events TO service_role;
ALTER TABLE public.channel_watch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own channel_watch_events" ON public.channel_watch_events
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. channel_watch_evidence
CREATE TABLE public.channel_watch_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.channel_watch_videos(id) ON DELETE CASCADE,
  evidence_vault_item_id uuid REFERENCES public.evidence_vault_items(id) ON DELETE SET NULL,
  kind text NOT NULL,
  s3_bucket text,
  s3_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_watch_evidence TO authenticated;
GRANT ALL ON public.channel_watch_evidence TO service_role;
ALTER TABLE public.channel_watch_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own channel_watch_evidence" ON public.channel_watch_evidence
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers (reuse public.update_updated_at_column())
CREATE TRIGGER channel_watches_updated_at BEFORE UPDATE ON public.channel_watches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER channel_watch_videos_updated_at BEFORE UPDATE ON public.channel_watch_videos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
