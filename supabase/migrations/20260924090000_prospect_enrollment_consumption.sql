-- Pre-Enrollment Intelligence — onboarding consumes the staff hand-off package.
--
-- prospect_enrollment_packages: one package per prospect scan (idempotent),
--   carrying the resolved identity snapshot and prospect_scan_id, linked to the
--   client account when the invitation is redeemed (or by an admin for an
--   existing account).
-- client_prospect_findings: review-only copies of the transferred,
--   human-verified findings with references to their stored evidence. No
--   scanner, report or enforcement path reads this table; imported rows are
--   never enforcement-eligible.

CREATE TABLE IF NOT EXISTS public.prospect_enrollment_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL UNIQUE REFERENCES public.prospect_scans(id) ON DELETE RESTRICT,
  prospect_id uuid NOT NULL REFERENCES public.prospect_identities(id) ON DELETE RESTRICT,
  identity_snapshot jsonb NOT NULL,
  account_type text,
  invite_id uuid REFERENCES public.signup_invites(id) ON DELETE SET NULL,
  assigned_email text,
  client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'LINKED', 'APPLIED')),
  profile_prefilled_at timestamptz,
  findings_imported integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  linked_at timestamptz,
  applied_at timestamptz
);
CREATE INDEX IF NOT EXISTS prospect_enrollment_packages_invite_idx
  ON public.prospect_enrollment_packages(invite_id) WHERE invite_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospect_enrollment_packages_client_idx
  ON public.prospect_enrollment_packages(client_user_id) WHERE client_user_id IS NOT NULL;

-- A package, once linked to a client, is never re-pointed to another account,
-- and its identity snapshot / prospect_scan_id never change.
CREATE OR REPLACE FUNCTION public.prospect_enrollment_packages_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.scan_id IS DISTINCT FROM OLD.scan_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'prospect_enrollment_packages provenance is immutable';
  END IF;
  IF OLD.client_user_id IS NOT NULL AND NEW.client_user_id IS DISTINCT FROM OLD.client_user_id THEN
    RAISE EXCEPTION 'an enrollment package cannot be re-linked to another account';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prospect_enrollment_packages_guard ON public.prospect_enrollment_packages;
CREATE TRIGGER prospect_enrollment_packages_guard
  BEFORE UPDATE ON public.prospect_enrollment_packages
  FOR EACH ROW EXECUTE FUNCTION public.prospect_enrollment_packages_guard();

ALTER TABLE public.prospect_enrollment_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prospect_enrollment_packages FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.prospect_enrollment_packages TO authenticated;
GRANT ALL ON public.prospect_enrollment_packages TO service_role;

DROP POLICY IF EXISTS "staff read packages" ON public.prospect_enrollment_packages;
CREATE POLICY "staff read packages" ON public.prospect_enrollment_packages
  FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
DROP POLICY IF EXISTS "staff create packages" ON public.prospect_enrollment_packages;
CREATE POLICY "staff create packages" ON public.prospect_enrollment_packages
  FOR INSERT TO authenticated
  WITH CHECK (public.is_prospect_staff(auth.uid()) AND created_by = auth.uid());
DROP POLICY IF EXISTS "staff update packages" ON public.prospect_enrollment_packages;
CREATE POLICY "staff update packages" ON public.prospect_enrollment_packages
  FOR UPDATE TO authenticated
  USING (public.is_prospect_staff(auth.uid()))
  WITH CHECK (public.is_prospect_staff(auth.uid()));
DROP POLICY IF EXISTS "client reads own package" ON public.prospect_enrollment_packages;
CREATE POLICY "client reads own package" ON public.prospect_enrollment_packages
  FOR SELECT TO authenticated USING (client_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.client_prospect_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.prospect_enrollment_packages(id) ON DELETE RESTRICT,
  client_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prospect_scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE RESTRICT,
  prospect_finding_id uuid NOT NULL REFERENCES public.prospect_findings(id) ON DELETE RESTRICT,
  stage_key text NOT NULL,
  category text NOT NULL,
  severity text,
  detection_reason text NOT NULL,
  confidence integer,
  source_url text NOT NULL,
  canonical_url text,
  platform text,
  title text,
  discovery_method text,
  identity_confidence integer,
  finding_state text NOT NULL CHECK (finding_state IN ('VERIFIED', 'ESCALATED')),
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'PENDING_CLIENT_REVIEW'
    CHECK (review_status IN ('PENDING_CLIENT_REVIEW', 'ACKNOWLEDGED', 'DISMISSED')),
  enforcement_eligible boolean NOT NULL DEFAULT false CHECK (enforcement_eligible = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, prospect_finding_id)
);
CREATE INDEX IF NOT EXISTS client_prospect_findings_client_idx
  ON public.client_prospect_findings(client_user_id, created_at);
CREATE INDEX IF NOT EXISTS client_prospect_findings_package_idx
  ON public.client_prospect_findings(package_id);
COMMENT ON TABLE public.client_prospect_findings IS
  'Review-only import of human-verified pre-enrollment findings. Never read by scanners, reports or enforcement.';

ALTER TABLE public.client_prospect_findings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_prospect_findings FROM anon;
GRANT SELECT ON public.client_prospect_findings TO authenticated;
GRANT ALL ON public.client_prospect_findings TO service_role;

DROP POLICY IF EXISTS "client reads own imported findings" ON public.client_prospect_findings;
CREATE POLICY "client reads own imported findings" ON public.client_prospect_findings
  FOR SELECT TO authenticated USING (client_user_id = auth.uid());
DROP POLICY IF EXISTS "staff read imported findings" ON public.client_prospect_findings;
CREATE POLICY "staff read imported findings" ON public.client_prospect_findings
  FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
