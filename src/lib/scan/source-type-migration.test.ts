/**
 * Static checks on the scan_hits.source_type backfill migration, mirroring
 * the CASE mapping in canonicalSourceType so the two can never silently
 * drift apart (the whole point of the migration is to make historical rows
 * agree with the same taxonomy the app now writes and filters by).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSourceType, SOURCE_TYPE_FILTERS } from "./source-type";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260830100148_normalize_scan_hits_source_type.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("only UPDATEs scan_hits.source_type — never touches source, id, or any other column", () => {
  assert.match(sql, /UPDATE public\.scan_hits\s*\nSET source_type = CASE lower\(source\)/);
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
  assert.doesNotMatch(sql, /SET\s+(?!source_type)\w+\s*=/i);
});

test("adds the source_type index conditionally, never unconditionally", () => {
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS idx_scan_hits_source_type ON public\.scan_hits\(source_type\);/,
  );
});

test("every canonical source_type value has a WHEN branch mapping to itself (idempotent on already-normalized rows)", () => {
  for (const { value } of SOURCE_TYPE_FILTERS) {
    if (!value) continue;
    const re = new RegExp(`WHEN '${value}' THEN '${value}'`);
    assert.match(sql, re, `missing idempotent branch for canonical value "${value}"`);
  }
});

test("the SQL CASE mapping for every legacy label matches canonicalSourceType() exactly", () => {
  const legacyLabels = [
    "youtube",
    "news",
    "reddit",
    "x",
    "instagram",
    "tiktok",
    "facebook",
    "blogs",
    "forums",
    "reviews",
    "archive",
    "linkedin",
    "podcasts",
    "complaints",
    "web",
    "ai research", // unmapped legacy label — must fall through to the ELSE branch
  ];
  for (const label of legacyLabels) {
    const whenMatch = sql.match(new RegExp(`WHEN '${label}' THEN '([a-z]+)'`));
    const expected = canonicalSourceType(label);
    if (whenMatch) {
      assert.equal(
        whenMatch[1],
        expected,
        `SQL maps "${label}" to "${whenMatch[1]}" but canonicalSourceType maps it to "${expected}"`,
      );
    } else {
      // No explicit branch means it falls through to ELSE 'web'.
      assert.equal(expected, "web", `"${label}" has no SQL branch but canonicalSourceType() ≠ web`);
      assert.match(sql, /ELSE 'web'/);
    }
  }
});
