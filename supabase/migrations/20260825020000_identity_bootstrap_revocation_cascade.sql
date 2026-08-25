-- Protected-Asset Identity Bootstrap (Path C) — revocation cascade.
--
-- Fixes a gap found in preview validation: revoking an
-- ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE anchor previously left any
-- SCREENSHOT_DERIVED_REFERENCE rows that were auto-matched *because of* that
-- anchor still trusted — dangerous if the admin revoked specifically because
-- they confirmed the wrong person, since everything matched against that
-- wrong anchor should stop being trusted too.
--
-- Purely additive to deepfake_reference_faces (confirmed-real production
-- table; only new nullable columns are added, no existing row or constraint
-- is touched), following the exact conventions of the two prior migrations
-- in this feature (20260825000000, 20260825010000).

ALTER TABLE public.deepfake_reference_faces
  -- Which reference this one was auto-matched against, if any — the
  -- provenance edge the cascade walk in identity-bootstrap-core.server.ts
  -- follows. NULL for every reference that isn't a downstream match of
  -- another reference (canonical/manual uploads, admin-confirmed anchors
  -- themselves, and any legacy row predating this column).
  ADD COLUMN IF NOT EXISTS derived_from_reference_id UUID
    REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL,
  -- Why this specific row was revoked — a direct admin decision, or a
  -- cascade from revoking the anchor it was matched against. NULL for a
  -- row that has never been revoked.
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  -- The original anchor whose revocation triggered this row's cascade —
  -- distinct from derived_from_reference_id, which may be an intermediate
  -- link in a longer chain rather than the anchor an admin actually acted
  -- on. NULL unless revoked_reason = 'CASCADED_ANCHOR_REVOKED'.
  ADD COLUMN IF NOT EXISTS revoked_cascade_root_id UUID
    REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.deepfake_reference_faces
    ADD CONSTRAINT deepfake_reference_faces_revoked_reason_check
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('ADMIN_REVOKED', 'CASCADED_ANCHOR_REVOKED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Cascade walk performance — one row typically derives from very few
-- others, but this keeps the revoke-time BFS a lookup instead of a scan as
-- a customer's reference set grows.
CREATE INDEX IF NOT EXISTS deepfake_reference_faces_derived_from_idx
  ON public.deepfake_reference_faces(derived_from_reference_id)
  WHERE derived_from_reference_id IS NOT NULL;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='deepfake_reference_faces'
--   AND column_name IN ('derived_from_reference_id','revoked_reason','revoked_cascade_root_id');
--
-- Confirm no existing rows were altered:
-- SELECT count(*) FROM public.deepfake_reference_faces; -- unchanged from before
