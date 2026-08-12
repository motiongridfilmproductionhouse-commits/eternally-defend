-- Migration: 20260812090000_scan_hits_evidence_classification.sql
-- Description: Persist the evidence-gated reputation classifier's verdict on scan_hits.
--
-- The evidence-gated classifier (src/lib/reputation/evidence-classifier.ts) already
-- computes a tier + risk evidence for every hit at scan time, but that verdict was
-- never written to scan_hits — it only lived in the in-memory API response. Once a
-- scan was persisted and reloaded, the presentation layer had no way to tell a
-- correctly-neutral result ("analysis complete, no risk found") apart from one that
-- was never analyzed, so the UI defaulted to a permanent "pending" state for both.
--
-- classification_tier / risk_evidence_found are plain columns (cheap to filter/sort
-- on); evidence_classification carries the full verdict (category, evidence excerpt,
-- confidence, reason) for detail views, mirroring the existing metrics/source_metadata
-- JSONB bag pattern already used on this table.

ALTER TABLE public.scan_hits
  ADD COLUMN IF NOT EXISTS classification_tier TEXT,
  ADD COLUMN IF NOT EXISTS risk_evidence_found BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_classification JSONB;

CREATE INDEX IF NOT EXISTS idx_scan_hits_classification_tier
  ON public.scan_hits(classification_tier);
