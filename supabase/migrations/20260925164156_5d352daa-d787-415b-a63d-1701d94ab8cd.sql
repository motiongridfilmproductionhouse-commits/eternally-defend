CREATE TABLE public.eip_account_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  requested_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.eip_account_access TO authenticated;
GRANT ALL ON public.eip_account_access TO service_role;
ALTER TABLE public.eip_account_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip access read own or admin" ON public.eip_account_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "eip access request own" ON public.eip_account_access FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid() AND enabled = false) OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "eip access admin update" ON public.eip_account_access FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.eip_enabled(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT enabled FROM public.eip_account_access WHERE user_id=_uid), false)
    OR public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin') OR public.has_role(_uid,'staff')
$$;

CREATE TABLE public.eip_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  width int, height int, size_bytes bigint,
  original_sha256 text NOT NULL,
  authorization_ref text NOT NULL,
  authorized_identity text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','PASS','LIMITED','FAIL','SYSTEM_ERROR')),
  current_stage text,
  engine_version text,
  config_sha256 text,
  protected_storage_path text,
  protected_sha256 text,
  certificate_id text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  error_message text,
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.eip_jobs TO authenticated;
GRANT ALL ON public.eip_jobs TO service_role;
ALTER TABLE public.eip_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip jobs read" ON public.eip_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "eip jobs create queued" ON public.eip_jobs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status='QUEUED' AND public.eip_enabled(auth.uid()));
CREATE POLICY "eip jobs admin retry" ON public.eip_jobs FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Only the engine (service role) may write outcomes; people may only retry SYSTEM_ERROR -> QUEUED.
CREATE OR REPLACE FUNCTION public.eip_jobs_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF NOT (OLD.status='SYSTEM_ERROR' AND NEW.status='QUEUED') THEN
    RAISE EXCEPTION 'EIP outcomes can only be written by the EIP engine (retry of SYSTEM_ERROR is the only manual change)';
  END IF;
  IF ROW(NEW.image_name,NEW.storage_path,NEW.original_sha256,NEW.authorization_ref,NEW.user_id,NEW.protected_sha256,NEW.certificate_id)
     IS DISTINCT FROM ROW(OLD.image_name,OLD.storage_path,OLD.original_sha256,OLD.authorization_ref,OLD.user_id,OLD.protected_sha256,OLD.certificate_id) THEN
    RAISE EXCEPTION 'EIP job provenance is immutable';
  END IF;
  NEW.error_message := NULL; NEW.current_stage := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER eip_jobs_guard BEFORE UPDATE ON public.eip_jobs FOR EACH ROW EXECUTE FUNCTION public.eip_jobs_guard();

CREATE TABLE public.eip_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.eip_jobs(id) ON DELETE CASCADE,
  evaluation_version text NOT NULL,
  is_initial boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('PASS','LIMITED','FAIL','SYSTEM_ERROR')),
  visual_quality text, transformation_robustness text, identity_evaluation text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.eip_evaluations TO authenticated;
GRANT ALL ON public.eip_evaluations TO service_role;
ALTER TABLE public.eip_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip evals read" ON public.eip_evaluations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.eip_jobs j WHERE j.id=job_id AND (j.user_id=auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))));
CREATE OR REPLACE FUNCTION public.eip_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'EIP evaluation history is append-only'; END $$;
CREATE TRIGGER eip_evaluations_append_only BEFORE UPDATE OR DELETE ON public.eip_evaluations FOR EACH ROW EXECUTE FUNCTION public.eip_append_only();

CREATE TABLE public.eip_reevaluation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.eip_jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','DONE','SYSTEM_ERROR')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.eip_reevaluation_requests TO authenticated;
GRANT ALL ON public.eip_reevaluation_requests TO service_role;
ALTER TABLE public.eip_reevaluation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip reeval read" ON public.eip_reevaluation_requests FOR SELECT TO authenticated
  USING (requested_by=auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "eip reeval create" ON public.eip_reevaluation_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by=auth.uid() AND status='QUEUED' AND EXISTS (SELECT 1 FROM public.eip_jobs j WHERE j.id=job_id AND j.status IN ('PASS','LIMITED','FAIL')
    AND (j.user_id=auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))));

CREATE POLICY "eip uploads own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='eip-uploads' AND (storage.foldername(name))[1]=auth.uid()::text AND public.eip_enabled(auth.uid()));
CREATE POLICY "eip uploads own read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='eip-uploads' AND ((storage.foldername(name))[1]=auth.uid()::text OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')));