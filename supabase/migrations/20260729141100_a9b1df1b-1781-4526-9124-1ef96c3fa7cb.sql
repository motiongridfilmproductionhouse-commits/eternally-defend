CREATE TABLE public.copyright_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  reference_kind TEXT NOT NULL DEFAULT 'image',
  storage_path TEXT,
  frame_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.copyright_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.copyright_scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  platform TEXT,
  page_title TEXT,
  thumbnail_url TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  confidence_band TEXT NOT NULL DEFAULT 'review',
  detection_type TEXT NOT NULL DEFAULT 'reuploaded_artwork',
  transformations JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ocr_text TEXT,
  reason TEXT,
  contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scan_id, source_url)
);

CREATE INDEX idx_copyright_scans_user ON public.copyright_scans(user_id, created_at DESC);
CREATE INDEX idx_copyright_matches_scan ON public.copyright_matches(scan_id, confidence DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_scans TO authenticated;
GRANT ALL ON public.copyright_scans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.copyright_matches TO authenticated;
GRANT ALL ON public.copyright_matches TO service_role;

ALTER TABLE public.copyright_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copyright_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own copyright scans" ON public.copyright_scans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own copyright matches" ON public.copyright_matches FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_copyright_scans_updated_at BEFORE UPDATE ON public.copyright_scans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();