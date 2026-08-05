import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260805120000_business_reputation_worker.sql"),
  "utf8",
);
const baseSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260714122219_21a7ba22-cd13-4a5d-a334-91e4e47d0610.sql",
  ),
  "utf8",
);

test("migration adds an isolated scan type and worker runtime fields", () => {
  for (const field of [
    "scan_type",
    "scan_run_token",
    "heartbeat_at",
    "lease_expires_at",
    "brand_profile",
    "query_plan",
    "report_summary",
  ])
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`));
  assert.match(sql, /business_reputation/);
});
test("migration creates worker diagnostics with owner-only read RLS", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.business_reputation_worker_events/);
  assert.match(sql, /auth\.uid\(\) = user_id/);
  assert.match(sql, /GRANT ALL ON public\.business_reputation_worker_events TO service_role/);
});
test("migration protects Business runtime fields from authenticated clients", () => {
  assert.match(sql, /business_scans_protect_runtime_fields/);
  assert.match(sql, /scan_run_token IS DISTINCT FROM OLD\.scan_run_token/);
  assert.match(sql, /service_role/);
});
test("migration permits partial terminal state for warning-complete scans", () =>
  assert.match(sql, /'partial'/));
test("existing scan and finding RLS remains owner-only and excludes anonymous users", () => {
  assert.match(baseSql, /CREATE POLICY "own scans" ON public\.scans/);
  assert.match(baseSql, /CREATE POLICY "own scan_hits" ON public\.scan_hits/);
  assert.match(baseSql, /FOR ALL TO authenticated/);
  assert.doesNotMatch(baseSql, /TO anon/);
});
