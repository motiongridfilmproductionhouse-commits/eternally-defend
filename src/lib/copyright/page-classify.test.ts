import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCopyrightPage,
  detectPrimaryPurpose,
  extractTitleMatchedDetailLinks,
  hasExactTitleIdentity,
} from "./page-classify.server";
import {
  isActionablePiracy,
  isClientVisiblePiracyMatch,
  normalizeClassification,
} from "./taxonomy";
import {
  filterClientVisibleCopyrightMatches,
  isClientVisibleCopyrightMatch,
} from "./client-filter";
import { piracyCategory, buildQueries, type ReferenceAnalysis } from "./discover.server";
import { isExcludedHost, canonicalUrl } from "./url.server";

const TITLES = ["Neon Horizon"];

const long = (s: string) =>
  `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;

test("1. VOX/showtime page → CINEMA_OR_SHOWTIME, not piracy", () => {
  const result = classifyCopyrightPage({
    url: "https://www.voxcinemas.com/movies/neon-horizon",
    pageTitle: "Neon Horizon | Now Showing | VOX Cinemas",
    markdown: long(
      "Neon Horizon is now showing at VOX Cinemas. Book tickets online. Showtimes today 4:00 PM, 7:30 PM. Buy tickets and select seats.",
    ),
    html: "<html><body>Book tickets Now Showing Showtimes</body></html>",
    links: ["https://www.voxcinemas.com/booking/neon-horizon"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "CINEMA_OR_SHOWTIME");
  assert.equal(result.clientVisible, false);
  assert.equal(isActionablePiracy(result.classification), false);
});

test("2. District/cast/review page → rejected", () => {
  const cast = classifyCopyrightPage({
    url: "https://example-movies.info/cast/neon-horizon",
    pageTitle: "Neon Horizon Cast and Crew",
    markdown: long(
      "Full cast and crew credits for Neon Horizon. Actor biography and character list.",
    ),
    html: "<html></html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(cast.classification, "CAST_OR_INFORMATION");
  assert.equal(cast.clientVisible, false);

  const review = classifyCopyrightPage({
    url: "https://filmblog.example/neon-horizon-movie-review",
    pageTitle: "Neon Horizon Movie Review — 3.5/5",
    markdown: long("Our critic review of Neon Horizon. Rating and opinion. Box office outlook."),
    html: "<html></html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(review.classification, "REVIEW_OR_NEWS");
  assert.equal(review.clientVisible, false);
});

test("3. YouTube official trailer → TRAILER_OR_PROMO", () => {
  const result = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=abc123trailer",
    pageTitle: "Neon Horizon – Official Trailer",
    markdown: long("Watch the official trailer for Neon Horizon. Teaser trailer out now."),
    html: '<iframe src="https://www.youtube.com/embed/abc123trailer"></iframe>',
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "TRAILER_OR_PROMO");
  assert.equal(result.clientVisible, false);
});

test("4. Reddit discussion without access URL → SOCIAL_DISCUSSION", () => {
  const result = classifyCopyrightPage({
    url: "https://www.reddit.com/r/movies/comments/xyz/neon_horizon_discussion/",
    pageTitle: "Neon Horizon discussion thread",
    markdown: long("What did you think of Neon Horizon? Spoiler thread. Comment thread for fans."),
    html: "<html></html>",
    links: ["https://www.reddit.com/r/movies/"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "SOCIAL_DISCUSSION");
  assert.equal(result.clientVisible, false);
});

test("5. Poster/OCR/actor match only → DUPLICATE_ARTWORK_ONLY", () => {
  const result = classifyCopyrightPage({
    url: "https://fanwallpapers.example/neon-horizon-poster",
    pageTitle: "Neon Horizon poster HD wallpaper",
    markdown: long(
      "Neon Horizon poster gallery and wallpaper download for desktop. Fan art image gallery.",
    ),
    html: "<html><img src='/poster.jpg'/></html>",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.ok(
    result.classification === "DUPLICATE_ARTWORK_ONLY" ||
      result.classification === "UNVERIFIED_LEAD",
  );
  assert.equal(result.clientVisible, false);
  assert.equal(result.identityMatch, true);
});

test("6. Exact title plus full-movie player → probable/verified distribution", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/watch/neon-horizon-full-movie",
    pageTitle: "Watch Neon Horizon Full Movie Online Free",
    markdown: long(
      "Watch the full movie Neon Horizon online free in HD. Streaming server 1 ready.",
    ),
    html: '<iframe src="https://doodstream.com/e/abc123"></iframe><video src="https://cdn.example/movie.m3u8"></video>',
    links: ["https://doodstream.com/e/abc123"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.ok(
    result.classification === "VERIFIED_UNAUTHORIZED_STREAM" ||
      result.classification === "PROBABLE_UNAUTHORIZED_STREAM",
  );
  assert.equal(result.clientVisible, true);
  assert.equal(result.strongAccess, true);
});

test("7. Exact title plus download/file-host destination → actionable", () => {
  const result = classifyCopyrightPage({
    url: "https://dlhub.test/neon-horizon-download",
    pageTitle: "Neon Horizon Download Full Movie",
    markdown: long("Download full movie Neon Horizon from file host mirrors. Click to download."),
    html: '<a href="https://mega.nz/file/abc">Download</a>',
    links: ["https://mega.nz/file/abc", "https://mediafire.com/file/xyz"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.ok(
    result.classification === "DOWNLOAD_PAGE" || result.classification === "FILE_HOST_DISTRIBUTION",
  );
  assert.equal(result.clientVisible, true);
  assert.ok(result.distributionLinks.length >= 1);
});

test("8. Exact title plus magnet/torrent → actionable", () => {
  const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Neon+Horizon";
  const result = classifyCopyrightPage({
    url: "https://torrentindex.test/neon-horizon",
    pageTitle: "Neon Horizon 1080p WEBRip torrent",
    markdown: long(`Neon Horizon WEBRip torrent download. ${magnet}`),
    html: `<a href="${magnet}">magnet</a>`,
    links: [magnet],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "TORRENT_OR_MAGNET");
  assert.equal(result.clientVisible, true);
});

test("9. CAM/HDTS theatre-print detail page → THEATRE_PRINT_DISTRIBUTION", () => {
  const result = classifyCopyrightPage({
    url: "https://leakprint.test/neon-horizon-hdcam",
    pageTitle: "Neon Horizon HDCAM Theatre Print Watch Full Movie",
    markdown: long(
      "Neon Horizon HDTS theatre print. Watch full movie. Cinema recording available on server 1.",
    ),
    html: '<iframe src="https://streamtape.com/e/camprint"></iframe>',
    links: ["https://streamtape.com/e/camprint"],
    titles: TITLES,
    releaseDate: new Date().toISOString().slice(0, 10),
    pageInspected: true,
  });
  assert.equal(result.classification, "THEATRE_PRINT_DISTRIBUTION");
  assert.equal(result.clientVisible, true);
});

test("10. Listing page follows validated exact-title detail page", () => {
  const listingHtml = `
    <a href="/movie/neon-horizon-full-movie">Neon Horizon Full Movie</a>
    <a href="/category/latest">Latest</a>
    <a href="/movie/other-film">Other Film</a>
  `;
  const details = extractTitleMatchedDetailLinks({
    pageUrl: "https://piracylib.test/latest-movies",
    html: listingHtml,
    markdown: "Latest movies listing Neon Horizon",
    links: [
      "https://piracylib.test/movie/neon-horizon-full-movie",
      "https://piracylib.test/category/latest",
      "https://piracylib.test/movie/other-film",
      "https://evil.other/neon-horizon",
    ],
    titles: TITLES,
    limit: 4,
  });
  assert.ok(details.some((u) => u.includes("neon-horizon-full-movie")));
  assert.ok(!details.some((u) => u.includes("evil.other")));
  assert.ok(!details.some((u) => u.includes("/category/")));
});

test("11. Search snippet alone cannot become a finding", () => {
  const result = classifyCopyrightPage({
    url: "https://mystery.test/neon-horizon",
    pageTitle: "Neon Horizon full movie",
    markdown: "snippet only",
    html: "",
    links: [],
    titles: TITLES,
    pageInspected: true,
    snippetOnly: true,
  });
  assert.equal(result.classification, "UNVERIFIED_LEAD");
  assert.equal(result.clientVisible, false);
});

test("12. Crawl failure fails closed", () => {
  const result = classifyCopyrightPage({
    url: "https://down.test/neon-horizon",
    pageTitle: "Neon Horizon",
    titles: TITLES,
    pageInspected: false,
  });
  assert.equal(result.classification, "UNVERIFIED_LEAD");
  assert.equal(result.clientVisible, false);
  assert.equal(result.strongAccess, false);
});

test("13. Unsafe/private URLs rejected from distribution links", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/watch/neon-horizon",
    pageTitle: "Neon Horizon Watch Full Movie",
    markdown: long("Watch full movie Neon Horizon free streaming"),
    html: '<iframe src="https://doodstream.com/e/ok"></iframe><a href="http://127.0.0.1/admin">x</a>',
    links: [
      "http://127.0.0.1/secret",
      "http://169.254.169.254/latest/meta-data",
      "https://mega.nz/file/ok",
      "ftp://files.example/movie.mkv",
    ],
    titles: TITLES,
    pageInspected: true,
  });
  assert.ok(!result.distributionLinks.some((l) => l.includes("127.0.0.1")));
  assert.ok(!result.distributionLinks.some((l) => l.includes("169.254")));
  assert.ok(!result.distributionLinks.some((l) => l.startsWith("ftp:")));
});

test("14. Official studio/OTT source rejected or authorized", () => {
  assert.equal(isExcludedHost("https://www.netflix.com/title/neon-horizon"), true);
  const result = classifyCopyrightPage({
    url: "https://www.netflix.com/title/neon-horizon",
    pageTitle: "Neon Horizon | Netflix",
    markdown: long("Watch Neon Horizon on Netflix."),
    html: "",
    links: [],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "OFFICIAL_OR_AUTHORIZED");
  assert.equal(result.clientVisible, false);
});

test("15. Distinct mirrors remain distinct", () => {
  const a = canonicalUrl("https://Mirror-One.test/watch/neon-horizon?utm_source=x");
  const b = canonicalUrl("https://mirror-two.test/watch/neon-horizon");
  assert.notEqual(a, b);
  assert.equal(
    canonicalUrl("https://www.mirror-one.test/watch/neon-horizon"),
    "https://mirror-one.test/watch/neon-horizon",
  );
});

test("16. Raw provider candidates cannot reach the UI", () => {
  const matches = [
    {
      detection_type: "UNVERIFIED_LEAD",
      evidence: { client_visible: false, discovery: "provider_raw" },
    },
    {
      detection_type: "DUPLICATE_ARTWORK_ONLY",
      evidence: { client_visible: false, identity_only: true },
    },
    {
      detection_type: "ripped_copy",
      evidence: { client_visible: true },
    },
    {
      detection_type: "video_clip",
      evidence: { identity_only: true },
    },
    {
      detection_type: "ripped_copy",
      evidence: {
        distribution: {
          content_type: "torrent_index_site",
          strong_evidence: true,
        },
      },
    },
    {
      detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
      evidence: {
        client_visible: true,
        distribution: {
          classification: "VERIFIED_UNAUTHORIZED_STREAM",
          strong_evidence: true,
          client_visible: true,
        },
      },
    },
  ];
  const visible = filterClientVisibleCopyrightMatches(matches);
  assert.equal(visible.length, 2);
  assert.ok(visible.some((m) => m.detection_type === "VERIFIED_UNAUTHORIZED_STREAM"));
  assert.ok(visible.some((m) => m.detection_type === "ripped_copy"));
  assert.equal(isClientVisibleCopyrightMatch(matches[2]!), false);
  assert.equal(isClientVisibleCopyrightMatch(matches[3]!), false);
  assert.equal(normalizeClassification("ripped_copy"), "UNVERIFIED_LEAD");
  assert.equal(normalizeClassification("video_clip"), "UNVERIFIED_LEAD");
});

test("cinema brand mention on piracy page does not hard-reject", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/neon-horizon-hdcam",
    pageTitle: "Neon Horizon HDCAM full movie — better than VOX Cinemas",
    markdown: long(
      "Watch full movie Neon Horizon HDCAM theatre print online free. Mention of VOX Cinemas for comparison only.",
    ),
    html: '<iframe src="https://doodstream.com/e/cam"></iframe>',
    links: ["https://doodstream.com/e/cam"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.equal(result.classification, "THEATRE_PRINT_DISTRIBUTION");
  assert.equal(result.clientVisible, true);
});

test("now showing + watch online player is not rejected as cinema", () => {
  const result = classifyCopyrightPage({
    url: "https://streamexample.test/neon-horizon-now-showing",
    pageTitle: "Neon Horizon now showing — watch online",
    markdown: long(
      "Neon Horizon now showing. Watch online free on streaming server 1. Download available.",
    ),
    html: '<iframe src="https://streamtape.com/e/watchonline"></iframe>',
    links: ["https://streamtape.com/e/watchonline"],
    titles: TITLES,
    pageInspected: true,
  });
  assert.notEqual(result.classification, "CINEMA_OR_SHOWTIME");
  assert.equal(result.clientVisible, true);
  assert.ok(isActionablePiracy(result.classification));
});

test("17. Legacy ripped_copy / cinema discovery category never auto-actionable", () => {
  assert.equal(
    piracyCategory("Neon Horizon now showing VOX Cinemas showtimes book tickets"),
    "cinema_or_showtime",
  );
  assert.equal(
    piracyCategory("Neon Horizon HDCAM theatre print watch full movie"),
    "cam_theatre_leak",
  );
  assert.equal(isActionablePiracy("ripped_copy"), false);
  assert.equal(isActionablePiracy("CINEMA_OR_SHOWTIME"), false);
  // Identity-only legacy labels stay hidden.
  assert.equal(
    isClientVisiblePiracyMatch({
      detectionType: "ripped_copy",
      clientVisible: true,
      strongEvidence: false,
    }),
    false,
  );
  assert.equal(
    isClientVisiblePiracyMatch({
      detectionType: "video_clip",
      clientVisible: true,
    }),
    false,
  );
  // Legacy distribution rows with strong_evidence remain visible.
  assert.equal(
    isClientVisiblePiracyMatch({
      detectionType: "ripped_copy",
      clientVisible: true,
      strongEvidence: true,
      contentType: "torrent_index_site",
    }),
    true,
  );
});

test("18. Queries require exact title + distribution phrase (never bare tokens)", () => {
  const analysis: ReferenceAnalysis = {
    title: "Neon Horizon",
    altTitles: ["Neon Horizon Malayalam"],
    language: "english",
    audienceLanguages: [],
    region: null,
    actors: ["Ava Stone"],
    productionCompany: null,
    releaseDate: "2026-07-01",
    descriptors: ["neon skyline"],
    ocrText: null,
    watermark: null,
    visualFeatures: [],
    mediaType: "poster",
  };
  const plans = buildQueries(analysis, "Neon Horizon");
  assert.ok(plans.length > 0);
  for (const p of plans) {
    assert.ok(
      /"neon horizon"/i.test(p.query) ||
        /"neon-horizon"/i.test(p.query) ||
        /neon horizon malayalam/i.test(p.query),
      `query missing exact title: ${p.query}`,
    );
    assert.notEqual(p.query.trim().toLowerCase(), "neon horizon");
    assert.notEqual(p.query.trim().toLowerCase(), '"neon horizon"');
  }
  assert.ok(plans.some((p) => /watch full movie/i.test(p.query)));
  assert.ok(plans.some((p) => /torrent|magnet/i.test(p.query)));
  assert.ok(plans.some((p) => /ogomovies1\.com\.pk/i.test(p.query)));
});

test("title identity helper requires near-exact title", () => {
  const hit = hasExactTitleIdentity("Watch Neon Horizon full movie online free", TITLES, "2026");
  assert.equal(hit.match, true);
  const miss = hasExactTitleIdentity("Watch Horizon news online", TITLES);
  assert.equal(miss.match, false);
});

test("detectPrimaryPurpose classifies cinema booking hosts", () => {
  assert.equal(
    detectPrimaryPurpose({
      url: "https://www.voxcinemas.com/movies/x",
      pageTitle: "Now Showing",
      text: "Book tickets showtimes",
      host: "voxcinemas.com",
    }),
    "cinema_or_showtime",
  );
});

test("mixed-signal showtime+cam snippets are kept for discovery inspection", () => {
  const text =
    "Neon Horizon now showing online free HDCAM theatre print download full movie torrent";
  assert.equal(piracyCategory(text), "cam_theatre_leak");
  // Soft cinema language alone would drop; piracy hints retain the lead.
  assert.equal(
    /(now showing|showtimes?)/i.test(text) &&
      !/(download|watch\s*online|hdcam|camrip|torrent|magnet|full\s*movie)/i.test(text),
    false,
  );
});
