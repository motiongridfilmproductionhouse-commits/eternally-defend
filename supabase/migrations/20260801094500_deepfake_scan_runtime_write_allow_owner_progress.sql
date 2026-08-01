-- Allow the owning authenticated session to heartbeat / finalize its own
-- RUNNING scan (token unchanged or cleared on terminal). Preserve:
--   - completed/failed never revive
--   - partial → running only via acquire_deepfake_scan_continuation
--   - clients still cannot freely rewrite another invocation's token

CREATE OR REPLACE FUNCTION public.deepfake_scans_protect_runtime_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.deepfake_allow_partial_continue', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND auth.uid() IS NOT NULL THEN
    /*
     * Owner progress while RUNNING with the same ownership token
     * (heartbeats, metrics, checkpoints).
     */
    IF OLD.status = 'running'
       AND NEW.status = 'running'
       AND NEW.scan_run_token IS NOT NULL
       AND NEW.scan_run_token IS NOT DISTINCT FROM OLD.scan_run_token THEN
      RETURN NEW;
    END IF;

    /*
     * Owner terminal finalize: clear token and leave RUNNING.
     * Application WHERE clause still matches the owning token.
     */
    IF OLD.status = 'running'
       AND NEW.status IN ('completed', 'partial', 'failed')
       AND OLD.scan_run_token IS NOT NULL
       AND NEW.scan_run_token IS NULL THEN
      RETURN NEW;
    END IF;

    /*
     * Stale lease recovery: RUNNING → failed after lease expiry.
     */
    IF OLD.status = 'running'
       AND NEW.status = 'failed'
       AND NEW.scan_run_token IS NULL
       AND OLD.lease_expires_at IS NOT NULL
       AND OLD.lease_expires_at < NOW() THEN
      RETURN NEW;
    END IF;

    IF NEW.scan_checkpoint IS DISTINCT FROM OLD.scan_checkpoint
       OR NEW.scan_run_token IS DISTINCT FROM OLD.scan_run_token
       OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
       OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at
       OR NEW.discovery_metrics IS DISTINCT FROM OLD.discovery_metrics
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at
       OR NEW.error_message IS DISTINCT FROM OLD.error_message THEN
      RAISE EXCEPTION
        'deepfake_scans: runtime fields are server-managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
