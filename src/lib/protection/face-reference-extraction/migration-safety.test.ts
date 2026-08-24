/**
 * Static checks against the face-reference-extraction migration text,
 * mirroring src/lib/protection/migration-safety.test.ts's approach: these
 * can't replace running the migration against a real Postgres instance, but
 * they catch the exact class of regression the team has already been
 * burned by twice (protection_profiles, then deepfake_target_profiles/
 * deepfake_reference_faces) — silently reintroducing a CREATE TABLE that
 * would no-op past (or worse, conflict with) a real production table.
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
  "..",
  "supabase",
  "migrations",
  "20260825000000_face_reference_extraction.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const sqlNoComments = sql.replace(/--.*$/gm, "");

test("never CREATE TABLE for a confirmed-real table (protected_assets, deepfake_target_profiles, deepfake_reference_faces)", () => {
  for (const table of [
    "protected_assets",
    "deepfake_target_profiles",
    "deepfake_reference_faces",
  ]) {
    assert.doesNotMatch(
      sqlNoComments,
      new RegExp(`CREATE TABLE\\s+(IF NOT EXISTS\\s+)?public\\.${table}\\s*\\(`, "i"),
      `must not CREATE TABLE ${table} — it already exists in production`,
    );
  }
});

test("never references protected_faces or protected_face_profiles anywhere (confirmed not to exist in production)", () => {
  assert.doesNotMatch(sqlNoComments, /protected_faces\b/);
  assert.doesNotMatch(sqlNoComments, /protected_face_profiles\b/);
});

test("only ADD COLUMN IF NOT EXISTS is used against protected_assets and deepfake_reference_faces — no DROP/RENAME/data UPDATE", () => {
  for (const table of ["protected_assets", "deepfake_reference_faces"]) {
    const re = new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?;`, "g");
    const statements = sqlNoComments.match(re) ?? [];
    assert.ok(statements.length > 0, `expected at least one ALTER TABLE for ${table}`);
    for (const stmt of statements) {
      if (/ADD COLUMN/i.test(stmt)) {
        assert.match(
          stmt,
          /ADD COLUMN IF NOT EXISTS/i,
          `unguarded ADD COLUMN: ${stmt.slice(0, 80)}`,
        );
      }
    }
  }
  assert.doesNotMatch(sqlNoComments, /DROP COLUMN/i);
  assert.doesNotMatch(sqlNoComments, /RENAME COLUMN/i);
  assert.doesNotMatch(sqlNoComments, /UPDATE public\.protected_assets\s/i);
  assert.doesNotMatch(sqlNoComments, /UPDATE public\.deepfake_reference_faces\s/i);
});

test("does not touch deepfake_target_profiles, KYC/liveness, or authorization tables at all", () => {
  assert.doesNotMatch(sqlNoComments, /deepfake_target_profiles/);
  assert.doesNotMatch(sqlNoComments, /kyc_verifications|biometric_consents|client_authorizations/i);
});

test("new columns on confirmed-real tables carry a safe DEFAULT (never NULL-breaking for existing rows)", () => {
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS grid_screenshot_status TEXT NOT NULL DEFAULT 'UNSCREENED'/,
  );
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS reference_tier TEXT NOT NULL DEFAULT 'APPROVED_SECONDARY_REFERENCE'/,
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD'/);
});

test("protected_asset_grid_tiles is idempotent per tile via UNIQUE (parent_asset_id, tile_index)", () => {
  assert.match(sqlNoComments, /UNIQUE \(parent_asset_id, tile_index\)/);
});

function isInsideGuardedDoBlock(fullSql: string, statementIndex: number): boolean {
  const lastDo = fullSql.lastIndexOf("DO $$ BEGIN", statementIndex);
  const lastEnd = fullSql.lastIndexOf("END $$;", statementIndex);
  return lastDo !== -1 && lastDo > lastEnd;
}

test("every CREATE POLICY, CREATE TRIGGER, and ADD CONSTRAINT is wrapped in a guarded DO block so a re-run can't fail", () => {
  const guardedBlocks = sql.match(/CREATE (POLICY|TRIGGER)[\s\S]*?;/g) ?? [];
  assert.ok(guardedBlocks.length > 0, "expected at least one guarded CREATE POLICY/TRIGGER");
  for (const block of guardedBlocks) {
    const idx = sql.indexOf(block);
    assert.ok(isInsideGuardedDoBlock(sql, idx), `unguarded block: ${block.slice(0, 60)}...`);
  }
  const addConstraintBlocks = sql.match(/ADD CONSTRAINT[\s\S]*?;/g) ?? [];
  assert.ok(addConstraintBlocks.length > 0, "expected at least one guarded ADD CONSTRAINT");
  for (const block of addConstraintBlocks) {
    const idx = sql.indexOf(block);
    assert.ok(
      isInsideGuardedDoBlock(sql, idx),
      `unguarded ADD CONSTRAINT: ${block.slice(0, 60)}...`,
    );
  }
});

test("protected_asset_grid_tiles grants writes only to service_role; authenticated is read + review-update only", () => {
  assert.match(sql, /GRANT SELECT, UPDATE ON public\.protected_asset_grid_tiles TO authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.protected_asset_grid_tiles TO service_role;/);
  assert.doesNotMatch(
    sql,
    /GRANT[^;]*INSERT[^;]*ON public\.protected_asset_grid_tiles TO authenticated/,
  );
});
