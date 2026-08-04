-- Extend continuation lease TTL to match batch-worker ownership windows.

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
  v_lease timestamptz := v_now + INTERVAL '180 seconds';
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
