DROP POLICY IF EXISTS "public verify cert" ON public.verification_certificates;
DROP POLICY IF EXISTS "public verify auth" ON public.client_authorizations;
DROP POLICY IF EXISTS "public verify profile" ON public.client_profiles;
DROP VIEW IF EXISTS public.public_verifications;

CREATE OR REPLACE FUNCTION public.get_public_verification(_slug TEXT)
RETURNS TABLE (
  public_slug TEXT,
  certificate_number TEXT,
  status TEXT,
  score INT,
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  auth_number TEXT,
  authorization_status public.authorization_status,
  enforcement_enabled BOOLEAN,
  display_name TEXT,
  company_name TEXT,
  client_id TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vc.public_slug,
    vc.certificate_number,
    vc.status,
    vc.score,
    vc.issued_at,
    vc.expires_at,
    ca.auth_number,
    ca.status,
    ca.enforcement_enabled,
    cp.display_name,
    cp.company_name,
    cp.client_id
  FROM public.verification_certificates vc
  JOIN public.client_authorizations ca ON ca.id = vc.authorization_id
  LEFT JOIN public.client_profiles cp ON cp.user_id = vc.user_id
  WHERE vc.public_slug = _slug
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_verification(TEXT) TO anon, authenticated;
