
-- =========================================================
-- Enums
-- =========================================================
CREATE TYPE public.discovery_subject_kind AS ENUM
  ('person','brand','company','domain','handle','website');

CREATE TYPE public.discovered_platform AS ENUM
  ('youtube','instagram','facebook','tiktok','x','linkedin','reddit','website');

CREATE TYPE public.discovered_account_status AS ENUM
  ('discovered','likely_official','user_confirmed','ownership_pending','verified','rejected');

CREATE TYPE public.discovered_user_decision AS ENUM
  ('confirmed','not_mine','unsure');

CREATE TYPE public.discovery_source AS ENUM
  ('firecrawl_search','website_links','cross_link','manual');

CREATE TYPE public.verification_method AS ENUM
  ('oauth','domain_dns','domain_meta','business_email','bio_code','document','admin_review');

CREATE TYPE public.verification_state AS ENUM
  ('pending','passed','failed','expired');

-- =========================================================
-- discovery_subjects
-- =========================================================
CREATE TABLE public.discovery_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_kind public.discovery_subject_kind NOT NULL,
  query text NOT NULL,
  normalized_name text,
  website_domain text,
  country text,
  org text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_subjects TO authenticated;
GRANT ALL ON public.discovery_subjects TO service_role;

ALTER TABLE public.discovery_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own discovery_subjects"
  ON public.discovery_subjects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_discovery_subjects_updated
  BEFORE UPDATE ON public.discovery_subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_discovery_subjects_user ON public.discovery_subjects(user_id, created_at DESC);

-- =========================================================
-- discovered_accounts
-- =========================================================
CREATE TABLE public.discovered_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.discovery_subjects(id) ON DELETE CASCADE,
  platform public.discovered_platform NOT NULL,
  display_name text,
  handle text,
  profile_url text NOT NULL,
  profile_image_url text,
  bio text,
  follower_count bigint,
  platform_verified boolean NOT NULL DEFAULT false,
  website_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  cross_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  match_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  discovery_source public.discovery_source NOT NULL DEFAULT 'firecrawl_search',
  status public.discovered_account_status NOT NULL DEFAULT 'discovered',
  user_decision public.discovered_user_decision,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovered_accounts TO authenticated;
GRANT ALL ON public.discovered_accounts TO service_role;

ALTER TABLE public.discovered_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own discovered_accounts"
  ON public.discovered_accounts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins can review discovered_accounts"
  ON public.discovered_accounts
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update discovered_accounts for review"
  ON public.discovered_accounts
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_discovered_accounts_updated
  BEFORE UPDATE ON public.discovered_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX idx_discovered_accounts_dedupe
  ON public.discovered_accounts(subject_id, platform, lower(coalesce(handle,'')), lower(profile_url));
CREATE INDEX idx_discovered_accounts_subject ON public.discovered_accounts(subject_id);
CREATE INDEX idx_discovered_accounts_user ON public.discovered_accounts(user_id, status);

-- =========================================================
-- account_verifications
-- =========================================================
CREATE TABLE public.account_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.discovered_accounts(id) ON DELETE CASCADE,
  method public.verification_method NOT NULL,
  state public.verification_state NOT NULL DEFAULT 'pending',
  code text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_id uuid REFERENCES auth.users(id),
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_verifications TO authenticated;
GRANT ALL ON public.account_verifications TO service_role;

ALTER TABLE public.account_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own account_verifications"
  ON public.account_verifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admins can read account_verifications"
  ON public.account_verifications
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update account_verifications"
  ON public.account_verifications
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_account_verifications_updated
  BEFORE UPDATE ON public.account_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_account_verifications_account ON public.account_verifications(account_id, created_at DESC);
CREATE INDEX idx_account_verifications_user ON public.account_verifications(user_id, state);

-- =========================================================
-- account_audit_log  (append-only)
-- =========================================================
CREATE TABLE public.account_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.discovered_accounts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  from_status public.discovered_account_status,
  to_status public.discovered_account_status,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.account_audit_log TO authenticated;
GRANT ALL ON public.account_audit_log TO service_role;

ALTER TABLE public.account_audit_log ENABLE ROW LEVEL SECURITY;

-- Owners can read + append entries for accounts they own.
CREATE POLICY "owner can read account_audit_log"
  ON public.account_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.discovered_accounts a
      WHERE a.id = account_audit_log.account_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "owner can append account_audit_log"
  ON public.account_audit_log
  FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.discovered_accounts a
      WHERE a.id = account_audit_log.account_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "admins can read account_audit_log"
  ON public.account_audit_log
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can append account_audit_log"
  ON public.account_audit_log
  FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

CREATE INDEX idx_account_audit_log_account ON public.account_audit_log(account_id, created_at DESC);

-- =========================================================
-- Link protected_assets → discovered_accounts (optional promotion)
-- =========================================================
ALTER TABLE public.protected_assets
  ADD COLUMN IF NOT EXISTS discovered_account_id uuid
  REFERENCES public.discovered_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_protected_assets_discovered_account
  ON public.protected_assets(discovered_account_id);
