ALTER TABLE public.authorization_signatures
  ADD COLUMN IF NOT EXISTS signer_email text,
  ADD COLUMN IF NOT EXISTS client_id text,
  ADD COLUMN IF NOT EXISTS auth_number text,
  ADD COLUMN IF NOT EXISTS signature_method text DEFAULT 'typed-name electronic signature',
  ADD COLUMN IF NOT EXISTS consent_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_text text,
  ADD COLUMN IF NOT EXISTS signature_sha256 text,
  ADD COLUMN IF NOT EXISTS device_metadata jsonb;