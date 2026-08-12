-- Replace partial unique indexes on scan_hits with full ones so upserts can infer them
DROP INDEX IF EXISTS public.uq_scan_hits_source_extid;
DROP INDEX IF EXISTS public.uq_scan_hits_source_canonical;

-- Remove duplicate rows that would violate the new full unique indexes
DELETE FROM public.scan_hits a
USING public.scan_hits b
WHERE a.id < b.id
  AND a.user_id = b.user_id
  AND a.source = b.source
  AND a.external_id IS NOT NULL
  AND a.external_id = b.external_id;

DELETE FROM public.scan_hits a
USING public.scan_hits b
WHERE a.id < b.id
  AND a.user_id = b.user_id
  AND a.source = b.source
  AND a.canonical_url IS NOT NULL
  AND a.canonical_url = b.canonical_url;

CREATE UNIQUE INDEX uq_scan_hits_source_extid
  ON public.scan_hits (user_id, source, external_id);

CREATE UNIQUE INDEX uq_scan_hits_source_canonical
  ON public.scan_hits (user_id, source, canonical_url);