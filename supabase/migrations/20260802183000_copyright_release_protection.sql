-- Release Protection & Automatic Leak Monitoring for Copyright Intelligence

CREATE TABLE public.copyright_release_protection (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scan_id UUID REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_package JSONB NOT NULL DEFAULT '{}'::jsonb,
  readiness_score INTEGER NOT NULL DEFAULT 0,
  readiness_level TEXT NOT NULL DEFAULT 'not_ready',
  paused BOOLEAN NOT NULL DEFAULT false,
  monitoring_start_at TIMESTAMPTZ,
  monitoring_end_at TIMESTAMPTZ,
  next_scan_at TIMESTAMPTZ,
  last_scan_at TIMESTAMPTZ,
  last_scan_id UUID REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.release_monitor_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  release_protection_id UUID NOT NULL REFERENCES public.copyright_release_protection(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scan_id UUID REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  providers_attempted INTEGER NOT NULL DEFAULT 0,
  providers_succeeded INTEGER NOT NULL DEFAULT 0,
  providers_failed INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  incidents_created INTEGER NOT NULL DEFAULT 0,
  pre_release_findings INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.release_protection_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  release_protection_id UUID NOT NULL REFERENCES public.copyright_release_protection(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  incident_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'web',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  release_timing TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_protection_id, source_url, incident_type)
);

CREATE INDEX idx_release_protection_user ON public.copyright_release_protection(user_id, created_at DESC);
CREATE INDEX idx_release_protection_due ON public.copyright_release_protection(next_scan_at)
  WHERE paused = false AND (settings->>'enabled')::boolean IS DISTINCT FROM false;
CREATE INDEX idx_release_monitor_runs_protection ON public.release_monitor_runs(release_protection_id, scheduled_for DESC);
CREATE INDEX idx_release_incidents_protection ON public.release_protection_incidents(release_protection_id, last_seen_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_release_protection TO authenticated;
GRANT ALL ON public.copyright_release_protection TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_monitor_runs TO authenticated;
GRANT ALL ON public.release_monitor_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_protection_incidents TO authenticated;
GRANT ALL ON public.release_protection_incidents TO service_role;

ALTER TABLE public.copyright_release_protection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_monitor_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_protection_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own release protection"
  ON public.copyright_release_protection FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own release monitor runs"
  ON public.release_monitor_runs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own release protection incidents"
  ON public.release_protection_incidents FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_copyright_release_protection_updated_at
  BEFORE UPDATE ON public.copyright_release_protection
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_release_protection_incidents_updated_at
  BEFORE UPDATE ON public.release_protection_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
