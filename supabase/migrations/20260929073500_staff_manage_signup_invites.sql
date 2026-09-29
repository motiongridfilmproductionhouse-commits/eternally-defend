-- Staff may issue and manage account invitation codes.
DROP POLICY IF EXISTS "Admins manage signup invites" ON public.signup_invites;
CREATE POLICY "Admins and staff manage signup invites"
  ON public.signup_invites FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'staff')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'staff')
  );
