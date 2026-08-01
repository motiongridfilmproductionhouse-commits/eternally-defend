-- Deepfake Intelligence production hotfix:
-- scan ownership tokens, heartbeat leases, stale recovery, and
-- one-active-scan-per-identity uniqueness.

-- 1) Ownership + lease columns
ALTER TABLE public.deepfake_scans
  ADD COLUMN IF NOT EXISTS scan_run_token UUID NULL,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.deepfake_scans.scan_run_token IS
  'Unique token for the currently executing scan invocation. Cleared on terminal status.';
COMMENT ON COLUMN public.deepfake_scans.heartbeat_at IS
  'Last progress heartbeat from the owning scan invocation.';
COMMENT ON COLUMN public.deepfake_scans.lease_expires_at IS
  'Exclusive ownership lease expiry. Stale recovery only acts after this timestamp.';

-- 2) Safe one-time recovery for permanently RUNNING production rows that
-- pre-date lease tracking. Do NOT use started_at for ongoing recovery —
-- this bootstrap only marks pre-lease stuck rows so new scans can start.
UPDATE public.deepfake_scans
SET
  status = 'failed',
  scan_run_token = NULL,
  finished_at = COALESCE(finished_at, NOW()),
  lease_expires_at = NULL,
  error_message = COALESCE(
    NULLIF(error_message, ''),
    'Recovered stuck RUNNING scan during ownership/lease migration.'
  )
WHERE status = 'running'
  AND lease_expires_at IS NULL
  AND heartbeat_at IS NULL
  AND scan_run_token IS NULL
  AND started_at < NOW() - INTERVAL '2 minutes';

-- 3) Before creating the unique active-scan index, fail all but one
-- RUNNING row per exact future index key:
--   (user_id, COALESCE(profile_id, sentinel), lower(btrim(target_name)))
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        user_id,
        COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(btrim(target_name))
      ORDER BY
        COALESCE(heartbeat_at, started_at, created_at) DESC NULLS LAST,
        created_at DESC,
        id DESC
    ) AS rn
  FROM public.deepfake_scans
  WHERE status = 'running'
)
UPDATE public.deepfake_scans AS scans
SET
  status = 'failed',
  scan_run_token = NULL,
  finished_at = COALESCE(scans.finished_at, NOW()),
  lease_expires_at = NULL,
  error_message = COALESCE(
    NULLIF(scans.error_message, ''),
    'Superseded duplicate RUNNING scan before unique active-scan index.'
  )
FROM ranked
WHERE scans.id = ranked.id
  AND ranked.rn > 1;

-- 4) Partial unique index: only one active RUNNING scan per identity.
-- Target normalization matches application code: lower(btrim(target_name)).
-- Internal whitespace is intentionally preserved.
CREATE UNIQUE INDEX IF NOT EXISTS deepfake_scans_one_active_per_target
  ON public.deepfake_scans (
    user_id,
    (COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(btrim(target_name)))
  )
  WHERE status = 'running';

-- 5) Defense in depth: terminal scans must never return to RUNNING.
CREATE OR REPLACE FUNCTION public.deepfake_scans_prevent_terminal_revive()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed', 'partial')
     AND NEW.status = 'running' THEN
    RAISE EXCEPTION
      'deepfake_scans: terminal status % cannot transition back to running',
      OLD.status
      USING ERRCODE = 'check_violation';
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

CREATE INDEX IF NOT EXISTS deepfake_scans_lease_recovery_idx
  ON public.deepfake_scans (lease_expires_at)
  WHERE status = 'running' AND lease_expires_at IS NOT NULL;

-- 6) Ensure discoveries batch upserts are idempotent across retries/batches.
-- Table already exists in production; guard for environments missing it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'deepfake_discoveries'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS deepfake_discoveries_unique_page
      ON public.deepfake_discoveries (scan_id, page_url);
  END IF;
END $$;
