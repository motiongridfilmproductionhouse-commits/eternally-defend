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
  "20260825010000_protected_asset_face_bootstrap.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const sqlNoComments = sql.replace(/--.*$/gm, "");

test("never CREATE TABLE for a confirmed-real table", () => {
  for (const table of [
    "protected_assets",
    "deepfake_target_profiles",
    "deepfake_reference_faces",
    "protected_asset_grid_tiles",
  ]) {
    assert.doesNotMatch(
      sqlNoComments,
      new RegExp(`CREATE TABLE\\s+(IF NOT EXISTS\\s+)?public\\.${table}\\s*\\(`, "i"),
      `must not CREATE TABLE ${table} — it already exists`,
    );
  }
});

test("never references protected_faces or protected_face_profiles (unrelated to this migration)", () => {
  assert.doesNotMatch(sqlNoComments, /protected_faces\b/);
  assert.doesNotMatch(sqlNoComments, /protected_face_profiles\b/);
});

test("only ADD COLUMN IF NOT EXISTS against deepfake_reference_faces and protected_asset_grid_tiles — no DROP COLUMN, no data UPDATE", () => {
  for (const table of ["deepfake_reference_faces", "protected_asset_grid_tiles"]) {
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
  assert.doesNotMatch(sqlNoComments, /UPDATE public\.deepfake_reference_faces\s/i);
  assert.doesNotMatch(sqlNoComments, /UPDATE public\.protected_asset_grid_tiles\s/i);
  assert.doesNotMatch(sqlNoComments, /DELETE FROM public\./i);
});

function isInsideGuardedDoBlock(fullSql: string, statementIndex: number): boolean {
  const lastDo = fullSql.lastIndexOf("DO $$ BEGIN", statementIndex);
  const lastEnd = fullSql.lastIndexOf("END $$;", statementIndex);
  return lastDo !== -1 && lastDo > lastEnd;
}

test("every DROP CONSTRAINT / ADD CONSTRAINT / CREATE POLICY / CREATE TRIGGER is wrapped in a guarded DO block", () => {
  const patterns = [
    /DROP CONSTRAINT[\s\S]*?;/g,
    /ADD CONSTRAINT[\s\S]*?;/g,
    /CREATE (POLICY|TRIGGER)[\s\S]*?;/g,
  ];
  let checked = 0;
  for (const pattern of patterns) {
    const blocks = sql.match(pattern) ?? [];
    for (const block of blocks) {
      const idx = sql.indexOf(block);
      assert.ok(isInsideGuardedDoBlock(sql, idx), `unguarded: ${block.slice(0, 70)}...`);
      checked++;
    }
  }
  assert.ok(checked > 0, "expected at least one guarded statement");
});

test("widened CHECK constraints add new values without removing any of the original ones", () => {
  assert.match(
    sql,
    /'CANONICAL_VERIFIED_REFERENCE','APPROVED_SECONDARY_REFERENCE','SCREENSHOT_DERIVED_REFERENCE',\s*\n\s*'ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE'/,
  );
  assert.match(sql, /'MANUAL_UPLOAD','SCREENSHOT_DERIVED','ADMIN_CONFIRMED_PROTECTED_ASSET'/);
  assert.match(
    sql,
    /'NOT_CANDIDATE','PENDING_REVIEW','AUTO_APPROVED','MANUALLY_APPROVED','REJECTED','DUPLICATE',\s*\n\s*'UNCONFIRMED_IDENTITY_CANDIDATE'/,
  );
});

test("face_identity_candidate_clusters grants writes only to service_role", () => {
  assert.match(sql, /GRANT SELECT ON public\.face_identity_candidate_clusters TO authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.face_identity_candidate_clusters TO service_role;/);
  assert.doesNotMatch(
    sql,
    /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.face_identity_candidate_clusters TO authenticated/,
  );
});
