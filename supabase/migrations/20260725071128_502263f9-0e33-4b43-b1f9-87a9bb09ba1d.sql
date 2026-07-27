
CREATE TABLE public.deepfake_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  handles TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  total_queries INT NOT NULL DEFAULT 0,
  total_results INT NOT NULL DEFAULT 0,
  critical_count INT NOT NULL DEFAULT 0,
  high_count INT NOT NULL DEFAULT 0,
  medium_count INT NOT NULL DEFAULT 0,
  low_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_scans TO authenticated;
GRANT ALL ON public.deepfake_scans TO service_role;
ALTER TABLE public.deepfake_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scans" ON public.deepfake_scans FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX deepfake_scans_user_idx ON public.deepfake_scans(user_id, created_at DESC);

CREATE TABLE public.deepfake_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID NOT NULL REFERENCES public.deepfake_scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  source_host TEXT,
  page_title TEXT,
  snippet TEXT,
  query TEXT,
  risk_level TEXT NOT NULL DEFAULT 'LOW',
  content_category TEXT,
  confidence INT NOT NULL DEFAULT 0,
  is_synthetic BOOLEAN NOT NULL DEFAULT false,
  face_referenced BOOLEAN NOT NULL DEFAULT false,
  takedown_recommended BOOLEAN NOT NULL DEFAULT false,
  ai_reasoning TEXT,
  review_status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deepfake_findings TO authenticated;
GRANT ALL ON public.deepfake_findings TO service_role;
ALTER TABLE public.deepfake_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own findings" ON public.deepfake_findings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX deepfake_findings_scan_idx ON public.deepfake_findings(scan_id, risk_level);
CREATE UNIQUE INDEX deepfake_findings_unique_url ON public.deepfake_findings(scan_id, url);
