
-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.onboarding_overall_status AS ENUM ('NOT_STARTED','IN_PROGRESS','ACTION_REQUIRED','UNDER_REVIEW','VERIFIED','REJECTED','COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.kyc_status AS ENUM ('NOT_STARTED','SESSION_CREATED','IN_PROGRESS','SUBMITTED','APPROVED','DECLINED','RESUBMISSION_REQUIRED','EXPIRED','MANUAL_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.face_profile_status AS ENUM ('NOT_STARTED','CONSENT_REQUIRED','CAMERA_PERMISSION_REQUIRED','CAPTURE_IN_PROGRESS','LIVENESS_PROCESSING','LIVENESS_FAILED','QUALITY_FAILED','FACE_VERIFIED','MANUAL_REVIEW','DELETION_REQUESTED','DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_verification_status AS ENUM ('UNVERIFIED','CODE_GENERATED','VERIFICATION_PENDING','VERIFIED','REJECTED','EXPIRED','REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.authorization_status AS ENUM ('DRAFT','AWAITING_KYC','AWAITING_FACE_VERIFICATION','AWAITING_ASSET_VERIFICATION','AWAITING_SIGNATURE','SIGNED','UNDER_ADMIN_REVIEW','ACTIVE','REJECTED','SUSPENDED','REVOKED','EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.signature_status AS ENUM ('DRAFT','READY_FOR_REVIEW','AWAITING_SIGNATURE','AWAITING_OTP','SIGNED','VOIDED','SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ SEQUENCES ============
CREATE SEQUENCE IF NOT EXISTS public.client_id_seq START 10000;
CREATE SEQUENCE IF NOT EXISTS public.authorization_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.certificate_number_seq START 1;

-- ============ CLIENT PROFILE EXTENSIONS ============
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS client_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS role_title TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- ============ ONBOARDING PROGRESS ============
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step INT NOT NULL DEFAULT 1,
  overall_status public.onboarding_overall_status NOT NULL DEFAULT 'NOT_STARTED',
  step_states JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.onboarding_progress TO authenticated;
GRANT ALL ON public.onboarding_progress TO service_role;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own progress" ON public.onboarding_progress FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin progress read" ON public.onboarding_progress FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- ============ KYC ============
CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT,
  veriff_session_id TEXT UNIQUE,
  provider_reference TEXT,
  verification_status public.kyc_status NOT NULL DEFAULT 'NOT_STARTED',
  verification_date TIMESTAMPTZ,
  country TEXT,
  document_type TEXT,
  review_reason TEXT,
  session_url TEXT,
  raw_webhook JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_user_idx ON public.kyc_verifications(user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.kyc_verifications TO authenticated;
GRANT ALL ON public.kyc_verifications TO service_role;
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kyc" ON public.kyc_verifications FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin kyc read" ON public.kyc_verifications FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- ============ BIOMETRIC CONSENTS ============
CREATE TABLE IF NOT EXISTS public.biometric_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_version TEXT NOT NULL,
  consents JSONB NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.biometric_consents TO authenticated;
GRANT ALL ON public.biometric_consents TO service_role;
ALTER TABLE public.biometric_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own consents" ON public.biometric_consents FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin consents read" ON public.biometric_consents FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- ============ PROTECTED FACE PROFILE ============
CREATE TABLE IF NOT EXISTS public.protected_face_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL,
  rekognition_user_id TEXT,
  liveness_session_id TEXT,
  liveness_score NUMERIC,
  status public.face_profile_status NOT NULL DEFAULT 'NOT_STARTED',
  enrollment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.protected_face_profiles TO authenticated;
GRANT ALL ON public.protected_face_profiles TO service_role;
ALTER TABLE public.protected_face_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own face profile" ON public.protected_face_profiles FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin face profile read" ON public.protected_face_profiles FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.protected_face_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.protected_face_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  face_id TEXT,
  quality_scores JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.protected_face_references TO authenticated;
GRANT ALL ON public.protected_face_references TO service_role;
ALTER TABLE public.protected_face_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own face refs" ON public.protected_face_references FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

-- ============ DIGITAL ASSETS ============
CREATE TABLE IF NOT EXISTS public.digital_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  channel_id TEXT,
  channel_url TEXT,
  handle TEXT,
  name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_status public.asset_verification_status NOT NULL DEFAULT 'UNVERIFIED',
  verification_method TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS digital_assets_user_idx ON public.digital_assets(user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.digital_assets TO authenticated;
GRANT ALL ON public.digital_assets TO service_role;
ALTER TABLE public.digital_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own assets" ON public.digital_assets FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin assets read" ON public.digital_assets FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.youtube_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.digital_assets(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.youtube_verification_challenges TO authenticated;
GRANT ALL ON public.youtube_verification_challenges TO service_role;
ALTER TABLE public.youtube_verification_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own challenges" ON public.youtube_verification_challenges FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

CREATE TABLE IF NOT EXISTS public.asset_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.digital_assets(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.asset_verification_events TO authenticated;
GRANT ALL ON public.asset_verification_events TO service_role;
ALTER TABLE public.asset_verification_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own asset events" ON public.asset_verification_events FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin asset events read" ON public.asset_verification_events FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- ============ AUTHORIZATIONS ============
CREATE TABLE IF NOT EXISTS public.client_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_number TEXT NOT NULL UNIQUE,
  version INT NOT NULL DEFAULT 1,
  status public.authorization_status NOT NULL DEFAULT 'DRAFT',
  effective_date DATE,
  expiry_date DATE,
  territory TEXT,
  enforcement_enabled BOOLEAN NOT NULL DEFAULT false,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_user_idx ON public.client_authorizations(user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.client_authorizations TO authenticated;
GRANT ALL ON public.client_authorizations TO service_role;
ALTER TABLE public.client_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own auths" ON public.client_authorizations FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin auths read" ON public.client_authorizations FOR SELECT USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin auths update" ON public.client_authorizations FOR UPDATE USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.authorization_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_key TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (authorization_id, scope_key)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorization_scopes TO authenticated;
GRANT ALL ON public.authorization_scopes TO service_role;
ALTER TABLE public.authorization_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scopes" ON public.authorization_scopes FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin scopes read" ON public.authorization_scopes FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.authorization_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorization_versions TO authenticated;
GRANT ALL ON public.authorization_versions TO service_role;
ALTER TABLE public.authorization_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own auth versions" ON public.authorization_versions FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin auth versions read" ON public.authorization_versions FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.authorization_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INT NOT NULL,
  status public.signature_status NOT NULL DEFAULT 'AWAITING_SIGNATURE',
  typed_name TEXT,
  role_title TEXT,
  drawn_signature_svg TEXT,
  otp_verified_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  document_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorization_signatures TO authenticated;
GRANT ALL ON public.authorization_signatures TO service_role;
ALTER TABLE public.authorization_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own signatures" ON public.authorization_signatures FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin signatures read" ON public.authorization_signatures FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.authorization_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- draft | signed | certificate | package
  version INT,
  s3_key TEXT NOT NULL,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorization_documents TO authenticated;
GRANT ALL ON public.authorization_documents TO service_role;
ALTER TABLE public.authorization_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own auth docs" ON public.authorization_documents FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin auth docs read" ON public.authorization_documents FOR SELECT USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.authorization_admin_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id),
  decision TEXT NOT NULL, -- approve|reject|request_info|suspend|revoke|renew
  notes TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.authorization_admin_reviews TO authenticated;
GRANT ALL ON public.authorization_admin_reviews TO service_role;
ALTER TABLE public.authorization_admin_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own review read" ON public.authorization_admin_reviews FOR SELECT USING (auth.uid()=user_id);
CREATE POLICY "admin reviews all" ON public.authorization_admin_reviews FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ CERTIFICATES ============
CREATE TABLE IF NOT EXISTS public.verification_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  authorization_id UUID NOT NULL REFERENCES public.client_authorizations(id) ON DELETE CASCADE,
  certificate_number TEXT NOT NULL UNIQUE,
  public_slug TEXT NOT NULL UNIQUE,
  score INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|EXPIRED|SUSPENDED|REVOKED
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  s3_key TEXT,
  sha256 TEXT,
  snapshot JSONB
);
CREATE INDEX IF NOT EXISTS cert_user_idx ON public.verification_certificates(user_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.verification_certificates TO authenticated;
GRANT ALL ON public.verification_certificates TO service_role;
-- Public verify page reads a narrow safe subset via server publishable client. Allow anon SELECT only of safe columns via view below.
ALTER TABLE public.verification_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cert" ON public.verification_certificates FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
CREATE POLICY "admin cert read" ON public.verification_certificates FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- Public verification view (safe columns only)
CREATE OR REPLACE VIEW public.public_verifications AS
SELECT
  vc.public_slug,
  vc.certificate_number,
  vc.status,
  vc.score,
  vc.issued_at,
  vc.expires_at,
  ca.auth_number,
  ca.status AS authorization_status,
  ca.enforcement_enabled,
  cp.display_name,
  cp.company_name,
  cp.client_id
FROM public.verification_certificates vc
JOIN public.client_authorizations ca ON ca.id = vc.authorization_id
LEFT JOIN public.client_profiles cp ON cp.user_id = vc.user_id;
GRANT SELECT ON public.public_verifications TO anon, authenticated;

-- ============ AUDIT ============
CREATE TABLE IF NOT EXISTS public.authorization_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  payload JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON public.authorization_audit_logs TO authenticated;
GRANT ALL ON public.authorization_audit_logs TO service_role;
ALTER TABLE public.authorization_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit read" ON public.authorization_audit_logs FOR SELECT USING (auth.uid()=user_id OR auth.uid()=actor_id);
CREATE POLICY "own audit insert" ON public.authorization_audit_logs FOR INSERT WITH CHECK (auth.uid()=actor_id OR auth.uid()=user_id);
CREATE POLICY "admin audit read" ON public.authorization_audit_logs FOR SELECT USING (public.has_role(auth.uid(),'admin'));

-- ============ TRIGGERS ============
CREATE TRIGGER trg_onboarding_progress_updated BEFORE UPDATE ON public.onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kyc_updated BEFORE UPDATE ON public.kyc_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_face_profile_updated BEFORE UPDATE ON public.protected_face_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_digital_assets_updated BEFORE UPDATE ON public.digital_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_client_authorizations_updated BEFORE UPDATE ON public.client_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
