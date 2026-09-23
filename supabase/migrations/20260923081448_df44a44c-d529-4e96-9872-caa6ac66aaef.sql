CREATE POLICY "Staff read prospect evidence files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'prospect-evidence' AND public.is_prospect_staff(auth.uid()));

CREATE POLICY "Staff upload prospect evidence files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'prospect-evidence' AND public.is_prospect_staff(auth.uid()));