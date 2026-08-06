/**
 * Mocked multi-host discovery regression for Chinna Chinna Aasai (2026).
 *
 * Fails if the pipeline collapses to ~3 findings / domains. Provider responses
 * and HTML fixtures are inlined — no live network.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeScanCandidateLeads, type CandidateUnionEntry } from "./candidate-union";
import { classifyCopyrightPage } from "./page-classify.server";
import { hostOf, canonicalUrl } from "./url.server";
import {
  FORBIDDEN_TERMINATION_REASONS,
  coverageDiagnosticsFromStats,
  resolveScanTerminationReason,
} from "./scan-diagnostics";
import {
  DETAIL_FOLLOW_DRAIN_CAP,
  DETAIL_FOLLOW_MAX_DEPTH,
  DETAIL_FOLLOW_MAX_QUEUE,
  DetailFollowRecorder,
} from "./detail-follow.server";
import { DEFAULT_PAGE_CAP } from "./crawl-budget";
import { MAX_DEPTH, MAX_DETAIL_DRAIN, MAX_DETAIL_QUEUE } from "./discovery-config";
import { buildQueries, type ReferenceAnalysis } from "./discover.server";
import {
  classifyThreatCategory,
  summarizeThreatIntelligence,
  type ThreatResultRow,
} from "./threat-results";

const TITLES = ["Chinna Chinna Aasai"];
const long = (s: string) =>
  `${s} ${"Exact crawled page body with enough text for identity and distribution evidence. ".repeat(4)}`;

const analysis: ReferenceAnalysis = {
  title: "Chinna Chinna Aasai",
  altTitles: ["Chinna Chinna Aasai Malayalam"],
  language: "malayalam",
  audienceLanguages: ["english", "tamil"],
  region: "India",
  actors: [],
  productionCompany: null,
  releaseDate: "2026-01-01",
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

/** Mocked provider SERP/HTML hits across the known public hosts. */
const MOCK_PROVIDER_HITS: Array<{
  url: string;
  title: string;
  html: string;
  markdown: string;
  links: string[];
  origin: CandidateUnionEntry["origin"];
}> = [
  {
    url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
    title: "Chinna Chinna Aasai (2026) Full Movie Download",
    markdown: long(
      "Chinna Chinna Aasai 2026 Malayalam full movie download 1080p HDRip MKV. Click Download Now.",
    ),
    html: '<html><body><a href="/download/chinna-chinna-aasai.mkv">Download Now</a><a href="/dl/full">Download HD</a></body></html>',
    links: [
      "https://www.ogomovies1.com.pk/download/chinna-chinna-aasai.mkv",
      "https://www.ogomovies1.com.pk/dl/full",
    ],
    origin: "fresh_discovery",
  },
  {
    url: "https://www.bilibili.tv/en/video/4800404031282176",
    title: "Chinna Chinna Aasai full movie",
    markdown: long(
      "Watch Chinna Chinna Aasai full movie online. Uploaded copyrighted movie content.",
    ),
    html: '<html><body><video controls src="/play.mp4"></video><iframe src="https://www.bilibili.tv/player/embed/4800404031282176"></iframe></body></html>',
    links: [],
    origin: "fresh_discovery",
  },
  {
    url: "https://www.terabox.app/sharing/link?surl=V_Y7iz4bTqJepcsXMzkhow",
    title: "Chinna Chinna Aasai shared folder",
    markdown: long(
      "Terabox public sharing link for Chinna Chinna Aasai full movie file. Download the shared folder.",
    ),
    html: "<html><body><a href='/download'>Download</a><button>Download</button></body></html>",
    links: ["https://www.terabox.app/download/file"],
    origin: "fresh_discovery",
  },
  {
    url: "https://ia903101.us.archive.org/28/items/china-china-aasai-boly4u/china-china-aasai-boly4u.pdf",
    title: "china-china-aasai-boly4u.pdf — Chinna Chinna Aasai",
    markdown: long(
      "Internet Archive item for Chinna Chinna Aasai boly4u PDF download of copyrighted material.",
    ),
    html: "<html><body><a href='china-china-aasai-boly4u.pdf'>PDF Download</a></body></html>",
    links: [
      "https://ia903101.us.archive.org/28/items/china-china-aasai-boly4u/china-china-aasai-boly4u.pdf",
    ],
    origin: "fresh_discovery",
  },
  {
    url: "https://www.dailymotion.com/video/xaswffu",
    title: "Chinna Chinna Aasai movie",
    markdown: long("Chinna Chinna Aasai uploaded on Dailymotion. Watch the video online."),
    html: '<html><body><iframe src="https://www.dailymotion.com/embed/video/xaswffu"></iframe></body></html>',
    links: [],
    origin: "fresh_discovery",
  },
  {
    url: "https://t.me/s/piracy_movies_channel/chinna-chinna-aasai",
    title: "Chinna Chinna Aasai Telegram post",
    markdown: long("Chinna Chinna Aasai 2026 full movie telegram channel download link HDRip."),
    html: '<html><body><a href="https://t.me/piracy_movies_channel">Join</a><a href="magnet:?xt=urn:btih:abc">torrent</a></body></html>',
    links: ["https://t.me/piracy_movies_channel", "magnet:?xt=urn:btih:abc"],
    origin: "site_scoped_search",
  },
];

