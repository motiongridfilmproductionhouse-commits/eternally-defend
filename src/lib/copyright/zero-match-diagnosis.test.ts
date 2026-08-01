import assert from "node:assert/strict";
import test from "node:test";
import {
  expandTitleVariants,
  hasExactTitleIdentity,
  queryTitleVariants,
} from "./title-identity";
import {
  classifyCopyrightPage,
  extractTitleMatchedDetailLinks,
} from "./page-classify.server";
import { buildQueries, type ReferenceAnalysis } from "./discover.server";
import {
  diagnosticsFromStats,
  explainZeroMatchFunnel,
} from "./scan-diagnostics";
import { isActionablePiracy } from "./taxonomy";
import {
  filterClientVisibleCopyrightMatches,
} from "./client-filter";

const long = (s: string) =>
  `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;

test("spiderman vs Spider-Man brand new day title identity matches", () => {
  const userTitle = "spiderman brand new day";
  const pageBlob =
    "Watch Spider-Man: Brand New Day full movie online free HDCAM";
  const hit = hasExactTitleIdentity(pageBlob, [userTitle], "2026");
  assert.equal(hit.match, true, `expected identity match, evidence=${hit.evidence.join(",")}`);

  const reverse = hasExactTitleIdentity(
    "spiderman brand new day watch online free",
    ["Spider-Man: Brand New Day"],
  );
  assert.equal(reverse.match, true);
});

test("query variants never emit bare single tokens", () => {
  const variants = queryTitleVariants("spiderman brand new day", [
    "Spider-Man: Brand New Day",
  ]);
  assert.ok(variants.length >= 2);
  for (const v of variants) {
    assert.notEqual(v.toLowerCase(), "spiderman");
    assert.notEqual(v.toLowerCase(), "spider");
    assert.ok(v.length >= 8);
  }
  assert.ok(
    variants.some((v) => /spider[\s-]?man/i.test(v) || /spiderman/i.test(v)),
  );
});

test("exact-title page with playable unauthorized stream → visible", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/watch/spiderman-brand-new-day",
    pageTitle: "Spider-Man Brand New Day Watch Full Movie",
    markdown: long(
      "Watch full movie Spider-Man Brand New Day online free. Streaming server 1.",
    ),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe>',
    links: ["https://doodstream.com/e/abc"],
    titles: ["spiderman brand new day", "Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(result.clientVisible, true);
  assert.ok(isActionablePiracy(result.classification));
});

test("exact-title download/file-host page → visible", () => {
  const result = classifyCopyrightPage({
    url: "https://dlhub.test/spiderman-brand-new-day-download",
    pageTitle: "Spider-Man Brand New Day Download Full Movie",
    markdown: long("Download full movie Spider-Man Brand New Day from mega."),
    html: '<a href="https://mega.nz/file/abc">Download</a>',
    links: ["https://mega.nz/file/abc"],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(result.clientVisible, true);
  assert.ok(
    result.classification === "DOWNLOAD_PAGE" ||
      result.classification === "FILE_HOST_DISTRIBUTION",
  );
});

test("exact-title torrent/magnet page → visible", () => {
  const magnet =
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Spider-Man";
  const result = classifyCopyrightPage({
    url: "https://torrentindex.test/spiderman-brand-new-day",
    pageTitle: "Spider-Man Brand New Day 1080p WEBRip torrent",
    markdown: long(`Spider-Man Brand New Day WEBRip torrent ${magnet}`),
    html: `<a href="${magnet}">magnet</a>`,
    links: [magnet],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(result.classification, "TORRENT_OR_MAGNET");
  assert.equal(result.clientVisible, true);
});

test("exact-title CAM/theatre-print distribution page → visible", () => {
  const result = classifyCopyrightPage({
    url: "https://leakprint.test/spiderman-brand-new-day-hdcam",
    pageTitle: "Spider-Man Brand New Day HDCAM Theatre Print",
    markdown: long(
      "Spider-Man Brand New Day HDTS theatre print. Watch full movie on server 1.",
    ),
    html: '<iframe src="https://streamtape.com/e/cam"></iframe>',
    links: ["https://streamtape.com/e/cam"],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(result.classification, "THEATRE_PRINT_DISTRIBUTION");
  assert.equal(result.clientVisible, true);
});

test("title listing → followed to qualifying detail page", () => {
  const details = extractTitleMatchedDetailLinks({
    pageUrl: "https://piracylib.test/latest-movies",
    html: `<a href="/movie/spider-man-brand-new-day-full-movie">Spider-Man Brand New Day Full Movie</a>`,
    markdown: "Latest movies listing",
    links: [
      "https://piracylib.test/movie/spider-man-brand-new-day-full-movie",
      "https://piracylib.test/category/latest",
    ],
    titles: ["spiderman brand new day"],
    limit: 4,
  });
  assert.ok(details.some((u) => u.includes("spider-man-brand-new-day")));
});

test("cinema/showtime/review/trailer/official page → rejected", () => {
  const cinema = classifyCopyrightPage({
    url: "https://www.voxcinemas.com/movies/spider-man-brand-new-day",
    pageTitle: "Spider-Man Brand New Day | Now Showing",
    markdown: long("Book tickets. Showtimes today. Buy tickets."),
    html: "",
    links: [],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(cinema.classification, "CINEMA_OR_SHOWTIME");
  assert.equal(cinema.clientVisible, false);

  const trailer = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=trailer",
    pageTitle: "Spider-Man Brand New Day Official Trailer",
    markdown: long("Watch the official trailer. Teaser trailer out now."),
    html: '<iframe src="https://www.youtube.com/embed/trailer"></iframe>',
    links: [],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(trailer.classification, "TRAILER_OR_PROMO");
  assert.equal(trailer.clientVisible, false);

  const official = classifyCopyrightPage({
    url: "https://www.netflix.com/title/spider-man-brand-new-day",
    pageTitle: "Spider-Man Brand New Day | Netflix",
    markdown: long("Watch Spider-Man Brand New Day on Netflix."),
    html: "",
    links: [],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(official.classification, "OFFICIAL_OR_AUTHORIZED");
  assert.equal(official.clientVisible, false);
});

test("inaccessible/snippet-only page → internal lead, not client-visible", () => {
  const failed = classifyCopyrightPage({
    url: "https://down.test/spiderman",
    titles: ["spiderman brand new day"],
    pageInspected: false,
  });
  assert.equal(failed.classification, "UNVERIFIED_LEAD");
  assert.equal(failed.clientVisible, false);

  const snippet = classifyCopyrightPage({
    url: "https://mystery.test/spiderman",
    pageTitle: "Spider-Man Brand New Day full movie",
    markdown: "snippet",
    pageInspected: true,
    snippetOnly: true,
    titles: ["spiderman brand new day"],
  });
  assert.equal(snippet.classification, "UNVERIFIED_LEAD");
  assert.equal(snippet.clientVisible, false);
});

test("provider candidates all filtered → diagnostic counters accurate", () => {
  const stats = {
    queries_generated: 32,
    queries_executed: 32,
    provider_results: 40,
    unique_candidate_pages: 28,
    listing_pages_found: 3,
    detail_pages_followed: 2,
    pages_crawled: 18,
    pages_failed: 4,
    title_identity_rejected: 6,
    hard_negative_rejected: 8,
    access_evidence_rejected: 5,
    artwork_only_rejected: 3,
    access_evidence_pages: 0,
    embedded_players: 0,
    download_pages: 0,
    file_host_destinations: 0,
    torrents_magnets: 0,
    theatre_print_findings: 0,
    internal_leads_persisted: 12,
    client_visible_findings: 0,
    matches: 0,
  };
  const d = diagnosticsFromStats(stats);
  assert.equal(d.queries_generated, 32);
  assert.equal(d.client_visible_findings, 0);
  assert.equal(d.hard_negative_rejected, 8);
  assert.equal(d.access_evidence_rejected, 5);
  const funnel = explainZeroMatchFunnel(stats);
  assert.ok(funnel.length >= 5);
  assert.ok(funnel.some((l) => /Primary bottleneck/i.test(l)));

  const visible = filterClientVisibleCopyrightMatches([
    {
      detection_type: "DUPLICATE_ARTWORK_ONLY",
      evidence: { client_visible: false, identity_only: true },
    },
    {
      detection_type: "CINEMA_OR_SHOWTIME",
      evidence: { client_visible: false },
    },
    {
      detection_type: "UNVERIFIED_LEAD",
      evidence: { client_visible: false, snippet_only: true },
    },
  ]);
  assert.equal(visible.length, 0);
});

test("buildQueries covers watch online / stream / CAM for title variants", () => {
  const analysis: ReferenceAnalysis = {
    title: "Spider-Man: Brand New Day",
    altTitles: [],
    language: "english",
    audienceLanguages: [],
    region: null,
    actors: [],
    productionCompany: null,
    releaseDate: "2026-07-31",
    descriptors: [],
    ocrText: null,
    watermark: null,
    visualFeatures: [],
    mediaType: "poster",
  };
  const plans = buildQueries(analysis, "spiderman brand new day");
  assert.ok(plans.some((p) => /watch online/i.test(p.query)));
  assert.ok(plans.some((p) => /\bstream\b/i.test(p.query)));
  assert.ok(plans.some((p) => /\bCAM\b|\bHDCAM\b/i.test(p.query)));
  assert.ok(plans.some((p) => /spiderman brand new day/i.test(p.query)));
  for (const p of plans) {
    assert.notEqual(p.query.trim().toLowerCase(), "spiderman");
    assert.notEqual(p.query.trim().toLowerCase(), "spider");
  }
});

test("expandTitleVariants produces spider-man compounds", () => {
  const variants = expandTitleVariants("spiderman brand new day");
  assert.ok(variants.some((v) => /spider\s+man\s+brand\s+new\s+day/i.test(v)));
  assert.ok(variants.some((v) => v.replace(/\s+/g, "") === "spidermanbrandnewday"));
});

test("short single-word titles still establish identity", () => {
  assert.equal(
    hasExactTitleIdentity("Watch Soul full movie online free", ["Soul"]).match,
    true,
  );
  assert.equal(
    hasExactTitleIdentity("Nope official theatre print watch online", ["Nope"]).match,
    true,
  );
});

test("generic watch now CTA does not override official trailer rejection", () => {
  const result = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=officialtrailer",
    pageTitle: "Spider-Man Brand New Day – Official Trailer | Watch Now",
    markdown: long(
      "Official trailer for Spider-Man Brand New Day. Watch now on YouTube. Teaser trailer out now.",
    ),
    html: '<iframe src="https://www.youtube.com/embed/officialtrailer"></iframe>',
    links: [],
    titles: ["spiderman brand new day"],
    pageInspected: true,
  });
  assert.equal(result.classification, "TRAILER_OR_PROMO");
  assert.equal(result.clientVisible, false);
});
