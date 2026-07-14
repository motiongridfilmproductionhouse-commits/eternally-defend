
-- Enforcement package artifacts
ALTER TABLE public.enforcement_requests
  ADD COLUMN IF NOT EXISTS evidence_pdf_path text,
  ADD COLUMN IF NOT EXISTS authorization_pdf_path text,
  ADD COLUMN IF NOT EXISTS platform_complaint_pdf_path text,
  ADD COLUMN IF NOT EXISTS platform_complaint_json jsonb,
  ADD COLUMN IF NOT EXISTS package_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS package_hash text;

CREATE TABLE IF NOT EXISTS public.enforcement_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  enforcement_request_id uuid NOT NULL REFERENCES public.enforcement_requests(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('evidence','authorization','platform_complaint','platform_complaint_json')),
  storage_bucket text NOT NULL DEFAULT 'enforcement-packages',
  storage_path text NOT NULL,
  sha256 text,
  bytes integer,
  generated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_package_items TO authenticated;
GRANT ALL ON public.enforcement_package_items TO service_role;

ALTER TABLE public.enforcement_package_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own enforcement package items"
  ON public.enforcement_package_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Storage policies for enforcement-packages bucket (per-user folder)
CREATE POLICY "Users read own enforcement packages"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'enforcement-packages' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users write own enforcement packages"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'enforcement-packages' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own enforcement packages"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'enforcement-packages' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own enforcement packages"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'enforcement-packages' AND auth.uid()::text = (storage.foldername(name))[1]);
