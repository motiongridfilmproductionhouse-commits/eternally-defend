\pset tuples_only on
\pset format unaligned
INSERT INTO auth.users VALUES
 ('00000000-0000-0000-0000-00000000000a','staff@x.test'),
 ('00000000-0000-0000-0000-00000000000b','admin@x.test'),
 ('00000000-0000-0000-0000-00000000000c','client@x.test'),
 ('00000000-0000-0000-0000-00000000000d','stranger@x.test');
INSERT INTO public.user_roles(user_id, role) VALUES
 ('00000000-0000-0000-0000-00000000000a','staff'),
 ('00000000-0000-0000-0000-00000000000b','staff'),
 ('00000000-0000-0000-0000-00000000000b','admin');
INSERT INTO public.client_profiles(user_id,email,display_name) VALUES
 ('00000000-0000-0000-0000-00000000000c','Client@X.test','Typed by client'),
 ('00000000-0000-0000-0000-00000000000d','stranger@x.test',null);
INSERT INTO public.prospect_identities(id,display_name,normalized_name,created_by) VALUES
 ('10000000-0000-0000-0000-000000000001','Asha Menon','asha menon','00000000-0000-0000-0000-00000000000a');
INSERT INTO public.prospect_scans(id,prospect_id,status,created_by,source_family_set_version,classification_version) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','running','00000000-0000-0000-0000-00000000000a','v1','v1');
SELECT 'T01 scan insert kicks worker (Bearer = managed token): ' ||
  (SELECT count(*) FROM net.calls WHERE url LIKE '%/api/public/hooks/prospect-scan-worker'
     AND headers->>'Authorization' = 'Bearer ' || (SELECT token FROM internal_cron_secrets WHERE name='prospect_scan_worker')
     AND body->>'scan_id' = '20000000-0000-0000-0000-000000000001')::text || ' (expect 1)';
SELECT 'T02 cron job scheduled: ' || count(*) || ' (expect 1)' FROM cron.job WHERE jobname='eterna-prospect-scan-worker' AND schedule='* * * * *';
INSERT INTO public.prospect_discoveries(id,scan_id,prospect_id,original_url,canonical_url,family_key,discovery_method,identity_bucket,identity_confidence) VALUES
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://a.test/1','a.test/1','web','WEB_SEARCH','MATCHED',90),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','https://a.test/2','a.test/2','web','WEB_SEARCH','POSSIBLE_MATCH',50);
INSERT INTO public.prospect_findings(id,scan_id,prospect_id,discovery_id,stage_key,category,detection_reason,classification_version,state) VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','impersonation','Possible impersonation','r','v1','NEEDS_HUMAN_REVIEW'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','harmful_content','Potential reputation risk','r','v1','NEEDS_HUMAN_REVIEW');
INSERT INTO public.prospect_staff_decisions(scan_id,finding_id,actor_id,action,previous_state,new_state) VALUES
 ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','VERIFY','NEEDS_HUMAN_REVIEW','VERIFIED'),
 ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','VERIFY','NEEDS_HUMAN_REVIEW','VERIFIED');
UPDATE public.prospect_findings SET state='VERIFIED', verified_by='00000000-0000-0000-0000-00000000000a', verified_at=now();
INSERT INTO public.prospect_finding_evidence(finding_id,scan_id,source_url,content_hash) VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','https://a.test/1','hash1');
INSERT INTO public.prospect_enrollment_transfers(scan_id,prospect_id,finding_id,target_table,transferred_by) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,'enrollment_identity','00000000-0000-0000-0000-00000000000a'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','enrollment_finding','00000000-0000-0000-0000-00000000000a'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','enrollment_finding','00000000-0000-0000-0000-00000000000a');
INSERT INTO public.signup_invites(id,code_hash,created_by) VALUES ('50000000-0000-0000-0000-000000000001','h','00000000-0000-0000-0000-00000000000b');
INSERT INTO public.prospect_enrollment_packages(id,scan_id,prospect_id,identity_snapshot,invite_id,created_by) VALUES
 ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','{"display_name":"Asha Menon"}','50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a');
INSERT INTO public.signup_invite_redemptions(invite_id,user_id,email) VALUES ('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c','client@x.test');
