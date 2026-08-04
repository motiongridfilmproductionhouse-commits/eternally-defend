import assert from "node:assert/strict";
import test from "node:test";
import {
  SARAYU_DEMO_FINDING_URLS,
  buildSarayuDemoFindingRows,
  isSarayuDemoTarget,
  seedSarayuDemoFindings,
} from "./sarayu-demo-findings";

test("Sarayu demo target matching is isolated and normalized", () => {
  assert.equal(isSarayuDemoTarget("Sarayu Mohan"), true);
  assert.equal(isSarayuDemoTarget("sarayu-mohan"), true);
  assert.equal(isSarayuDemoTarget("Honey Rose"), false);
});

test("Sarayu demo rows preserve the supplied URLs and verified finding fields", () => {
  const rows = buildSarayuDemoFindingRows({
    scanId: "scan-id",
    userId: "user-id",
    now: "2026-08-04T00:00:00.000Z",
  });
  const expectedUrls = [...new Set(SARAYU_DEMO_FINDING_URLS)];

  assert.deepEqual(rows.map((row) => row.url), expectedUrls);
  assert.equal(rows.length, 7);
  for (const row of rows) {
    assert.equal(row.risk_level, "HIGH");
    assert.equal(row.finding_classification, "VERIFIED_DEEPFAKE");
    assert.equal(row.url_verification_status, "URL_VERIFIED");
    assert.equal(row.confidence, 100);
    assert.equal(row.source_host, new URL(String(row.url)).hostname);
    assert.equal("verified_domain" in row, false);
    assert.equal(row.snippet, "Sarayu Mohan verified demo evidence URL");
    assert.deepEqual(row.matched_evidence, ["Verified Demo Evidence"]);
  }
});

test("Sarayu demo seed upserts only columns present in deepfake_findings", async () => {
  let insertedRows: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "deepfake_findings");
      return {
        upsert(rows: Array<Record<string, unknown>>, options: { onConflict: string }) {
          insertedRows = rows;
          assert.equal(options.onConflict, "scan_id,url");
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const count = await seedSarayuDemoFindings({
    supabase,
    scanId: "scan-id",
    userId: "user-id",
    now: "2026-08-04T00:00:00.000Z",
  });

  assert.equal(count, 7);
  assert.equal(insertedRows.length, 7);
  assert.ok(insertedRows.every((row) => !("verified_domain" in row)));
});
