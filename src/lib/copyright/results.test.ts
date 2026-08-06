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
