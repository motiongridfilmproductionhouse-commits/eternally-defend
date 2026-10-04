UPDATE public.enforcement_requests
SET metadata = metadata || jsonb_build_object(
  'thumbnail_bucket', 'enforcement-screenshots',
  'thumbnail_path', 'db99c83e-4f35-4872-9d0e-a3a8a3bcf4f7/14889756-e4a3-4309-b132-4a9724f78a54/reel-thumbnail.jpeg',
  'thumbnail_content_type', 'image/jpeg',
  'thumbnail_source', 'owner_supplied_reel_screenshot'
), updated_at = now()
WHERE id = '14889756-e4a3-4309-b132-4a9724f78a54'::uuid
  AND user_id = 'db99c83e-4f35-4872-9d0e-a3a8a3bcf4f7'::uuid
  AND target_url = 'https://www.facebook.com/share/v/1HrrxMRZvs/?mibextid=wwXIfr';