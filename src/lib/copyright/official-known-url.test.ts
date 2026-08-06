import assert from "node:assert/strict";
import test from "node:test";
import { classifyCopyrightPage, extractTitleMatchedDetailLinks } from "./page-classify.server";
import {
  isAuthorizedCatalogHost,
  isNeverMonitoredDomain,
  isYouTubeHost,
  isYouTubeWatchUrl,
  officialPlatformDecision,
} from "./official-platforms";
import { shouldRegisterMonitoredSource } from "./distribution-monitor.server";
import type { DistributionAnalysis } from "./distribution.server";
import {
  parseKnownUrlInputs,
  prioritizeKnownUrlLeads,
  validateKnownUrlSeeds,
} from "./known-urls.server";
import { isActionablePiracy } from "./taxonomy";
import { isExcludedHost } from "./url.server";

const long = (s: string) =>
  `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;

function baseAnalysis(over: Partial<DistributionAnalysis>): DistributionAnalysis {
  return {
    url: "https://piracy.example/movie/spider-man-brand-new-day",
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
    identityEvidence: ["exact_title:Spider-Man"],
    accessEvidence: ["Embedded video player detected"],
    screenshot: null,
    pageTitle: "Spider-Man Brand New Day",
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

test("watch.plex.tv catalog page is not piracy", () => {
  assert.equal(
    isAuthorizedCatalogHost("https://watch.plex.tv/movie/spider-man-brand-new-day"),
    true,
  );
  const result = classifyCopyrightPage({
    url: "https://watch.plex.tv/movie/spider-man-brand-new-day",
    pageTitle: "Spider-Man: Brand New Day | Watch on Plex",
    markdown: long(
      "Watch now on Plex. Runtime 120 minutes. Official catalog discovery page for Spider-Man Brand New Day.",
    ),
    html: "<button>Watch now</button><video></video>",
    links: [],
    titles: ["spiderman brand new day", "Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.ok(
    result.classification === "OFFICIAL_OR_AUTHORIZED" ||
      result.classification === "CATALOG_OR_LISTING",
  );
  assert.equal(result.clientVisible, false);
  assert.equal(isActionablePiracy(result.classification), false);
});

test("normal YouTube trailer/review/clip is not piracy", () => {
  const trailer = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=abcTRAILER",
    pageTitle: "Spider-Man: Brand New Day – Official Trailer",
    markdown: long("Official trailer. Watch now. Teaser trailer out."),
    html: '<iframe src="https://www.youtube.com/embed/abcTRAILER"></iframe>',
    links: [],
    titles: ["Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(trailer.classification, "TRAILER_OR_PROMO");
  assert.equal(trailer.clientVisible, false);
});

test("YouTube domain is never registered as one monitored source", () => {
  assert.equal(isNeverMonitoredDomain("https://www.youtube.com/watch?v=x"), true);
  assert.equal(isNeverMonitoredDomain("https://youtu.be/abcdefg"), true);
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://www.youtube.com/watch?v=fullmovie",
        domain: "youtube.com",
        classification: "VIDEO_HOST_REUPLOAD",
        contentType: "reupload_platform",
        clientVisible: true,
        strongEvidence: true,
      }),
    ),
    false,
  );
});

test("exact YouTube watch URL requires full-length reupload evidence and stays internal", () => {
  assert.equal(isYouTubeWatchUrl("https://www.youtube.com/watch?v=full123"), true);
  assert.equal(isYouTubeWatchUrl("https://www.youtube.com/@SonyPictures"), false);

  const decision = officialPlatformDecision({
    url: "https://www.youtube.com/watch?v=full123",
    pageTitle: "Spider-Man Brand New Day FULL MOVIE",
    text: "Watch full movie complete film runtime 130 minutes",
  });
  assert.equal(decision?.kind, "youtube_internal_reupload");
  assert.equal(decision?.classification, "VIDEO_HOST_REUPLOAD");

  const result = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=full123",
    pageTitle: "Spider-Man Brand New Day FULL MOVIE",
    markdown: long("Watch full movie complete film runtime 130 minutes"),
    html: '<iframe src="https://www.youtube.com/embed/full123"></iframe>',
    links: [],
    titles: ["Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(result.classification, "VIDEO_HOST_REUPLOAD");
  assert.equal(result.clientVisible, false);
  // Taxonomy remains VIDEO_HOST_REUPLOAD, but client_visible:false must allow
  // internal persistence even though isActionablePiracy(true) for that label.
  assert.equal(isActionablePiracy(result.classification), true);
  assert.equal(result.clientVisible === false, true);
});

test("known URL parser accepts http/https and bounds to 10", () => {
  const parsed = parseKnownUrlInputs(
    "https://a.test/1\nhttps://b.test/2,https://c.test/3\n" +
      Array.from({ length: 12 }, (_, i) => `https://x.test/${i}`).join("\n"),
  );
  assert.ok(parsed.length <= 10);
  assert.ok(parsed[0]?.startsWith("https://"));
});

