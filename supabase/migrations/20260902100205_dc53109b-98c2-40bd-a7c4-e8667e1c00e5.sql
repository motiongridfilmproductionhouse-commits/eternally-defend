CREATE TABLE public.waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_id text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  phone text NOT NULL,
  phone_normalized text NOT NULL UNIQUE,
  persona text NOT NULL,
  organization text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.waitlist_signups TO service_role;

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view waitlist signups"
ON public.waitlist_signups
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.waitlist_signups TO authenticated;

CREATE INDEX idx_waitlist_signups_created_at ON public.waitlist_signups (created_at DESC);