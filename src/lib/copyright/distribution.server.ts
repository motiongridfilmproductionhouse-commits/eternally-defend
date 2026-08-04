/**
 * Unauthorized movie-distribution site detection.
 *
 * Discovery hands us candidate pages; this module retrieves each page with
 * safe static HTML + Firecrawl rendered fallback and classifies with the
 * exact-page evidence gates in page-classify.server.ts.
 *
 * A page is only classified as piracy when identity + access evidence exist.
 * Title, poster, trailer or news mentions alone are never enough.
 *
 * Evidence collection only — nothing here reports or takes down content.
 */

import { isSafePublicHttpUrl } from "@/lib/deepfake/url-safety.server";
import { hostOf } from "./url.server";
import {
  classifyCopyrightPage,
  extractTitleMatchedDetailLinks,
  type PageClassifyResult,
  type PiracyIndicator,
} from "./page-classify.server";
import { retrieveCopyrightPage } from "./page-retrieve.server";
import type { CrawlFailureCategory } from "./crawl-failure";
import { releaseTimingFor, type ReleaseTiming } from "./release-timing";
import { isLikelyListingPage } from "./page-extract.server";
import type { DetailFollowRecorder } from "./detail-follow.server";
import type { CopyrightClassification } from "./taxonomy";
import {
  extractReferenceImagesFromPage,
  type ReferenceImage,
} from "./reference-images";

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
  /** Exact failure category when crawlFailed — never a content-rejection label. */
  crawlFailureCategory: CrawlFailureCategory | null;
  /** Sanitized diagnostic reason for retrieval failure. */
  crawlFailureReason: string | null;
  /** How the page body was retrieved. */
  retrievalMethod: "static_html" | "firecrawl_render" | "crawl4ai_render" | "none";
  /** True when Firecrawl rendered fallback was used. */
  rendered: boolean;
  /** Thumbnails discovered on this page for the live reference carousel only. */
  pageReferenceImages?: ReferenceImage[];
  /** Short readable excerpt of the inspected page body, for evidence display. */
  pageExcerpt?: string | null;
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
    case "TRAILER_OR_PROMOTIONAL":
      return "trailer_or_promo";
    case "CATALOG_OR_LISTING":
      return "unknown";
    case "OFFICIAL_OR_AUTHORIZED_PAGE":
      return "official_platform";
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
  crawlFailureCategory: CrawlFailureCategory | null = null,
  crawlFailureReason: string | null = null,
  retrievalMethod: DistributionAnalysis["retrievalMethod"] = "none",
  rendered = false,
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
    crawlFailureCategory,
    crawlFailureReason,
    retrievalMethod,
    rendered,
  };
}

/**
 * Inspect one candidate page for unauthorized-distribution evidence.
 * Returns a fail-closed UNVERIFIED_LEAD analysis when the page cannot be fetched.
 * Network/render failures set crawlFailed + category — never content rejection.
 */
