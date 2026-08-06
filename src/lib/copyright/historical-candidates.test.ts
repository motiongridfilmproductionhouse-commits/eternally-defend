import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteScanDeadlineAt,
  discoveryPhaseDeadlineAt,
  knownUrlDeadlineAt,
  providerCrawlDeadlineAt,
  SCAN_TOTAL_BUDGET_MS,
  DETAIL_FOLLOW_BUDGET_MS,
  KNOWN_URL_BUDGET_MS,
  PROVIDER_CRAWL_BUDGET_MS,
} from "./crawl-budget";

test("scan deadlines derive from one absolute scan start", () => {
  const started = 1_000_000;
  const deadline = absoluteScanDeadlineAt(started);
  assert.equal(deadline, started + SCAN_TOTAL_BUDGET_MS);
  assert.equal(
    SCAN_TOTAL_BUDGET_MS,
    KNOWN_URL_BUDGET_MS + PROVIDER_CRAWL_BUDGET_MS + DETAIL_FOLLOW_BUDGET_MS,
  );
  assert.equal(knownUrlDeadlineAt(started, deadline), started + KNOWN_URL_BUDGET_MS);
  assert.equal(discoveryPhaseDeadlineAt(started, deadline), started + PROVIDER_CRAWL_BUDGET_MS);
  assert.equal(providerCrawlDeadlineAt(deadline), deadline - DETAIL_FOLLOW_BUDGET_MS);
});

test("phase deadlines never exceed the absolute scan deadline", () => {
  const started = Date.now();
  const deadline = absoluteScanDeadlineAt(started);
  assert.ok(knownUrlDeadlineAt(started, deadline) <= deadline);
  assert.ok(discoveryPhaseDeadlineAt(started, deadline) <= deadline);
  assert.ok(providerCrawlDeadlineAt(deadline) <= deadline);
});
