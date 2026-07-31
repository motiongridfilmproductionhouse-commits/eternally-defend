CREATE TABLE public.distribution_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'website',
  content_type TEXT NOT NULL DEFAULT 'unknown',
  platform TEXT,
  page_title TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  risk_score INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  screenshot_url TEXT,
  tracked_titles TEXT[] NOT NULL DEFAULT '{}',
  discovered_scan_id UUID REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  parent_source_id UUID REFERENCES public.distribution_sources(id) ON DELETE SET NULL,
  monitor_enabled BOOLEAN NOT NULL DEFAULT true,
  monitor_interval_minutes INTEGER NOT NULL DEFAULT 720,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_count INTEGER NOT NULL DEFAULT 0,
  incident_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_sources TO authenticated;
GRANT ALL ON public.distribution_sources TO service_role;
ALTER TABLE public.distribution_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own distribution sources"
ON public.distribution_sources FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_distribution_sources_user ON public.distribution_sources (user_id, last_seen_at DESC);
CREATE INDEX idx_distribution_sources_due ON public.distribution_sources (next_check_at) WHERE monitor_enabled;

CREATE TABLE public.distribution_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.distribution_sources(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  work_title TEXT,
  incident_type TEXT NOT NULL DEFAULT 'source_active',
  severity TEXT NOT NULL DEFAULT 'medium',
  confidence INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  summary TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_incidents TO authenticated;
GRANT ALL ON public.distribution_incidents TO service_role;
ALTER TABLE public.distribution_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own distribution incidents"
ON public.distribution_incidents FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_distribution_incidents_user ON public.distribution_incidents (user_id, detected_at DESC);
CREATE INDEX idx_distribution_incidents_source ON public.distribution_incidents (source_id, detected_at DESC);

CREATE TABLE public.distribution_monitor_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.distribution_sources(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'auto_monitor',
  status TEXT NOT NULL DEFAULT 'completed',
  reachable BOOLEAN,
  confidence INTEGER,
  risk_level TEXT,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  incidents_created INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.distribution_monitor_runs TO authenticated;
GRANT ALL ON public.distribution_monitor_runs TO service_role;
ALTER TABLE public.distribution_monitor_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own distribution monitor runs"
ON public.distribution_monitor_runs FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_distribution_runs_source ON public.distribution_monitor_runs (source_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_distribution_sources_updated_at BEFORE UPDATE ON public.distribution_sources
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_distribution_incidents_updated_at BEFORE UPDATE ON public.distribution_incidents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();