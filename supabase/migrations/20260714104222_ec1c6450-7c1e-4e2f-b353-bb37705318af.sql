
CREATE POLICY "Users read own media" ON storage.objects FOR SELECT
  USING (bucket_id = 'multimedia-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own media" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'multimedia-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own media" ON storage.objects FOR UPDATE
  USING (bucket_id = 'multimedia-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own media" ON storage.objects FOR DELETE
  USING (bucket_id = 'multimedia-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
