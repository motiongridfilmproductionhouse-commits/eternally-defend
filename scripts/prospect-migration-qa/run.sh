#!/usr/bin/env bash
# Applies the prospect migrations to a throwaway local Postgres (>=14) with a
# minimal Supabase-like prelude (roles, auth.uid(), cron/net stubs) and runs
# the access-control and production-routing checks. Every line ends with its
# expected value in parentheses.
#   PSQL="psql -d postgres" ./scripts/prospect-migration-qa/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PSQL=${PSQL:-"psql -d postgres"}
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
DB=${QA_DB:-eterna_prospect_qa}
MIGS=(
  20260923081200_5f17ccfa-5be8-4a8c-b2e1-e7b61ee3d9f1
  20260923081345_7813994e-e772-421b-b5dd-758e7b6fe5c0
  20260923081448_df44a44c-d529-4e96-9872-caa6ac66aaef
  20260923083240_6db0781d-a99f-4877-ad7f-b48f160e68e7
  20260923100000_prospect_runner_hardening
  20260924090000_prospect_enrollment_consumption
  20260924091000_prospect_scan_worker_schedule
  20260924120000_prospect_without_service_role
)
q() { $PSQL -q -v ON_ERROR_STOP=1 -d "$DB"; }
fresh() {
  $PSQL -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
  q < scripts/prospect-migration-qa/00_prelude.sql >/dev/null 2>&1
  for m in "${MIGS[@]}"; do q < "supabase/migrations/$m.sql" >/dev/null && echo "applied $m"; done
}

echo "== 1. production routing + existing queued scan recovery"
fresh
q <<'SQL'
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000aa','staff@x.test');
INSERT INTO public.prospect_identities(id,display_name,normalized_name,created_by) VALUES ('10000000-0000-0000-0000-000000000009','Tini Tom','tini tom','00000000-0000-0000-0000-0000000000aa');
INSERT INTO public.prospect_scans(id,prospect_id,status,created_by,source_family_set_version,classification_version,created_at) VALUES ('5b9538c4-582e-4d06-8e9e-102f6fb3fa44','10000000-0000-0000-0000-000000000009','queued','00000000-0000-0000-0000-0000000000aa','v1','v1', now() - interval '1 day');
CREATE TABLE qa_before AS SELECT token FROM internal_cron_secrets WHERE name='prospect_scan_worker';
SQL
q < supabase/migrations/20260924121000_prospect_worker_production_origin.sql >/dev/null && echo "applied 20260924121000_prospect_worker_production_origin"
q < supabase/migrations/20260924121000_prospect_worker_production_origin.sql >/dev/null && echo "re-applied 20260924121000 (idempotent)"
q < scripts/prospect-migration-qa/30_production_origin.sql 2>&1 | grep -E '^M[0-9]'

echo "== 2. worker / client / staff access checks (all migrations)"
fresh
q < supabase/migrations/20260924121000_prospect_worker_production_origin.sql >/dev/null
q < scripts/prospect-migration-qa/10_fixtures.sql 2>&1 | grep -E '^T[0-9]'
$PSQL -q -d "$DB" < scripts/prospect-migration-qa/20_access_checks.sql 2>&1 | grep -E '^[WCSZ][0-9]|ERROR'
