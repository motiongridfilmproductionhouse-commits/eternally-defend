CREATE TABLE IF NOT EXISTS public.enforcement_email_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  enforcement_request_id uuid NULL,
  case_id uuid NULL,
  provider text NOT NULL DEFAULT 'SES',
  from_email text NOT NULL,
  intended_recipient text NOT NULL,
  destination_email text NOT NULL,
  subject text NOT NULL,
  provider_message_id text NULL,
  delivery_status text NOT NULL DEFAULT 'PENDING',
  error text NULL,
  test_mode boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enforcement_email_deliveries_user_idx ON public.enforcement_email_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS enforcement_email_deliveries_request_idx ON public.enforcement_email_deliveries (enforcement_request_id);
CREATE INDEX IF NOT EXISTS enforcement_email_deliveries_case_idx ON public.enforcement_email_deliveries (case_id);

GRANT SELECT ON public.enforcement_email_deliveries TO authenticated;
GRANT ALL ON public.enforcement_email_deliveries TO service_role;

ALTER TABLE public.enforcement_email_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own enforcement email deliveries" ON public.enforcement_email_deliveries;
CREATE POLICY "Users can view their own enforcement email deliveries"
  ON public.enforcement_email_deliveries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);