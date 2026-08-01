/**
 * Unauthorized movie-distribution site detection.
 *
 * Discovery hands us candidate pages; this module fetches each page with
 * Firecrawl (markdown + html + links + screenshot) and classifies with the
 * exact-page evidence gates in page-classify.server.ts.
 *
 * A page is only classified as piracy when identity + access evidence exist.
 * Title, poster, trailer or news mentions alone are never enough.
 *
 * Evidence collection only — nothing here reports or takes down content.
 */

import { firecrawlFetch } from "@/lib/firecrawl-client.server";
import { isSafePublicHttpUrl } from "@/lib/deepfake/url-safety.server";
import { hostOf } from "./url.server";
import {
  classifyCopyrightPage,
  extractTitleMatchedDetailLinks,
  type PageClassifyResult,
  type PiracyIndicator,
} from "./page-classify.server";
import { releaseTimingFor, type ReleaseTiming } from "./release-timing";
import type { CopyrightClassification } from "./taxonomy";

export type { ReleaseTiming, PiracyIndicator };
export { releaseTimingFor };

export type DomainRisk = "high" | "medium" | "low";

/** @deprecated Prefer CopyrightClassification from taxonomy.ts */
export type DistributionContentType =
  | "unauthorized_streaming_site"
  | "movie_download_site"
  | "torrent_index_site"
  | "file_distribution_site"
  | "linking_page"
  | "reupload_platform"
  | "official_platform"
  | "news_or_review"
  | "discussion"
  | "cinema_or_showtime"
  | "trailer_or_promo"
  | "unknown";

export interface DistributionAnalysis {
  url: string;
  domain: string | null;
  domainRisk: DomainRisk;
  contentType: DistributionContentType;
  /** New taxonomy classification */
  classification: CopyrightClassification;
  clientVisible: boolean;
  releaseTiming: ReleaseTiming;
  releaseOffsetDays: number | null;
  indicators: PiracyIndicator[];
  indicatorKeys: string[];
  strongEvidence: boolean;
  confidence: number;
  confidenceBreakdown: PageClassifyResult["confidenceBreakdown"];
  identityEvidence: string[];
  accessEvidence: string[];
  screenshot: string | null;
  pageTitle: string | null;
  distributionLinks: string[];
  qualityTags: string[];
  embedSources: string[];
  reason: string;
  /** Same-domain title-matched detail pages when the crawl hit a listing. */
  detailFollowUrls: string[];
  /** true when exact-page crawl failed or URL was unsafe */
  crawlFailed: boolean;
}

interface ScrapeInner {
  markdown?: string;
  html?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
}
interface ScrapeResponse extends ScrapeInner {
  success?: boolean;
  data?: ScrapeInner;
  error?: string;
}

