CREATE TABLE public.asset_discovery_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  protected_asset_id uuid NOT NULL REFERENCES public.protected_assets(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.copyright_scans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  stage text NOT NULL DEFAULT 'queued',
  candidates_discovered integer NOT NULL DEFAULT 0,
  candidates_fetched integer NOT NULL DEFAULT 0,
  candidates_verified integer NOT NULL DEFAULT 0,
  candidates_rejected integer NOT NULL DEFAULT 0,
  matches_created integer NOT NULL DEFAULT 0,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_discovery_jobs TO authenticated;
GRANT ALL ON public.asset_discovery_jobs TO service_role;
ALTER TABLE public.asset_discovery_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own discovery jobs" ON public.asset_discovery_jobs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX asset_discovery_jobs_user_asset_idx
  ON public.asset_discovery_jobs (user_id, protected_asset_id, created_at DESC);

CREATE TABLE public.discovery_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  protected_asset_id uuid NOT NULL REFERENCES public.protected_assets(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.asset_discovery_jobs(id) ON DELETE SET NULL,
  page_url text NOT NULL,
  canonical_page_url text NOT NULL,
  media_url text,
  provider text NOT NULL DEFAULT 'unknown',
  match_type text,
  page_title text,
  platform text,
  host text,
  crawl_status text NOT NULL DEFAULT 'PENDING',
  crawl_failure_reason text,
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  similarity numeric,
  distance integer,
  algorithm text,
  match_reason text,
  hashes jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  screenshot_url text,
  copyright_match_id uuid REFERENCES public.copyright_matches(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_candidates_crawl_status_check
    CHECK (crawl_status IN ('PENDING','FETCHED','FETCH_FAILED','SKIPPED')),
  CONSTRAINT discovery_candidates_verification_status_check
    CHECK (verification_status IN ('UNVERIFIED','VERIFIED_MATCH','REJECTED','FETCH_FAILED'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_candidates TO authenticated;
GRANT ALL ON public.discovery_candidates TO service_role;
ALTER TABLE public.discovery_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own discovery candidates" ON public.discovery_candidates
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX discovery_candidates_identity_idx
  ON public.discovery_candidates (user_id, protected_asset_id, canonical_page_url);
CREATE INDEX discovery_candidates_job_idx ON public.discovery_candidates (job_id);
CREATE INDEX discovery_candidates_status_idx
  ON public.discovery_candidates (user_id, verification_status, last_seen_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_asset_discovery_jobs_updated_at
  BEFORE UPDATE ON public.asset_discovery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_discovery_candidates_updated_at
  BEFORE UPDATE ON public.discovery_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();