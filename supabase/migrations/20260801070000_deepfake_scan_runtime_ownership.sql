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

-- 2) Ensure status accepts application terminal values including 'partial'.
-- Base schema is unconstrained TEXT (already accepts 'partial'). When every
-- existing row already uses a known status, attach an explicit CHECK so future
-- writes remain limited to the production status set.
DO $$
DECLARE
  unknown_status_count integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO unknown_status_count
  FROM public.deepfake_scans
  WHERE status IS NOT NULL
    AND status NOT IN ('running', 'completed', 'failed', 'partial');

  IF unknown_status_count = 0 THEN
    ALTER TABLE public.deepfake_scans
      DROP CONSTRAINT IF EXISTS deepfake_scans_status_check;

    ALTER TABLE public.deepfake_scans
      ADD CONSTRAINT deepfake_scans_status_check
      CHECK (status IN ('running', 'completed', 'failed', 'partial'));
  ELSE
    RAISE NOTICE
      'deepfake_scans_status_check skipped: % row(s) use statuses outside (running, completed, failed, partial)',
      unknown_status_count;
  END IF;
END $$;

-- 3) Safe one-time recovery for permanently RUNNING production rows that
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

-- 4) Before creating the unique active-scan index, fail all but one
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

-- 5) Partial unique index: only one active RUNNING scan per identity.
-- Target normalization matches application code: lower(btrim(target_name)).
-- Internal whitespace is intentionally preserved.
CREATE UNIQUE INDEX IF NOT EXISTS deepfake_scans_one_active_per_target
  ON public.deepfake_scans (
    user_id,
    (COALESCE(profile_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (lower(btrim(target_name)))
  )
  WHERE status = 'running';

-- 6) Defense in depth: terminal scans must never return to RUNNING.
-- Exact production terminal values written by application code:
-- completed | failed | partial
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

-- 7) Discoveries unique page index:
--    a) detect duplicates by (scan_id, page_url) for non-null/non-empty page_url
--    b) keep the best/newest row with deterministic ordering
--    c) delete only redundant duplicates
--    d) create unique index (idempotent via IF NOT EXISTS)
-- NULL/empty page_url rows are intentionally left alone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'deepfake_discoveries'
  ) THEN
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY scan_id, page_url
          ORDER BY
            (
              CASE
                WHEN analysis_status = 'url_verified' THEN 4
                WHEN nullif(btrim(COALESCE(analysis_status, '')), '') IS NOT NULL THEN 1
                ELSE 0
              END
              + CASE WHEN nullif(btrim(COALESCE(canonical_url, '')), '') IS NOT NULL THEN 2 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(page_title, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(snippet, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(image_url, '')), '') IS NOT NULL THEN 2 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(thumbnail_url, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(source_host, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(media_type, '')), '') IS NOT NULL THEN 1 ELSE 0 END
              + CASE WHEN nullif(btrim(COALESCE(search_query, '')), '') IS NOT NULL THEN 1 ELSE 0 END
            ) DESC,
            COALESCE(updated_at, discovered_at) DESC NULLS LAST,
            discovered_at DESC NULLS LAST,
            id DESC
        ) AS rn
      FROM public.deepfake_discoveries
      WHERE page_url IS NOT NULL
        AND btrim(page_url) <> ''
    )
    DELETE FROM public.deepfake_discoveries AS discoveries
    USING ranked
    WHERE discoveries.id = ranked.id
      AND ranked.rn > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS deepfake_discoveries_unique_page
      ON public.deepfake_discoveries (scan_id, page_url);
  END IF;
END $$;