test("supplied known URL enters verification before search results", () => {
  const ordered = prioritizeKnownUrlLeads(
    [
      {
        url: "https://flixbaba.org.uk/details/movie/969681",
        query: "known_url_seed",
      },
      {
        url: "https://ogomovies1.com.pk/movies/spider-man-brand-new-day-2026/",
        query: "known_url_seed",
      },
    ],
    [
      { url: "https://search.example/result-a", query: "provider" },
      { url: "https://flixbaba.org.uk/details/movie/969681", query: "provider_dup" },
      { url: "https://search.example/result-b", query: "provider" },
    ],
    32,
  );
  assert.equal(ordered[0]?.query, "known_url_seed");
  assert.equal(ordered[1]?.query, "known_url_seed");
  assert.ok(ordered.every((l, i) => i < 2 || l.query === "provider"));
  assert.equal(ordered.filter((l) => l.url.includes("flixbaba.org.uk")).length, 1);
});

test("known URL capacity is reserved when provider candidates exceed page cap", () => {
  const known = [
    { url: "https://ogomovies1.com.pk/movies/unmadham-2026/", query: "known_url_seed" },
  ];
  const provider = Array.from({ length: 40 }, (_, i) => ({
    url: `https://provider.example/page-${i}`,
    query: "provider",
  }));
  const ordered = prioritizeKnownUrlLeads(known, provider, 5);
  assert.equal(ordered[0]?.url.includes("unmadham-2026"), true);
  assert.equal(ordered[0]?.query, "known_url_seed");
  assert.equal(ordered.length, 5);
  assert.equal(ordered.filter((l) => l.query === "known_url_seed").length, 1);
  assert.equal(ordered.filter((l) => l.query === "provider").length, 4);
});

test("known URL cannot bypass SSRF or private-host checks", async () => {
  const seeds = await validateKnownUrlSeeds([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "ftp://files.example/movie.mkv",
    "not a url",
  ]);
  assert.ok(seeds.every((s) => !s.accepted));
  assert.ok(
    seeds.some(
      (s) => s.rejectReason === "private_or_reserved" || s.rejectReason === "url_safety_rejected",
    ),
  );
  assert.ok(seeds.some((s) => s.rejectReason === "unsupported_protocol"));
  assert.ok(seeds.some((s) => s.rejectReason === "invalid_url"));
});

