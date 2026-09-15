ALTER TABLE public.agent_assessments
  ADD COLUMN IF NOT EXISTS image_url text
  CHECK (image_url IS NULL OR (image_url ~ '^https://' AND length(image_url) <= 1024));