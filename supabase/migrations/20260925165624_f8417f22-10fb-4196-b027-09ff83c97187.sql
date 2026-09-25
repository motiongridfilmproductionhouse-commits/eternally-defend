-- lovable-cron-fallback-reviewed: engine is async with no callback; per-minute poll is armed on enqueue and unscheduled by the worker when drained or engine disabled.
-- EIP engine integration: worker claiming, heartbeats, manifest storage, engine status.
ALTER TABLE public.eip_jobs
  ADD COLUMN IF NOT EXISTS engine_job_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_base_version text,
  ADD COLUMN IF NOT EXISTS evaluation_version text,
  ADD COLUMN IF NOT EXISTS manifest jsonb,
  ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE public.eip_jobs DROP CONSTRAINT IF EXISTS eip_jobs_status_check;
ALTER TABLE public.eip_jobs ADD CONSTRAINT eip_jobs_status_check CHECK (status IN
  ('QUEUED','PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING','PASS','LIMITED','FAIL','CANCELLED','SYSTEM_ERROR'));
CREATE INDEX IF NOT EXISTS eip_jobs_active_idx ON public.eip_jobs (created_at)
  WHERE status IN ('QUEUED','PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING');

ALTER TABLE public.eip_reevaluation_requests
  ADD COLUMN IF NOT EXISTS engine_evaluation_id text,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_code text;

