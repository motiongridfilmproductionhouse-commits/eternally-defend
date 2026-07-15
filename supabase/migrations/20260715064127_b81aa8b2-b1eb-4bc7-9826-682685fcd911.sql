
-- 1. rekognition_collections: one per client
CREATE TABLE public.rekognition_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  collection_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  face_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rekognition_collections TO authenticated;
GRANT ALL ON public.rekognition_collections TO service_role;
ALTER TABLE public.rekognition_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own collection" ON public.rekognition_collections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. protected_faces: indexed reference faces (one row per Rekognition Face)
CREATE TABLE public.protected_faces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL,
  discovered_account_id UUID REFERENCES public.discovered_accounts(id) ON DELETE SET NULL,
  platform TEXT,
  label TEXT,
  source_url TEXT,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  face_id TEXT NOT NULL,
  image_id TEXT,
  external_image_id TEXT,
  confidence NUMERIC,
  bounding_box JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX protected_faces_user_idx ON public.protected_faces(user_id);
CREATE INDEX protected_faces_face_idx ON public.protected_faces(face_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protected_faces TO authenticated;
GRANT ALL ON public.protected_faces TO service_role;
ALTER TABLE public.protected_faces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own faces" ON public.protected_faces FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. face_match_events: Rekognition SearchFacesByImage results + review workflow
CREATE TABLE public.face_match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  matched_face_id TEXT,
  matched_protected_face_id UUID REFERENCES public.protected_faces(id) ON DELETE SET NULL,
  matched_asset_id UUID REFERENCES public.protected_assets(id) ON DELETE SET NULL,
  similarity NUMERIC,
  face_confidence NUMERIC,
  source_url TEXT,
  source_type TEXT,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  image_s3_bucket TEXT,
  image_s3_key TEXT,
  bounding_box JSONB,
  review_status TEXT NOT NULL DEFAULT 'pending',
  threat_category TEXT,
  context_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX face_match_events_user_status_idx ON public.face_match_events(user_id, review_status, created_at DESC);
CREATE INDEX face_match_events_category_idx ON public.face_match_events(user_id, threat_category, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.face_match_events TO authenticated;
GRANT ALL ON public.face_match_events TO service_role;
ALTER TABLE public.face_match_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own matches" ON public.face_match_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. evidence_vault_items: S3 evidence archive
CREATE TABLE public.evidence_vault_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  enforcement_request_id UUID REFERENCES public.enforcement_requests(id) ON DELETE SET NULL,
  scan_hit_id UUID REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  face_match_event_id UUID REFERENCES public.face_match_events(id) ON DELETE SET NULL,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  sha256 TEXT,
  bytes BIGINT,
  content_type TEXT,
  label TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_vault_user_idx ON public.evidence_vault_items(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_vault_items TO authenticated;
GRANT ALL ON public.evidence_vault_items TO service_role;
ALTER TABLE public.evidence_vault_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own evidence" ON public.evidence_vault_items FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at triggers
CREATE TRIGGER trg_rekcol_updated BEFORE UPDATE ON public.rekognition_collections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_fme_updated BEFORE UPDATE ON public.face_match_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
