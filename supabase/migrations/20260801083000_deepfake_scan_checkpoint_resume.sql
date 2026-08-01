-- Deepfake Intelligence: resumable scan checkpoints + controlled PARTIAL → RUNNING.
-- Requires 20260801070000_deepfake_scan_runtime_ownership.sql.

-- 1) Durable checkpoint for interleaved discovery/verification resume.
ALTER TABLE public.deepfake_scans
  ADD COLUMN IF NOT EXISTS scan_checkpoint JSONB NULL;

COMMENT ON COLUMN public.deepfake_scans.scan_checkpoint IS
  'Server-managed resumable checkpoint: next_query_index, completed queries, pending/verified URLs, stage, and budget metadata.';

-- Bound JSONB growth (256 KiB). Oversized checkpoints are rejected at write time.
ALTER TABLE public.deepfake_scans
  DROP CONSTRAINT IF EXISTS deepfake_scans_checkpoint_size_check;

ALTER TABLE public.deepfake_scans
  ADD CONSTRAINT deepfake_scans_checkpoint_size_check
  CHECK (
    scan_checkpoint IS NULL
    OR pg_column_size(scan_checkpoint) <= 262144
  );

-- 2) Terminal revive rules:
--    - completed / failed → running: never
--    - partial → running: only when app.deepfake_allow_partial_continue = on
--      (set by acquire_deepfake_scan_continuation) with a fresh ownership token + lease
CREATE OR REPLACE FUNCTION public.deepfake_scans_prevent_terminal_revive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed')
     AND NEW.status = 'running' THEN
    RAISE EXCEPTION
      'deepfake_scans: terminal status % cannot transition back to running',
      OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'partial' AND NEW.status = 'running' THEN
    IF current_setting('app.deepfake_allow_partial_continue', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'deepfake_scans: partial → running is only allowed through continue_scan'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.scan_run_token IS NULL
       OR NEW.scan_run_token IS NOT DISTINCT FROM OLD.scan_run_token
       OR NEW.lease_expires_at IS NULL
       OR NEW.lease_expires_at <= NOW()
       OR NEW.finished_at IS NOT NULL THEN
      RAISE EXCEPTION
        'deepfake_scans: partial → running requires a fresh scan_run_token and active lease'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deepfake_scans_prevent_terminal_revive
  ON public.deepfake_scans;

CREATE TRIGGER deepfake_scans_prevent_terminal_revive
  BEFORE UPDATE OF status ON public.deepfake_scans
  FOR EACH ROW
  EXECUTE FUNCTION public.deepfake_scans_prevent_terminal_revive();

-- 3) Runtime ownership / checkpoint fields are server-managed.
-- Authenticated clients cannot inject checkpoint URLs, tokens, status, or leases.
-- service_role (pipeline heartbeats) and the continue RPC (session GUC) may write them.
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

DROP TRIGGER IF EXISTS deepfake_scans_protect_runtime_fields
  ON public.deepfake_scans;

CREATE TRIGGER deepfake_scans_protect_runtime_fields
  BEFORE UPDATE ON public.deepfake_scans
  FOR EACH ROW
  EXECUTE FUNCTION public.deepfake_scans_protect_runtime_fields();

-- 4) Controlled Continue: atomic PARTIAL → RUNNING with a fresh ownership token.
CREATE OR REPLACE FUNCTION public.acquire_deepfake_scan_continuation(p_scan_id uuid)
RETURNS TABLE (
  scan_id uuid,
  scan_run_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_token uuid := gen_random_uuid();
  v_now timestamptz := NOW();
  v_lease timestamptz := v_now + INTERVAL '90 seconds';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.deepfake_allow_partial_continue', 'on', true);

  RETURN QUERY
  UPDATE public.deepfake_scans AS scans
  SET
    status = 'running',
    scan_run_token = v_token,
    heartbeat_at = v_now,
    lease_expires_at = v_lease,
    finished_at = NULL,
    error_message = NULL
  WHERE scans.id = p_scan_id
    AND scans.user_id = v_user_id
    AND scans.status = 'partial'
  RETURNING
    scans.id,
    scans.scan_run_token,
    scans.lease_expires_at,
    scans.heartbeat_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unable to acquire scan continuation lease'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_deepfake_scan_continuation(uuid) TO service_role;
