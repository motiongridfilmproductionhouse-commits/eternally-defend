CREATE TABLE public.removal_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL UNIQUE,
  url text NOT NULL,
  platform text, content_type text, publisher text, page_title text, potential_category text,
  affects text NOT NULL, issue text NOT NULL, explanation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  full_name text NOT NULL, email text NOT NULL, phone text NOT NULL, country text NOT NULL,
  assessment_summary text, recommended_route text,
  fee_amount integer NOT NULL DEFAULT 1000, currency text NOT NULL DEFAULT 'USD',
  payment_method text,
  payment_status text NOT NULL DEFAULT 'invoice_pending',
  case_status text NOT NULL DEFAULT 'awaiting_payment',
  status_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.removal_orders TO authenticated;
GRANT ALL ON public.removal_orders TO service_role;
ALTER TABLE public.removal_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view removal orders" ON public.removal_orders FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update removal orders" ON public.removal_orders FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER removal_orders_updated BEFORE UPDATE ON public.removal_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();