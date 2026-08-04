-- Deepfake Intelligence: durable manual evidence leads.
-- Exact submitted URLs are persisted immediately. Google Images #sv fragments
-- remain part of initial dedupe; resolved-source/image/hash dedupe is recorded
-- later in resolved_dedupe_key so selected-image variants are not collapsed.

CREATE TABLE IF NOT EXISTS public.deepfake_manual_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES public.deepfake_scans(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES public.deepfake_target_profiles(id) ON DELETE SET NULL,
  target_name TEXT NOT NULL,

  submitted_url TEXT NOT NULL,
  submitted_url_kind TEXT NOT NULL DEFAULT 'source_page',
  selected_result_fragment TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual_submission',
  state TEXT NOT NULL DEFAULT 'submitted',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  requires_human_review BOOLEAN NOT NULL DEFAULT true,
  client_visible BOOLEAN NOT NULL DEFAULT true,
  submitted_by TEXT NOT NULL DEFAULT 'user_submission',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  source_page_url TEXT,
  original_image_url TEXT,
  source_domain TEXT,
  page_title TEXT,
  surrounding_text TEXT,
  related_links TEXT[] NOT NULL DEFAULT '{}',
  extracted_images TEXT[] NOT NULL DEFAULT '{}',

  google_result_screenshot_path TEXT,
  source_page_screenshot_path TEXT,
  capture_timestamp TIMESTAMPTZ,
  media_sha256 TEXT,
  perceptual_hash TEXT,
  face_similarity_score NUMERIC,
  identity_confidence_score NUMERIC,
  discovery_path TEXT[] NOT NULL DEFAULT '{}',

  processing_status TEXT NOT NULL DEFAULT 'submitted',
  error_reason TEXT,
  classification TEXT NOT NULL DEFAULT 'manual lead',

  resolved_dedupe_key TEXT,
  duplicate_of_lead_id UUID REFERENCES public.deepfake_manual_leads(id) ON DELETE SET NULL,

  reviewer_source_page_url TEXT,
  reviewer_image_url TEXT,
  reviewer_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT deepfake_manual_leads_status_check CHECK (
    processing_status IN (
      'submitted',
      'parsing',
      'source_resolved',
      'crawl_pending',
      'crawled',
      'identity_check_pending',
      'review_required',
      'evidence_ready',
      'rejected',
      'failed'
    )
  ),
  CONSTRAINT deepfake_manual_leads_kind_check CHECK (
    submitted_url_kind IN (
      'google_images_search',
      'google_images_viewer',
      'source_page',
      'direct_image'
    )
  ),
  CONSTRAINT deepfake_manual_leads_classification_check CHECK (
    classification IN (
      'manual lead',
      'potential_identity_related_content',
      'identity match confirmed',
      'identity match rejected',
      'manipulation suspected',
      'probable deepfake',
      'verified deepfake only after review',
      'unrelated result',
      'requires human review'
    )
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_manual_leads TO authenticated;
GRANT ALL ON public.deepfake_manual_leads TO service_role;
ALTER TABLE public.deepfake_manual_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own manual leads"
ON public.deepfake_manual_leads FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS deepfake_manual_leads_submitted_unique
  ON public.deepfake_manual_leads (user_id, target_name, submitted_url);

-- Preloaded leads are keyed by the owning identity and the exact URL. The
-- fragment is intentionally part of submitted_url so Google #sv selections
-- remain distinct until resolution.
CREATE UNIQUE INDEX IF NOT EXISTS deepfake_manual_leads_identity_url_unique
  ON public.deepfake_manual_leads (profile_id, submitted_url)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deepfake_manual_leads_scan_idx
  ON public.deepfake_manual_leads (scan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deepfake_manual_leads_profile_idx
  ON public.deepfake_manual_leads (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deepfake_manual_leads_status_idx
  ON public.deepfake_manual_leads (user_id, processing_status, created_at DESC);

CREATE INDEX IF NOT EXISTS deepfake_manual_leads_resolved_dedupe_idx
  ON public.deepfake_manual_leads (user_id, target_name, resolved_dedupe_key)
  WHERE resolved_dedupe_key IS NOT NULL;

CREATE TRIGGER trg_deepfake_manual_leads_updated
BEFORE UPDATE ON public.deepfake_manual_leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_deepfake_manual_lead_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.state := NEW.processing_status;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deepfake_manual_leads_state
BEFORE INSERT OR UPDATE OF processing_status ON public.deepfake_manual_leads
FOR EACH ROW EXECUTE FUNCTION public.sync_deepfake_manual_lead_state();