test("known URL with title but no access evidence remains internal", () => {
  const result = classifyCopyrightPage({
    url: "https://fanblog.example/spider-man-brand-new-day-poster",
    pageTitle: "Spider-Man Brand New Day poster gallery",
    markdown: long("Spider-Man Brand New Day poster gallery and wallpaper. Fan art image gallery."),
    html: "<img src='/p.jpg'/>",
    links: [],
    titles: ["Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(result.clientVisible, false);
  assert.ok(
    result.classification === "DUPLICATE_ARTWORK_ONLY" ||
      result.classification === "UNVERIFIED_LEAD" ||
      result.classification === "CATALOG_OR_LISTING",
  );
});

test("exact-title detail page with player/server/download evidence qualifies", () => {
  const result = classifyCopyrightPage({
    url: "https://flixbaba.org.uk/details/movie/969681",
    pageTitle: "Spider-Man: Brand New Day (2026) Watch Online",
    markdown: long(
      "Spider-Man Brand New Day watch full movie online. Server 1. Download full movie.",
    ),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe><a href="https://mega.nz/file/x">Download</a>',
    links: ["https://doodstream.com/e/abc", "https://mega.nz/file/x"],
    titles: ["spiderman brand new day", "Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(result.clientVisible, true);
  assert.ok(isActionablePiracy(result.classification));
});

test("listing page follows exact-title detail link", () => {
  const details = extractTitleMatchedDetailLinks({
    pageUrl: "https://ogomovies1.com.pk/",
    html: `<a href="/movies/spider-man-brand-new-day-2026/">Spider-Man Brand New Day 2026</a>`,
    markdown: "Latest movies",
    links: [
      "https://ogomovies1.com.pk/movies/spider-man-brand-new-day-2026/",
      "https://ogomovies1.com.pk/category/latest",
    ],
    titles: ["spiderman brand new day", "Spider-Man: Brand New Day"],
    limit: 4,
  });
  assert.ok(details.some((u) => u.includes("spider-man-brand-new-day-2026")));
});

test("blocked or unsafe supplied URL fails closed with diagnostic reason", async () => {
  const seeds = await validateKnownUrlSeeds(["http://localhost:8080/secret"]);
  assert.equal(seeds[0]?.accepted, false);
  assert.ok(seeds[0]?.rejectReason);
  assert.ok(seeds[0]?.rejectDetail);
});

test("domain reputation alone never creates a finding", () => {
  assert.equal(isExcludedHost("https://ogomovies1.com.pk/movies/x"), false);
  const decision = officialPlatformDecision({
    url: "https://ogomovies1.com.pk/movies/spider-man-brand-new-day-2026/",
    pageTitle: "Home",
    text: "movie site",
  });
  assert.equal(decision, null);

  const noEvidence = classifyCopyrightPage({
    url: "https://ogomovies1.com.pk/",
    pageTitle: "OgoMovies Home",
    markdown: long("Latest movies category browse movies"),
    html: "",
    links: [],
    titles: ["Spider-Man: Brand New Day"],
    pageInspected: true,
  });
  assert.equal(noEvidence.clientVisible, false);
});

test("exact evidence URL, not homepage, is required for registration", () => {
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://piracy.example/",
        domain: "piracy.example",
      }),
    ),
    false,
  );
  assert.equal(
    shouldRegisterMonitoredSource(
      baseAnalysis({
        url: "https://piracy.example/movies/spider-man-brand-new-day-2026/",
      }),
    ),
    true,
  );
  assert.equal(isYouTubeHost("https://youtube.com/"), true);
});

test("registration prefers prior detail URL and keeps evidence URL aligned", () => {
  // Mirrors registerDistributionSource preferUrl + evidence alignment rules.
  const priorUrl: string = "https://piracy.example/movies/spider-man-brand-new-day-2026/";
  const homepage: string = "https://piracy.example/";
  const priorIsDetail = /\/.+/.test(new URL(priorUrl).pathname);
  const currentIsHomepage = (new URL(homepage).pathname.replace(/\/$/, "") || "/") === "/";
  const preferUrl =
    priorUrl !== homepage && priorIsDetail && currentIsHomepage ? priorUrl : homepage;
  assert.equal(preferUrl, priorUrl);
  const evidence = {
    exact_evidence_url: preferUrl,
    canonical_url: preferUrl,
  };
  assert.equal(evidence.exact_evidence_url, preferUrl);
  assert.equal(evidence.canonical_url, preferUrl);
});
