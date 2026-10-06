ALTER TABLE public.removal_orders
  ADD COLUMN invoice_ref text, ADD COLUMN payment_ref text, ADD COLUMN paid_at timestamptz,
  ADD COLUMN customer_message text, ADD COLUMN internal_notes text,
  ADD COLUMN info_request jsonb, ADD COLUMN outcome_explanation text,
  ADD COLUMN removal_verification jsonb, ADD COLUMN status_changed_at timestamptz,
  ADD COLUMN status_changed_by uuid, ADD COLUMN staff_attention boolean NOT NULL DEFAULT true;
ALTER TABLE public.removal_orders ALTER COLUMN payment_status SET DEFAULT 'awaiting_invoice';
UPDATE public.removal_orders SET payment_status = 'awaiting_invoice' WHERE payment_status IN ('invoice_pending','invoice_requested');
CREATE TABLE public.removal_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.removal_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL, old_value text, new_value text, detail text,
  actor uuid, customer_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.removal_order_events(order_id, created_at);
GRANT SELECT ON public.removal_order_events TO authenticated;
GRANT ALL ON public.removal_order_events TO service_role;
ALTER TABLE public.removal_order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view removal events" ON public.removal_order_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));