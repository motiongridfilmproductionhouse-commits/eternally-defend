-- Automatic Face Reference Extraction from existing protected screenshots
-- (Instagram/social grid screenshots already uploaded by a protected
-- customer). Purely additive, follows the exact production-safety
-- conventions established by 20260822120000_protection_orchestration.sql and
-- 20260823090000_protection_phase2.sql:
--
--   * protected_assets and deepfake_reference_faces are CONFIRMED to already
--     exist in production with real customer rows (see phase2's own
--     verification queries). This migration only ADD COLUMN IF NOT EXISTS
--     (nullable/defaulted) on them — it never CREATEs, DROPs, or renames a
--     column, and never mutates an existing row's data.
--   * protected_faces and protected_face_profiles are CONFIRMED NOT to exist
--     in production (see src/lib/protection/profile.server.ts and
--     src/lib/protection/dispatch/face-protection.server.ts). This migration
--     does not create, alter, or reference either table anywhere.
--   * deepfake_target_profiles is read-only from this feature's code and is
--     not touched by this migration at all.
--   * protected_asset_grid_tiles is a brand-new table — ordinary
--     CREATE TABLE IF NOT EXISTS, no conflict risk with any existing table.

-- ============ A. protected_assets: per-asset grid-backfill status ============
ALTER TABLE public.protected_assets
  ADD COLUMN IF NOT EXISTS grid_screenshot_status TEXT NOT NULL DEFAULT 'UNSCREENED',
  ADD COLUMN IF NOT EXISTS grid_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grid_tile_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.protected_assets
    ADD CONSTRAINT protected_assets_grid_screenshot_status_check
    CHECK (grid_screenshot_status IN
      ('UNSCREENED','PENDING','PROCESSING','COMPLETED','NOT_APPLICABLE','FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS protected_assets_grid_status_idx
  ON public.protected_assets(user_id, grid_screenshot_status)
  WHERE kind = 'photo';

-- ============ B. protected_asset_grid_tiles: one row per candidate tile ============
-- Every tile a screenshot is segmented into, whether it becomes a usable
-- face or not — this is what makes the pipeline auditable (an operator can
-- see exactly why a tile was rejected) and idempotent (re-processing the
-- same screenshot upserts onto the same tile_index instead of duplicating).
CREATE TABLE IF NOT EXISTS public.protected_asset_grid_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_asset_id UUID NOT NULL REFERENCES public.protected_assets(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,

  crop_x INTEGER NOT NULL,
  crop_y INTEGER NOT NULL,
  crop_width INTEGER NOT NULL,
  crop_height INTEGER NOT NULL,

  -- Provenance. This is a screenshot-derived thumbnail — never claims
  -- Eterna downloaded or crawled the original Instagram media.
  source_type TEXT NOT NULL DEFAULT 'SOCIAL_GRID_SCREENSHOT',
  platform TEXT NOT NULL DEFAULT 'INSTAGRAM',
  source_media_type TEXT NOT NULL DEFAULT 'IMAGE'
    CHECK (source_media_type IN ('IMAGE','VIDEO_THUMBNAIL')),
  -- Timestamp of the parent screenshot's upload/capture into Eterna — never
  -- claims to be the original Instagram post's publish date.
  captured_at TIMESTAMPTZ NOT NULL,

  tile_storage_path TEXT,
  tile_sha256 TEXT,
  tile_phash TEXT,

  face_classification TEXT NOT NULL CHECK (face_classification IN
    ('NO_FACE','ONE_FACE','MULTIPLE_FACES','FACE_TOO_SMALL','LOW_QUALITY','USABLE_FACE')),
  face_confidence NUMERIC(5,2),
  face_bounding_box JSONB,

  identity_status TEXT CHECK (identity_status IN
    ('MATCHED_PROTECTED_SUBJECT','PROBABLE_MATCH','AMBIGUOUS','NOT_SUBJECT','REQUIRES_HUMAN_REVIEW')),
  face_match_similarity NUMERIC(5,2),
  matched_reference_face_id UUID REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL,

  promotion_status TEXT NOT NULL DEFAULT 'NOT_CANDIDATE' CHECK (promotion_status IN
    ('NOT_CANDIDATE','PENDING_REVIEW','AUTO_APPROVED','MANUALLY_APPROVED','REJECTED','DUPLICATE')),
  promoted_reference_id UUID REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,

  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (parent_asset_id, tile_index)
);

CREATE INDEX IF NOT EXISTS protected_asset_grid_tiles_user_idx
  ON public.protected_asset_grid_tiles(user_id);
CREATE INDEX IF NOT EXISTS protected_asset_grid_tiles_parent_idx
  ON public.protected_asset_grid_tiles(parent_asset_id);
CREATE INDEX IF NOT EXISTS protected_asset_grid_tiles_pending_review_idx
  ON public.protected_asset_grid_tiles(user_id)
  WHERE promotion_status = 'PENDING_REVIEW';

-- Customers may read and review (approve/reject) their own tiles; only the
-- pipeline (service_role) inserts new tile rows.
GRANT SELECT, UPDATE ON public.protected_asset_grid_tiles TO authenticated;
GRANT ALL ON public.protected_asset_grid_tiles TO service_role;
ALTER TABLE public.protected_asset_grid_tiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own grid tiles read" ON public.protected_asset_grid_tiles
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "own grid tiles review" ON public.protected_asset_grid_tiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_protected_asset_grid_tiles_updated
    BEFORE UPDATE ON public.protected_asset_grid_tiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ C. deepfake_reference_faces: provenance + tiering ============
-- Additive only. Existing rows (all created via the manual Deepfake Intel
-- upload UI) keep their DEFAULT values unchanged — nothing about them is
-- altered by this migration.
ALTER TABLE public.deepfake_reference_faces
  ADD COLUMN IF NOT EXISTS reference_tier TEXT NOT NULL DEFAULT 'APPROVED_SECONDARY_REFERENCE',
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD',
  ADD COLUMN IF NOT EXISTS source_asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_tile_id UUID REFERENCES public.protected_asset_grid_tiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phash TEXT;

DO $$ BEGIN
  ALTER TABLE public.deepfake_reference_faces
    ADD CONSTRAINT deepfake_reference_faces_reference_tier_check
    CHECK (reference_tier IN
      ('CANONICAL_VERIFIED_REFERENCE','APPROVED_SECONDARY_REFERENCE','SCREENSHOT_DERIVED_REFERENCE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.deepfake_reference_faces
    ADD CONSTRAINT deepfake_reference_faces_source_type_check
    CHECK (source_type IN ('MANUAL_UPLOAD','SCREENSHOT_DERIVED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- New columns/tables exist:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='protected_assets'
--   AND column_name IN ('grid_screenshot_status','grid_processed_at','grid_tile_count');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='deepfake_reference_faces'
--   AND column_name IN ('reference_tier','source_type','source_asset_id','source_tile_id','phash');
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name = 'protected_asset_grid_tiles';
--
-- Confirm this migration created no face tables and altered no existing rows:
-- SELECT count(*) FROM public.protected_assets;           -- unchanged from before
-- SELECT count(*) FROM public.deepfake_target_profiles;    -- unchanged from before
-- SELECT count(*) FROM public.deepfake_reference_faces;    -- unchanged from before (rows preserved, only new columns added)
