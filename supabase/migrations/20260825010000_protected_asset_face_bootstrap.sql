-- Protected-Asset Face Bootstrap (Path C identity anchor).
--
-- Lets a customer with NO liveness and NO manually-created Deepfake Intel
-- target profile still build face-reference coverage from screenshots
-- already sitting in their protected_assets — gated behind mandatory human
-- (admin) confirmation of which recurring face cluster is actually the
-- protected person, never an automatic largest/most-frequent-face guess.
--
-- Purely additive, following the exact conventions of
-- 20260825000000_face_reference_extraction.sql:
--   * protected_asset_grid_tiles and its promotion_status/reference_tier
--     CHECK constraints were both introduced by that earlier migration
--     (this repo's own code), so widening them here is safe — no
--     confirmed-real production table's pre-existing constraint is touched.
--   * deepfake_reference_faces itself is confirmed-real production (untouched
--     rows, only the additional columns/constraints that migration already
--     added get widened further here).
--   * face_identity_candidate_clusters is a brand-new table.

-- ============ A. protected_asset_grid_tiles: candidate-review support ============
ALTER TABLE public.protected_asset_grid_tiles
  ADD COLUMN IF NOT EXISTS cluster_id UUID;

DO $$ BEGIN
  ALTER TABLE public.protected_asset_grid_tiles
    DROP CONSTRAINT IF EXISTS protected_asset_grid_tiles_promotion_status_check;
  ALTER TABLE public.protected_asset_grid_tiles
    ADD CONSTRAINT protected_asset_grid_tiles_promotion_status_check
    CHECK (promotion_status IN
      ('NOT_CANDIDATE','PENDING_REVIEW','AUTO_APPROVED','MANUALLY_APPROVED','REJECTED','DUPLICATE',
       'UNCONFIRMED_IDENTITY_CANDIDATE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS protected_asset_grid_tiles_cluster_idx
  ON public.protected_asset_grid_tiles(cluster_id)
  WHERE cluster_id IS NOT NULL;

-- ============ B. face_identity_candidate_clusters: recurring-face groups awaiting review ============
CREATE TABLE IF NOT EXISTS public.face_identity_candidate_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  representative_tile_id UUID REFERENCES public.protected_asset_grid_tiles(id) ON DELETE SET NULL,
  tile_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REJECTED')),
  -- Set only once an admin confirms this cluster IS the protected person —
  -- points at the deepfake_reference_faces row created at that moment.
  confirmed_reference_id UUID REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS face_identity_candidate_clusters_user_idx
  ON public.face_identity_candidate_clusters(user_id);

-- Read: the owning customer can see their own cluster status (for the
-- Coverage panel's "identity confirmation required" state); admins can see
-- any customer's clusters (for the review screen). Writes only via
-- service_role — the confirm/reject/revoke actions re-verify the admin role
-- server-side before ever touching this table.
GRANT SELECT ON public.face_identity_candidate_clusters TO authenticated;
GRANT ALL ON public.face_identity_candidate_clusters TO service_role;
ALTER TABLE public.face_identity_candidate_clusters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "own identity clusters read" ON public.face_identity_candidate_clusters
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admin identity clusters read" ON public.face_identity_candidate_clusters
    FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_face_identity_candidate_clusters_updated
    BEFORE UPDATE ON public.face_identity_candidate_clusters
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK from protected_asset_grid_tiles.cluster_id, added after the cluster
-- table exists.
DO $$ BEGIN
  ALTER TABLE public.protected_asset_grid_tiles
    ADD CONSTRAINT protected_asset_grid_tiles_cluster_id_fkey
    FOREIGN KEY (cluster_id) REFERENCES public.face_identity_candidate_clusters(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ C. deepfake_reference_faces: admin-confirmed tier + revocation ============
-- Additive only — existing rows (manual uploads, screenshot-derived) are
-- entirely unaffected; new columns default to NULL.
ALTER TABLE public.deepfake_reference_faces
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.deepfake_reference_faces
    DROP CONSTRAINT IF EXISTS deepfake_reference_faces_reference_tier_check;
  ALTER TABLE public.deepfake_reference_faces
    ADD CONSTRAINT deepfake_reference_faces_reference_tier_check
    CHECK (reference_tier IN
      ('CANONICAL_VERIFIED_REFERENCE','APPROVED_SECONDARY_REFERENCE','SCREENSHOT_DERIVED_REFERENCE',
       'ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.deepfake_reference_faces
    DROP CONSTRAINT IF EXISTS deepfake_reference_faces_source_type_check;
  ALTER TABLE public.deepfake_reference_faces
    ADD CONSTRAINT deepfake_reference_faces_source_type_check
    CHECK (source_type IN ('MANUAL_UPLOAD','SCREENSHOT_DERIVED','ADMIN_CONFIRMED_PROTECTED_ASSET'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='protected_asset_grid_tiles' AND column_name='cluster_id';
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='deepfake_reference_faces'
--   AND column_name IN ('confirmed_by','confirmed_at','revoked_by','revoked_at');
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema='public' AND table_name='face_identity_candidate_clusters';
--
-- Confirm no existing rows were altered:
-- SELECT count(*) FROM public.deepfake_reference_faces;  -- unchanged from before
-- SELECT count(*) FROM public.protected_asset_grid_tiles; -- unchanged from before