function simulateCoverageFromMocks() {
  const merged = mergeScanCandidateLeads([
    MOCK_PROVIDER_HITS.map((hit): CandidateUnionEntry => ({
      url: hit.url,
      title: hit.title,
      query: `site:${hostOf(hit.url) ?? "web"} Chinna Chinna Aasai`,
      text: hit.title,
      strong: true,
      origin: hit.origin,
    })),
  ]);

  const uniqueUrls = new Set(merged.leads.map((l) => canonicalUrl(l.url)));
  const uniqueDomains = new Set(
    [...uniqueUrls].map((u) => hostOf(u)).filter((h): h is string => Boolean(h)),
  );

  const classified = MOCK_PROVIDER_HITS.map((hit) => {
    const result = classifyCopyrightPage({
      url: hit.url,
      pageTitle: hit.title,
      markdown: hit.markdown,
      html: hit.html,
      links: hit.links,
      titles: TITLES,
      pageInspected: true,
      releaseDate: "2026-01-01",
      // Explicitly omit poster/visual similarity — text/metadata evidence alone.
    });
    return { hit, result };
  });

  const verified = classified.filter((c) => c.result.clientVisible);
  const pending = classified.filter((c) => !c.result.clientVisible && c.result.identityMatch);
  const rejected = classified.filter((c) => !c.result.clientVisible && !c.result.identityMatch);

  const rows: ThreatResultRow[] = verified.map((c, i) => {
    const domain = hostOf(c.hit.url) ?? "unknown";
    const categoryKey = classifyThreatCategory({
      domain,
      url: c.hit.url,
      classification: c.result.classification,
    });
    return {
      id: String(i + 1),
      domain,
      url: c.hit.url,
      title: c.hit.title,
      classification: c.result.classification,
      categoryKey,
      categoryLabel: categoryKey,
      severity: "critical",
      status: "active",
      confidence: c.result.confidence,
      lastVerifiedAt: "2026-08-03T12:00:00.000Z",
      evidenceSummary: c.result.reason,
      reason: c.result.reason,
      discoveryQuery: null,
      screenshotUrl: null,
      pageExcerpt: null,
      additionalUrls: [],
      findingCount: 1,
      verified: true,
      sourceState: "new_confirmed",
      reviewStatus: null,
      evidence: null,
      contact: null,
      detectionType: c.result.classification,
    };
  });

  return {
    candidatePages: uniqueUrls.size,
    uniqueDomains: uniqueDomains.size,
    verified: verified.length,
    pending: pending.length,
    rejected: rejected.length,
    verifiedPlusPending: verified.length + pending.length,
    intel: summarizeThreatIntelligence(rows),
    classified,
  };
}

test("mocked multi-host discovery yields >=5 candidates, domains, and findings", () => {
  const coverage = simulateCoverageFromMocks();

  // Hard regression: must not collapse to ~3 threats.
  assert.ok(coverage.candidatePages >= 5, `candidate pages=${coverage.candidatePages}`);
  assert.ok(coverage.uniqueDomains >= 5, `unique domains=${coverage.uniqueDomains}`);
  assert.ok(
    coverage.verifiedPlusPending >= 5,
    `verified+pending=${coverage.verifiedPlusPending} (verified=${coverage.verified}, pending=${coverage.pending})`,
  );
  assert.notEqual(coverage.verifiedPlusPending, 3);
  assert.ok(coverage.verified >= 5, `verified findings=${coverage.verified}`);
});

test("low/absent poster similarity does not reject strong title+access evidence", () => {
  const coverage = simulateCoverageFromMocks();
  for (const { hit, result } of coverage.classified.slice(0, 5)) {
    assert.equal(
      result.clientVisible,
      true,
      `${hit.url} rejected despite title/access evidence: ${result.classification} ${result.reason}`,
    );
    assert.ok(result.identityMatch, `${hit.url} missing title identity`);
    assert.ok(result.strongAccess || result.accessEvidence.length > 0);
  }
});

