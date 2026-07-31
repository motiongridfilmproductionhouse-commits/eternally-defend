-- Deepfake Intelligence: internal discovery funnel diagnostics.
ALTER TABLE public.deepfake_scans
  ADD COLUMN IF NOT EXISTS discovery_metrics JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.deepfake_scans.discovery_metrics IS
  'Internal Deepfake Intelligence funnel metrics: generated/executed queries, provider candidates, crawl and verification outcomes, and client-visible counts.';
