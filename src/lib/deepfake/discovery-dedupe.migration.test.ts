import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareDiscoveryRowsForKeep,
  discoveryEvidenceScore,
  isIndexableDiscoveryPageUrl,
  requireNonEmptyDiscoveryPageUrl,
  selectRedundantDiscoveryIds,
  type DiscoveryDedupeRow,
} from "./discovery-dedupe";
import { upsertDiscoveriesBatch } from "./scan-persist.server";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260801070000_deepfake_scan_runtime_ownership.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

test("migration accepts partial status and uses exact terminal trigger values", () => {
  const sql = migrationSql();
  assert.match(sql, /deepfake_scans_status_check/);
  assert.match(
    sql,
    /CHECK \(status IN \('running', 'completed', 'failed', 'partial'\)\)/,
  );
  assert.match(
    sql,
    /OLD\.status IN \('completed', 'failed', 'partial'\)/,
  );
  assert.match(sql, /NEW\.status = 'running'/);
});

test("migration dedupes discoveries before creating unique page index", () => {
  const sql = migrationSql();
  const dedupeIdx = sql.indexOf("WITH ranked AS");
  // Use the discoveries-specific ranked block (second occurrence after scans).
  const discoveriesBlock = sql.indexOf(
    "FROM public.deepfake_discoveries",
  );
  const deleteIdx = sql.indexOf(
    "DELETE FROM public.deepfake_discoveries AS discoveries",
  );
  const indexIdx = sql.indexOf("deepfake_discoveries_unique_page");

  assert.ok(discoveriesBlock > 0);
  assert.ok(deleteIdx > discoveriesBlock);
  assert.ok(indexIdx > deleteIdx, "unique index must follow duplicate delete");
  assert.match(sql, /PARTITION BY scan_id, page_url/);
  assert.match(sql, /page_url IS NOT NULL/);
  assert.match(sql, /btrim\(page_url\) <> ''/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS deepfake_discoveries_unique_page/);
  assert.match(sql, /analysis_status = 'url_verified'/);
  assert.match(sql, /COALESCE\(updated_at, discovered_at\) DESC/);
  assert.match(sql, /id DESC/);
});

test("migration remains idempotent for discoveries unique index", () => {
  const sql = migrationSql();
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS deepfake_discoveries_unique_page/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS deepfake_scans_one_active_per_target/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scan_run_token/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS deepfake_scans_status_check/);
  assert.match(sql, /DROP TRIGGER IF EXISTS deepfake_scans_prevent_terminal_revive/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.deepfake_scans_prevent_terminal_revive/);
  // Second run: ranked.rn > 1 deletes nothing once unique.
  assert.match(sql, /ranked\.rn > 1/);
});

