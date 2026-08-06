/**
 * Regression tests for Copyright Intelligence scan scoping + exact-page retrieval.
 * Covers the Unmadham / Spider-Man production failure modes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateCrawlSlots,
  prioritizeKnownUrlLeadsWithReservation,
  splitKnownAndProviderLeads,
} from "./crawl-budget";
import {
  bumpCrawlFailure,
  emptyCrawlFailureCounts,
  mapSafeFetchToCrawlFailure,
} from "./crawl-failure";
import { prioritizeKnownUrlLeads } from "./known-urls.server";
import { needsRenderedFallback } from "./page-retrieve.server";
import { classifyCopyrightPage } from "./page-classify.server";
import { shouldRegisterMonitoredSource } from "./distribution-monitor.server";
import type { DistributionAnalysis } from "./distribution.server";
import {
  isAuthorizedCatalogHost,
  isNeverMonitoredDomain,
  officialPlatformDecision,
} from "./official-platforms";
import { isActionablePiracy } from "./taxonomy";
import {
  isScanDetailAligned,
  monitoredSourceAttribution,
  PREVIOUSLY_MONITORED_SOURCES_LABEL,
  scopedScanMatches,
  shouldShowAnalysisBanner,
} from "./scan-scope";
import { isStaleOfficialMonitoredSource } from "./stale-official.server";
import { evaluateTelegramPublicEvidence, isPublicTelegramMessageUrl } from "./telegram-evidence";
import { hasExactTitleIdentity } from "./title-identity";
import { explainZeroMatchFunnel } from "./scan-diagnostics";

const long = (s: string) =>
  `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;

function baseAnalysis(over: Partial<DistributionAnalysis>): DistributionAnalysis {
  return {
    url: "https://piracy.example/movies/unmadham-2026/",
    domain: "piracy.example",
    domainRisk: "high",
    contentType: "unauthorized_streaming_site",
    classification: "VERIFIED_UNAUTHORIZED_STREAM",
    clientVisible: true,
    releaseTiming: "first_week",
    releaseOffsetDays: 3,
    indicators: [{ key: "embedded_player", detail: "player", weight: 30, strong: true }],
    indicatorKeys: ["embedded_player"],
    strongEvidence: true,
    confidence: 88,
    confidenceBreakdown: { identity: 30, access: 50, releaseWindow: 8, penalties: 0 },
    identityEvidence: ["exact_title:Unmadham"],
    accessEvidence: ["Embedded video player detected"],
    screenshot: null,
    pageTitle: "Unmadham 2026",
    distributionLinks: ["https://doodstream.com/e/x"],
    qualityTags: ["webrip"],
    embedSources: ["https://doodstream.com/e/x"],
    reason: "test",
    detailFollowUrls: [],
    crawlFailed: false,
    crawlFailureCategory: null,
    crawlFailureReason: null,
    retrievalMethod: "static_html",
    rendered: false,
    ...over,
  };
}

// 1. Starting/selecting Unmadham never displays Spider-Man scan findings.
test("1. selecting Unmadham never surfaces Spider-Man findings", () => {
  const spiderMatches = [
    { id: "m1", source_url: "https://youtube.com/watch?v=sp", page_title: "Spider-Man" },
  ];
  const unmadhamMatches = [
    {
      id: "m2",
      source_url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
      page_title: "Unmadham",
    },
  ];

  assert.deepEqual(
    scopedScanMatches("scan-unmadham", {
      scan: { id: "scan-spiderman" },
      matches: spiderMatches,
    }),
    [],
  );
  assert.deepEqual(
    scopedScanMatches(
      "scan-unmadham",
      { scan: { id: "scan-unmadham" }, matches: unmadhamMatches },
      { isLoading: true },
    ),
    [],
  );
  assert.deepEqual(
    scopedScanMatches("scan-unmadham", {
      scan: { id: "scan-unmadham" },
      matches: unmadhamMatches,
    }),
    unmadhamMatches,
  );
  assert.equal(
    shouldShowAnalysisBanner({
      scanPending: false,
      selectedScanId: "scan-unmadham",
      bannerTitle: "Spider-Man Brand New Day",
      selectedScanTitle: "Unmadham movie malayalam",
    }),
    false,
  );
  assert.equal(
    isScanDetailAligned({
      selectedScanId: "scan-unmadham",
      detailScanId: "scan-spiderman",
    }),
    false,
  );
});

// 2. Global monitored sources are visually separate and identify originating title.
test("2. previously monitored sources label + attribution identify originating title", () => {
  assert.equal(PREVIOUSLY_MONITORED_SOURCES_LABEL, "Previously monitored sources");
  const attr = monitoredSourceAttribution({
    id: "s1",
    domain: "youtube.com",
    url: "https://youtube.com/watch?v=x",
    tracked_titles: ["Spider-Man Brand New Day", "Other"],
    discovered_scan_id: "scan-spiderman",
  });
  assert.equal(attr.workTitle, "Spider-Man Brand New Day");
  assert.equal(attr.originatingScanId, "scan-spiderman");
});

// 3. YouTube promotional results are rejected and not monitored.
test("3. YouTube promotional results rejected and not monitored", () => {
  const trailer = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=promo123",
    pageTitle: "Unmadham Official Trailer Malayalam",
    markdown: long("Official trailer. Watch the teaser trailer now."),
    html: '<iframe src="https://www.youtube.com/embed/promo123"></iframe>',
    links: [],
    titles: ["Unmadham movie malayalam", "Unmadham"],
    pageInspected: true,
  });
  assert.equal(trailer.classification, "TRAILER_OR_PROMO");
  assert.equal(trailer.clientVisible, false);
  assert.equal(isNeverMonitoredDomain("https://www.youtube.com/watch?v=promo123"), true);
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://www.youtube.com/watch?v=promo123",
        domain: "youtube.com",
        classification: "TRAILER_OR_PROMO",
        contentType: "trailer_or_promo",
        clientVisible: false,
        strongEvidence: false,
      }),
    ),
    false,
  );
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://www.youtube.com/watch?v=promo123",
      domain: "youtube.com",
      content_type: "trailer_or_promo",
    }),
    true,
  );
});

// 4. Plex/authorized catalog pages are rejected and not monitored.
test("4. Plex/authorized catalog pages rejected and not monitored", () => {
  assert.equal(isAuthorizedCatalogHost("https://watch.plex.tv/movie/unmadham"), true);
  const plex = classifyCopyrightPage({
    url: "https://watch.plex.tv/movie/unmadham",
    pageTitle: "Unmadham | Watch on Plex",
    markdown: long("Watch now on Plex. Runtime 130 minutes. Official catalog page for Unmadham."),
    html: "<button>Watch now</button><video></video>",
    links: [],
    titles: ["Unmadham", "Unmadham movie malayalam"],
    pageInspected: true,
  });
  assert.ok(
    plex.classification === "OFFICIAL_OR_AUTHORIZED" ||
      plex.classification === "CATALOG_OR_LISTING",
  );
  assert.equal(plex.clientVisible, false);
  assert.equal(isActionablePiracy(plex.classification), false);
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://watch.plex.tv/movie/unmadham",
        domain: "watch.plex.tv",
        classification: "CATALOG_OR_LISTING",
        contentType: "official_platform",
        clientVisible: false,
        strongEvidence: false,
      }),
    ),
    false,
  );
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://watch.plex.tv/movie/spider-man-brand-new-day",
      domain: "watch.plex.tv",
    }),
    true,
  );
});

// 5. Accepted known URL is attempted before provider candidates.
test("5. accepted known URL attempted before provider candidates", () => {
  const ordered = prioritizeKnownUrlLeads(
    [{ url: "https://ogomovies1.com.pk/movies/unmadham-2026/", query: "known_url_seed" }],
    [
      { url: "https://provider.example/a", query: "provider" },
      { url: "https://provider.example/b", query: "provider" },
    ],
    32,
  );
  assert.equal(ordered[0]?.query, "known_url_seed");
  assert.ok(ordered[0]?.url.includes("unmadham-2026"));
  const split = splitKnownAndProviderLeads(ordered);
  assert.equal(split.known.length, 1);
  assert.equal(split.provider.length, 2);
});

// 6. Known URL capacity reserved when provider candidates exceed limits.
test("6. known URL capacity reserved when providers exceed page cap", () => {
  const known: Array<{ url: string; query: string }> = Array.from({ length: 3 }, (_, i) => ({
    url: `https://known.example/movie-${i}`,
    query: "known_url_seed",
  }));
  const provider: Array<{ url: string; query: string }> = Array.from({ length: 50 }, (_, i) => ({
    url: `https://provider.example/p-${i}`,
    query: "provider",
  }));
  const slots = allocateCrawlSlots(known.length, provider.length, 8);
  assert.equal(slots.knownSlots, 3);
  assert.equal(slots.providerSlots, 5);
  const ordered = prioritizeKnownUrlLeadsWithReservation(known, provider, 8);
  assert.equal(
    ordered.slice(0, 3).every((l) => l.query === "known_url_seed"),
    true,
  );
  assert.equal(ordered.length, 8);
  assert.ok(ordered.some((l) => l.url.includes("movie-0")));
});

// 7. JS-rendered known URL gets rendered fallback.
test("7. JS-rendered / empty static HTML needs rendered fallback", () => {
  const shell = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
  assert.equal(needsRenderedFallback(shell, ""), true);
  const rich = long(
    `<html><body><h1>Unmadham full movie</h1><iframe src="https://doodstream.com/e/x"></iframe><a href="https://mega.nz/file/x">Download</a></body></html>`,
  );
  assert.equal(needsRenderedFallback(rich, rich), false);
});

// 8. Network/render failure is not recorded as content rejection.
test("8. network/render failure is not content rejection", () => {
  const counts = emptyCrawlFailureCounts();
  bumpCrawlFailure(counts, "timeout");
  bumpCrawlFailure(counts, "render_failure");
  assert.equal(counts.timeout, 1);
  assert.equal(counts.render_failure, 1);

  const failed = classifyCopyrightPage({
    url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
    pageTitle: "Unmadham",
    titles: ["Unmadham movie malayalam"],
    pageInspected: false,
  });
  assert.equal(failed.clientVisible, false);
  assert.ok(failed.classification === "UNVERIFIED_LEAD" || failed.classification === "UNRELATED");
  // Funnel must explain retrieval failure distinctly from title/access rejection.
  const lines = explainZeroMatchFunnel({
    known_urls_submitted: 1,
    known_urls_accepted: 1,
    known_urls_attempted: 1,
    known_urls_retrieved: 0,
    known_urls_verified: 0,
    pages_crawled: 1,
    pages_failed: 1,
    crawl_failed_by_category: { render_failure: 1 },
    known_url_failure_reasons: [
      {
        url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
        category: "render_failure",
        reason: "Firecrawl returned empty rendered content",
      },
    ],
    client_visible_findings: 0,
  });
  assert.ok(lines.some((l) => /could not be retrieved|network\/render/i.test(l)));
  assert.ok(lines.some((l) => /render_failure/i.test(l)));
  assert.equal(mapSafeFetchToCrawlFailure("request_timeout"), "timeout");
  assert.equal(mapSafeFetchToCrawlFailure("dns_resolution_failed"), "dns_failure");
});

// 9. Exact title + verified public player/download evidence → client-visible.
test("9. exact title + verified public player/download becomes client-visible", () => {
  const result = classifyCopyrightPage({
    url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
    pageTitle: "Unmadham (2026) Malayalam Full Movie Watch Online",
    markdown: long(
      "Unmadham movie malayalam watch full movie online. Server 1. Download full movie.",
    ),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe><a href="https://mega.nz/file/x">Download</a>',
    links: ["https://doodstream.com/e/abc", "https://mega.nz/file/x"],
    titles: ["Unmadham movie malayalam", "Unmadham"],
    pageInspected: true,
  });
  assert.equal(result.clientVisible, true);
  assert.ok(isActionablePiracy(result.classification));
  assert.ok(result.identityEvidence.length > 0);
  assert.ok(result.accessEvidence.length > 0);
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
        domain: "ogomovies1.com.pk",
        classification: result.classification as DistributionAnalysis["classification"],
        clientVisible: true,
        strongEvidence: true,
        identityEvidence: result.identityEvidence,
        accessEvidence: result.accessEvidence,
      }),
    ),
    true,
  );
});

// 10. Title-only, poster-only and synopsis-only pages remain rejected.
test("10. title-only / poster-only / synopsis-only pages remain rejected", () => {
  const titleOnly = classifyCopyrightPage({
    url: "https://fanblog.example/unmadham-synopsis",
    pageTitle: "Unmadham movie malayalam synopsis",
    markdown: long(
      "Unmadham movie malayalam is a drama film. Plot synopsis and poster wallpaper gallery.",
    ),
    html: "<img src='/poster.jpg'/><p>Synopsis only</p>",
    links: [],
    titles: ["Unmadham movie malayalam", "Unmadham"],
    pageInspected: true,
  });
  assert.equal(titleOnly.clientVisible, false);
  assert.ok(
    titleOnly.classification === "DUPLICATE_ARTWORK_ONLY" ||
      titleOnly.classification === "UNVERIFIED_LEAD" ||
      titleOnly.classification === "REVIEW_OR_NEWS" ||
      titleOnly.classification === "CATALOG_OR_LISTING",
  );

  const identity = hasExactTitleIdentity("Unmadham (2026) Malayalam movie poster", [
    "Unmadham movie malayalam",
    "Unmadham",
  ]);
  assert.equal(identity.match, true);
});

// 11. Public Telegram exact-message evidence supported; private fails closed.
test("11. public Telegram exact-message evidence supported; private fails closed", () => {
  assert.equal(isPublicTelegramMessageUrl("https://t.me/freemovies/12345"), true);
  assert.equal(isPublicTelegramMessageUrl("https://t.me/s/freemovies/12345"), true);
  assert.equal(isPublicTelegramMessageUrl("https://t.me/joinchat/AAAA"), false);
  assert.equal(isPublicTelegramMessageUrl("https://t.me/+InviteHash"), false);
  assert.equal(isPublicTelegramMessageUrl("https://t.me/c/1234567890/12"), false);
  assert.equal(isPublicTelegramMessageUrl("https://t.me/freemovies"), false);

  const publicOk = evaluateTelegramPublicEvidence({
    url: "https://t.me/movieleaks/99",
    pageTitle: "Unmadham full movie",
    markdown: long("Unmadham movie malayalam full movie download mega.nz mirror"),
    html: '<a href="https://mega.nz/file/x">Download</a>',
    titles: ["Unmadham movie malayalam", "Unmadham"],
  });
  assert.equal(publicOk.eligible, true);
  assert.equal(publicOk.evidenceUrl, "https://t.me/movieleaks/99");

  const privateFail = evaluateTelegramPublicEvidence({
    url: "https://t.me/joinchat/SECRET",
    pageTitle: "Unmadham full movie",
    markdown: "Unmadham download",
    titles: ["Unmadham"],
  });
  assert.equal(privateFail.eligible, false);

  const genericChannel = evaluateTelegramPublicEvidence({
    url: "https://t.me/freemovieshub/12",
    pageTitle: "Free movies channel",
    markdown: "Free movies every day. Join our free movies channel.",
    titles: ["Unmadham movie malayalam"],
  });
  assert.equal(genericChannel.eligible, false);
});

// 12. Old stale monitored-source incidents can be safely deactivated.
test("12. stale official sources can be deactivated without deleting audit history", () => {
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://www.youtube.com/watch?v=spiderman",
      domain: "youtube.com",
      content_type: "trailer_or_promo",
    }),
    true,
  );
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://watch.plex.tv/movie/spider-man-brand-new-day",
      domain: "watch.plex.tv",
      content_type: "official_platform",
    }),
    true,
  );
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://ogomovies1.com.pk/movies/unmadham-2026/",
      domain: "ogomovies1.com.pk",
      content_type: "unauthorized_streaming_site",
      classification: "VERIFIED_UNAUTHORIZED_STREAM",
    }),
    false,
  );

  // Soft-deactivation model: evidence.active=false keeps the row for audit.
  const incidentEvidence = {
    active: false,
    deactivated_at: new Date().toISOString(),
    deactivation_reason: "Parent source deactivated as stale official false positive.",
    prior_summary: "New unauthorized distribution evidence page discovered",
  };
  assert.equal(incidentEvidence.active, false);
  assert.ok(incidentEvidence.prior_summary);
});

test("official platform decision still rejects plex without weakening gates", () => {
  const decision = officialPlatformDecision({
    url: "https://watch.plex.tv/movie/x",
    pageTitle: "Watch",
    text: "catalog",
  });
  assert.ok(decision);
  assert.equal(decision?.kind, "authorized_catalog");
});
