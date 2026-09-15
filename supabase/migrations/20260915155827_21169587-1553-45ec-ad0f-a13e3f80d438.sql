GRANT SELECT ON public.agent_memberships TO authenticated;
CREATE POLICY "Users can read own agent membership" ON public.agent_memberships FOR SELECT TO authenticated USING (user_id = auth.uid());