CREATE TABLE public.eip_engine_status (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  engine_version text, research_base_version text, config_sha256 text,
  expected_engine_version text,
  models_loaded boolean,
  error_code text,
  last_checked_at timestamptz, last_ok_at timestamptz, worker_heartbeat_at timestamptz
);
GRANT SELECT ON public.eip_engine_status TO authenticated;
GRANT ALL ON public.eip_engine_status TO service_role;
ALTER TABLE public.eip_engine_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip engine status admin read" ON public.eip_engine_status FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
INSERT INTO public.eip_engine_status (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.eip_ops_log (
  id bigserial PRIMARY KEY,
  job_id uuid, reevaluation_id uuid,
  error_code text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.eip_ops_log TO authenticated;
GRANT ALL ON public.eip_ops_log TO service_role;
ALTER TABLE public.eip_ops_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eip ops log admin read" ON public.eip_ops_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.internal_cron_secrets (name, token)
VALUES ('eip_worker', replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.eip_worker_token_valid(_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(length(_token),0) >= 32 AND EXISTS (
    SELECT 1 FROM public.internal_cron_secrets WHERE name='eip_worker' AND token=_token);
$$;
REVOKE ALL ON FUNCTION public.eip_worker_token_valid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eip_worker_token_valid(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.eip_request_is_worker() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE h text;
BEGIN
  h := nullif(current_setting('request.headers', true),'')::json->>'x-eip-worker-token';
  RETURN public.eip_worker_token_valid(h);
EXCEPTION WHEN others THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.eip_request_is_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eip_request_is_worker() TO anon, authenticated;

-- Worker storage access: read originals (to sign short-lived input URLs), write protected outputs.
CREATE POLICY "eip worker read uploads" ON storage.objects FOR SELECT TO anon
  USING (bucket_id='eip-uploads' AND public.eip_request_is_worker());
CREATE POLICY "eip worker write protected" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id='eip-uploads' AND (storage.foldername(name))[2]='protected' AND public.eip_request_is_worker());

-- Guard: people may only retry recoverable SYSTEM_ERRORs; only the worker path writes progress/outcomes.
CREATE OR REPLACE FUNCTION public.eip_jobs_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_setting('eip.worker', true) = 'on' THEN RETURN NEW; END IF;
  IF NOT (OLD.status='SYSTEM_ERROR' AND NEW.status='QUEUED'
          AND coalesce(OLD.error_code,'') NOT IN ('CONFIG_INTEGRITY_FAILED','ENGINE_VERSION_MISMATCH','INPUT_HASH_MISMATCH','AUTHORIZATION_INVALID')) THEN
    RAISE EXCEPTION 'Only recoverable EIP system errors can be retried; results are written only by the EIP engine';
  END IF;
  IF ROW(NEW.image_name,NEW.storage_path,NEW.original_sha256,NEW.authorization_ref,NEW.user_id,NEW.protected_sha256,NEW.certificate_id,NEW.manifest::text)
     IS DISTINCT FROM ROW(OLD.image_name,OLD.storage_path,OLD.original_sha256,OLD.authorization_ref,OLD.user_id,OLD.protected_sha256,OLD.certificate_id,OLD.manifest::text) THEN
    RAISE EXCEPTION 'EIP job provenance is immutable';
  END IF;
  NEW.error_message := NULL; NEW.current_stage := NULL; NEW.error_code := NULL;
  NEW.worker_id := NULL; NEW.claimed_at := NULL; NEW.heartbeat_at := NULL; NEW.attempt_count := 0;
  RETURN NEW;
END $$;

-- Atomic claim with stale recovery. Stale = no heartbeat for _stale_seconds.
CREATE OR REPLACE FUNCTION public.eip_worker_claim(_token text, _worker text, _limit int, _stale_seconds int, _max_attempts int)
RETURNS SETOF public.eip_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM set_config('eip.worker','on',true);
  UPDATE public.eip_engine_status SET worker_heartbeat_at = now() WHERE id=1;
  -- Stale jobs past the attempt budget become SYSTEM_ERROR (never FAIL).
  UPDATE public.eip_jobs SET status='SYSTEM_ERROR', error_code='ENGINE_TIMEOUT',
    error_message='Processing did not complete in time', completed_at=now(), worker_id=NULL
  WHERE status IN ('PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING')
    AND heartbeat_at < now() - make_interval(secs => _stale_seconds) AND attempt_count >= _max_attempts;
  -- Remaining stale jobs are released (engine_job_id kept for idempotent resume).
  UPDATE public.eip_jobs SET worker_id=NULL, claimed_at=NULL
  WHERE status IN ('PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING')
    AND worker_id IS NOT NULL AND heartbeat_at < now() - make_interval(secs => _stale_seconds);
  RETURN QUERY
  UPDATE public.eip_jobs j SET worker_id=_worker, claimed_at=now(), heartbeat_at=now(),
    attempt_count = CASE WHEN j.status='QUEUED' OR j.worker_id IS NULL AND j.engine_job_id IS NULL THEN j.attempt_count+1 ELSE j.attempt_count END,
    status = CASE WHEN j.status='QUEUED' THEN 'PROCESSING' ELSE j.status END,
    started_at = coalesce(j.started_at, now())
  WHERE j.id IN (
    SELECT id FROM public.eip_jobs
    WHERE (status='QUEUED' OR (status IN ('PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING') AND worker_id IS NULL))
      AND attempt_count < _max_attempts
    ORDER BY created_at LIMIT _limit FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END $$;

-- Progress/terminal write for a job this worker holds.
CREATE OR REPLACE FUNCTION public.eip_worker_update(_token text, _worker text, _job uuid, _patch jsonb, _evaluation jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE terminal boolean := (_patch->>'status') IN ('PASS','LIMITED','FAIL','CANCELLED','SYSTEM_ERROR');
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  PERFORM set_config('eip.worker','on',true);
  UPDATE public.eip_jobs SET
    status = coalesce(_patch->>'status', status),
    current_stage = coalesce(_patch->>'current_stage', current_stage),
    engine_job_id = coalesce(engine_job_id, _patch->>'engine_job_id'),
    engine_version = coalesce(_patch->>'engine_version', engine_version),
    research_base_version = coalesce(_patch->>'research_base_version', research_base_version),
    config_sha256 = coalesce(_patch->>'config_sha256', config_sha256),
    evaluation_version = coalesce(_patch->>'evaluation_version', evaluation_version),
    protected_storage_path = coalesce(_patch->>'protected_storage_path', protected_storage_path),
    protected_sha256 = coalesce(_patch->>'protected_sha256', protected_sha256),
    certificate_id = coalesce(_patch->>'certificate_id', certificate_id),
    manifest = coalesce(_patch->'manifest', manifest),
    reason_codes = CASE WHEN _patch ? 'reason_codes' THEN ARRAY(SELECT jsonb_array_elements_text(_patch->'reason_codes')) ELSE reason_codes END,
    error_code = CASE WHEN _patch ? 'error_code' THEN _patch->>'error_code' ELSE error_code END,
    error_message = CASE WHEN _patch ? 'error_message' THEN _patch->>'error_message' ELSE error_message END,
    heartbeat_at = now(),
    completed_at = CASE WHEN terminal THEN now() ELSE completed_at END,
    worker_id = CASE WHEN terminal THEN NULL ELSE worker_id END
  WHERE id=_job AND worker_id=_worker;
  IF NOT FOUND THEN RAISE EXCEPTION 'job not held by this worker'; END IF;
  IF _evaluation IS NOT NULL THEN
    INSERT INTO public.eip_evaluations (job_id, evaluation_version, is_initial, status, visual_quality, transformation_robustness, identity_evaluation, reason_codes, duration_ms)
    VALUES (_job, _evaluation->>'evaluation_version', coalesce((_evaluation->>'is_initial')::boolean,true), _evaluation->>'status',
      _evaluation->>'visual_quality', _evaluation->>'transformation_robustness', _evaluation->>'identity_evaluation',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(_evaluation->'reason_codes','[]'))), (_evaluation->>'duration_ms')::int);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.eip_worker_claim_reevals(_token text, _worker text, _limit int, _stale_seconds int, _max_attempts int)
RETURNS TABLE (id uuid, job_id uuid, engine_evaluation_id text, protected_storage_path text, protected_sha256 text, engine_job_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.eip_reevaluation_requests SET status='SYSTEM_ERROR', error_code='ENGINE_TIMEOUT', worker_id=NULL
   WHERE status='PROCESSING' AND heartbeat_at < now()-make_interval(secs=>_stale_seconds) AND attempt_count >= _max_attempts;
  UPDATE public.eip_reevaluation_requests SET worker_id=NULL
   WHERE status='PROCESSING' AND heartbeat_at < now()-make_interval(secs=>_stale_seconds);
  RETURN QUERY
  WITH c AS (
    UPDATE public.eip_reevaluation_requests r SET worker_id=_worker, claimed_at=now(), heartbeat_at=now(), status='PROCESSING',
      attempt_count = CASE WHEN r.engine_evaluation_id IS NULL THEN r.attempt_count+1 ELSE r.attempt_count END
    WHERE r.id IN (SELECT x.id FROM public.eip_reevaluation_requests x
      WHERE (x.status='QUEUED' OR (x.status='PROCESSING' AND x.worker_id IS NULL)) AND x.attempt_count < _max_attempts
      ORDER BY x.created_at LIMIT _limit FOR UPDATE SKIP LOCKED)
    RETURNING r.id, r.job_id, r.engine_evaluation_id)
  SELECT c.id, c.job_id, c.engine_evaluation_id, j.protected_storage_path, j.protected_sha256, j.engine_job_id
  FROM c JOIN public.eip_jobs j ON j.id=c.job_id;
END $$;

CREATE OR REPLACE FUNCTION public.eip_worker_update_reeval(_token text, _worker text, _id uuid, _status text, _engine_evaluation_id text, _error_code text, _evaluation jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE jid uuid;
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  UPDATE public.eip_reevaluation_requests SET status=_status,
    engine_evaluation_id=coalesce(engine_evaluation_id,_engine_evaluation_id), error_code=_error_code, heartbeat_at=now(),
    worker_id = CASE WHEN _status IN ('DONE','SYSTEM_ERROR') THEN NULL ELSE worker_id END
  WHERE id=_id AND worker_id=_worker RETURNING job_id INTO jid;
  IF jid IS NULL THEN RAISE EXCEPTION 'request not held by this worker'; END IF;
  IF _evaluation IS NOT NULL THEN
    INSERT INTO public.eip_evaluations (job_id, evaluation_version, is_initial, status, visual_quality, transformation_robustness, identity_evaluation, reason_codes, duration_ms)
    VALUES (jid, _evaluation->>'evaluation_version', false, _evaluation->>'status', _evaluation->>'visual_quality',
      _evaluation->>'transformation_robustness', _evaluation->>'identity_evaluation',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(_evaluation->'reason_codes','[]'))), (_evaluation->>'duration_ms')::int);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.eip_worker_report(_token text, _status jsonb, _log jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _status IS NOT NULL THEN
    UPDATE public.eip_engine_status SET
      status=_status->>'status', engine_version=_status->>'engine_version',
      research_base_version=_status->>'research_base_version', config_sha256=_status->>'config_sha256',
      expected_engine_version=_status->>'expected_engine_version', models_loaded=(_status->>'models_loaded')::boolean,
      error_code=_status->>'error_code', last_checked_at=now(),
      last_ok_at = CASE WHEN _status->>'status'='OPERATIONAL' THEN now() ELSE last_ok_at END,
      worker_heartbeat_at=now()
    WHERE id=1;
  END IF;
  IF _log IS NOT NULL THEN
    INSERT INTO public.eip_ops_log (job_id, reevaluation_id, error_code, detail)
    VALUES ((_log->>'job_id')::uuid, (_log->>'reevaluation_id')::uuid, _log->>'error_code', left(_log->>'detail', 2000));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.eip_worker_claim(text,text,int,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eip_worker_update(text,text,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eip_worker_claim_reevals(text,text,int,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eip_worker_update_reeval(text,text,uuid,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eip_worker_report(text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eip_worker_claim(text,text,int,int,int) TO anon;
GRANT EXECUTE ON FUNCTION public.eip_worker_update(text,text,uuid,jsonb,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.eip_worker_claim_reevals(text,text,int,int,int) TO anon;
GRANT EXECUTE ON FUNCTION public.eip_worker_update_reeval(text,text,uuid,text,text,text,jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.eip_worker_report(text,jsonb,jsonb) TO anon;

-- Wake-on-enqueue: arm a per-minute poll only while EIP work is pending; the worker disarms it when drained.
CREATE OR REPLACE FUNCTION public.eip_arm_worker() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE url text := 'https://project--cee11c03-c063-46d5-9436-8e007b1b3e97.lovable.app/api/public/hooks/eip-worker';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='eterna-eip-worker') THEN
    PERFORM cron.schedule('eterna-eip-worker', '* * * * *', format($cmd$
      SELECT net.http_post(url := %L,
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT token FROM public.internal_cron_secrets WHERE name='eip_worker')),
        body := '{}'::jsonb)
    $cmd$, url));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.eip_arm_worker() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER eip_jobs_arm_worker AFTER INSERT OR UPDATE OF status ON public.eip_jobs
  FOR EACH ROW WHEN (NEW.status = 'QUEUED') EXECUTE FUNCTION public.eip_arm_worker();
CREATE TRIGGER eip_reevals_arm_worker AFTER INSERT ON public.eip_reevaluation_requests
  FOR EACH ROW EXECUTE FUNCTION public.eip_arm_worker();

CREATE OR REPLACE FUNCTION public.eip_worker_idle(_token text, _force boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.eip_worker_token_valid(_token) THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF _force OR (NOT EXISTS (SELECT 1 FROM public.eip_jobs WHERE status IN ('QUEUED','PROCESSING','VALIDATING','IMMUNIZING','EVALUATING','FINALIZING'))
     AND NOT EXISTS (SELECT 1 FROM public.eip_reevaluation_requests WHERE status IN ('QUEUED','PROCESSING'))) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='eterna-eip-worker') THEN PERFORM cron.unschedule('eterna-eip-worker'); END IF;
    RETURN true;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.eip_worker_idle(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eip_worker_idle(text,boolean) TO anon;