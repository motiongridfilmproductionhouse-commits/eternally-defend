ALTER TABLE public.celebrity_campaigns
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_accounts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS approved_media_urls text[] NOT NULL DEFAULT '{}';

CREATE TABLE public.celebrity_finding_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.celebrity_campaigns(id) ON DELETE SET NULL,
  finding_kind text NOT NULL CHECK (finding_kind IN ('reputation','face_match','deepfake','impersonation','copyright')),
  finding_id text NOT NULL,
  association text NOT NULL DEFAULT 'REVIEW' CHECK (association IN ('AUTHORIZED','REVIEW','POSSIBLE_UNAUTHORIZED_AD','MISUSE')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, finding_kind, finding_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.celebrity_finding_links TO authenticated;
GRANT ALL ON public.celebrity_finding_links TO service_role;

ALTER TABLE public.celebrity_finding_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their finding links"
  ON public.celebrity_finding_links FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_celebrity_finding_links_user ON public.celebrity_finding_links (user_id, finding_kind);

CREATE TRIGGER trg_celebrity_finding_links_updated
  BEFORE UPDATE ON public.celebrity_finding_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();