-- Migration: Ensure scan_hits unique indexes exist for onConflict upsert targets:
-- 1. (user_id, source, external_id) -> scan_hits_user_source_external_id_idx
-- 2. (user_id, source, canonical_url) -> scan_hits_user_source_canonical_url_idx

CREATE UNIQUE INDEX IF NOT EXISTS scan_hits_user_source_external_id_idx
  ON public.scan_hits (user_id, source, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS scan_hits_user_source_canonical_url_idx
  ON public.scan_hits (user_id, source, canonical_url);
