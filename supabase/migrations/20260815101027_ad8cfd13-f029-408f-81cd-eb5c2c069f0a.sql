ALTER TABLE public.domain_enforcement_routes
  ADD COLUMN IF NOT EXISTS discovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS discovery_finding_id text,
  ADD COLUMN IF NOT EXISTS discovery_case_id uuid,
  ADD COLUMN IF NOT EXISTS discovery_finding_url text,
  ADD COLUMN IF NOT EXISTS discovery_source_type text;

CREATE INDEX IF NOT EXISTS idx_domain_enforcement_routes_discovered_at
  ON public.domain_enforcement_routes (discovered_at DESC);