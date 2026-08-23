-- Managed scheduling for privileged protection jobs.
-- Tokens are generated inside the database and read server-side only by
-- pg_net when it calls the Lovable-hosted origin; they are never exposed to
-- clients, and they are NOT the Supabase service-role credential.

INSERT INTO public.internal_cron_secrets (name, token)
SELECT j.name, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
FROM (VALUES
  ('scan_orchestrator'),
  ('enforcement_worker'),
  ('channel_watch_poll'),
  ('distribution_monitor'),
  ('release_protection_monitor')
) AS j(name)
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  base text := 'https://project--cee11c03-c063-46d5-9436-8e007b1b3e97.lovable.app/api/public/hooks/';
  j record;
BEGIN
  FOR j IN SELECT * FROM (VALUES
      ('scan-orchestrator',           'scan_orchestrator',           '*/15 * * * *'),
      ('channel-watch-poll',          'channel_watch_poll',          '*/15 * * * *'),
      ('distribution-monitor',        'distribution_monitor',        '*/30 * * * *'),
      ('release-protection-monitor',  'release_protection_monitor',  '20 * * * *'),
      ('enforcement-worker',          'enforcement_worker',          '40 * * * *')
    ) AS t(hook, secret_name, schedule)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'eterna-' || j.hook) THEN
      PERFORM cron.unschedule('eterna-' || j.hook);
    END IF;

    PERFORM cron.schedule(
      'eterna-' || j.hook,
      j.schedule,
      format($cmd$
        SELECT net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT token FROM public.internal_cron_secrets WHERE name = %L)
          ),
          body := '{}'::jsonb
        )
        WHERE EXISTS (SELECT 1 FROM public.internal_cron_secrets WHERE name = %L);
      $cmd$, base || j.hook, j.secret_name, j.secret_name)
    );
  END LOOP;
END $$;