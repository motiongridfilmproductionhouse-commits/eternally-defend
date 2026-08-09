-- Create youtube_search_cache table for persistent L2 YouTube Data API search result caching
CREATE TABLE IF NOT EXISTS public.youtube_search_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_query TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  order_mode TEXT NOT NULL DEFAULT 'relevance',
  region_code TEXT DEFAULT NULL,
  video_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index for query, page, order, and region code lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_search_cache_lookup
ON public.youtube_search_cache (
  normalized_query,
  page_number,
  order_mode,
  coalesce(region_code, '')
);

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_youtube_search_cache_expires
ON public.youtube_search_cache (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_search_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_search_cache TO anon;
GRANT ALL ON public.youtube_search_cache TO service_role;

ALTER TABLE public.youtube_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read of youtube_search_cache"
  ON public.youtube_search_cache FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public write of youtube_search_cache"
  ON public.youtube_search_cache FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update of youtube_search_cache"
  ON public.youtube_search_cache FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);
