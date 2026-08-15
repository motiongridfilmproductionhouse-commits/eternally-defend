CREATE TABLE public.enforcement_production_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('CLIENT','ASSET')),
  user_id UUID NOT NULL,
  protected_asset_id UUID,
  approval_reference TEXT NOT NULL,
  rights_evidence_ref TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT enforcement_production_approvals_asset_scope
    CHECK ((scope = 'ASSET' AND protected_asset_id IS NOT NULL) OR (scope = 'CLIENT' AND protected_asset_id IS NULL))
);

CREATE UNIQUE INDEX enforcement_production_approvals_client_uniq
  ON public.enforcement_production_approvals (user_id)
  WHERE scope = 'CLIENT' AND active;

CREATE UNIQUE INDEX enforcement_production_approvals_asset_uniq
  ON public.enforcement_production_approvals (protected_asset_id)
  WHERE scope = 'ASSET' AND active;

GRANT SELECT ON public.enforcement_production_approvals TO authenticated;
GRANT ALL ON public.enforcement_production_approvals TO service_role;

ALTER TABLE public.enforcement_production_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own production approvals"
  ON public.enforcement_production_approvals FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins manage production approvals"
  ON public.enforcement_production_approvals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.enforcement_presend_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  case_id UUID,
  enforcement_request_id UUID,
  user_id UUID NOT NULL,
  protected_asset_id UUID,
  finding_id UUID,
  infringing_url TEXT NOT NULL,
  infringing_host TEXT,
  recipient TEXT,
  recipient_verification_method TEXT,
  authoritative_source_url TEXT,
  recipient_verified_at TIMESTAMP WITH TIME ZONE,
  evidence_reference TEXT,
  evidence_snapshot_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_approved_by UUID,
  client_authorization_id UUID,
  client_authorization_reference TEXT,
  asset_approval_id UUID,
  asset_approval_reference TEXT,
  enforcement_ground TEXT,
  gate_result TEXT NOT NULL CHECK (gate_result IN ('GO','NO_GO')),
  failed_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  gate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  notice_hash TEXT,
  notice_subject TEXT,
  reply_to TEXT,
  reply_to_verified BOOLEAN NOT NULL DEFAULT false,
  test_mode BOOLEAN NOT NULL DEFAULT true,
  live_enabled BOOLEAN NOT NULL DEFAULT false,
  transport TEXT,
  provider_message_id TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE,
  submission_status TEXT,
  delivery_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX enforcement_presend_audit_idempotency_uniq
  ON public.enforcement_presend_audit (idempotency_key);

CREATE INDEX enforcement_presend_audit_user_idx
  ON public.enforcement_presend_audit (user_id, created_at DESC);

GRANT SELECT ON public.enforcement_presend_audit TO authenticated;
GRANT ALL ON public.enforcement_presend_audit TO service_role;

ALTER TABLE public.enforcement_presend_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their own pre-send audit rows"
  ON public.enforcement_presend_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_enforcement_production_approvals_updated_at
  BEFORE UPDATE ON public.enforcement_production_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_enforcement_presend_audit_updated_at
  BEFORE UPDATE ON public.enforcement_presend_audit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();