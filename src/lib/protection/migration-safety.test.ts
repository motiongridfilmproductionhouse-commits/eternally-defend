/**
 * Static checks against the Phase 1 migration text itself, proving the
 * in-place-upgrade safety properties the deployment-review asked for
 * (production protection_profiles already has 9 real rows). These can't
 * replace actually running the migration against a real Postgres instance,
 * but they catch the exact class of regression that caused the original
 * bug: silently reintroducing a CREATE TABLE that would no-op against the
 * real table, or losing one of the safety guards on a future edit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260822120000_protection_orchestration.sql",
);
const sql = readFileSync(migrationPath, "utf8");
// Strip `-- ...` line comments for assertions that must only look at actual
// executable SQL — the migration's own explanatory comments legitimately
// name tables like deepfake_target_profiles to document why the face FK
// was omitted, which isn't a functional dependency on them.
const sqlNoComments = sql.replace(/--.*$/gm, "");

test("does not CREATE TABLE protection_profiles (must upgrade the existing production table, not no-op past it)", () => {
  // Anchored directly after CREATE TABLE (only IF NOT EXISTS allowed in
  // between) so this only matches protection_profiles being the table
  // *created*, not a later FK reference to it inside some other table's
  // definition (e.g. protection_profile_aliases' `profile_id ...
  // REFERENCES public.protection_profiles(id)`, which is correct and
  // expected).
  assert.doesNotMatch(
    sqlNoComments,
    /CREATE TABLE\s+(IF NOT EXISTS\s+)?public\.protection_profiles\s*\(/i,
  );
});

test("adds id via ADD COLUMN IF NOT EXISTS, not as part of a CREATE TABLE", () => {
  assert.match(sql, /ALTER TABLE public\.protection_profiles ADD COLUMN IF NOT EXISTS id UUID;/);
});

test("backfills id via an explicit per-row UPDATE, not via ADD COLUMN's own DEFAULT (unsafe for a volatile expression across existing rows)", () => {
  assert.match(
    sql,
    /UPDATE public\.protection_profiles SET id = gen_random_uuid\(\) WHERE id IS NULL;/,
  );
  // The id column must not be given a DEFAULT in the same statement that adds it.
  assert.doesNotMatch(sql, /ADD COLUMN IF NOT EXISTS id UUID DEFAULT/);
});

test("primary key and unique(user_id) are added conditionally, never unconditionally", () => {
  assert.match(
    sql,
    /IF NOT EXISTS[\s\S]{0,300}constraint_type = 'PRIMARY KEY'[\s\S]{0,200}ADD CONSTRAINT protection_profiles_pkey PRIMARY KEY \(id\)/,
  );
  assert.match(
    sql,
    /constraint_type = 'UNIQUE' AND ccu\.column_name = 'user_id'[\s\S]{0,200}ADD CONSTRAINT protection_profiles_user_id_key UNIQUE \(user_id\)/,
  );
});

test("never touches the legacy status column", () => {
  assert.doesNotMatch(sql, /DROP COLUMN[^;]*status/i);
  assert.doesNotMatch(sql, /RENAME COLUMN[^;]*status/i);
  assert.doesNotMatch(sql, /UPDATE public\.protection_profiles SET status/i);
});

test("does not add protected_face_profile_id as an actual column/constraint (explanatory comments naming it are fine)", () => {
  assert.doesNotMatch(sqlNoComments, /protected_face_profile_id/);
});

test("does not functionally reference deepfake_target_profiles, deepfake_reference_faces, KYC, or client_authorizations writes (explanatory comments naming them are fine)", () => {
  assert.doesNotMatch(sqlNoComments, /deepfake_target_profiles|deepfake_reference_faces/);
  assert.doesNotMatch(
    sqlNoComments,
    /UPDATE public\.client_authorizations|DELETE FROM public\.client_authorizations/i,
  );
  assert.doesNotMatch(sqlNoComments, /kyc_verifications|biometric_consents/);
});

test("new tables are created after the id-upgrade section, not before", () => {
  const idBackfillIdx = sql.indexOf("UPDATE public.protection_profiles SET id");
  const aliasesTableIdx = sql.indexOf(
    "CREATE TABLE IF NOT EXISTS public.protection_profile_aliases",
  );
  const enrollmentsTableIdx = sql.indexOf(
    "CREATE TABLE IF NOT EXISTS public.scan_module_enrollments",
  );
  assert.ok(idBackfillIdx > -1 && aliasesTableIdx > -1 && enrollmentsTableIdx > -1);
  assert.ok(
    idBackfillIdx < aliasesTableIdx,
    "id must be backfilled before protection_profile_aliases is created",
  );
  assert.ok(
    idBackfillIdx < enrollmentsTableIdx,
    "id must be backfilled before scan_module_enrollments is created",
  );
});

test("ends with assertions that abort the transaction on any safety-invariant violation", () => {
  assert.match(sql, /RAISE EXCEPTION[\s\S]*row count dropped/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*changed or missing user_id\/status/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*still have a null id/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*duplicate user_id groups/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*protection_profile_aliases\.profile_id is not FK-ed/);
  assert.match(sql, /RAISE EXCEPTION[\s\S]*scan_module_enrollments\.profile_id is not FK-ed/);
});

test("every CREATE POLICY is guarded so a re-run can't fail", () => {
  const policyBlocks = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  assert.ok(policyBlocks.length > 0, "expected at least one CREATE POLICY statement");
  for (const block of policyBlocks) {
    const idx = sql.indexOf(block);
    const preceding = sql.slice(Math.max(0, idx - 20), idx);
    assert.match(
      preceding,
      /DO \$\$ BEGIN\s*$/,
      `unguarded CREATE POLICY: ${block.slice(0, 60)}...`,
    );
  }
});

test("the pre-migration snapshot temp table is dropped defensively before creation (safe to re-run in the same session)", () => {
  assert.match(
    sql,
    /DROP TABLE IF EXISTS _protection_profiles_pre_migration_snapshot;\s*\nCREATE TEMP TABLE _protection_profiles_pre_migration_snapshot/,
  );
});
