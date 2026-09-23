\pset tuples_only on
\pset format unaligned
\set VERBOSITY terse
-- ================= WORKER (anon + publishable key) =================
SET ROLE anon;
SELECT set_config('request.headers', '{}', false);
SELECT 'W01 anon, no token: scans visible = ' || count(*) || ' (expect 0)' FROM prospect_scans;
WITH u AS (UPDATE prospect_scans SET worker_lease_id='x' RETURNING 1) SELECT 'W02 anon, no token: scan updates = ' || count(*) || ' (expect 0)' FROM u;
SELECT set_config('request.headers', '{"x-prospect-worker-token":"wrong-token-wrong-token-wrong-token-00"}', false);
SELECT 'W03 anon, wrong token: scans visible = ' || count(*) || ' (expect 0)' FROM prospect_scans;
RESET ROLE;
SELECT set_config('qa.tok', (SELECT token FROM internal_cron_secrets WHERE name='prospect_scan_worker'), false);
SET ROLE anon;
SELECT 'W04 token valid (rpc) = ' || prospect_worker_token_valid(current_setting('qa.tok')) || ', wrong = ' || prospect_worker_token_valid('nope') || ' (expect t, f)';
SELECT set_config('request.headers', json_build_object('x-prospect-worker-token', current_setting('qa.tok'))::text, false);
SELECT 'W05 worker token: scans visible = ' || count(*) || ' (expect 1)' FROM prospect_scans;
SELECT 'W06 worker token: identity readable = ' || count(*) || ' (expect 1)' FROM prospect_identities;
WITH u AS (UPDATE prospect_scans SET worker_lease_until = now() + interval '30 seconds', worker_lease_id='lease1' WHERE id='20000000-0000-0000-0000-000000000001' AND (worker_lease_until IS NULL OR worker_lease_until < now()) RETURNING id) SELECT 'W07 worker lease claim = ' || count(*) || ' (expect 1)' FROM u;
INSERT INTO prospect_scan_events(scan_id,level,message,detail) VALUES ('20000000-0000-0000-0000-000000000001','info','PROVIDER_STARTED','{"type":"PROVIDER_STARTED"}');
SELECT 'W08 worker appended event = ' || count(*) || ' (expect 1)' FROM prospect_scan_events;
INSERT INTO prospect_discoveries(scan_id,prospect_id,original_url,canonical_url,family_key,discovery_method,identity_bucket,identity_confidence) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://b.test/','b.test/','web','WEB_SEARCH','UNRELATED',5);
INSERT INTO prospect_scan_sources(scan_id,family_key,family_label,state) VALUES ('20000000-0000-0000-0000-000000000001','web','Web','scanning') ON CONFLICT DO NOTHING;
INSERT INTO prospect_risk_scores(scan_id,score_kind,model_version,band) VALUES ('20000000-0000-0000-0000-000000000001','PRELIMINARY_EXPOSURE','v1','LOW');
SELECT 'W09 worker wrote discovery/source/score: ' || (SELECT count(*) FROM prospect_discoveries) || '/' || (SELECT count(*) FROM prospect_scan_sources) || '/' || (SELECT count(*) FROM prospect_risk_scores) || ' (expect 3/1/1)';
WITH u AS (UPDATE prospect_scans SET status='completed', worker_lease_until=null, worker_lease_id=null WHERE id='20000000-0000-0000-0000-000000000001' RETURNING 1) SELECT 'W10 worker finalize/release lease = ' || count(*) || ' (expect 1)' FROM u;
UPDATE prospect_findings SET state='VERIFIED', verified_by=null WHERE id='40000000-0000-0000-0000-000000000002';
SELECT 'W11 ^ worker cannot fake a human verification (expect ERROR above)';
SELECT 'W12 worker secrets read: ' || count(*) FROM internal_cron_secrets;
SELECT 'W13 worker reads packages = ' || count(*) || ', client findings = ' || (SELECT count(*) FROM client_prospect_findings) || ' (expect errors or 0)' FROM prospect_enrollment_packages;
SELECT 'W14 worker reads staff decisions: ' || count(*) FROM prospect_staff_decisions;
RESET ROLE;
-- ================= CLIENTS (authenticated) =================
SET ROLE authenticated;
SELECT set_config('request.headers', '{}', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
SELECT 'C01 stranger claims = ' || count(*) || ' (expect 0)' FROM prospect_claim_my_packages();
SELECT 'C02 stranger mark prefilled = ' || prospect_mark_my_package_prefilled('60000000-0000-0000-0000-000000000001') || ' (expect f)';
SELECT 'C03 stranger imports = ' || prospect_import_my_findings() || ' (expect 0)';
SELECT 'C04 stranger sees prospect scans = ' || count(*) || ' (expect 0)' FROM prospect_scans;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
SELECT 'C05 client claims via redeemed invite = ' || count(*) || ' (expect 1)' FROM prospect_claim_my_packages();
SELECT 'C06 client import #1 = ' || prospect_import_my_findings() || ' (expect 1: only VERIFIED + MATCHED)';
SELECT 'C07 client import #2 = ' || prospect_import_my_findings() || ' (expect 0: idempotent)';
SELECT 'C08 client sees own imported findings = ' || count(*) || ', evidence refs = ' || coalesce(max(jsonb_array_length(evidence_refs)),0) || ', scan = ' || max(prospect_scan_id::text) || ' (expect 1, 1, 2000…1)' FROM client_prospect_findings;
SELECT 'C09 client mark prefilled = ' || prospect_mark_my_package_prefilled('60000000-0000-0000-0000-000000000001') || ' (expect t)';
SELECT 'C10 client reads own package status = ' || status || ', imported = ' || findings_imported FROM prospect_enrollment_packages;
SELECT 'C11 client still cannot read prospect scans/findings = ' || (SELECT count(*) FROM prospect_scans) || '/' || (SELECT count(*) FROM prospect_findings) || ' (expect 0/0)';
SELECT prospect_import_package_findings('60000000-0000-0000-0000-000000000001');
SELECT 'C12 ^ client cannot call staff import (expect ERROR above)';
SELECT _prospect_import_package_findings('60000000-0000-0000-0000-000000000001');
SELECT 'C13 ^ internal import not callable (expect ERROR above)';
INSERT INTO client_prospect_findings(package_id,client_user_id,prospect_scan_id,prospect_finding_id,stage_key,category,detection_reason,source_url,finding_state) VALUES ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','x','x','x','x','VERIFIED');
SELECT 'C14 ^ client cannot insert findings directly (expect ERROR above)';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
SELECT 'C15 stranger sees client findings/package = ' || (SELECT count(*) FROM client_prospect_findings) || '/' || (SELECT count(*) FROM prospect_enrollment_packages) || ' (expect 0/0)';
-- ================= STAFF =================
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
SELECT 'S01 staff sees scans = ' || count(*) || ' (expect 1)' FROM prospect_scans;
SELECT prospect_link_package_to_client_email('60000000-0000-0000-0000-000000000001','client@x.test');
SELECT 'S02 ^ non-admin staff cannot link by email (expect ERROR above)';
SELECT 'S03 staff import for linked package = ' || prospect_import_package_findings('60000000-0000-0000-0000-000000000001') || ' (expect 0: already imported)';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
SELECT 'S04 admin link same client (case-insensitive) = ' || prospect_link_package_to_client_email('60000000-0000-0000-0000-000000000001','CLIENT@x.test') || ' (expect …000c)';
SELECT prospect_link_package_to_client_email('60000000-0000-0000-0000-000000000001','stranger@x.test');
SELECT 'S05 ^ package cannot be re-pointed to another client (expect ERROR above)';
SELECT 'S06 admin link unknown email = ' || coalesce(prospect_link_package_to_client_email('60000000-0000-0000-0000-000000000001','nobody@x.test')::text,'NULL') || ' (expect NULL)';
RESET ROLE;
SELECT 'Z01 transfers linked to client = ' || count(*) || ' of 2 (identity + imported finding)' FROM prospect_enrollment_transfers WHERE target_user_id='00000000-0000-0000-0000-00000000000c';
SELECT 'Z02 enforcement_eligible can never be true: ' || (SELECT count(*) FROM client_prospect_findings WHERE enforcement_eligible);
