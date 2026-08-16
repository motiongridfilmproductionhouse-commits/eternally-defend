CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.internal_cron_secrets (
  name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_cron_secrets TO service_role;

ALTER TABLE public.internal_cron_secrets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_internal_cron_secrets_updated
BEFORE UPDATE ON public.internal_cron_secrets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

SELECT cron.unschedule('protection-autopilot-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'protection-autopilot-sweep');

SELECT cron.schedule(
  'protection-autopilot-sweep',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--cee11c03-c063-46d5-9436-8e007b1b3e97.lovable.app/api/public/hooks/protection-autopilot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT token FROM public.internal_cron_secrets WHERE name = 'protection_autopilot')
    ),
    body := jsonb_build_object('limit', 10)
  )
  WHERE EXISTS (SELECT 1 FROM public.internal_cron_secrets WHERE name = 'protection_autopilot');
  $$
);