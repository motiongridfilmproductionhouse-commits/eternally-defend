-- 1. RLS on deepfake biometric tables
ALTER TABLE public.deepfake_target_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deepfake_reference_faces ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_target_profiles TO authenticated;
GRANT ALL ON public.deepfake_target_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_reference_faces TO authenticated;
GRANT ALL ON public.deepfake_reference_faces TO service_role;
REVOKE ALL ON public.deepfake_target_profiles FROM anon;
REVOKE ALL ON public.deepfake_reference_faces FROM anon;

DROP POLICY IF EXISTS "Users manage own deepfake target profiles" ON public.deepfake_target_profiles;
CREATE POLICY "Users manage own deepfake target profiles"
  ON public.deepfake_target_profiles FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own deepfake reference faces" ON public.deepfake_reference_faces;
CREATE POLICY "Users manage own deepfake reference faces"
  ON public.deepfake_reference_faces FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.deepfake_target_profiles p
    WHERE p.id = deepfake_reference_faces.profile_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.deepfake_target_profiles p
    WHERE p.id = deepfake_reference_faces.profile_id AND p.user_id = auth.uid()
  ));

-- 2. Pin search_path on remaining trigger functions
ALTER FUNCTION public.deepfake_scans_protect_runtime_fields() SET search_path = public;
ALTER FUNCTION public.deepfake_scans_prevent_terminal_revive() SET search_path = public;

-- 3. Restrict EXECUTE on SECURITY DEFINER / internal functions
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.issue_partner_commission() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.issue_partner_commission() TO service_role;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

REVOKE ALL ON FUNCTION public.deepfake_scans_protect_runtime_fields() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.deepfake_scans_protect_runtime_fields() TO service_role;
REVOKE ALL ON FUNCTION public.deepfake_scans_prevent_terminal_revive() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.deepfake_scans_prevent_terminal_revive() TO service_role;

-- get_public_verification stays anon-callable: it powers the public certificate page
REVOKE ALL ON FUNCTION public.get_public_verification(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_verification(text) TO anon, authenticated, service_role;