ALTER TABLE public.domain_enforcement_routes
  ADD COLUMN IF NOT EXISTS route_type TEXT NOT NULL DEFAULT 'EMAIL_DMCA',
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS authoritative_source_url TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reverify_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS hosting_provider TEXT,
  ADD COLUMN IF NOT EXISTS registrar TEXT,
  ADD COLUMN IF NOT EXISTS platform_kind TEXT;

UPDATE public.domain_enforcement_routes
  SET recipient_email = COALESCE(recipient_email, contact, copyright_email, abuse_email);

DELETE FROM public.domain_enforcement_routes a
  USING public.domain_enforcement_routes b
  WHERE a.domain = b.domain AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS domain_enforcement_routes_domain_key
  ON public.domain_enforcement_routes (domain);

DROP POLICY IF EXISTS "authenticated update routes" ON public.domain_enforcement_routes;
DROP POLICY IF EXISTS "authenticated add routes" ON public.domain_enforcement_routes;

CREATE POLICY "discovery inserts unverified routes"
  ON public.domain_enforcement_routes FOR INSERT TO authenticated
  WITH CHECK (verification_status <> 'VERIFIED');

CREATE POLICY "admins update routes"
  ON public.domain_enforcement_routes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "admins delete routes"
  ON public.domain_enforcement_routes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.domain_enforcement_routes TO authenticated;
GRANT ALL ON public.domain_enforcement_routes TO service_role;