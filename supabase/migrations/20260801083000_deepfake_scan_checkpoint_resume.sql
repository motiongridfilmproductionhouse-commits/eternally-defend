-- Deepfake Intelligence: resumable scan checkpoints + allow PARTIAL → RUNNING.

-- 1) Durable checkpoint for interleaved discovery/verification resume.
ALTER TABLE public.deepfake_scans
  ADD COLUMN IF NOT EXISTS scan_checkpoint JSONB NULL;

COMMENT ON COLUMN public.deepfake_scans.scan_checkpoint IS
  'Resumable scan checkpoint: next_query_index, completed queries, pending/verified URLs, stage, and budget metadata.';

-- 2) Allow Continue scan to revive only PARTIAL → RUNNING.
-- completed/failed still cannot return to RUNNING.
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

  /*
   * PARTIAL → RUNNING is allowed for ownership-safe Continue scan.
   * Application code must issue a fresh scan_run_token when doing so.
   */
  RETURN NEW;
END;
$$;
