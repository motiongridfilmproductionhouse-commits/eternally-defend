CREATE TABLE public.celebrity_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  campaign_type text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'ACTIVE',
  notes text,
  hashtags text[] NOT NULL DEFAULT '{}',
  official_urls text[] NOT NULL DEFAULT '{}',
  monitoring_started_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.celebrity_campaigns TO authenticated;
GRANT ALL ON public.celebrity_campaigns TO service_role;
ALTER TABLE public.celebrity_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own campaigns" ON public.celebrity_campaigns FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER celebrity_campaigns_updated_at BEFORE UPDATE ON public.celebrity_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX celebrity_campaigns_user_idx ON public.celebrity_campaigns(user_id, status);

CREATE TABLE public.celebrity_campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.celebrity_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  asset_kind text NOT NULL DEFAULT 'image',
  title text,
  source_url text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.celebrity_campaign_assets TO authenticated;
GRANT ALL ON public.celebrity_campaign_assets TO service_role;
ALTER TABLE public.celebrity_campaign_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own campaign assets" ON public.celebrity_campaign_assets FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX celebrity_campaign_assets_campaign_idx ON public.celebrity_campaign_assets(campaign_id);