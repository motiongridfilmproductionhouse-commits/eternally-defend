ALTER TABLE public.partner_profiles
  ALTER COLUMN commission_pct SET DEFAULT 10.00;

UPDATE public.partner_profiles
SET commission_pct = 10.00
WHERE commission_pct IN (20.00, 25.00);

ALTER TABLE public.partner_referred_clients
  ALTER COLUMN commission_amount_inr SET DEFAULT 50000;