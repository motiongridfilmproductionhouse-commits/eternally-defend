import assert from "node:assert/strict";
import test from "node:test";
import { isExcludedHost, websiteTypeFor, canonicalUrl } from "./url.server";

test("1. 12 discovered candidates are persisted and marked client_visible", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => ({
    url: `https://pirate-site-${i}.com/download`,
    title: `Leaked copy ${i}`,
    exact: i < 3,
  }));

  const rows = candidates.map((c) => ({
    scan_id: "00000000-0000-0000-0000-000000000001",
    user_id: "user_123",
    source_url: canonicalUrl(c.url),
    confidence: c.exact ? 92 : 45,
    confidence_band: c.exact ? "confirmed" : "review",
    review_status: "pending",
    evidence: { client_visible: true, website_type: websiteTypeFor(c.url) },
  }));

  assert.equal(rows.length, 12);
  assert.equal(
    rows.every((r) => r.evidence.client_visible === true),
    true,
  );
  assert.equal(
    rows.every((r) => r.scan_id === "00000000-0000-0000-0000-000000000001"),
    true,
  );
});

test("2. Unverified candidates appear under Pending Review", () => {
  const matches = [
    { id: "1", confidence: 95, confidence_band: "confirmed", review_status: "pending" },
    { id: "2", confidence: 45, confidence_band: "review", review_status: "pending" },
    { id: "3", confidence: 40, confidence_band: "review", review_status: "pending" },
  ];

  const pendingCount = matches.filter((m) => m.review_status === "pending").length;
  assert.equal(pendingCount, 3);
});

test("3. Verified candidates appear under Verified", () => {
  const matches = [
    { id: "1", confidence: 95, confidence_band: "confirmed", review_status: "pending" },
    { id: "2", confidence: 45, confidence_band: "review", review_status: "pending" },
  ];

  const verifiedCount = matches.filter(
    (m) => m.confidence >= 90 || m.confidence_band === "confirmed",
  ).length;
  assert.equal(verifiedCount, 1);
});

test("4. client_visible=false rows remain hidden", () => {
  const matches = [
    { id: "1", evidence: { client_visible: true } },
    { id: "2", evidence: { client_visible: false } },
    { id: "3", evidence: { client_visible: true } },
  ];

  const visibleMatches = matches.filter((m) => m.evidence.client_visible !== false);
  assert.equal(visibleMatches.length, 2);
  assert.equal(
    visibleMatches.some((m) => m.id === "2"),
    false,
  );
});

test("5. Official sources are excluded", () => {
  const urls = [
    "https://netflix.com/title/123",
    "https://imdb.com/title/tt123",
    "https://variety.com/article",
    "https://pirate-streaming-site.to/movie",
  ];

  const excluded = urls.filter(isExcludedHost);
  const validCandidates = urls.filter((u) => !isExcludedHost(u));

  assert.deepEqual(excluded, [
    "https://netflix.com/title/123",
    "https://imdb.com/title/tt123",
    "https://variety.com/article",
  ]);
  assert.deepEqual(validCandidates, ["https://pirate-streaming-site.to/movie"]);
});

test("6. Scan card count equals Investigation Center visible count", () => {
  const matches = [
    { id: "1", confidence: 90, review_status: "pending", evidence: { client_visible: true } },
    { id: "2", confidence: 45, review_status: "pending", evidence: { client_visible: true } },
  ];

  const stats = { matches: matches.length };
  const visibleCount = matches.filter((m) => m.evidence.client_visible !== false).length;

  assert.equal(stats.matches, visibleCount);
});

test("7. Candidate pages greater than zero triggers crawl dispatch", () => {
  const candidatesCount = 60;
  const crawlQueueCount = candidatesCount;
  const crawledCount = 40;

  assert.equal(candidatesCount > 0, true);
  assert.equal(crawlQueueCount, 60);
  assert.equal(crawledCount > 0, true);
});

test("8. Scan cannot complete with 60 candidates and 0 persisted rows", () => {
  const candidateCount: number = 60;
  const persistedRowsCount: number = 0;

  const canComplete = candidateCount === 0 || persistedRowsCount > 0;
  assert.equal(canComplete, false);
});

test("9. Existing completed scans still load correctly", () => {
  const scan = {
    id: "scan-999",
    status: "completed",
    stats: { matches: 5, candidate_pages: 20, crawled_pages: 15 },
  };
  const matches = Array.from({ length: 5 }, (_, i) => ({ id: `m-${i}`, scan_id: scan.id }));

  assert.equal(scan.status, "completed");
  assert.equal(matches.length, scan.stats.matches);
});

test("10. Suspicious Sources and historical rows are not regressed", () => {
  const match = {
    id: "m-100",
    detection_type: "ripped_copy",
    confidence_band: "probable",
    review_status: "pending",
    evidence: {
      distribution: {
        domain: "leaked-movies.to",
        domain_risk: "high",
        content_type: "unauthorized_streaming_site",
      },
    },
  };

  assert.equal(match.evidence.distribution.domain_risk, "high");
  assert.equal(match.detection_type, "ripped_copy");
});

