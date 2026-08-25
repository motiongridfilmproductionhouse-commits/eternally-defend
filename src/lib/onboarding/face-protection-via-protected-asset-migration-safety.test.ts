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
  "20260825030000_face_protection_via_protected_asset.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const sqlNoComments = sql.replace(/--.*$/gm, "");

test("never CREATE TABLE or DROP TABLE for any confirmed-real table", () => {
  assert.doesNotMatch(sqlNoComments, /CREATE TABLE/i);
  assert.doesNotMatch(sqlNoComments, /DROP TABLE/i);
});

test("only ADD VALUE IF NOT EXISTS on the face_profile_status enum — no other enum mutation", () => {
  const alterTypeStatements = sqlNoComments.match(/ALTER TYPE[\s\S]*?;/gi) ?? [];
  assert.equal(alterTypeStatements.length, 1, "expected exactly one ALTER TYPE statement");
  assert.match(alterTypeStatements[0], /ALTER TYPE public\.face_profile_status/i);
  assert.match(alterTypeStatements[0], /ADD VALUE IF NOT EXISTS/i);
  assert.doesNotMatch(alterTypeStatements[0], /DROP VALUE|RENAME/i);
});

test("only ADD COLUMN IF NOT EXISTS against protected_faces — no DROP COLUMN, no data UPDATE/DELETE", () => {
  const alterTableStatements =
    sqlNoComments.match(/ALTER TABLE public\.protected_faces[\s\S]*?;/g) ?? [];
  assert.ok(
    alterTableStatements.length > 0,
    "expected at least one ALTER TABLE for protected_faces",
  );
  for (const stmt of alterTableStatements) {
    assert.match(stmt, /ADD COLUMN IF NOT EXISTS/i, `unguarded ADD COLUMN: ${stmt.slice(0, 80)}`);
    assert.doesNotMatch(stmt, /DROP COLUMN/i);
  }
  assert.doesNotMatch(sqlNoComments, /\bUPDATE public\.protected_faces\b/i);
  assert.doesNotMatch(sqlNoComments, /\bDELETE FROM public\.protected_faces\b/i);
});

test("the new column is nullable and FK-guarded — never NOT NULL, never a default that could invent data", () => {
  const addColumnClause = sqlNoComments.match(
    /ADD COLUMN IF NOT EXISTS\s+linked_reference_face_id[\s\S]*?(?=;)/i,
  )?.[0];
  assert.ok(addColumnClause, "expected an ADD COLUMN clause for linked_reference_face_id");
  assert.doesNotMatch(addColumnClause!, /\bNOT NULL\b/i);
  assert.doesNotMatch(addColumnClause!, /\bDEFAULT\b/i);
  assert.match(
    sqlNoComments,
    /linked_reference_face_id UUID\s+REFERENCES public\.deepfake_reference_faces\(id\) ON DELETE SET NULL/i,
  );
});

test("no other confirmed-real table is touched", () => {
  for (const table of [
    "protected_face_profiles",
    "deepfake_reference_faces",
    "protected_assets",
    "face_identity_candidate_clusters",
  ]) {
    assert.doesNotMatch(
      sqlNoComments,
      new RegExp(`ALTER TABLE public\\.${table}\\b`, "i"),
      `must not alter ${table} — unrelated to this migration`,
    );
  }
});
