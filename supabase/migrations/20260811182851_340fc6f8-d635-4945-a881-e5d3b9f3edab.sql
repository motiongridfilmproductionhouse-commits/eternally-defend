CREATE TABLE public.web_scan_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  sources TEXT[] NOT NULL DEFAULT '{}',
  funnel JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.web_scan_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.web_scan_runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  source TEXT,
  platform TEXT,
  query TEXT,
  stage TEXT NOT NULL,
  identity_tier TEXT NOT NULL,
  identity_confidence INTEGER NOT NULL DEFAULT 0,
  matched_signals TEXT[] NOT NULL DEFAULT '{}',
  failed_signals TEXT[] NOT NULL DEFAULT '{}',
  exclusion_reason TEXT,
  extractor TEXT,
  page_excerpt TEXT,
  severity TEXT,
  threat_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX web_scan_leads_run_idx ON public.web_scan_leads(run_id);
CREATE INDEX web_scan_leads_stage_idx ON public.web_scan_leads(stage);
CREATE INDEX web_scan_runs_created_idx ON public.web_scan_runs(created_at DESC);

GRANT SELECT ON public.web_scan_runs TO authenticated;
GRANT ALL ON public.web_scan_runs TO service_role;
GRANT SELECT ON public.web_scan_leads TO authenticated;
GRANT ALL ON public.web_scan_leads TO service_role;

ALTER TABLE public.web_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_scan_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scan runs" ON public.web_scan_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view scan leads" ON public.web_scan_leads
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));