async function scrapePage(url: string): Promise<ScrapeInner | null> {
  if (!isSafePublicHttpUrl(url)) return null;
  try {
    const res = await firecrawlFetch("/scrape", {
      url,
      formats: ["markdown", "html", "links", "screenshot"],
      onlyMainContent: false,
      waitFor: 1200,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ScrapeResponse;
    const inner = json.data ?? json;
    return inner ?? null;
  } catch {
    return null;
  }
}

function normalizeShot(shot: string | undefined): string | null {
  if (!shot) return null;
  return shot.startsWith("data:") || shot.startsWith("http")
    ? shot
    : `data:image/png;base64,${shot}`;
}

function toLegacyContentType(
  classification: CopyrightClassification,
): DistributionContentType {
  switch (classification) {
    case "VERIFIED_UNAUTHORIZED_STREAM":
    case "PROBABLE_UNAUTHORIZED_STREAM":
      return "unauthorized_streaming_site";
    case "DOWNLOAD_PAGE":
      return "movie_download_site";
    case "FILE_HOST_DISTRIBUTION":
      return "file_distribution_site";
    case "TORRENT_OR_MAGNET":
      return "torrent_index_site";
    case "VIDEO_HOST_REUPLOAD":
      return "reupload_platform";
    case "MIRROR_OR_REDIRECT":
      return "linking_page";
    case "THEATRE_PRINT_DISTRIBUTION":
      return "unauthorized_streaming_site";
    case "OFFICIAL_OR_AUTHORIZED":
      return "official_platform";
    case "REVIEW_OR_NEWS":
      return "news_or_review";
    case "SOCIAL_DISCUSSION":
      return "discussion";
    case "CINEMA_OR_SHOWTIME":
      return "cinema_or_showtime";
    case "TRAILER_OR_PROMO":
      return "trailer_or_promo";
    default:
      return "unknown";
  }
}

function toDomainRisk(band: PageClassifyResult["domainRisk"]): DomainRisk {
  if (band === "critical" || band === "high") return "high";
  if (band === "medium") return "medium";
  return "low";
}

function fromClassify(
  url: string,
  pageTitle: string | null,
  screenshot: string | null,
  classified: PageClassifyResult,
  detailFollowUrls: string[] = [],
  crawlFailed = false,
): DistributionAnalysis {
  return {
    url,
    domain: hostOf(url),
    domainRisk: toDomainRisk(classified.domainRisk),
    contentType: toLegacyContentType(classified.classification),
    classification: classified.classification,
    clientVisible: classified.clientVisible,
    releaseTiming: classified.releaseTiming,
    releaseOffsetDays: classified.releaseOffsetDays,
    indicators: classified.indicators,
    indicatorKeys: classified.indicatorKeys,
    strongEvidence: classified.strongAccess && classified.clientVisible,
    confidence: classified.confidence,
    confidenceBreakdown: classified.confidenceBreakdown,
    identityEvidence: classified.identityEvidence,
    accessEvidence: classified.accessEvidence,
    screenshot,
    pageTitle,
    distributionLinks: classified.distributionLinks,
    qualityTags: classified.qualityTags,
    embedSources: classified.embedSources,
    reason: classified.reason,
    detailFollowUrls,
    crawlFailed,
  };
}

/**
 * Inspect one candidate page for unauthorized-distribution evidence.
 * Returns a fail-closed UNVERIFIED_LEAD analysis when the page cannot be fetched.
 */
export async function analyzeDistributionPage(opts: {
  url: string;
  title?: string | null;
  titles: string[];
  releaseDate?: string | null;
  screenshot?: string | null;
  /** When true, skip detail-link follow (used for already-followed detail pages). */
  skipDetailFollow?: boolean;
}): Promise<DistributionAnalysis> {
  if (!isSafePublicHttpUrl(opts.url)) {
    return fromClassify(
      opts.url,
      opts.title ?? null,
      null,
      classifyCopyrightPage({
        url: opts.url,
        pageTitle: opts.title,
        titles: opts.titles,
        releaseDate: opts.releaseDate,
        pageInspected: false,
      }),
      [],
      true,
    );
  }

  const page = await scrapePage(opts.url);
  if (!page) {
    return fromClassify(
      opts.url,
      opts.title ?? null,
      opts.screenshot ?? null,
      classifyCopyrightPage({
        url: opts.url,
        pageTitle: opts.title,
        titles: opts.titles,
        releaseDate: opts.releaseDate,
        pageInspected: false,
      }),
      [],
      true,
    );
  }

  const markdown = page.markdown ?? "";
  const html = page.html ?? "";
  const links = (Array.isArray(page.links) ? page.links : []).filter(
    (l): l is string => typeof l === "string",
  );
  const meta = (page.metadata ?? {}) as Record<string, unknown>;
  const pageTitle =
    (typeof meta.title === "string" && meta.title) || opts.title || null;

  const classified = classifyCopyrightPage({
    url: opts.url,
    pageTitle,
    markdown,
    html,
    links,
    titles: opts.titles,
    releaseDate: opts.releaseDate,
    releaseYear: opts.releaseDate?.slice(0, 4),
    pageInspected: true,
    metadata: meta,
  });

  let detailFollowUrls: string[] = [];
  if (
    !opts.skipDetailFollow &&
    classified.primaryPurpose === "listing_or_search" &&
    !classified.clientVisible
  ) {
    detailFollowUrls = extractTitleMatchedDetailLinks({
      pageUrl: opts.url,
      html,
      markdown,
      links,
      titles: opts.titles,
      limit: 4,
    });
  }

  return fromClassify(
    opts.url,
    pageTitle,
    normalizeShot(page.screenshot) ?? opts.screenshot ?? null,
    classified,
    detailFollowUrls,
  );
}

/**
 * Analyze a listing page then bounded-follow title-matched detail URLs.
 * Returns analyses for detail pages that clear evidence gates (and the listing
 * classification itself, always non-actionable).
 */
export async function analyzeListingWithDetailFollow(opts: {
  url: string;
  title?: string | null;
  titles: string[];
  releaseDate?: string | null;
  maxDetails?: number;
}): Promise<DistributionAnalysis[]> {
  const listing = await analyzeDistributionPage({
    ...opts,
    skipDetailFollow: false,
  });
  const maxDetails = opts.maxDetails ?? 4;
  const details = listing.detailFollowUrls.slice(0, maxDetails);
  const out: DistributionAnalysis[] = [listing];

  for (const detailUrl of details) {
    const analysis = await analyzeDistributionPage({
      url: detailUrl,
      titles: opts.titles,
      releaseDate: opts.releaseDate,
      skipDetailFollow: true,
    });
    out.push(analysis);
  }
  return out;
}
