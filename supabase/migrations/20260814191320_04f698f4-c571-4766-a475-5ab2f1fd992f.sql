CREATE TABLE IF NOT EXISTS public.deepfake_manual_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.deepfake_scans(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.deepfake_target_profiles(id) ON DELETE SET NULL,
  target_name text NOT NULL,
  submitted_url text NOT NULL,
  submitted_url_kind text NOT NULL DEFAULT 'source_page',
  selected_result_fragment text,
  source_page_url text,
  original_image_url text,
  source_domain text,
  page_title text,
  surrounding_text text,
  related_links text[] NOT NULL DEFAULT '{}',
  extracted_images text[] NOT NULL DEFAULT '{}',
  google_result_screenshot_path text,
  source_page_screenshot_path text,
  capture_timestamp timestamptz,
  media_sha256 text,
  perceptual_hash text,
  face_similarity_score numeric,
  identity_confidence_score numeric,
  discovery_path text[] NOT NULL DEFAULT '{}',
  processing_status text NOT NULL DEFAULT 'submitted',
  error_reason text,
  classification text,
  duplicate_of_lead_id uuid REFERENCES public.deepfake_manual_leads(id) ON DELETE SET NULL,
  reviewer_source_page_url text,
  reviewer_image_url text,
  reviewer_notes text,
  resolved_dedupe_key text,
  initial_dedupe_key text,
  source_type text,
  state text,
  verification_status text,
  requires_human_review boolean NOT NULL DEFAULT true,
  client_visible boolean NOT NULL DEFAULT true,
  submitted_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deepfake_manual_leads_profile_url_key UNIQUE (profile_id, submitted_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_manual_leads TO authenticated;
GRANT ALL ON public.deepfake_manual_leads TO service_role;

ALTER TABLE public.deepfake_manual_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own manual leads"
  ON public.deepfake_manual_leads FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS deepfake_manual_leads_user_created_idx
  ON public.deepfake_manual_leads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deepfake_manual_leads_scan_idx
  ON public.deepfake_manual_leads (scan_id);
CREATE INDEX IF NOT EXISTS deepfake_manual_leads_resolved_key_idx
  ON public.deepfake_manual_leads (user_id, target_name, resolved_dedupe_key);

CREATE TRIGGER update_deepfake_manual_leads_updated_at
  BEFORE UPDATE ON public.deepfake_manual_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS deepfake_findings_scan_url_key
  ON public.deepfake_findings (scan_id, url);