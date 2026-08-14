ALTER TABLE public.protected_assets
  ADD COLUMN IF NOT EXISTS dhash TEXT,
  ADD COLUMN IF NOT EXISTS ahash TEXT,
  ADD COLUMN IF NOT EXISTS hash_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS hashed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS protected_assets_phash_idx ON public.protected_assets (phash) WHERE phash IS NOT NULL;
CREATE INDEX IF NOT EXISTS protected_assets_dhash_idx ON public.protected_assets (dhash) WHERE dhash IS NOT NULL;
CREATE INDEX IF NOT EXISTS protected_assets_user_active_idx ON public.protected_assets (user_id, active);

CREATE TABLE IF NOT EXISTS public.protected_asset_frames (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protected_asset_id UUID NOT NULL REFERENCES public.protected_assets(id) ON DELETE CASCADE,
  frame_index INTEGER NOT NULL,
  timestamp_seconds NUMERIC,
  storage_path TEXT,
  phash TEXT,
  dhash TEXT,
  ahash TEXT,
  sha256 TEXT,
  width INTEGER,
  height INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (protected_asset_id, frame_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.protected_asset_frames TO authenticated;
GRANT ALL ON public.protected_asset_frames TO service_role;
ALTER TABLE public.protected_asset_frames ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own asset frames"
  ON public.protected_asset_frames FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS protected_asset_frames_asset_idx ON public.protected_asset_frames (protected_asset_id, frame_index);
CREATE INDEX IF NOT EXISTS protected_asset_frames_phash_idx ON public.protected_asset_frames (phash) WHERE phash IS NOT NULL;