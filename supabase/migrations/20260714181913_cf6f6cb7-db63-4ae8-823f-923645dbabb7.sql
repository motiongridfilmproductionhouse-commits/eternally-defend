
ALTER TABLE public.scan_hits
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS hidden_by_user_id uuid;

CREATE INDEX IF NOT EXISTS scan_hits_user_hidden_idx
  ON public.scan_hits (user_id, hidden_at);

ALTER TABLE public.client_profiles
  ADD COLUMN IF NOT EXISTS sidebar_collapsed boolean NOT NULL DEFAULT false;
