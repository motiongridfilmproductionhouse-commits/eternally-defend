ALTER TABLE public.web_scan_leads
  ADD COLUMN IF NOT EXISTS query_origin text NOT NULL DEFAULT 'PIPELINE',
  ADD COLUMN IF NOT EXISTS ai_content_type text,
  ADD COLUMN IF NOT EXISTS ai_reputation_risk text,
  ADD COLUMN IF NOT EXISTS ai_subject_confidence integer,
  ADD COLUMN IF NOT EXISTS ai_evidence_confidence integer,
  ADD COLUMN IF NOT EXISTS ai_recommended_action text,
  ADD COLUMN IF NOT EXISTS ai_evidence_basis text,
  ADD COLUMN IF NOT EXISTS ai_reasoning_summary text;

ALTER TABLE public.web_scan_runs
  ADD COLUMN IF NOT EXISTS ai_diagnostics jsonb;

CREATE TABLE IF NOT EXISTS public.scan_ai_analysis_cache (
  evidence_hash text PRIMARY KEY,
  verdict jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scan_ai_analysis_cache TO authenticated;
GRANT ALL ON public.scan_ai_analysis_cache TO service_role;

ALTER TABLE public.scan_ai_analysis_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read AI analysis cache" ON public.scan_ai_analysis_cache;
CREATE POLICY "Authenticated can read AI analysis cache"
  ON public.scan_ai_analysis_cache FOR SELECT TO authenticated USING (true);