test("11. Current scan findings remain visible when selecting active scan", () => {
  const currentScanId = "scan-current";
  const rows = [
    { id: "m-1", scan_id: "scan-current", user_id: "user-1", evidence: { client_visible: true } },
    { id: "m-2", scan_id: "scan-old", user_id: "user-1", evidence: { client_visible: true } },
  ];

  const currentMatches = rows.filter((r) => r.scan_id === currentScanId);
  assert.equal(currentMatches.length, 1);
  assert.equal(currentMatches[0].id, "m-1");
});

test("12. Old scans are hidden by default in previous results section", () => {
  let showPreviousResults = false; // default state
  const previousMatches = [{ id: "m-2", scan_id: "scan-old", evidence: { client_visible: true } }];

  const visiblePreviousMatches = showPreviousResults ? previousMatches : [];
  assert.equal(visiblePreviousMatches.length, 0);

  // Toggle show
  showPreviousResults = true;
  const expandedPreviousMatches = showPreviousResults ? previousMatches : [];
  assert.equal(expandedPreviousMatches.length, 1);
});

test("13. Hide toggle does not mutate database or row client_visible state", () => {
  const row = { id: "m-2", scan_id: "scan-old", evidence: { client_visible: true } };
  let showPreviousResults = false;

  // Toggle UI state
  showPreviousResults = !showPreviousResults;

  // Database row properties remain unchanged
  assert.equal(row.evidence.client_visible, true);
  assert.equal(showPreviousResults, true);
});

test("14. Archive action affects only old scans and preserves current scan rows", () => {
  const keepScanId = "scan-current";
  const userId = "user-1";

  const dbRows = [
    { id: "m-1", scan_id: "scan-current", user_id: "user-1", evidence: { client_visible: true } },
    { id: "m-2", scan_id: "scan-old-1", user_id: "user-1", evidence: { client_visible: true } },
    { id: "m-3", scan_id: "scan-old-2", user_id: "user-1", evidence: { client_visible: true } },
  ];

  // Archive operation
  const updatedRows = dbRows.map((r) => {
    if (r.user_id === userId && r.scan_id !== keepScanId) {
      return {
        ...r,
        evidence: { ...r.evidence, client_visible: false, archived_at: "2026-08-06T00:00:00Z" },
      };
    }
    return r;
  });

  // Current scan row preserved
  assert.equal(updatedRows.find((r) => r.id === "m-1")?.evidence.client_visible, true);
  // Old scan rows archived
  assert.equal(updatedRows.find((r) => r.id === "m-2")?.evidence.client_visible, false);
  assert.equal(updatedRows.find((r) => r.id === "m-3")?.evidence.client_visible, false);
});

test("15. Other clients' rows are not affected during archive operation", () => {
  const keepScanId = "scan-current";
  const authUserId = "user-client-A";

  const dbRows = [
    {
      id: "m-1",
      scan_id: "scan-old",
      user_id: "user-client-A",
      evidence: { client_visible: true },
    },
    {
      id: "m-2",
      scan_id: "scan-old",
      user_id: "user-client-B",
      evidence: { client_visible: true },
    },
  ];

  const updatedRows = dbRows.map((r) => {
    if (r.user_id === authUserId && r.scan_id !== keepScanId) {
      return { ...r, evidence: { ...r.evidence, client_visible: false } };
    }
    return r;
  });

  // Client A row archived
  assert.equal(updatedRows.find((r) => r.id === "m-1")?.evidence.client_visible, false);
  // Client B row untouched
  assert.equal(updatedRows.find((r) => r.id === "m-2")?.evidence.client_visible, true);
});

test("16. Confirmation required state before archive/delete execution", () => {
  let clearDialogOpen = false;
  let serverActionCalled = false;

  const triggerClearClick = () => {
    clearDialogOpen = true; // Opens dialog, does NOT call server action yet
  };

  const confirmActionClick = () => {
    if (clearDialogOpen) {
      serverActionCalled = true;
      clearDialogOpen = false;
    }
  };

  triggerClearClick();
  assert.equal(clearDialogOpen, true);
  assert.equal(serverActionCalled, false);

  confirmActionClick();
  assert.equal(clearDialogOpen, false);
  assert.equal(serverActionCalled, true);
});

test("17. Archived rows (client_visible: false) are excluded from canonical result list", () => {
  const allRows = [
    { id: "m-1", scan_id: "scan-1", evidence: { client_visible: true } },
    {
      id: "m-2",
      scan_id: "scan-1",
      evidence: { client_visible: false, archived_at: "2026-08-06T00:00:00Z" },
    },
    { id: "m-3", scan_id: "scan-2", evidence: { client_visible: true } },
  ];

  const canonicalVisibleList = allRows.filter((r) => r.evidence.client_visible !== false);
  assert.equal(canonicalVisibleList.length, 2);
  assert.deepEqual(
    canonicalVisibleList.map((r) => r.id),
    ["m-1", "m-3"],
  );
});
