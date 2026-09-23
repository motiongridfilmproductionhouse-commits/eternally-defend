-- Production routing + existing-scan recovery checks. Run on a database where
-- every prospect migration EXCEPT 20260924121000 is applied and the fixtures
-- below exist; run.sh then applies 20260924121000 twice (idempotency).
\pset tuples_only on
\pset format unaligned
SELECT 'M01 token preserved: ' || ((SELECT token FROM internal_cron_secrets WHERE name='prospect_scan_worker') = (SELECT token FROM qa_before)) || ' (expect true)';
SELECT 'M02 cron jobs named eterna-prospect-scan-worker: ' || count(*) || ', schedule ' || max(schedule) || ' (expect 1, * * * * *)' FROM cron.job WHERE jobname='eterna-prospect-scan-worker';
SELECT 'M03 cron command free of old origin: ' || (command NOT LIKE '%lovable.app%') || ' (expect true)' FROM cron.job WHERE jobname='eterna-prospect-scan-worker';
SELECT 'M04 worker URL: ' || public.prospect_worker_hook_url();
TRUNCATE net.calls;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname='eterna-prospect-scan-worker'); END $$;
SELECT 'M05 cron tick -> ' || url || ' | bearer = managed token: ' || (headers->>'Authorization' = 'Bearer ' || (SELECT token FROM qa_before)) FROM net.calls ORDER BY id DESC LIMIT 1;
TRUNCATE net.calls;
INSERT INTO public.prospect_scans(id,prospect_id,status,created_by,source_family_set_version,classification_version) VALUES ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','queued','00000000-0000-0000-0000-0000000000aa','v1','v1');
SELECT 'M06 scan-insert kick -> ' || url || ' | scan_id ok: ' || (body->>'scan_id' = '20000000-0000-0000-0000-000000000009') FROM net.calls;
DELETE FROM public.prospect_scans WHERE id='20000000-0000-0000-0000-000000000009';
SELECT 'M07 URL helper callable by client roles: anon=' || has_function_privilege('anon','public.prospect_worker_hook_url()','EXECUTE') || ' authenticated=' || has_function_privilege('authenticated','public.prospect_worker_hook_url()','EXECUTE') || ' (expect false/false)';
SELECT set_config('qa.tok', (SELECT token FROM internal_cron_secrets WHERE name='prospect_scan_worker'), false) IS NOT NULL;
SET ROLE anon;
SELECT set_config('request.headers', json_build_object('x-prospect-worker-token', current_setting('qa.tok'))::text, false) IS NOT NULL;
SELECT 'M08 worker sees existing queued scan 5b9538c4: ' || count(*) || ' (expect 1)' FROM prospect_scans WHERE id='5b9538c4-582e-4d06-8e9e-102f6fb3fa44' AND status='queued';
WITH u AS (UPDATE prospect_scans SET worker_lease_until = now() + interval '30 seconds', worker_lease_id='l' WHERE id='5b9538c4-582e-4d06-8e9e-102f6fb3fa44' AND status IN ('queued','running') AND (worker_lease_until IS NULL OR worker_lease_until < now()) RETURNING 1) SELECT 'M09 worker can lease it: ' || count(*) || ' (expect 1)' FROM u;
RESET ROLE;
SELECT 'M10 scans for Tini Tom (no duplicate created): ' || count(*) || ' (expect 1)' FROM prospect_scans s JOIN prospect_identities i ON i.id=s.prospect_id WHERE i.display_name='Tini Tom';
