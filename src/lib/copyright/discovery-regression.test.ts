import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSiteScopedDiscoveryQueries,
  mergeScanCandidateLeads,
  type CandidateUnionEntry,
} from "./candidate-union";
import { DetailFollowRecorder } from "./detail-follow.server";
import { buildPageEvidenceResult } from "./page-evidence";
import { classifyCopyrightPage } from "./page-classify.server";
import {
  BROWSER_FALLBACK_BUDGET_MS,
  DETAIL_FOLLOW_BUDGET_MS,
  PER_PAGE_BROWSER_BUDGET_MS,
} from "./crawl-budget";
import { diagnosticsFromStats } from "./scan-diagnostics";
import type { DistributionAnalysis } from "./distribution.server";

const TITLES = ["Balan", "Balan 2024 Full Movie"];

function lead(
  url: string,
  origin: CandidateUnionEntry["origin"],
): CandidateUnionEntry {
  return {
    url,
    title: "Balan",
    query: origin,
    text: "Balan",
    strong: true,
    origin,
  };
}

function distFromClassify(
  url: string,
  classified: ReturnType<typeof classifyCopyrightPage>,
): DistributionAnalysis {
  return {
    url,
    domain: "example.test",
    pageTitle: null,
    screenshot: null,
    classification: classified.classification,
    contentType: "unauthorized_streaming_site",
    domainRisk: "high",
    releaseTiming: "first_month",
    releaseOffsetDays: 30,
    confidence: classified.confidence,
    reason: classified.reason,
    indicators: classified.indicators,
    indicatorKeys: classified.indicatorKeys,
    distributionLinks: classified.distributionLinks,
    qualityTags: classified.qualityTags,
    identityEvidence: classified.identityEvidence,
    accessEvidence: classified.accessEvidence,
    confidenceBreakdown: classified.confidenceBreakdown,
    embedSources: classified.embedSources,
    clientVisible: classified.clientVisible,
    strongEvidence: classified.strongAccess && classified.clientVisible,
    crawlFailed: false,
    crawlFailureCategory: null,
    crawlFailureReason: null,
    retrievalMethod: "static_html",
    rendered: false,
    detailFollowUrls: [],
  };
}

test("historical finding candidate is included when fresh discovery is empty", () => {
  const historical = [lead("https://risky.example/watch/balan", "historical_finding")];
  const merged = mergeScanCandidateLeads([historical, []]);
  assert.equal(merged.leads.length, 1);
  assert.equal(merged.leads[0]?.origin, "historical_finding");
  assert.equal(merged.after_dedup, 1);
});

test("historical candidate wins dedup over fresh discovery for same URL", () => {
  const url = "https://risky.example/movie/balan";
  const merged = mergeScanCandidateLeads([
    [lead(url, "historical_finding")],
    [lead(url, "fresh_discovery")],
  ]);
  assert.equal(merged.leads.length, 1);
  assert.equal(merged.leads[0]?.origin, "historical_finding");
  assert.equal(merged.removed.length, 1);
});

test("site-scoped queries are generated from stored domains without hardcoding", () => {
  const queries = buildSiteScopedDiscoveryQueries(
    ["movies.example", "stream.example"],
    TITLES,
  );
  assert.ok(queries.some((q) => q.includes('site:movies.example "Balan"')));
  assert.ok(queries.some((q) => q.includes("watch")));
  assert.ok(!queries.some((q) => /ogomovies/i.test(q)));
});

test("detail follow recorder queues title-matched links and logs skips", () => {
  const recorder = new DetailFollowRecorder();
  recorder.recordListingDetected("https://listing.example/", 12);
  const queued = recorder.enqueueCandidates({
    pageUrl: "https://listing.example/",
    candidates: [
      "https://listing.example/movie/balan",
      "https://listing.example/movie/balan",
      "https://other.example/movie/balan",
    ],
    inspectedUrls: new Set(),
    titles: TITLES,
  });
  assert.equal(queued.length, 1);
  const stats = recorder.stats();
  assert.equal(stats.detail_pages_queued, 1);
  assert.ok(
    recorder.getLogs().some(
      (l) =>
        l.event === "candidate_skipped" &&
        (l.reason === "duplicate" ||
          l.reason === "duplicate_url" ||
          l.reason === "already_crawled" ||
          l.reason === "cross_domain" ||
          l.reason === "cross_domain_not_allowed"),
    ),
  );
});

