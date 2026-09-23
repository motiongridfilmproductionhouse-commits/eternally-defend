-- Pre-Enrollment Intelligence — route the prospect scan worker to production.
--
-- Earlier migrations pointed both the minute-by-minute safety-net job
-- (`eterna-prospect-scan-worker`, 20260924091000) and the scan-insert kick
-- (prospect_scans_dispatch_worker, 20260924120000) at the old Lovable preview
-- origin. Production is https://eternasentinel.com.
--
-- This forward migration:
--   * defines the worker URL in exactly one place (prospect_worker_hook_url),
--   * reschedules `eterna-prospect-scan-worker` against that URL,
--   * recreates the scan-insert trigger function to use the same URL.
--
-- The managed `prospect_scan_worker` token in internal_cron_secrets is kept
-- as-is (never regenerated, never selected into any client-visible result):
-- pg_cron / pg_net read it inside the database and send it only in the
-- server-to-server Authorization header. No service-role credential is used.

-- 1. Single source of truth for the worker endpoint.
CREATE OR REPLACE FUNCTION public.prospect_worker_hook_url()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'https://eternasentinel.com/api/public/hooks/prospect-scan-worker'::text;
$$;
REVOKE ALL ON FUNCTION public.prospect_worker_hook_url() FROM PUBLIC, anon, authenticated;

-- 2. Keep the existing managed token; only create it if it is somehow missing.
INSERT INTO public.internal_cron_secrets (name, token)
VALUES (
  'prospect_scan_worker',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (name) DO NOTHING;

-- 3. Reschedule the safety-net job against production. It only fires while a
--    scan is queued or running, so it also picks up scans that were created
--    while the worker was unreachable (they are resumed, not re-created).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eterna-prospect-scan-worker') THEN
    PERFORM cron.unschedule('eterna-prospect-scan-worker');
  END IF;

  PERFORM cron.schedule(
    'eterna-prospect-scan-worker',
    '* * * * *',
    $cmd$
      SELECT net.http_post(
        url := public.prospect_worker_hook_url(),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT token FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker')
        ),
        body := '{}'::jsonb
      )
      WHERE EXISTS (SELECT 1 FROM public.prospect_scans WHERE status IN ('queued', 'running'))
        AND EXISTS (SELECT 1 FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker');
    $cmd$
  );
END $$;

-- 4. Immediate kick on scan creation, same production endpoint.
CREATE OR REPLACE FUNCTION public.prospect_scans_dispatch_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tok text;
BEGIN
  SELECT token INTO tok FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker';
  IF tok IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := public.prospect_worker_hook_url(),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || tok
        ),
        body := jsonb_build_object('scan_id', NEW.id, 'hop', 0)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never block scan creation; the cron job resumes the scan within a minute.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prospect_scans_dispatch_worker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prospect_scans_dispatch_worker ON public.prospect_scans;
CREATE TRIGGER trg_prospect_scans_dispatch_worker
  AFTER INSERT ON public.prospect_scans
  FOR EACH ROW EXECUTE FUNCTION public.prospect_scans_dispatch_worker();
