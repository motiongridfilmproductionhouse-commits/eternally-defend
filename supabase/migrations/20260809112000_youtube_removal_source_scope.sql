-- Add source_scope column to youtube_removal_scans table
ALTER TABLE public.youtube_removal_scans
ADD COLUMN IF NOT EXISTS source_scope TEXT NOT NULL DEFAULT 'NON_OFFICIAL_ONLY'
CHECK (source_scope IN ('NON_OFFICIAL_ONLY', 'NEWS_ALLEGATIONS', 'ALL_SOURCES'));

-- Add source attribution & news allegation intelligence columns to youtube_removal_findings table
ALTER TABLE public.youtube_removal_findings
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'INDEPENDENT_CREATOR',
ADD COLUMN IF NOT EXISTS is_official_news BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_official_news_allegation BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS allegation_matched BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS allegation_signals TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS news_topic_tags TEXT[] DEFAULT '{}';
