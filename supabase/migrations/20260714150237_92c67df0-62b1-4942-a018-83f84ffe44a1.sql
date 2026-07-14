
-- Enums
CREATE TYPE public.client_type_enum AS ENUM ('individual','celebrity','creator','business','corporate','agency');
CREATE TYPE public.account_type_enum AS ENUM ('personal','business');
CREATE TYPE public.authorization_level_enum AS ENUM ('monitoring','monitoring_evidence','monitoring_enforcement','full_protection');
CREATE TYPE public.authorization_status_enum AS ENUM ('pending','authorized','enterprise_authorized');
CREATE TYPE public.asset_kind_enum AS ENUM ('name','brand','company','product','social_account','youtube_channel','website','logo','image','video','copyright');
CREATE TYPE public.enterprise_doc_type_enum AS ENUM ('authorization_letter','agency_agreement','power_of_attorney','brand_protection');

-- client_profiles
CREATE TABLE public.client_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_type public.client_type_enum,
  account_type public.account_type_enum,
  onboarding_step INT NOT NULL DEFAULT 1,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  onboarding_version TEXT NOT NULL DEFAULT 'v1',
  full_name TEXT,
  email TEXT,
  phone TEXT,
  country TEXT,
  gov_id_ref TEXT,
  social_profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
  company_name TEXT,
  website TEXT,
  contact_person TEXT,
  business_reg_number TEXT,
  company_email TEXT,
  official_socials JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorization_level public.authorization_level_enum,
  authorization_status public.authorization_status_enum NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_profiles TO authenticated;
GRANT ALL ON public.client_profiles TO service_role;
ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own client profile" ON public.client_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- onboarding_assets
CREATE TABLE public.onboarding_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_kind public.asset_kind_enum NOT NULL,
  label TEXT NOT NULL,
  value TEXT,
  url TEXT,
  storage_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_assets TO authenticated;
GRANT ALL ON public.onboarding_assets TO service_role;
ALTER TABLE public.onboarding_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own onboarding assets" ON public.onboarding_assets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_onboarding_assets_user ON public.onboarding_assets(user_id);

-- authorization_records (immutable)
CREATE TABLE public.authorization_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_version TEXT NOT NULL,
  onboarding_version TEXT NOT NULL,
  consents JSONB NOT NULL,
  authorization_level public.authorization_level_enum NOT NULL,
  legal_name TEXT NOT NULL,
  signature_text TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  signature_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.authorization_records TO authenticated;
GRANT ALL ON public.authorization_records TO service_role;
ALTER TABLE public.authorization_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own authorization records" ON public.authorization_records
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own authorization records" ON public.authorization_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_auth_records_user_active ON public.authorization_records(user_id, active);

-- enterprise_documents
CREATE TABLE public.enterprise_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type public.enterprise_doc_type_enum NOT NULL,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size_bytes BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enterprise_documents TO authenticated;
GRANT ALL ON public.enterprise_documents TO service_role;
ALTER TABLE public.enterprise_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enterprise docs" ON public.enterprise_documents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- onboarding_audit_log
CREATE TABLE public.onboarding_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  step INT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.onboarding_audit_log TO authenticated;
GRANT ALL ON public.onboarding_audit_log TO service_role;
ALTER TABLE public.onboarding_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own audit log" ON public.onboarding_audit_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own audit log" ON public.onboarding_audit_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_audit_log_user ON public.onboarding_audit_log(user_id, created_at DESC);

-- Triggers
CREATE TRIGGER trg_client_profiles_updated_at
  BEFORE UPDATE ON public.client_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_onboarding_assets_updated_at
  BEFORE UPDATE ON public.onboarding_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for authorization-vault bucket (per-user folder)
CREATE POLICY "vault read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'authorization-vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "vault write own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'authorization-vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "vault update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'authorization-vault' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "vault delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'authorization-vault' AND (storage.foldername(name))[1] = auth.uid()::text);
