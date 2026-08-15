-- Invitation codes for gated signup
CREATE TABLE public.signup_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
  expires_at timestamptz,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  assigned_email text,
  account_type text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signup_invites TO authenticated;
GRANT ALL ON public.signup_invites TO service_role;
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage signup invites"
  ON public.signup_invites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Audit: which invitation created which account
CREATE TABLE public.signup_invite_redemptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES public.signup_invites(id) ON DELETE CASCADE,
  user_id uuid,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.signup_invite_redemptions TO authenticated;
GRANT ALL ON public.signup_invite_redemptions TO service_role;
ALTER TABLE public.signup_invite_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read invite redemptions"
  ON public.signup_invite_redemptions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Rate limiting of invalid invite-code attempts
CREATE TABLE public.signup_invite_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_key text NOT NULL,
  email text,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signup_invite_attempts_actor_idx ON public.signup_invite_attempts (actor_key, created_at DESC);

GRANT SELECT ON public.signup_invite_attempts TO authenticated;
GRANT ALL ON public.signup_invite_attempts TO service_role;
ALTER TABLE public.signup_invite_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read invite attempts"
  ON public.signup_invite_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Atomic claim: locks the invite row, validates it, increments use_count.
-- Returns no rows when the code is unusable for any reason (caller returns a generic error).
CREATE OR REPLACE FUNCTION public.claim_signup_invite(_code_hash text, _email text)
RETURNS TABLE(invite_id uuid, account_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inv public.signup_invites;
BEGIN
  SELECT * INTO inv FROM public.signup_invites
   WHERE code_hash = _code_hash
   FOR UPDATE;

  IF inv.id IS NULL THEN RETURN; END IF;
  IF inv.status <> 'active' THEN RETURN; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN; END IF;
  IF inv.use_count >= inv.max_uses THEN RETURN; END IF;
  IF inv.assigned_email IS NOT NULL
     AND lower(trim(inv.assigned_email)) <> lower(trim(coalesce(_email, ''))) THEN RETURN; END IF;

  UPDATE public.signup_invites
     SET use_count = use_count + 1,
         last_used_at = now()
   WHERE id = inv.id;

  RETURN QUERY SELECT inv.id, inv.account_type;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_signup_invite(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_signup_invite(text, text) TO service_role;

-- Release a claim when account creation fails afterwards.
CREATE OR REPLACE FUNCTION public.release_signup_invite(_invite_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.signup_invites
     SET use_count = GREATEST(use_count - 1, 0)
   WHERE id = _invite_id;
$$;

REVOKE ALL ON FUNCTION public.release_signup_invite(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_signup_invite(uuid) TO service_role;