-- Controlled Production Activation Migration

ALTER TABLE public.client_enforcement_settings
  ADD COLUMN IF NOT EXISTS production_enforcement_approved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS production_notes TEXT;

ALTER TABLE public.asset_enforcement_settings
  ADD COLUMN IF NOT EXISTS production_enforcement_approved BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS production_approved_by TEXT;

-- Immutable Production Submission Snapshots Table
CREATE TABLE IF NOT EXISTS public.production_submission_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.enforcement_cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  protected_asset_id UUID,
  copyright_owner TEXT NOT NULL,
  authorization_id UUID,
  target_url TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  enforcement_basis TEXT NOT NULL,
  verified_route JSONB NOT NULL,
  recipient TEXT NOT NULL,
  notice_subject TEXT NOT NULL,
  notice_hash TEXT NOT NULL,
  evidence_references JSONB,
  worker_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.production_submission_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and owners can view snapshots"
  ON public.production_submission_snapshots FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
