CREATE TABLE IF NOT EXISTS public.social_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'instagram',
  profile_url TEXT NOT NULL,
  handle TEXT,
  mode TEXT NOT NULL DEFAULT 'PUBLIC_REFERENCE'
    CHECK (mode IN ('PUBLIC_REFERENCE','AUTHORIZED_CONNECTED')),
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_cursor TEXT,
  token_ref TEXT,
  platform_user_id TEXT,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, profile_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own social accounts" ON public.social_accounts;
CREATE POLICY "Users manage their own social accounts"
  ON public.social_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS social_accounts_user_idx ON public.social_accounts (user_id, platform);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_social_accounts_updated_at ON public.social_accounts;
CREATE TRIGGER update_social_accounts_updated_at BEFORE UPDATE ON public.social_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Migrate existing self-declared onboarding links as PUBLIC_REFERENCE only.
INSERT INTO public.social_accounts (user_id, platform, profile_url, handle, mode)
SELECT p.user_id,
       COALESCE(NULLIF(link->>'platform',''), 'other') AS platform,
       link->>'url' AS profile_url,
       NULLIF(regexp_replace(split_part(regexp_replace(link->>'url', '^https?://[^/]+/', ''), '/', 1), '^@', ''), '') AS handle,
       'PUBLIC_REFERENCE'
FROM public.client_profiles p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.social_profiles->'links') = 'array'
       THEN p.social_profiles->'links' ELSE '[]'::jsonb END
) AS link
WHERE link->>'url' IS NOT NULL AND link->>'url' <> ''
ON CONFLICT (user_id, platform, profile_url) DO NOTHING;