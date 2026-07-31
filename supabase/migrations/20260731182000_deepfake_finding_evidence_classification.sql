-- Deepfake Intelligence: page-evidence classification fields.
-- Stores identity/synthetic confidence, matched evidence, page type and
-- the finding taxonomy used to suppress false-positive adult search pages.

ALTER TABLE public.deepfake_findings
  ADD COLUMN IF NOT EXISTS finding_classification TEXT,
  ADD COLUMN IF NOT EXISTS page_type TEXT,
  ADD COLUMN IF NOT EXISTS identity_confidence INT,
  ADD COLUMN IF NOT EXISTS synthetic_media_confidence INT,
  ADD COLUMN IF NOT EXISTS matched_evidence TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_explanation TEXT;

COMMENT ON COLUMN public.deepfake_findings.finding_classification IS
  'VERIFIED_DEEPFAKE | PROBABLE_DEEPFAKE | ADULT_NAME_MENTION | UNRELATED_ADULT_CONTENT | UNVERIFIED_LEAD';

COMMENT ON COLUMN public.deepfake_findings.page_type IS
  'Detected page type after crawl: search | tag | category | performer_index | listing | content | unknown';

COMMENT ON COLUMN public.deepfake_findings.identity_confidence IS
  '0-100 confidence that the protected identity is evidenced on the exact page';

COMMENT ON COLUMN public.deepfake_findings.synthetic_media_confidence IS
  '0-100 confidence that synthetic/impersonation evidence is present on the page';

COMMENT ON COLUMN public.deepfake_findings.matched_evidence IS
  'Structured evidence labels collected during page inspection and media analysis';

COMMENT ON COLUMN public.deepfake_findings.classification_explanation IS
  'Human-readable explanation of why the finding received its classification';

CREATE INDEX IF NOT EXISTS deepfake_findings_classification_idx
  ON public.deepfake_findings (scan_id, finding_classification);
