ALTER VIEW public.public_verifications SET (security_invoker = true);
-- Allow anon to read the underlying certificate/authorization/profile columns via a narrow policy
CREATE POLICY "public verify cert" ON public.verification_certificates FOR SELECT TO anon USING (true);
CREATE POLICY "public verify auth" ON public.client_authorizations FOR SELECT TO anon USING (true);
CREATE POLICY "public verify profile" ON public.client_profiles FOR SELECT TO anon USING (true);
