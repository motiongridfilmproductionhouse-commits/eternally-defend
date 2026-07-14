
-- ============================================================
-- SCANS
-- ============================================================
CREATE TABLE public.scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID,
  protection_profile_id UUID,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  query TEXT,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  period TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  total_hits INT NOT NULL DEFAULT 0,
  unique_hits INT NOT NULL DEFAULT 0,
  new_hits INT NOT NULL DEFAULT 0,
  updated_hits INT NOT NULL DEFAULT 0,
  duplicate_hits_removed INT NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scans_status_check CHECK (status IN ('queued','running','completed','failed','cancelled'))
);

CREATE INDEX idx_scans_user ON public.scans(user_id, created_at DESC);
CREATE INDEX idx_scans_org ON public.scans(organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX idx_scans_profile ON public.scans(protection_profile_id) WHERE protection_profile_id IS NOT NULL;
CREATE INDEX idx_scans_status ON public.scans(status);
CREATE INDEX idx_scans_query ON public.scans(query);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scans TO authenticated;
GRANT ALL ON public.scans TO service_role;

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scans" ON public.scans
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_scans_updated_at
  BEFORE UPDATE ON public.scans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- SCAN_HITS
-- One row per unique discovered result (dedup by source + external_id, fallback canonical_url).
-- Small metadata only; no binaries.
-- ============================================================
CREATE TABLE public.scan_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id UUID,
  protection_profile_id UUID,

  -- Source identification
  source TEXT NOT NULL,                       -- e.g. 'youtube','news','instagram','tiktok'
  source_type TEXT,                           -- specific type e.g. 'youtube_video','news_article'
  external_id TEXT,                           -- provider ID (video id, post id...)
  canonical_url TEXT,                         -- normalised URL used as dedup fallback
  permalink TEXT,                             -- shareable URL

  -- Content metadata (small text only, no binaries)
  title TEXT,
  description TEXT,
  author TEXT,
  author_handle TEXT,
  thumbnail_url TEXT,                         -- reference URL, not the image bytes
  language TEXT,
  country TEXT,

  -- Timing
  published_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Scoring / metrics
  reach BIGINT,
  engagement BIGINT,
  velocity TEXT,
  risk_score NUMERIC(6,3),
  threat_score NUMERIC(6,3),
  severity TEXT,
  growth_pct NUMERIC(8,3),

  -- Classification
  narrative_claim TEXT,
  risk_type TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Extensible bags (small JSON only)
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb, -- references to storage paths / evidence ids

  -- Cross-scan tracking
  previous_scan_id UUID,
  previous_scan_seen BOOLEAN NOT NULL DEFAULT FALSE,
  is_new_since_last_scan BOOLEAN NOT NULL DEFAULT TRUE,
  times_detected INT NOT NULL DEFAULT 1,

  -- Retention
  retention_class TEXT NOT NULL DEFAULT 'unique', -- 'unique' kept indefinitely; 'duplicate_raw' purgeable
  purge_after TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: unique per (user, source, external_id) and per (user, source, canonical_url) fallback
CREATE UNIQUE INDEX uq_scan_hits_source_extid
  ON public.scan_hits(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX uq_scan_hits_source_canonical
  ON public.scan_hits(user_id, source, canonical_url)
  WHERE external_id IS NULL AND canonical_url IS NOT NULL;

-- Required indexes
CREATE INDEX idx_scan_hits_user ON public.scan_hits(user_id);
CREATE INDEX idx_scan_hits_org ON public.scan_hits(organisation_id) WHERE organisation_id IS NOT NULL;
CREATE INDEX idx_scan_hits_profile ON public.scan_hits(protection_profile_id) WHERE protection_profile_id IS NOT NULL;
CREATE INDEX idx_scan_hits_scan ON public.scan_hits(scan_id);
CREATE INDEX idx_scan_hits_source ON public.scan_hits(source);
CREATE INDEX idx_scan_hits_external ON public.scan_hits(external_id);
CREATE INDEX idx_scan_hits_canonical ON public.scan_hits(canonical_url);
CREATE INDEX idx_scan_hits_published ON public.scan_hits(published_at DESC NULLS LAST);
CREATE INDEX idx_scan_hits_detected ON public.scan_hits(detected_at DESC);
CREATE INDEX idx_scan_hits_risk ON public.scan_hits(risk_score DESC NULLS LAST);

-- Composite for the default sort: newest published, tiebreak by threat score, scoped to user
CREATE INDEX idx_scan_hits_user_sort
  ON public.scan_hits(user_id, published_at DESC NULLS LAST, threat_score DESC NULLS LAST);

-- Query text search on stored scan query lives on scans table; hits use tags/title search via btree indexes above

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_hits TO authenticated;
GRANT ALL ON public.scan_hits TO service_role;

ALTER TABLE public.scan_hits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scan_hits" ON public.scan_hits
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_scan_hits_updated_at
  BEFORE UPDATE ON public.scan_hits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
