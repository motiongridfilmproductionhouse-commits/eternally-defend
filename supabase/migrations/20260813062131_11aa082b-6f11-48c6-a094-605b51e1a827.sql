ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS company_email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS company_brand_name TEXT,
  ADD COLUMN IF NOT EXISTS company_authority_status TEXT NOT NULL DEFAULT 'AUTHORITY_PENDING';

CREATE TABLE IF NOT EXISTS public.company_email_otps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_email_otps_user_idx ON public.company_email_otps (user_id, created_at DESC);

GRANT SELECT ON public.company_email_otps TO authenticated;
GRANT ALL ON public.company_email_otps TO service_role;

ALTER TABLE public.company_email_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own company email verifications" ON public.company_email_otps;
CREATE POLICY "Users can view their own company email verifications"
  ON public.company_email_otps FOR SELECT TO authenticated
  USING (auth.uid() = user_id);