DROP INDEX IF EXISTS public.scan_hits_dedupe_external_id_key;
DROP INDEX IF EXISTS public.scan_hits_dedupe_canonical_url_key;
CREATE UNIQUE INDEX IF NOT EXISTS scan_hits_user_source_external_id_idx ON public.scan_hits (user_id, source, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS scan_hits_user_source_canonical_url_idx ON public.scan_hits (user_id, source, canonical_url);