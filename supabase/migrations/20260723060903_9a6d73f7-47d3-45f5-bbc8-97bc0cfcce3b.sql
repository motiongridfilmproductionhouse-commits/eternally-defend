
CREATE POLICY "Partner reads own docs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'partner-documents' AND (
    (storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')
  ));
CREATE POLICY "Partner writes own docs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'partner-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Partner updates own docs" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'partner-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Partner deletes own docs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'partner-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
