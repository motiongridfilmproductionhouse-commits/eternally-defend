CREATE POLICY "campaign assets read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'campaign-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "campaign assets insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "campaign assets delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campaign-assets' AND (storage.foldername(name))[1] = auth.uid()::text);