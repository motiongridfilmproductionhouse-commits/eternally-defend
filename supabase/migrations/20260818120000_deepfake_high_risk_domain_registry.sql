-- Persists the deepfake-intel "high-risk domain" registry that was previously
-- an in-memory Map (src/lib/deepfake/high-risk-registry.server.ts). Domains
-- are reference data shared across the whole deepfake_intel feature, not
-- per-tenant data — a domain having produced a qualified finding for one
-- protected target is useful signal for prioritising discovery on ANY
-- target's next scan.
--
-- TENANT ISOLATION: this table is server-side/service-role-only in both
-- directions (no client, of any tenant, can read or write it) and stores
-- ONLY non-tenant-identifying operational data: a hostname, an aggregate
-- qualified-finding count, a generic provider/category label, and
-- timestamps. It deliberately does NOT store `exact_discovery_query` (or any
-- other field that could contain a protected person's name, alias, handle,
-- or search phrase) — a globally-shared table is the wrong place for that,
-- since it would let any authenticated customer infer which individuals
-- other customers have enrolled for protection. `exact_discovery_query` is
-- not required for query generation either: generateHighRiskSiteQueries()
-- (src/lib/deepfake/high-risk-registry.server.ts) always rebuilds the query
-- fresh from the hostname plus the CURRENT scan's own target name/aliases,
-- so no historical query text ever needs to be stored or replayed.
CREATE TABLE public.deepfake_high_risk_domains (
  hostname text NOT NULL PRIMARY KEY,
  discovery_provider text NOT NULL DEFAULT 'seed',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  qualified_finding_count integer NOT NULL DEFAULT 1 CHECK (qualified_finding_count > 0)
);

CREATE INDEX deepfake_high_risk_domains_rank_idx
  ON public.deepfake_high_risk_domains (qualified_finding_count DESC);

-- No client of any kind (anon or authenticated, any tenant) gets a grant on
-- this table. Explicit REVOKE first as defense-in-depth against any
-- project-level default-privilege grant to PUBLIC/anon/authenticated;
-- RLS is enabled with zero policies, so even a role that somehow retained a
-- table-level grant is denied every row by default. Only service_role
-- (which bypasses RLS and is only ever used by server-side worker code, see
-- src/integrations/supabase/client.server.ts) can read or write it, and even
-- service_role goes through the SECURITY DEFINER upsert function below for
-- writes rather than a raw INSERT/UPDATE grant.
REVOKE ALL ON public.deepfake_high_risk_domains FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deepfake_high_risk_domains TO service_role;
ALTER TABLE public.deepfake_high_risk_domains ENABLE ROW LEVEL SECURITY;
-- Intentionally no CREATE POLICY here: with RLS enabled and no policy for a
-- given role, that role reads zero rows. service_role is exempt from RLS
-- entirely, so it does not need (and is not given) a policy.

-- Atomic upsert used by recordQualifiedDomainFinding()/persistQualifiedDomainFinding():
-- increments the count on conflict instead of a plain overwrite, so
-- concurrent scans across different targets/workers never lose a prior
-- finding count. Takes only a hostname and a generic provider label — no
-- target-identifying text is ever accepted or stored by this function.
CREATE OR REPLACE FUNCTION public.upsert_deepfake_high_risk_domain(
  _hostname text,
  _provider text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.deepfake_high_risk_domains (hostname, discovery_provider)
  VALUES (lower(trim(_hostname)), COALESCE(_provider, 'firecrawl'))
  ON CONFLICT (hostname) DO UPDATE
    SET qualified_finding_count = public.deepfake_high_risk_domains.qualified_finding_count + 1,
        last_seen_at = now(),
        discovery_provider = COALESCE(_provider, public.deepfake_high_risk_domains.discovery_provider);
$$;

REVOKE ALL ON FUNCTION public.upsert_deepfake_high_risk_domain(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_deepfake_high_risk_domain(text, text) TO service_role;
