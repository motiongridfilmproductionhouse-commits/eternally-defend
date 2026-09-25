REVOKE EXECUTE ON FUNCTION public.eip_enabled(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eip_enabled(uuid) TO authenticated, service_role;