import assert from "node:assert/strict";
import test from "node:test";
import {
  SARAYU_DEMO_FINDING_URLS,
  buildSarayuDemoFindingRows,
  isSarayuDemoTarget,
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
    assert.equal(row.snippet, "Sarayu Mohan verified demo evidence URL");
    assert.deepEqual(row.matched_evidence, ["Verified Demo Evidence"]);
  }
});
