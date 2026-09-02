ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_id uuid,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_email_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.waitlist_signups
  DROP CONSTRAINT IF EXISTS waitlist_signups_status_check;
ALTER TABLE public.waitlist_signups
  ADD CONSTRAINT waitlist_signups_status_check
  CHECK (status IN ('PENDING','APPROVED','DECLINED'));

CREATE INDEX IF NOT EXISTS waitlist_signups_status_idx ON public.waitlist_signups (status, created_at DESC);

GRANT SELECT, UPDATE ON public.waitlist_signups TO authenticated;
GRANT ALL ON public.waitlist_signups TO service_role;

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view waitlist signups" ON public.waitlist_signups;
CREATE POLICY "Admins can view waitlist signups"
ON public.waitlist_signups FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins can review waitlist signups" ON public.waitlist_signups;
CREATE POLICY "Admins can review waitlist signups"
ON public.waitlist_signups FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_waitlist_signups_updated_at ON public.waitlist_signups;
CREATE TRIGGER update_waitlist_signups_updated_at
BEFORE UPDATE ON public.waitlist_signups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();