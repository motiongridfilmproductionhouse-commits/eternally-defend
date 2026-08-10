CREATE TABLE IF NOT EXISTS public.youtube_search_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_query TEXT NOT NULL,
  page_number INTEGER NOT NULL DEFAULT 1,
  order_mode TEXT NOT NULL DEFAULT 'relevance',
  region_code TEXT,
  video_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '6 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS youtube_search_cache_key_idx
  ON public.youtube_search_cache (normalized_query, page_number, order_mode, coalesce(region_code, ''));

CREATE INDEX IF NOT EXISTS youtube_search_cache_expires_idx
  ON public.youtube_search_cache (expires_at);

GRANT ALL ON public.youtube_search_cache TO service_role;

ALTER TABLE public.youtube_search_cache ENABLE ROW LEVEL SECURITY;