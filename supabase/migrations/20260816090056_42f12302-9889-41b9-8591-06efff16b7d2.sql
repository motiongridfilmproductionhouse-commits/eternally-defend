DROP POLICY IF EXISTS "authenticated read routes" ON public.domain_enforcement_routes;

CREATE POLICY "operators read routes"
ON public.domain_enforcement_routes
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

REVOKE ALL ON public.domain_enforcement_routes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_enforcement_routes TO authenticated;
GRANT ALL ON public.domain_enforcement_routes TO service_role;

ALTER TABLE public.enforcement_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enforcement_provider_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.enforcement_provider_events FROM authenticated;
GRANT SELECT ON public.enforcement_provider_events TO authenticated;
GRANT ALL ON public.enforcement_provider_events TO service_role;
COMMENT ON TABLE public.enforcement_provider_events IS 'Append-only provider webhook event ledger. Inserted exclusively by service_role via server webhook handlers; clients have read-only access scoped by RLS (own rows, admins all). No client INSERT/UPDATE/DELETE policy or grant exists by design.';

REVOKE ALL ON public.evidence_chain_of_custody FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.evidence_chain_of_custody FROM authenticated;
GRANT SELECT, INSERT ON public.evidence_chain_of_custody TO authenticated;
GRANT ALL ON public.evidence_chain_of_custody TO service_role;
COMMENT ON TABLE public.evidence_chain_of_custody IS 'Immutable chain-of-custody ledger: owners may INSERT and SELECT their own rows only. UPDATE/DELETE intentionally denied (no policy, no grant) so the trail is tamper-evident; corrections are recorded as new rows.';
COMMENT ON TABLE public.evidence_objects IS 'Owner-scoped preserved evidence objects, restricted to auth.uid() = user_id via RLS; service_role handles server-side preservation writes.';