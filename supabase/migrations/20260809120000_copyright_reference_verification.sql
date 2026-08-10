-- Migration for Reference-Verified Copyright Movie Detection & Visual Fingerprinting
CREATE TABLE IF NOT EXISTS public.copyright_reference_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL,
  reference_type TEXT NOT NULL DEFAULT 'poster', -- 'poster', 'still', 'actor', 'character', 'trailer_frame'
  image_url TEXT NOT NULL,
  perceptual_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.copyright_identity_verifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  candidate_url TEXT NOT NULL,
  title_similarity NUMERIC NOT NULL DEFAULT 0,
  poster_similarity NUMERIC NOT NULL DEFAULT 0,
  frame_similarity NUMERIC NOT NULL DEFAULT 0,
  face_similarity NUMERIC NOT NULL DEFAULT 0,
  target_identity_score NUMERIC NOT NULL DEFAULT 0,
  piracy_risk_score NUMERIC NOT NULL DEFAULT 0,
  target_status TEXT NOT NULL DEFAULT 'NOT_SUBJECT', -- 'VERIFIED_TARGET', 'PROBABLE_TARGET', 'REVIEW_REQUIRED', 'NOT_SUBJECT'
  matched_signals TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copyright_ref_asset ON public.copyright_reference_images(asset_id);
CREATE INDEX IF NOT EXISTS idx_copyright_verif_scan ON public.copyright_identity_verifications(scan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_reference_images TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_identity_verifications TO authenticated, anon;
GRANT ALL ON public.copyright_reference_images TO service_role;
GRANT ALL ON public.copyright_identity_verifications TO service_role;

ALTER TABLE public.copyright_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copyright_identity_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read of copyright_reference_images" ON public.copyright_reference_images FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert of copyright_reference_images" ON public.copyright_reference_images FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow public read of copyright_identity_verifications" ON public.copyright_identity_verifications FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public insert of copyright_identity_verifications" ON public.copyright_identity_verifications FOR INSERT TO anon, authenticated WITH CHECK (true);
