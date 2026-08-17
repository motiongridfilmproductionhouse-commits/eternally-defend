ALTER TABLE public.protected_assets DROP CONSTRAINT protected_assets_kind_check;
ALTER TABLE public.protected_assets ADD CONSTRAINT protected_assets_kind_check
  CHECK (kind = ANY (ARRAY['logo','photo','video','audio','product','artwork','watermark','frame','other']::text[]));