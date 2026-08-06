import assert from "node:assert/strict";
import test from "node:test";
import { classifyCopyrightPage, extractTitleMatchedDetailLinks } from "./page-classify.server";
import {
  crawlMetricsFromStats,
  explainZeroMatchFunnel,
  providerMetricsFromStats,
} from "./scan-diagnostics";
import { dedupeCopyrightMatchRows } from "./match-upsert";
import { CrawlMetricsRecorder } from "./crawl-metrics";
import { isActionablePiracy } from "./taxonomy";

const TITLES = ["Neon Horizon"];
const long = (s: string) =>
  `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;

test("listing page follows exact-title detail page link", () => {
  const details = extractTitleMatchedDetailLinks({
    pageUrl: "https://piracylib.test/latest-movies",
    html: `<a href="/movie/neon-horizon-full-movie">Neon Horizon Full Movie</a>`,
    markdown: "Latest movies listing",
    links: ["https://piracylib.test/movie/neon-horizon-full-movie"],
    titles: TITLES,
    limit: 5,
  });
  assert.ok(details.some((u) => u.includes("neon-horizon")));
});

test("trailer page is rejected as non-actionable", () => {
  const result = classifyCopyrightPage({
    url: "https://youtube.com/watch?v=trailer",
    pageTitle: "Neon Horizon Official Trailer",
    markdown: long("Watch the official trailer for Neon Horizon."),
    html: '<iframe src="https://youtube.com/embed/trailer"></iframe>',
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "TRAILER_OR_PROMO");
  assert.equal(result.clientVisible, false);
});

test("cinema timing page is rejected", () => {
  const result = classifyCopyrightPage({
    url: "https://voxcinemas.com/movies/neon-horizon",
    pageTitle: "Neon Horizon | Showtimes",
    markdown: long("Neon Horizon now showing. Book tickets. Showtimes today."),
    html: "<html>Book tickets showtimes</html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "CINEMA_OR_SHOWTIME");
  assert.equal(result.clientVisible, false);
});

test("exact-title page with embedded player becomes a finding", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/watch/neon-horizon",
    pageTitle: "Neon Horizon Watch Full Movie",
    markdown: long("Watch full movie Neon Horizon online free streaming server."),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe>',
    links: ["https://doodstream.com/e/abc"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.clientVisible, true);
  assert.ok(isActionablePiracy(result.classification));
  assert.ok(result.accessEvidence.length > 0);
});

test("exact-title page with only poster is not a finding", () => {
  const result = classifyCopyrightPage({
    url: "https://fanwall.example/neon-horizon-poster",
    pageTitle: "Neon Horizon poster HD",
    markdown: long("Neon Horizon poster gallery wallpaper download for desktop."),
    html: "<html><img alt='Neon Horizon poster' src='/poster.jpg'/></html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.clientVisible, false);
  assert.equal(result.strongAccess, false);
});

test("provider success remains success when crawling later fails", () => {
  const stats = {
    provider_requests: 9,
    provider_successes: 9,
    provider_failures: 0,
    provider_results: 27,
    pages_crawled: 13,
    pages_failed: 9,
    crawl_failed_by_category: { empty_static_html: 8, provider_failure: 1 },
    crawl_metrics: {
      static_fetch_empty: 8,
      browser_fallback_failed: 9,
      findings_created: 0,
    },
  };
  const provider = providerMetricsFromStats(stats);
  assert.equal(provider.requested, 9);
  assert.equal(provider.succeeded, 9);
  assert.equal(provider.failed, 0);
  assert.equal(provider.result_count, 27);
  const funnel = explainZeroMatchFunnel(stats);
  assert.ok(funnel.some((line) => line.includes("9 successful")));
  assert.ok(funnel.some((line) => line.includes("separate from crawl failures")));
});

test("duplicate findings are merged by canonical URL", () => {
  const rows = dedupeCopyrightMatchRows([
    {
      source_url: "https://Example.COM/watch/neon-horizon/",
      detection_type: "UNVERIFIED_LEAD",
      confidence: 0.2,
      evidence: { client_visible: false },
    },
    {
      source_url: "https://example.com/watch/neon-horizon",
      detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
      confidence: 0.92,
      evidence: { client_visible: true },
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.detection_type, "VERIFIED_UNAUTHORIZED_STREAM");
});

test("browser failure is recorded without losing crawl metrics shape", () => {
  const recorder = new CrawlMetricsRecorder();
  recorder.recordStaticEmpty();
  recorder.recordBrowserAttempt();
  recorder.recordBrowserFailure();
  const merged = recorder.mergeToStats({});
  const crawl = crawlMetricsFromStats(merged);
  assert.equal(crawl.static_fetch_empty, 1);
  assert.equal(crawl.browser_fallback_attempted, 1);
  assert.equal(crawl.browser_fallback_failed, 1);
  assert.equal(crawl.browser_fallback_succeeded, 0);
});