test("provider merge keeps one result per URL, not one per domain", () => {
  const sameDomain: CandidateUnionEntry[] = [
    {
      url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
      title: "A",
      query: "q1",
      text: "A",
      strong: true,
      origin: "fresh_discovery",
    },
    {
      url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026-tamil/",
      title: "B",
      query: "q2",
      text: "B",
      strong: true,
      origin: "fresh_discovery",
    },
    {
      url: "https://www.ogomovies1.com.pk/movies/chinna-chinna-aasai-2026/",
      title: "A dup",
      query: "q3",
      text: "A",
      strong: false,
      origin: "site_scoped_search",
    },
  ];
  const merged = mergeScanCandidateLeads([sameDomain]);
  assert.equal(merged.after_dedup, 2);
  assert.equal(merged.before_dedup, 3);
  const domains = new Set(merged.leads.map((l) => hostOf(l.url)));
  assert.equal(domains.size, 1);
});

test("detail follow drains recursively beyond a single 80-item pass", () => {
  assert.equal(MAX_DETAIL_QUEUE, 120);
  assert.equal(MAX_DETAIL_DRAIN, 80);
  assert.equal(MAX_DEPTH, 2);
  assert.equal(DETAIL_FOLLOW_MAX_QUEUE, MAX_DETAIL_QUEUE);
  assert.equal(DETAIL_FOLLOW_DRAIN_CAP, MAX_DETAIL_DRAIN);
  assert.equal(DETAIL_FOLLOW_MAX_DEPTH, MAX_DEPTH);

  const recorder = new DetailFollowRecorder();
  const candidates = Array.from(
    { length: 100 },
    (_, i) => `https://listing.example/movie/chinna-${i}`,
  );
  recorder.enqueueCandidates({
    pageUrl: "https://listing.example/",
    candidates,
    inspectedUrls: new Set(),
    titles: TITLES,
    fromDepth: 0,
  });
  assert.equal(recorder.stats().detail_pages_queued, 20);

  const first = recorder.drain(DETAIL_FOLLOW_DRAIN_CAP);
  assert.equal(first.length, 20);
  assert.equal(recorder.remaining(), 0);
  assert.ok(first[0]!.depth === 1);
});

test("platform-specific queries cover all known public hosts", () => {
  const joined = buildQueries(analysis, "Chinna Chinna Aasai")
    .map((p) => p.query)
    .join("\n");
  for (const host of [
    "ogomovies1.com.pk",
    "bilibili.tv",
    "terabox.app",
    "archive.org",
    "dailymotion.com",
    "t.me",
  ]) {
    assert.match(joined, new RegExp(host.replace(/\./g, "\\.")));
  }
  assert.match(joined, /torrent|magnet|pirate|kickass|1337x/i);
  assert.match(joined, /mega\.nz|mediafire|gofile|pixeldrain/i);
});

test("coverage diagnostics expose required keys and forbid early-stop reasons", () => {
  const stats = coverageDiagnosticsFromStats({
    queries_generated: 40,
    provider_requests_started: 12,
    provider_requests_succeeded: 10,
    provider_requests_failed: 2,
    raw_results_received: 48,
    unique_candidate_urls: 30,
    unique_candidate_domains: 12,
    pages_crawled: 22,
    detail_links_queued: 40,
    detail_links_processed: 35,
    redirects_followed: 4,
    candidates_rejected: 6,
    candidates_pending: 3,
    findings_verified: 8,
    scan_elapsed_ms: 120_000,
    termination_reason: "providers_exhausted",
    not_processed_due_to_budget: 5,
  });

  for (const key of [
    "queries_generated",
    "provider_requests_started",
    "provider_requests_succeeded",
    "provider_requests_failed",
    "raw_results_received",
    "unique_candidate_urls",
    "unique_candidate_domains",
    "pages_crawled",
    "detail_links_queued",
    "detail_links_processed",
    "redirects_followed",
    "candidates_rejected",
    "candidates_pending",
    "findings_verified",
    "scan_elapsed_ms",
    "termination_reason",
  ] as const) {
    assert.ok(key in stats, `missing ${key}`);
  }

  assert.equal(stats.termination_reason, "providers_exhausted");
  assert.equal(resolveScanTerminationReason({ abortedByDeadline: true }), "timeout_reached");
  assert.equal(resolveScanTerminationReason({ cancelled: true }), "cancelled");
  assert.equal(
    resolveScanTerminationReason({ fatalConfigurationError: true }),
    "fatal_configuration_error",
  );

  for (const forbidden of FORBIDDEN_TERMINATION_REASONS) {
    assert.notEqual(stats.termination_reason, forbidden);
  }

  const src = readFileSync(resolve(process.cwd(), "src/lib/copyright.functions.ts"), "utf8");
  assert.doesNotMatch(src, /enough_matches_found/);
  assert.doesNotMatch(src, /maximum_verified_findings_reached/);
  assert.ok(DEFAULT_PAGE_CAP >= 160);
});
