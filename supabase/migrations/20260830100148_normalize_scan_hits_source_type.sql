-- Normalize scan_hits.source_type to the canonical, singular, lowercase
-- taxonomy used by the /scan results source filter (see
-- src/lib/scan/source-type.ts): youtube, news, reddit, x, instagram,
-- tiktok, facebook, blog, forum, review, archive, linkedin, podcast,
-- complaint, web.
--
-- Historical rows were written with ad-hoc values derived client-side
-- ('youtube_video' for YouTube, plain lowercased plurals like 'blogs',
-- 'reviews', 'complaints' for everything else), which don't match the
-- canonical set. Filtering scan_hits by source_type therefore silently
-- returned zero rows for several categories even though matching rows
-- existed under `source`. Backfill source_type from the always-reliable
-- display label in `source` so every historical row becomes filterable.
UPDATE public.scan_hits
SET source_type = CASE lower(source)
  WHEN 'youtube' THEN 'youtube'
  WHEN 'news' THEN 'news'
  WHEN 'reddit' THEN 'reddit'
  WHEN 'x' THEN 'x'
  WHEN 'instagram' THEN 'instagram'
  WHEN 'tiktok' THEN 'tiktok'
  WHEN 'facebook' THEN 'facebook'
  WHEN 'blogs' THEN 'blog'
  WHEN 'blog' THEN 'blog'
  WHEN 'forums' THEN 'forum'
  WHEN 'forum' THEN 'forum'
  WHEN 'reviews' THEN 'review'
  WHEN 'review' THEN 'review'
  WHEN 'archive' THEN 'archive'
  WHEN 'linkedin' THEN 'linkedin'
  WHEN 'podcasts' THEN 'podcast'
  WHEN 'podcast' THEN 'podcast'
  WHEN 'complaints' THEN 'complaint'
  WHEN 'complaint' THEN 'complaint'
  WHEN 'web' THEN 'web'
  ELSE 'web'
END;

CREATE INDEX IF NOT EXISTS idx_scan_hits_source_type ON public.scan_hits(source_type);
