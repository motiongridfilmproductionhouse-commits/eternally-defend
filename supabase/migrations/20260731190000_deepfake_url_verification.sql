-- Deepfake Intelligence: URL verification fields for accurate evidence links.

ALTER TABLE public.deepfake_findings
  ADD COLUMN IF NOT EXISTS discovered_url TEXT,
  ADD COLUMN IF NOT EXISTS final_url TEXT,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS http_status INT,
  ADD COLUMN IF NOT EXISTS redirect_chain TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS url_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS url_rejection_reason TEXT;

COMMENT ON COLUMN public.deepfake_findings.discovered_url IS
  'Original URL returned by search/discovery before redirects';

COMMENT ON COLUMN public.deepfake_findings.final_url IS
  'Final URL after following redirects; this is the openable evidence page';

COMMENT ON COLUMN public.deepfake_findings.canonical_url IS
  'Normalized canonical URL used for deduplication after redirects';

COMMENT ON COLUMN public.deepfake_findings.http_status IS
  'HTTP status observed for the final URL during verification';

COMMENT ON COLUMN public.deepfake_findings.redirect_chain IS
  'Ordered list of URLs visited while resolving redirects';

COMMENT ON COLUMN public.deepfake_findings.crawled_at IS
  'Timestamp when the final URL was crawled for verification';

COMMENT ON COLUMN public.deepfake_findings.url_verification_status IS
  'URL_VERIFIED | URL_REJECTED';

COMMENT ON COLUMN public.deepfake_findings.url_rejection_reason IS
  'Why the URL failed verification, when rejected';

CREATE INDEX IF NOT EXISTS deepfake_findings_url_verification_idx
  ON public.deepfake_findings (scan_id, url_verification_status);

CREATE INDEX IF NOT EXISTS deepfake_findings_canonical_url_idx
  ON public.deepfake_findings (scan_id, canonical_url);
