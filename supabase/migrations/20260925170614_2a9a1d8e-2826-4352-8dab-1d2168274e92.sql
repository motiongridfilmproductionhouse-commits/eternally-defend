CREATE OR REPLACE FUNCTION public.eip_admin_set_access(_user text, _enabled boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Only admins can change EIP access';
  END IF;
  IF _user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO uid FROM auth.users WHERE id = _user::uuid;
  ELSE
    SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_user));
  END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'No account found for %', _user; END IF;
  INSERT INTO public.eip_account_access (user_id, enabled, updated_by, updated_at)
  VALUES (uid, _enabled, auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public.eip_admin_set_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eip_admin_set_access(text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.eip_admin_list_access()
RETURNS TABLE (user_id uuid, email text, enabled boolean, requested_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Only admins can view EIP access';
  END IF;
  RETURN QUERY SELECT a.user_id, u.email::text, a.enabled, a.requested_at, a.updated_at
  FROM public.eip_account_access a LEFT JOIN auth.users u ON u.id = a.user_id
  ORDER BY a.updated_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.eip_admin_list_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eip_admin_list_access() TO authenticated;