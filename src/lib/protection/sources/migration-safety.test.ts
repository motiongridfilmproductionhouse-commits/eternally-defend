/**
 * Static assertions on the Approved YouTube Sources migration SQL — mirrors
 * the style of src/lib/protection/migration-safety.test.ts. Confirms the
 * schema stays additive and that historical approved_source_videos rows
 * (including anything tied to a verified/probable deepfake finding) can
 * never be destroyed by a cascade when a customer removes a source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../../../../supabase/migrations");

function readMigration(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_approved_youtube_sources.sql"));
  assert.ok(file, "approved_youtube_sources migration file must exist");
  return readFileSync(join(MIGRATIONS_DIR, file as string), "utf8");
}

test("only CREATE TABLE IF NOT EXISTS — never ALTER/DROP an existing table", () => {
  const sql = readMigration();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.approved_youtube_sources/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.approved_source_videos/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(?!approved_)/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP COLUMN/i);
});

test("REGRESSION: approved_source_videos.source_id has no ON DELETE CASCADE — removing a source can never cascade-delete its historical videos", () => {
  const sql = readMigration();
  const sourceIdLine = sql
    .split("\n")
    .find((line) => /^\s*source_id UUID NOT NULL REFERENCES/.test(line));
  assert.ok(sourceIdLine, "source_id FK column definition must exist");
  assert.doesNotMatch(
    sourceIdLine as string,
    /ON DELETE CASCADE/,
    "a cascade delete here would destroy historical classification/evidence-linked rows when a source is removed",
  );
});

test("automated_finding_evidence_id uses ON DELETE SET NULL, not CASCADE — evidence deletion elsewhere never silently deletes the video row", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /automated_finding_evidence_id UUID REFERENCES public\.automated_finding_evidence\(id\) ON DELETE SET NULL/,
  );
});

test("status enum includes 'removed' for soft-delete, and RLS is present on both new tables", () => {
  const sql = readMigration();
  assert.match(
    sql,
    /status TEXT NOT NULL DEFAULT 'active' CHECK \(status IN \('active', 'paused', 'removed'\)\)/,
  );
  assert.match(sql, /ALTER TABLE public\.approved_youtube_sources ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.approved_source_videos ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /USING \(auth\.uid\(\) = user_id\) WITH CHECK \(auth\.uid\(\) = user_id\)/);
});

test("does not reference or modify enforcement, authorization, or RLS tables/policies outside its own two tables", () => {
  const sql = readMigration();
  for (const forbidden of [
    "enforcement_jobs",
    "enforcement_cases",
    "client_authorizations",
    "client_enforcement_settings",
    "asset_enforcement_settings",
    "authorization_scopes",
  ]) {
    assert.doesNotMatch(sql, new RegExp(forbidden));
  }
});