test("exact-title detail page with embedded full-work player yields strong access evidence", () => {
  const classified = classifyCopyrightPage({
    url: "https://stream.example/watch/balan",
    pageTitle: "Balan Watch Full Movie Online",
    markdown:
      "Watch Balan full movie online free streaming. Balan 2024 complete film HD.",
    html: '<iframe src="https://embed.example/e/abc123"></iframe>',
    links: ["https://embed.example/e/abc123"],
    titles: TITLES,
    pageInspected: true,
  });
  const dist = distFromClassify("https://stream.example/watch/balan", classified);
  const evidence = buildPageEvidenceResult(dist);
  assert.equal(evidence.titleIdentity.matched, true);
  assert.equal(evidence.embeddedPlayerDetected, true);
  assert.equal(evidence.accessEvidence.strength, "strong");
  assert.equal(evidence.clientVisibleFinding, true);
});

test("official trailer embed is rejected with clear reason", () => {
  const classified = classifyCopyrightPage({
    url: "https://youtube.com/watch?v=trailer",
    pageTitle: "Balan Official Trailer",
    markdown: "Watch the official trailer for Balan.",
    html: '<iframe src="https://youtube.com/embed/trailer"></iframe>',
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  const dist = distFromClassify("https://youtube.com/watch?v=trailer", classified);
  const evidence = buildPageEvidenceResult(dist);
  assert.equal(evidence.clientVisibleFinding, false);
  assert.equal(evidence.rejectionReason, "TRAILER_OR_PROMO");
});

test("canonical evidence object keeps embedded player and access strength aligned", () => {
  const classified = classifyCopyrightPage({
    url: "https://fan.example/balan-poster",
    pageTitle: "Balan HD poster wallpaper",
    markdown: "Balan poster gallery wallpaper download for desktop background.",
    html: "<html><img alt='Balan poster' src='/poster.jpg'/></html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  const dist = distFromClassify("https://fan.example/balan-poster", classified);
  dist.indicatorKeys = [...dist.indicatorKeys, "embedded_player"];
  const evidence = buildPageEvidenceResult(dist);
  assert.equal(evidence.embeddedPlayerDetected, true);
  assert.equal(evidence.accessEvidence.strength, "weak");
  assert.equal(evidence.clientVisibleFinding, false);
  assert.ok(evidence.suspectedReview || evidence.rejectionReason);
});

test("browser fallback budget is bounded separately from detail-follow budget", () => {
  const pagesAtMax = Math.ceil(BROWSER_FALLBACK_BUDGET_MS / PER_PAGE_BROWSER_BUDGET_MS);
  assert.ok(pagesAtMax >= 2);
  assert.ok(DETAIL_FOLLOW_BUDGET_MS >= 30_000);
});

test("comparison diagnostics derive from unified stats object", () => {
  const d = diagnosticsFromStats({
    fresh_discovery_candidates: 9,
    historical_candidates_restored: 4,
    monitored_sources_rechecked: 2,
    known_risk_domains_searched: 3,
    mirror_redirect_candidates: 1,
    candidates_before_dedup: 14,
    candidates_after_dedup: 12,
    detail_links_discovered: 6,
    detail_pages_queued: 4,
    detail_pages_followed: 3,
    embedded_players: 1,
    pages_with_access_evidence: 1,
    pages_missing_access_evidence: 0,
    suspected_review_pages: 0,
    exact_title_pages_found: 1,
    findings_created: 1,
    client_visible_findings: 1,
  });
  assert.equal(d.fresh_discovery_candidates, 9);
  assert.equal(d.historical_candidates_restored, 4);
  assert.equal(d.detail_pages_followed, 3);
  assert.equal(d.pages_with_access_evidence, 1);
  assert.equal(d.embedded_players, 1);
});

test("distinct detail URLs are not collapsed by candidate union dedup", () => {
  const merged = mergeScanCandidateLeads([
    [
      lead("https://risky.example/movie/balan-hd", "historical_finding"),
      lead("https://risky.example/movie/balan-cam", "historical_finding"),
    ],
  ]);
  assert.equal(merged.after_dedup, 2);
});
