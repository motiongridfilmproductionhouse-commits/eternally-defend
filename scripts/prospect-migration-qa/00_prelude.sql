-- Minimal Supabase-like environment for migration QA.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
CREATE TYPE public.app_role AS ENUM ('admin','super_admin','user');
CREATE TABLE public.user_roles (id uuid DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL, UNIQUE(user_id, role));
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE FUNCTION public.enforcement_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n,s,c) ON CONFLICT (jobname) DO UPDATE SET schedule=excluded.schedule, command=excluded.command RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname=n RETURNING true $$;
CREATE TABLE net.calls (id serial, url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url,headers,body) VALUES (url,headers,body) RETURNING id::bigint $$;
CREATE TABLE public.internal_cron_secrets (name text PRIMARY KEY, token text NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
GRANT ALL ON public.internal_cron_secrets TO service_role;
ALTER TABLE public.internal_cron_secrets ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.signup_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text, label text, max_uses int, assigned_email text, account_type text, created_by uuid, status text DEFAULT 'active');
CREATE TABLE public.signup_invite_redemptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invite_id uuid REFERENCES public.signup_invites(id), user_id uuid, email text, created_at timestamptz DEFAULT now());
ALTER TABLE public.signup_invite_redemptions ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.client_profiles (user_id uuid PRIMARY KEY, email text, display_name text, company_name text, country text, website text, onboarding_account_type text, social_profiles jsonb DEFAULT '{}'::jsonb);
ALTER TABLE public.client_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.client_profiles TO authenticated;
CREATE POLICY own_profile ON public.client_profiles FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
