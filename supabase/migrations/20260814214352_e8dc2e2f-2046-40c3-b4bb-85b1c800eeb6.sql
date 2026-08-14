
CREATE TABLE IF NOT EXISTS public.protection_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  auto_scan_enabled BOOLEAN NOT NULL DEFAULT true,
  paused BOOLEAN NOT NULL DEFAULT false,
  default_cadence_minutes INTEGER NOT NULL DEFAULT 1440,
  activated_at TIMESTAMPTZ,
  last_sweep_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.protection_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('identity','asset')),
  target_ref UUID,
  label TEXT NOT NULL,
  cadence_minutes INTEGER NOT NULL DEFAULT 1440,
  active BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  last_run_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_kind, label)
);
CREATE INDEX IF NOT EXISTS protection_targets_due_idx ON public.protection_targets (next_run_at) WHERE active;

CREATE TABLE IF NOT EXISTS public.protection_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  target_id UUID REFERENCES public.protection_targets(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS protection_runs_user_idx ON public.protection_runs (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.protection_findings_seen (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  target_id UUID REFERENCES public.protection_targets(id) ON DELETE SET NULL,
  case_id UUID,
  enforcement_status TEXT,
  blocking_reason TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  times_seen INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_profiles TO authenticated;
GRANT ALL ON public.protection_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_targets TO authenticated;
GRANT ALL ON public.protection_targets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_runs TO authenticated;
GRANT ALL ON public.protection_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_findings_seen TO authenticated;
GRANT ALL ON public.protection_findings_seen TO service_role;

ALTER TABLE public.protection_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protection_findings_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own protection profile" ON public.protection_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own protection targets" ON public.protection_targets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own protection runs" ON public.protection_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own protection findings seen" ON public.protection_findings_seen FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_protection_profiles_updated_at BEFORE UPDATE ON public.protection_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_protection_targets_updated_at BEFORE UPDATE ON public.protection_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
