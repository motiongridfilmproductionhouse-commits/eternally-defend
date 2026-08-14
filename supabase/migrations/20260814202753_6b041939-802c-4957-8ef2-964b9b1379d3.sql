CREATE TABLE public.preserved_evidence_media (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finding_id UUID NULL,
  lead_id UUID NULL,
  scan_id UUID NULL,
  media_kind TEXT NOT NULL DEFAULT 'image',
  source_page_url TEXT NOT NULL,
  source_media_url TEXT NULL,
  platform_domain TEXT NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NULL,
  perceptual_hash TEXT NULL,
  frame_index INTEGER NULL,
  frame_timestamp_seconds NUMERIC NULL,
  capture_timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  face_similarity NUMERIC NULL,
  identity_confidence NUMERIC NULL,
  synthetic_confidence NUMERIC NULL,
  evidence_status TEXT NOT NULL DEFAULT 'captured',
  source_http_status INTEGER NULL,
  source_reachable BOOLEAN NULL,
  dedupe_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX preserved_evidence_media_user_dedupe_idx
  ON public.preserved_evidence_media (user_id, dedupe_key);
CREATE INDEX preserved_evidence_media_finding_idx ON public.preserved_evidence_media (finding_id);
CREATE INDEX preserved_evidence_media_lead_idx ON public.preserved_evidence_media (lead_id);
CREATE INDEX preserved_evidence_media_source_idx ON public.preserved_evidence_media (user_id, source_page_url);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.preserved_evidence_media TO authenticated;
GRANT ALL ON public.preserved_evidence_media TO service_role;

ALTER TABLE public.preserved_evidence_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own preserved evidence"
  ON public.preserved_evidence_media FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_preserved_evidence_media_updated_at
  BEFORE UPDATE ON public.preserved_evidence_media
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();