test("duplicate discovery rows keep strongest newest evidence and delete only redundants", () => {
  const scanId = "11111111-1111-1111-1111-111111111111";
  const rows: DiscoveryDedupeRow[] = [
    {
      id: "a",
      scan_id: scanId,
      page_url: "https://example.com/leak",
      analysis_status: "discovered",
      page_title: null,
      snippet: null,
      discovered_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-01T10:00:00.000Z",
    },
    {
      id: "b",
      scan_id: scanId,
      page_url: "https://example.com/leak",
      analysis_status: "url_verified",
      canonical_url: "https://example.com/leak",
      page_title: "Verified leak page",
      snippet: "identity matched content",
      image_url: "https://cdn.example.com/a.jpg",
      source_host: "example.com",
      discovered_at: "2026-08-01T09:00:00.000Z",
      updated_at: "2026-08-01T11:00:00.000Z",
    },
    {
      id: "c",
      scan_id: scanId,
      page_url: "https://example.com/leak",
      analysis_status: "url_verified",
      canonical_url: "https://example.com/leak",
      page_title: "Older verified",
      discovered_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-01T08:30:00.000Z",
    },
    {
      id: "null-1",
      scan_id: scanId,
      page_url: null,
      analysis_status: "url_verified",
      discovered_at: "2026-08-01T12:00:00.000Z",
    },
    {
      id: "empty-1",
      scan_id: scanId,
      page_url: "   ",
      analysis_status: "url_verified",
      discovered_at: "2026-08-01T12:00:00.000Z",
    },
    {
      id: "null-2",
      scan_id: scanId,
      page_url: null,
      analysis_status: "discovered",
      discovered_at: "2026-08-01T13:00:00.000Z",
    },
  ];

  assert.ok(discoveryEvidenceScore(rows[1]!) > discoveryEvidenceScore(rows[0]!));
  assert.ok(compareDiscoveryRowsForKeep(rows[1]!, rows[2]!) < 0);

  const deleteIds = selectRedundantDiscoveryIds(rows);
  assert.deepEqual(new Set(deleteIds), new Set(["a", "c"]));
  assert.ok(!deleteIds.includes("b"), "strongest/newest row must be kept");
  assert.ok(
    !deleteIds.includes("null-1") &&
      !deleteIds.includes("null-2") &&
      !deleteIds.includes("empty-1"),
    "NULL/empty page_url rows must not be deduplicated",
  );
});

test("equal-score duplicates prefer newest then deterministic id", () => {
  const scanId = "22222222-2222-2222-2222-222222222222";
  const base = {
    scan_id: scanId,
    page_url: "https://example.com/same",
    analysis_status: "url_verified",
    canonical_url: "https://example.com/same",
    page_title: "Same",
    snippet: "Same",
  } as const;

  const rows: DiscoveryDedupeRow[] = [
    {
      ...base,
      id: "id-older",
      discovered_at: "2026-08-01T01:00:00.000Z",
      updated_at: "2026-08-01T01:00:00.000Z",
    },
    {
      ...base,
      id: "id-newer",
      discovered_at: "2026-08-01T02:00:00.000Z",
      updated_at: "2026-08-01T02:00:00.000Z",
    },
    {
      ...base,
      id: "id-newer-b",
      discovered_at: "2026-08-01T02:00:00.000Z",
      updated_at: "2026-08-01T02:00:00.000Z",
    },
  ];

  const deleteIds = selectRedundantDiscoveryIds(rows);
  assert.ok(!deleteIds.includes("id-newer-b"));
  assert.deepEqual(new Set(deleteIds), new Set(["id-older", "id-newer"]));
});

test("URL-verified discovery upserts require non-null non-empty page_url", async () => {
  assert.equal(isIndexableDiscoveryPageUrl(null), false);
  assert.equal(isIndexableDiscoveryPageUrl("  "), false);
  assert.equal(
    requireNonEmptyDiscoveryPageUrl({ page_url: " https://x.test/a " }),
    "https://x.test/a",
  );

  const upserts: Array<Array<{ page_url: string }>> = [];
  const supabase = {
    from() {
      return {
        upsert(rows: Array<{ page_url: string }>) {
          upserts.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const persisted = new Set<string>();
  const count = await upsertDiscoveriesBatch({
    supabase,
    userId: "u1",
    scanId: "s1",
    targetName: "Honey Rose",
    hostOf: () => "example.com",
    alreadyPersisted: persisted,
    rows: [
      {
        canonical_url: "https://example.com/ok",
        final_url: "https://example.com/ok",
        query: "q",
        page_title: "ok",
      },
      {
        canonical_url: "https://example.com/missing",
        final_url: "   ",
        page_url: "",
        query: "q",
      },
      {
        canonical_url: null,
        page_url: null,
        query: "q",
      },
    ],
  });

  assert.equal(count, 1);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.length, 1);
  assert.equal(upserts[0]?.[0]?.page_url, "https://example.com/ok");
  assert.ok(upserts[0]?.every((row) => Boolean(row.page_url?.trim())));
});
