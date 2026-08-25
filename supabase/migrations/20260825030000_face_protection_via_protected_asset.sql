-- Face Protection activation from the protected-asset identity bootstrap
-- (Path C). Lets a customer whose trusted identity reference was
-- established from their OWN protected images (admin-confirmed — see
-- 20260825010000/20260825020000) have Face Protection become ACTIVE
-- without ever performing AWS Face Liveness — without ever claiming
-- liveness occurred.
--
-- FACE_VERIFIED_VIA_PROTECTED_ASSET is deliberately a DISTINCT enum value
-- from FACE_VERIFIED: every place that treats FACE_VERIFIED as proof of a
-- strong, liveness-backed identity check (most importantly
-- src/lib/verification/verification-status.ts's deriveVerificationStatus,
-- which gates sensitive/enforcement actions) must never conflate the two,
-- so those safeguards are completely unaffected by this migration.
--
-- Purely additive:
--   * ALTER TYPE ... ADD VALUE IF NOT EXISTS, following the exact
--     precedent of 20260718061836's DEFERRED addition to this same enum.
--   * ADD COLUMN IF NOT EXISTS on protected_faces (confirmed-real
--     production table; only a new nullable, FK-guarded column is added).
-- No existing row, column, or constraint is touched.

ALTER TYPE public.face_profile_status ADD VALUE IF NOT EXISTS 'FACE_VERIFIED_VIA_PROTECTED_ASSET';

-- Links a protected_faces row created by Path C activation back to the
-- deepfake_reference_faces anchor it was derived from, so revoking that
-- anchor (identity-bootstrap-core.server.ts's revokeAdminConfirmedAnchorCore)
-- can find and deactivate the matching Face Protection reference too —
-- never deleted, just excluded from future automatic matching, mirroring
-- how the anchor revocation itself already works. NULL for every
-- liveness-enrolled protected_faces row (nothing to link back to) and for
-- every row that predates this column.
ALTER TABLE public.protected_faces
  ADD COLUMN IF NOT EXISTS linked_reference_face_id UUID
    REFERENCES public.deepfake_reference_faces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS protected_faces_linked_reference_idx
  ON public.protected_faces(linked_reference_face_id)
  WHERE linked_reference_face_id IS NOT NULL;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- SELECT unnest(enum_range(NULL::public.face_profile_status));
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='protected_faces'
--   AND column_name = 'linked_reference_face_id';
--
-- Confirm no existing rows were altered:
-- SELECT count(*) FROM public.protected_faces; -- unchanged from before
-- SELECT count(*) FROM public.protected_face_profiles; -- unchanged from before
