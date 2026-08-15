-- 1. Enforcement route table: writes are admin-only shared infrastructure.
DROP POLICY IF EXISTS "discovery inserts unverified routes" ON public.domain_enforcement_routes;

CREATE POLICY "admins insert routes"
ON public.domain_enforcement_routes
FOR INSERT
TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  AND verification_status <> 'VERIFIED'
);

-- 2. AI analysis cache: server-only, no cross-tenant client reads.
DROP POLICY IF EXISTS "Authenticated can read AI analysis cache" ON public.scan_ai_analysis_cache;
REVOKE ALL ON public.scan_ai_analysis_cache FROM anon, authenticated;
GRANT ALL ON public.scan_ai_analysis_cache TO service_role;

-- 3. SECURITY DEFINER functions: no anon execution at all.
REVOKE EXECUTE ON FUNCTION public.get_public_verification(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_public_verification(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_enforcement_job(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_partner_commission() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_route_outcome(text, text) FROM anon, authenticated;

-- 4. Worker-only continuation lease: service role only.
REVOKE EXECUTE ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) FROM authenticated;