CREATE OR REPLACE FUNCTION public.deepfake_scans_protect_runtime_fields()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN NEW; END IF;
  IF current_setting('app.deepfake_allow_partial_continue', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    IF OLD.status = 'running' AND NEW.status = 'running' AND NEW.scan_run_token IS NOT NULL
       AND NEW.scan_run_token IS NOT DISTINCT FROM OLD.scan_run_token THEN RETURN NEW; END IF;
    IF OLD.status = 'running' AND NEW.status IN ('completed','partial','failed')
       AND OLD.scan_run_token IS NOT NULL AND NEW.scan_run_token IS NULL THEN RETURN NEW; END IF;
    -- Stale recovery: expired lease, or no lease and no heartbeat for 10+ minutes
    IF OLD.status = 'running' AND NEW.status = 'failed' AND NEW.scan_run_token IS NULL
       AND (
         (OLD.lease_expires_at IS NOT NULL AND OLD.lease_expires_at < NOW())
         OR (OLD.lease_expires_at IS NULL AND coalesce(OLD.heartbeat_at, OLD.created_at) < NOW() - interval '10 minutes')
       ) THEN RETURN NEW; END IF;
    IF NEW.scan_checkpoint IS DISTINCT FROM OLD.scan_checkpoint
       OR NEW.scan_run_token IS DISTINCT FROM OLD.scan_run_token
       OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
       OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at
       OR NEW.discovery_metrics IS DISTINCT FROM OLD.discovery_metrics
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
       OR NEW.error_message IS DISTINCT FROM OLD.error_message THEN
      RAISE EXCEPTION 'deepfake_scans: runtime fields are server-managed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.deepfake_scans
SET status = 'failed', scan_run_token = NULL, finished_at = now(),
    error_message = 'Scan abandoned (no heartbeat)'
WHERE status = 'running'
  AND coalesce(lease_expires_at, heartbeat_at, created_at) < now() - interval '1 hour';