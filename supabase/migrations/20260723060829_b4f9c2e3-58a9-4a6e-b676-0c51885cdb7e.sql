
-- Add partner role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'partner' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'partner';
  END IF;
END $$;

-- Referral capture column on client_profiles
ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS referred_by TEXT;

-- =======================
-- partner_applications
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK (status IN ('PENDING_REVIEW','INFO_REQUESTED','APPROVED','REJECTED')),
  legal_company_name TEXT NOT NULL,
  trading_name TEXT,
  registration_number TEXT,
  country TEXT NOT NULL,
  address TEXT,
  website TEXT,
  industry TEXT,
  founder_name TEXT NOT NULL,
  rep_name TEXT NOT NULL,
  rep_title TEXT,
  business_email TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  territory TEXT,
  expected_monthly_clients INT,
  partnership_type TEXT NOT NULL,
  trade_licence_s3_key TEXT,
  id_document_s3_key TEXT,
  declarations JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_text TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  review_notes TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  assigned_partner_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_user_active
  ON public.partner_applications(user_id)
  WHERE status IN ('PENDING_REVIEW','INFO_REQUESTED','APPROVED');

GRANT SELECT, INSERT, UPDATE ON public.partner_applications TO authenticated;
GRANT ALL ON public.partner_applications TO service_role;
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Applicant reads own app" ON public.partner_applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Applicant inserts own app" ON public.partner_applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin updates apps" ON public.partner_applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =======================
-- partner_agreements
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT_AWAITING_ETERNA'
    CHECK (status IN ('DRAFT_AWAITING_ETERNA','ETERNA_SIGNED','ACTIVE','TERMINATED')),
  draft_s3_key TEXT NOT NULL,
  signed_s3_key TEXT,
  sha256 TEXT,
  eterna_signer_id UUID REFERENCES auth.users(id),
  eterna_signed_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.partner_agreements TO authenticated;
GRANT ALL ON public.partner_agreements TO service_role;
ALTER TABLE public.partner_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads agreements" ON public.partner_agreements FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owner writes agreements" ON public.partner_agreements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin updates agreements" ON public.partner_agreements FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =======================
-- partner_profiles
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id TEXT NOT NULL UNIQUE,
  referral_code TEXT NOT NULL UNIQUE,
  legal_company_name TEXT NOT NULL,
  territory TEXT,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 25.00,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','SUSPENDED','TERMINATED')),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_profiles TO authenticated;
GRANT ALL ON public.partner_profiles TO service_role;
ALTER TABLE public.partner_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partner reads own profile" ON public.partner_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- =======================
-- partner_referred_clients
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_referred_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL REFERENCES public.partner_profiles(partner_id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  client_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_email TEXT NOT NULL,
  lead_name TEXT,
  lead_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'LEAD'
    CHECK (status IN ('LEAD','ONBOARDING','ACTIVE','PAID','REFUNDED','REJECTED','CANCELLED')),
  sale_amount_inr NUMERIC(14,2),
  commission_amount_inr NUMERIC(14,2),
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prc_partner_client_unique
  ON public.partner_referred_clients(partner_id, client_user_id)
  WHERE client_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS prc_partner_email_active
  ON public.partner_referred_clients(partner_id, lower(lead_email))
  WHERE status IN ('LEAD','ONBOARDING','ACTIVE','PAID');

GRANT SELECT, INSERT, UPDATE ON public.partner_referred_clients TO authenticated;
GRANT ALL ON public.partner_referred_clients TO service_role;
ALTER TABLE public.partner_referred_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partner reads own leads" ON public.partner_referred_clients FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    partner_id IN (SELECT p.partner_id FROM public.partner_profiles p WHERE p.user_id = auth.uid())
  );
CREATE POLICY "Partner inserts own leads" ON public.partner_referred_clients FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    partner_id IN (SELECT p.partner_id FROM public.partner_profiles p WHERE p.user_id = auth.uid())
  );
CREATE POLICY "Admin updates leads" ON public.partner_referred_clients FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =======================
-- partner_commissions
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL REFERENCES public.partner_profiles(partner_id) ON DELETE CASCADE,
  referred_client_id UUID NOT NULL UNIQUE REFERENCES public.partner_referred_clients(id) ON DELETE CASCADE,
  gross_inr NUMERIC(14,2) NOT NULL DEFAULT 500000,
  commission_inr NUMERIC(14,2) NOT NULL DEFAULT 125000,
  status TEXT NOT NULL DEFAULT 'PAYABLE'
    CHECK (status IN ('PENDING','PAYABLE','PAID','VOID')),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  payout_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_commissions TO authenticated;
GRANT ALL ON public.partner_commissions TO service_role;
ALTER TABLE public.partner_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partner reads own commissions" ON public.partner_commissions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    partner_id IN (SELECT p.partner_id FROM public.partner_profiles p WHERE p.user_id = auth.uid())
  );

-- =======================
-- partner_audit_log
-- =======================
CREATE TABLE IF NOT EXISTS public.partner_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  partner_id TEXT,
  application_id UUID,
  action TEXT NOT NULL,
  payload JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.partner_audit_log TO authenticated;
GRANT ALL ON public.partner_audit_log TO service_role;
ALTER TABLE public.partner_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin reads audit" ON public.partner_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone inserts audit" ON public.partner_audit_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_id OR public.has_role(auth.uid(), 'admin'));

-- Triggers
CREATE TRIGGER partner_applications_touch BEFORE UPDATE ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER partner_agreements_touch BEFORE UPDATE ON public.partner_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER partner_profiles_touch BEFORE UPDATE ON public.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER partner_referred_clients_touch BEFORE UPDATE ON public.partner_referred_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER partner_commissions_touch BEFORE UPDATE ON public.partner_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-issue commission when referred client marked PAID
CREATE OR REPLACE FUNCTION public.issue_partner_commission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'PAID' AND (OLD.status IS DISTINCT FROM 'PAID') THEN
    INSERT INTO public.partner_commissions (partner_id, referred_client_id, gross_inr, commission_inr, status, earned_at)
    VALUES (NEW.partner_id, NEW.id, COALESCE(NEW.sale_amount_inr, 500000), COALESCE(NEW.commission_amount_inr, 125000), 'PAYABLE', COALESCE(NEW.cleared_at, now()))
    ON CONFLICT (referred_client_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER partner_referred_clients_commission
  AFTER UPDATE ON public.partner_referred_clients
  FOR EACH ROW EXECUTE FUNCTION public.issue_partner_commission();