export async function analyzeDistributionPage(opts: {
  url: string;
  title?: string | null;
  titles: string[];
  releaseDate?: string | null;
  screenshot?: string | null;
  /** When true, skip detail-link follow (used for already-followed detail pages). */
  skipDetailFollow?: boolean;
  signal?: AbortSignal;
  /** Prefer Firecrawl render (used for known evidence URLs). */
  preferRender?: boolean;
  /** Skip browser-render fallback when the scan render budget is exhausted. */
  allowBrowserFallback?: boolean;
  /** Optional detail-follow diagnostics recorder. */
  detailFollow?: DetailFollowRecorder;
  /** Force title-detail link extraction on listing/home/historical recheck pages. */
  forceDetailFollow?: boolean;
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
      "private_or_reserved_address",
      "URL failed public http(s) safety checks",
      "none",
      false,
    );
  }

  if (opts.signal?.aborted) {
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
      "aborted_by_deadline",
      "Aborted by scan deadline before retrieval",
      "none",
      false,
    );
  }

  const retrieved = await retrieveCopyrightPage(opts.url, {
    signal: opts.signal,
    preferRender: opts.preferRender,
    allowBrowserFallback: opts.allowBrowserFallback !== false,
  });

  if (!retrieved.ok) {
    return fromClassify(
      retrieved.finalUrl || opts.url,
      opts.title ?? null,
      opts.screenshot ?? null,
      classifyCopyrightPage({
        url: retrieved.finalUrl || opts.url,
        pageTitle: opts.title,
        titles: opts.titles,
        releaseDate: opts.releaseDate,
        pageInspected: false,
      }),
      [],
      true,
      retrieved.failureCategory,
      retrieved.failureReason,
      retrieved.method,
      retrieved.rendered,
    );
  }

  const markdown = retrieved.markdown ?? "";
  const html = retrieved.html ?? "";
  const links = retrieved.links;
  const meta = retrieved.metadata;
  const pageTitle = retrieved.pageTitle || opts.title || null;

  const classified = classifyCopyrightPage({
    url: retrieved.finalUrl,
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
  const listingByPurpose =
    classified.primaryPurpose === "listing_or_search" ||
    classified.classification === "CATALOG_OR_LISTING";
  const looksLikeListing =
    !opts.skipDetailFollow &&
    (opts.forceDetailFollow ||
      isLikelyListingPage({
        url: retrieved.finalUrl,
        primaryPurpose: classified.primaryPurpose,
        linkCount: links.length,
        html,
        markdown,
      }) ||
      listingByPurpose ||
      (links.length >= 10 && !classified.clientVisible) ||
      (links.length >= 3 && /\/$|\/(search|movies|latest|category)(\/|$)/i.test(retrieved.finalUrl)));

  if (looksLikeListing) {
    opts.detailFollow?.recordListingDetected(retrieved.finalUrl, links.length);
    if (!links.length) {
      opts.detailFollow?.recordSkipped(
        retrieved.finalUrl,
        "no_links_extracted",
        "listing page had no extractable links",
      );
    } else {
      opts.detailFollow?.recordLinksExtracted(retrieved.finalUrl, links.length);
      detailFollowUrls = extractTitleMatchedDetailLinks({
        pageUrl: retrieved.finalUrl,
        html,
        markdown,
        links,
        titles: opts.titles,
        limit: 20,
        metadata: meta,
      });
      opts.detailFollow?.recordTitleCandidatesScored(
        retrieved.finalUrl,
        detailFollowUrls.length,
      );
      if (!detailFollowUrls.length) {
        opts.detailFollow?.recordSkipped(
          retrieved.finalUrl,
          "title_score_below_threshold",
          "no title-matched detail links scored above threshold",
        );
      }
    }
  } else if (!opts.skipDetailFollow && classified.distributionLinks.length) {
    // Non-listing movie pages still expand into cloud/file/mirror destinations.
    detailFollowUrls = classified.distributionLinks
      .filter((l) => l.startsWith("http"))
      .slice(0, 12);
    if (detailFollowUrls.length) {
      opts.detailFollow?.recordLinksExtracted(retrieved.finalUrl, detailFollowUrls.length);
      opts.detailFollow?.recordTitleCandidatesScored(
        retrieved.finalUrl,
        detailFollowUrls.length,
      );
    }
  } else if (opts.forceDetailFollow && opts.detailFollow) {
    opts.detailFollow.recordSkipped(
      retrieved.finalUrl,
      "listing_not_detected",
      "historical or known-risk page did not qualify as listing for detail follow",
    );
  }

  return {
    ...fromClassify(
      retrieved.finalUrl,
      pageTitle,
      retrieved.screenshot ?? opts.screenshot ?? null,
      classified,
      detailFollowUrls,
      false,
      null,
      null,
      retrieved.method,
      retrieved.rendered,
    ),
    pageReferenceImages: extractReferenceImagesFromPage({
      pageUrl: retrieved.finalUrl,
      title: pageTitle,
      metadata: meta,
      html,
      screenshot: retrieved.screenshot ?? opts.screenshot ?? null,
      provider: retrieved.rendered ? "firecrawl" : "direct_retrieval",
    }),
  };
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
  signal?: AbortSignal;
}): Promise<DistributionAnalysis[]> {
  const listing = await analyzeDistributionPage({
    ...opts,
    skipDetailFollow: false,
  });
  const maxDetails = opts.maxDetails ?? 4;
  const details = listing.detailFollowUrls.slice(0, maxDetails);
  const out: DistributionAnalysis[] = [listing];

  for (const detailUrl of details) {
    if (opts.signal?.aborted) break;
    const analysis = await analyzeDistributionPage({
      url: detailUrl,
      titles: opts.titles,
      releaseDate: opts.releaseDate,
      skipDetailFollow: true,
      signal: opts.signal,
    });
    out.push(analysis);
  }
  return out;
}
