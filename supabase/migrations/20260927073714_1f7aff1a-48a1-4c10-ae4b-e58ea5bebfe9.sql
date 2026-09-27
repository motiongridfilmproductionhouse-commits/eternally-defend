-- lovable-cron-fallback-reviewed: safety net for lost self-chained scan steps; only posts while a prospect scan is queued/running; primary wake is the insert trigger.
INSERT INTO public.internal_cron_secrets (name, token)
VALUES (
  'prospect_scan_worker',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
ON CONFLICT (name) DO NOTHING;

CREATE INDEX IF NOT EXISTS prospect_scans_active_idx
  ON public.prospect_scans (created_at)
  WHERE status IN ('queued', 'running');

DO $$
DECLARE
  url text := 'https://project--cee11c03-c063-46d5-9436-8e007b1b3e97.lovable.app/api/public/hooks/prospect-scan-worker';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eterna-prospect-scan-worker') THEN
    PERFORM cron.unschedule('eterna-prospect-scan-worker');
  END IF;

  PERFORM cron.schedule(
    'eterna-prospect-scan-worker',
    '* * * * *',
    format($cmd$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT token FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker')
        ),
        body := '{}'::jsonb
      )
      WHERE EXISTS (SELECT 1 FROM public.prospect_scans WHERE status IN ('queued', 'running'))
        AND EXISTS (SELECT 1 FROM public.internal_cron_secrets WHERE name = 'prospect_scan_worker');
    $cmd$, url)
  );
END $$;