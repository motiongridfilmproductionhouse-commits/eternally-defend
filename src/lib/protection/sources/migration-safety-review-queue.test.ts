/**
 * Static assertions on the Review Queue + admin Takedown migration SQL —
 * mirrors migration-safety.test.ts's style for the first migration. Confirms
 * the schema stays additive, the audit log is append-only and admin-gated,
 * and — the key regression to guard — neither pre-existing owner-only RLS
 * policy on approved_youtube_sources/approved_source_videos is touched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../../../supabase/migrations");

function readMigration(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((f) =>
    f.endsWith("_approved_source_review_queue.sql"),
  );
  assert.ok(file, "approved_source_review_queue migration file must exist");
  return readFileSync(join(MIGRATIONS_DIR, file as string), "utf8");
}

test("only ALTER TABLE ... ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS — never DROP, never a destructive ALTER", () => {
  const sql = readMigration();
  assert.match(sql, /ALTER TABLE public\.approved_source_videos\s+ADD COLUMN IF NOT EXISTS/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.approved_source_takedown_log/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP COLUMN/i);
  assert.doesNotMatch(sql, /\bDELETE FROM\b/i);
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test("REGRESSION: neither pre-existing owner-only policy is redefined or dropped here — this migration only ever CREATEs new, additional policies", () => {
  const sql = readMigration();
  assert.doesNotMatch(sql, /DROP POLICY/i);
  // The original policies are named exactly "own approved youtube sources" /
  // "own approved source videos" (defined in the first migration). This
  // migration must not attempt to recreate or alter them under the same name.
  assert.doesNotMatch(sql, /CREATE POLICY "own approved youtube sources"/);
  assert.doesNotMatch(sql, /CREATE POLICY "own approved source videos"/);
});

test("new admin-read policies are SELECT-only and role-gated — never widen INSERT/UPDATE/DELETE for non-owners", () => {
  const sql = readMigration();
  const adminReadBlocks = sql.match(
    /CREATE POLICY "admin read [^"]+" ON public\.\w+\s+FOR SELECT USING \(public\.has_role\(auth\.uid\(\), 'admin'\)\);/g,
  );
  assert.ok(adminReadBlocks, "expected admin-read SELECT policies to exist");
  assert.equal(adminReadBlocks?.length, 2, "exactly one admin-read policy per existing table");
});

test("review_status CHECK constraint includes exactly the four expected states", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /review_status TEXT NOT NULL DEFAULT 'pending_review'\s+CHECK \(review_status IN \(\s*'pending_review', 'approved_legitimate', 'sent_for_review', 'takedown_requested'\s*\)\)/,
  );
});

test("approved_source_takedown_log: RLS enabled, admin-only INSERT, no UPDATE/DELETE policy of any kind (append-only)", () => {
  const sql = readMigration();
  assert.match(sql, /ALTER TABLE public\.approved_source_takedown_log ENABLE ROW LEVEL SECURITY/);
  assert.match(
    sql,
    /CREATE POLICY "admin takedown log insert" ON public\.approved_source_takedown_log\s+FOR INSERT WITH CHECK \(public\.has_role\(auth\.uid\(\), 'admin'\)\)/,
  );
  assert.doesNotMatch(sql, /FOR UPDATE/i);
  assert.doesNotMatch(sql, /FOR DELETE/i);
  // Grants must not include UPDATE/DELETE either — defense in depth beyond RLS.
  const grantLine = sql
    .split("\n")
    .find((line) => /GRANT .* ON public\.approved_source_takedown_log TO authenticated/.test(line));
  assert.ok(grantLine);
  assert.doesNotMatch(grantLine as string, /UPDATE|DELETE/);
});

test("takedown_log.video_id has no ON DELETE CASCADE — the audit trail must outlive the video row it describes", () => {
  const sql = readMigration();
  const videoIdLine = sql
    .split("\n")
    .find((line) => /^\s*video_id UUID NOT NULL REFERENCES/.test(line));
  assert.ok(videoIdLine);
  assert.doesNotMatch(videoIdLine as string, /ON DELETE CASCADE/);
});

test("enforcement_case_id uses ON DELETE SET NULL, not CASCADE", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /enforcement_case_id UUID REFERENCES public\.enforcement_cases\(id\) ON DELETE SET NULL/,
  );
});

test("does not touch enforcement_jobs, client_enforcement_settings, asset_enforcement_settings, or any authorization table", () => {
  const sql = readMigration();
  for (const forbidden of [
    "enforcement_jobs",
    "client_enforcement_settings",
    "asset_enforcement_settings",
    "authorization_scopes",
    "client_authorizations",
  ]) {
    assert.doesNotMatch(sql, new RegExp(forbidden));
  }
});
