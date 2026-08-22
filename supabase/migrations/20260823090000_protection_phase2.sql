-- Phase 2 of automatic protection enrollment: schema needed to wire
-- Copyright and Evidence into the existing scan_module_enrollments
-- scheduler. Purely additive — no change to authorization/KYC/liveness
-- tables, and no change to the Phase 1 protection/orchestrator schema.
--
-- Production schema inspection confirmed deepfake_target_profiles and
-- deepfake_reference_faces ALREADY EXIST in production with real customer
-- face-reference rows. An earlier version of this migration included
-- CREATE TABLE IF NOT EXISTS blocks for both — a no-op against the real
-- tables in the best case, but a real risk of silently documenting the
-- wrong schema shape (the same class of bug protection_profiles had) and,
-- worse, would have coupled this migration to redefining tables it must
-- never touch. Both CREATE TABLE blocks are removed entirely. Deepfake
-- dispatch (src/lib/protection/dispatch/deepfake.server.ts) now only reads
-- these two tables — never creates, alters, or writes to them — reusing
-- whatever deepfake_target_profiles/deepfake_reference_faces rows already
-- exist for a customer and returning an honest blocked status
-- (NO_TARGET_PROFILE / NO_REFERENCE_FACES) when none do, rather than
-- fabricating enrollment or copying from the confirmed-nonexistent
-- protected_faces/protected_face_profiles tables.
--
-- This migration does not create, alter, or reference protected_faces or
-- protected_face_profiles anywhere (both confirmed not to exist in
-- production) and does not touch deepfake_target_profiles,
-- deepfake_reference_faces, KYC/liveness tables, authorization rows,
-- existing protected_assets rows, or existing findings/cases.

-- ============ COPYRIGHT: LINK AUTOMATED SCANS BACK TO THEIR ASSET ============
-- protected_assets and copyright_scans both confirmed to already exist in
-- production. Additive column only.
ALTER TABLE public.copyright_scans
  ADD COLUMN IF NOT EXISTS protected_asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS copyright_scans_protected_asset_idx
  ON public.copyright_scans(protected_asset_id) WHERE protected_asset_id IS NOT NULL;

-- ============ GENERIC AUTOMATED-FINDING EVIDENCE RECORD ============
-- Mirrors the shape src/lib/deepfake/evidence-capture.server.ts's
-- captureAndStoreEvidence already produces for deepfake_evidence, generalized
-- so Copyright/YouTube-Removal findings (which have no evidence table today)
-- get a real, durable place to record capture results. Deepfake keeps
-- writing to its own existing deepfake_evidence table unchanged.
--
-- Dedupe key is (user_id, module_key, url) — content identity — NOT
-- finding_id. finding_id is a per-scan synthetic row id (a new
-- copyright_matches/youtube_removal_findings row is created on every
-- recurring re-scan even when the same real-world URL is rediscovered), so
-- keying uniqueness on it would let the exact same URL accumulate a fresh
-- evidence row every cadence cycle forever. Keying on the stable URL instead
-- makes a re-discovery of the same content across recurring scans upsert
-- onto the same evidence row (audit finding: duplicate-safety pass).
CREATE TABLE IF NOT EXISTS public.automated_finding_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  finding_source_table TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  media_type TEXT,
  http_status INTEGER,
  content_type TEXT,
  content_length INTEGER,
  media_sha256 TEXT,
  evidence_status TEXT NOT NULL,
  capture_error TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key, url)
);
CREATE INDEX IF NOT EXISTS automated_finding_evidence_user_idx
  ON public.automated_finding_evidence(user_id);
GRANT SELECT, INSERT, UPDATE ON public.automated_finding_evidence TO authenticated;
GRANT ALL ON public.automated_finding_evidence TO service_role;
ALTER TABLE public.automated_finding_evidence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own automated finding evidence" ON public.automated_finding_evidence
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin automated finding evidence read" ON public.automated_finding_evidence
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ APPEND-ONLY EVIDENCE CAPTURE HISTORY ============
-- automated_finding_evidence above is the canonical, idempotent (upserted)
-- occurrence used for dedup/case-prep gating — deliberately mutable so a
-- re-verification updates it. That upsert would otherwise silently discard
-- the prior capture's hash/status/timestamp on every re-scan of the same
-- URL, which is unacceptable for anything evidentiary. This table is the
-- immutable record: one INSERT per capture attempt, never updated or
-- deleted by application code (same insert-only convention already used by
-- authorization_audit_logs/enforcement_events elsewhere in this schema).
CREATE TABLE IF NOT EXISTS public.automated_finding_evidence_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id UUID NOT NULL REFERENCES public.automated_finding_evidence(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT,
  media_type TEXT,
  http_status INTEGER,
  content_type TEXT,
  content_length INTEGER,
  media_sha256 TEXT,
  evidence_status TEXT NOT NULL,
  capture_error TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automated_finding_evidence_captures_evidence_idx
  ON public.automated_finding_evidence_captures(evidence_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS automated_finding_evidence_captures_user_idx
  ON public.automated_finding_evidence_captures(user_id);
GRANT SELECT, INSERT ON public.automated_finding_evidence_captures TO authenticated;
GRANT ALL ON public.automated_finding_evidence_captures TO service_role;
ALTER TABLE public.automated_finding_evidence_captures ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own automated finding evidence history" ON public.automated_finding_evidence_captures
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin automated finding evidence history read" ON public.automated_finding_evidence_captures
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- New columns/tables exist.
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='copyright_scans' AND column_name='protected_asset_id';
--
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
-- AND table_name IN ('automated_finding_evidence','automated_finding_evidence_captures');
--
-- Confirm this migration created no face tables and altered no existing rows.
-- SELECT count(*) FROM public.deepfake_target_profiles;   -- unchanged from before
-- SELECT count(*) FROM public.deepfake_reference_faces;   -- unchanged from before
-- SELECT count(*) FROM public.protected_assets;           -- unchanged from before
