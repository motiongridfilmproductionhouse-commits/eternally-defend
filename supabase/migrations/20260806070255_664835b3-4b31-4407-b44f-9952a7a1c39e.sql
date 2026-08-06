ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS onboarding_account_type text,
  ADD COLUMN IF NOT EXISTS verification_badge text;

ALTER TABLE public.client_profiles
  ADD CONSTRAINT client_profiles_onboarding_account_type_check
  CHECK (onboarding_account_type IS NULL OR onboarding_account_type IN ('individual', 'celebrity', 'enterprise', 'production_house'));

ALTER TABLE public.onboarding_progress
  ADD COLUMN IF NOT EXISTS onboarding_version text NOT NULL DEFAULT 'v1';

ALTER TABLE public.verification_certificates
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS verification_badge text;

ALTER TABLE public.verification_certificates
  ADD CONSTRAINT verification_certificates_account_type_check
  CHECK (account_type IS NULL OR account_type IN ('individual', 'celebrity', 'enterprise', 'production_house'));

CREATE TABLE public.onboarding_v2_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN ('official_contact', 'representative', 'company', 'rights', 'authorization')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED')),
  verification_method text,
  reference_value text,
  storage_path text,
  filename text,
  mime_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, evidence_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_v2_evidence TO authenticated;
GRANT ALL ON public.onboarding_v2_evidence TO service_role;
ALTER TABLE public.onboarding_v2_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own v2 onboarding evidence"
  ON public.onboarding_v2_evidence
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_onboarding_v2_evidence_updated
  BEFORE UPDATE ON public.onboarding_v2_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_onboarding_v2_evidence_user_status
  ON public.onboarding_v2_evidence(user_id, status);