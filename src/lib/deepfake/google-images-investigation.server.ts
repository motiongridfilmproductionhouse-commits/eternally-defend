/**
 * Mandatory Google Images investigation for Deepfake Intelligence.
 * Required provider — failures degrade gracefully and never abort the scan.
 *
 * Flow per query:
 * 1) Browser/SerpAPI Google Images collection (viewer URLs are NEVER evidence)
 * 2) Extract imgrefurl / imgurl from each result
 * 3) Download + face compare against enrolled references
 * 4) Visit original source webpage; crawl images + same-domain galleries
 * 5) Face-compare extracted images; save evidence packages
 */

import type { CollectedReferenceImage } from "./reference-images";
import { buildGoogleImagesInvestigationQueries } from "./google-images-queries.server";
import {
  collectGoogleImagesMandatory,
  type GoogleImagesBrowserHit,
} from "./google-images-browser.server";
import {
  emptyGoogleImagesDiagnostics,
  type GoogleImagesInvestigationDiagnostics,
} from "./google-images-diagnostics";
import {
  buildGoogleImagesEvidencePackage,
  perceptualHashOfBytes,
  perceptualHashOfUrl,
  sha256OfBytes,
  sha256OfUrl,
} from "./google-images-evidence.server";
import { detectReferenceFace } from "./reference-face-detect.server";
import { compareAgainstReferences } from "./face-match.server";
import { downloadFaceImage } from "./face-match.server";
import { assertNotAborted } from "./scan-runtime.server";
import { crawl4aiRenderPage } from "@/lib/copyright/crawl4ai-render.server";
import { isSafePublicHttpUrl } from "./url-safety.server";
import {
  isGoogleImagesViewerUrl,
  isSameDomainGalleryLink,
  isUsableSourceWebsiteUrl,
} from "./google-images-source.server";

export const GOOGLE_IMAGES_MATCH_THRESHOLD = 88;
export const GOOGLE_IMAGES_HIGH_CONFIDENCE_THRESHOLD = 90;
export const GOOGLE_IMAGES_SOURCE_PAGE_LIMIT = 8;
export const GOOGLE_IMAGES_GALLERY_PAGE_LIMIT = 6;
export const GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT = 24;

export type GoogleImagesInvestigationCandidate = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source: "google_images_investigation";
  image_url?: string;
  thumbnail_url?: string;
  media_url?: string;
  evidence_page_url?: string;
  target_face_match?: boolean;
  face_similarity?: number;
  matched_face_id?: string | null;
  google_result_url?: string;
  google_search_query?: string;
  content_match_score?: number;
  threat_signals?: string[];
  page_crawled?: boolean;
  finding_classification?: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  url_verification_status?: "URL_VERIFIED" | "UNVERIFIED";
};

export type GoogleImagesInvestigationResult = {
  diagnostics: GoogleImagesInvestigationDiagnostics;
  candidates: GoogleImagesInvestigationCandidate[];
  evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[];
};

type ReferenceBytes = {
  bytes: Uint8Array[];
  images: CollectedReferenceImage[];
};

async function loadReferenceBytes(
  images: CollectedReferenceImage[],
  signal?: AbortSignal,
): Promise<ReferenceBytes> {
  const sorted = [...images]
    .filter((img) => img.face_detected)
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, 20);

  const bytes: Uint8Array[] = [];
  const used: CollectedReferenceImage[] = [];

  for (const img of sorted) {
    assertNotAborted(signal);
    try {
      const buffer = await downloadFaceImage(img.image_url, { signal });
      bytes.push(buffer);
      used.push(img);
    } catch {
      // Skip failed reference downloads.
    }
  }

  return { bytes, images: used };
}

function threatKeywordHit(query: string): boolean {
  return /\b(?:deepfake|face\s*swap|fake\s*nude|ai\s*generated|synthetic|morphed)\b/i.test(
    query,
  );
}

function classificationForMatch(input: {
  similarity: number;
  query: string;
  pageCrawled: boolean;
}): "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE" {
  if (
    input.pageCrawled &&
    input.similarity >= GOOGLE_IMAGES_HIGH_CONFIDENCE_THRESHOLD &&
    threatKeywordHit(input.query)
  ) {
    return "VERIFIED_DEEPFAKE";
  }
  return "PROBABLE_DEEPFAKE";
}

function toCandidate(
  hit: GoogleImagesBrowserHit,
  match: {
    matched: boolean;
    similarity: number;
    faceConfidence: number;
  },
  opts?: { pageCrawled?: boolean },
): GoogleImagesInvestigationCandidate | null {
  const pageUrl = isUsableSourceWebsiteUrl(hit.source_website_url)
    ? hit.source_website_url
    : null;
  if (!pageUrl) return null;

  const pageCrawled = Boolean(opts?.pageCrawled);
  return {
    url: pageUrl,
    title: hit.title ?? hit.query,
    description: `Google Images match for ${hit.query}`,
    query: hit.query,
    source: "google_images_investigation",
    image_url: hit.image_url,
    thumbnail_url: hit.thumbnail_url ?? hit.image_url,
    media_url: hit.image_url,
    evidence_page_url: pageUrl,
    target_face_match: match.matched,
    face_similarity: match.similarity,
    matched_face_id: match.matched ? "google_images_auto_ref" : null,
    google_result_url: hit.google_result_url,
    google_search_query: hit.query,
    content_match_score: match.matched ? Math.round(match.similarity) : 0,
    threat_signals: match.matched ? ["google-images-face-match"] : undefined,
    page_crawled: pageCrawled,
    finding_classification: classificationForMatch({
      similarity: match.similarity,
      query: hit.query,
      pageCrawled,
    }),
    url_verification_status: pageCrawled ? "URL_VERIFIED" : "UNVERIFIED",
  };
}

function pushUniqueImageUrl(
  out: string[],
  seen: Set<string>,
  raw: string,
  pageUrl: string,
): void {
  if (out.length >= GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT) return;
  let absolute = raw.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").trim();
  if (!absolute) return;
  try {
    absolute = new URL(absolute, pageUrl).toString();
  } catch {
    return;
  }
  if (!isSafePublicHttpUrl(absolute)) return;
  if (isGoogleImagesViewerUrl(absolute)) return;
  if (
    /googleusercontent\.com|gstatic\.com|sprite|logo|icon|pixel|tracking/i.test(
      absolute,
    )
  ) {
    return;
  }
  if (/\.gif(?:$|[?#])/i.test(absolute)) return;
  if (seen.has(absolute)) return;
  seen.add(absolute);
  out.push(absolute);
}

/** Extract images including lazy-loaded / srcset / gallery media URLs. */
function extractPageImageUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern =
    /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;
  for (const raw of html.match(pattern) ?? []) {
    pushUniqueImageUrl(out, seen, raw, pageUrl);
  }

  const attrPatterns = [
    /<img[^>]+(?:src|data-src|data-lazy-src|data-original|data-url)=["']([^"']+)["']/gi,
    /<(?:a|div|span|li|figure)[^>]+(?:data-src|data-image|data-full|data-large|data-zoom)=["']([^"']+)["']/gi,
    /srcset=["']([^"']+)["']/gi,
  ];
  for (const re of attrPatterns) {
    let match: RegExpExecArray | null;
    while (
      (match = re.exec(html)) &&
      out.length < GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT
    ) {
      const value = match[1] ?? "";
      // srcset may contain "url 1x, url 2x"
      for (const part of value.split(",")) {
        const urlPart = part.trim().split(/\s+/)[0];
        if (urlPart) pushUniqueImageUrl(out, seen, urlPart, pageUrl);
      }
    }
  }

  return out;
}

function extractGalleryLinks(html: string, pageUrl: string, links: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (link: string) => {
    if (!isSameDomainGalleryLink(link, pageUrl)) return;
    const key = link.split("#")[0]!;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const link of links) push(link);

  const hrefRe = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) && out.length < 20) {
    try {
      push(new URL(match[1]!, pageUrl).toString());
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function investigateSourcePage(input: {
  pageUrl: string;
  query: string;
  /** Provenance Google Images URL — never used as evidence page. */
  googleResultUrl: string;
  references: ReferenceBytes;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  seenImageUrls: Set<string>;
  seenSha: Set<string>;
  seenPhash: Set<string>;
  crawledPages: Set<string>;
  maxPages?: number;
}): Promise<{
  crawled: boolean;
  relatedCandidates: GoogleImagesInvestigationCandidate[];
  evidence: ReturnType<typeof buildGoogleImagesEvidencePackage>[];
  metrics: {
    pages_crawled: number;
    images_discovered: number;
    images_downloaded: number;
    images_extracted_from_sources: number;
    gallery_pages_followed: number;
    face_comparisons: number;
    high_confidence_matches: number;
    evidence_packages_created: number;
    failed_downloads: number;
  };
}> {
  const maxPages =
    input.maxPages ??
    GOOGLE_IMAGES_SOURCE_PAGE_LIMIT + GOOGLE_IMAGES_GALLERY_PAGE_LIMIT;
  const metrics = {
    pages_crawled: 0,
    images_discovered: 0,
    images_downloaded: 0,
    images_extracted_from_sources: 0,
    gallery_pages_followed: 0,
    face_comparisons: 0,
    high_confidence_matches: 0,
    evidence_packages_created: 0,
    failed_downloads: 0,
  };
  const relatedCandidates: GoogleImagesInvestigationCandidate[] = [];
  const evidence: ReturnType<typeof buildGoogleImagesEvidencePackage>[] = [];

  if (!isUsableSourceWebsiteUrl(input.pageUrl)) {
    return { crawled: false, relatedCandidates, evidence, metrics };
  }

  const queue: Array<{ url: string; isGallery: boolean }> = [
    { url: input.pageUrl, isGallery: false },
  ];
  let anyCrawled = false;

  while (queue.length && metrics.pages_crawled < maxPages) {
    assertNotAborted(input.signal);
    const next = queue.shift()!;
    if (!isUsableSourceWebsiteUrl(next.url)) continue;
    if (input.crawledPages.has(next.url)) continue;
    input.crawledPages.add(next.url);

    let rendered;
    try {
      rendered = await crawl4aiRenderPage(next.url, input.signal);
    } catch {
      continue;
    }
    if (!rendered.ok || !rendered.html) continue;

    anyCrawled = true;
    metrics.pages_crawled += 1;
    if (next.isGallery) metrics.gallery_pages_followed += 1;

    const pageImages = extractPageImageUrls(rendered.html, next.url);
    metrics.images_discovered += pageImages.length;
    metrics.images_extracted_from_sources += pageImages.length;

    for (const imageUrl of pageImages) {
      assertNotAborted(input.signal);
      if (input.seenImageUrls.has(imageUrl)) continue;
      input.seenImageUrls.add(imageUrl);

      try {
        metrics.images_downloaded += 1;
        const imageBytes = await downloadFaceImage(imageUrl, {
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
        });
        const contentSha = sha256OfBytes(imageBytes);
        const contentPhash = perceptualHashOfBytes(imageBytes);
        if (input.seenSha.has(contentSha) || input.seenPhash.has(contentPhash)) {
          continue;
        }
        input.seenSha.add(contentSha);
        input.seenPhash.add(contentPhash);

        const face = await detectReferenceFace({
          imageUrl,
          imageBytes,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
        });
        if (!face.usable) continue;

        metrics.face_comparisons += 1;
        let match = {
          matched: false,
          similarity: 0,
          faceConfidence: face.faceConfidence,
        };
        if (input.references.bytes.length > 0) {
          const comparison = await compareAgainstReferences({
            referenceImages: input.references.bytes,
            discoveredImageUrl: imageUrl,
            similarityThreshold: GOOGLE_IMAGES_MATCH_THRESHOLD,
            signal: input.signal,
            softDeadlineMs: input.softDeadlineMs,
          });
          match = {
            matched: comparison.matched,
            similarity: comparison.similarity,
            faceConfidence: comparison.faceConfidence,
          };
        }

        if (!match.matched) continue;
        metrics.high_confidence_matches += 1;

        const hit: GoogleImagesBrowserHit = {
          image_url: imageUrl,
          thumbnail_url: imageUrl,
          source_website_url: next.url,
          google_result_url: input.googleResultUrl,
          query: input.query,
          title: rendered.pageTitle,
          width: null,
          height: null,
          hostname: null,
          surrounding_text: null,
        };
        const candidate = toCandidate(hit, match, { pageCrawled: true });
        if (candidate) relatedCandidates.push(candidate);

        evidence.push(
          buildGoogleImagesEvidencePackage({
            query: input.query,
            googleResultUrl: input.googleResultUrl,
            sourceWebsiteUrl: next.url,
            imageUrl,
            faceSimilarity: match.similarity,
            identityConfidence: match.faceConfidence,
            sha256: contentSha,
            perceptualHash: contentPhash,
            screenshotUrl: null,
            evidenceStatus: "captured",
            crawlMetadata: {
              provider: next.isGallery
                ? "google_images_gallery_page"
                : "google_images_source_page",
              crawled_page_url: next.url,
              used_browser: true,
              gallery_follow: next.isGallery,
            },
          }),
        );
        metrics.evidence_packages_created += 1;
      } catch {
        metrics.failed_downloads += 1;
      }
    }

    // Continue crawling same-domain gallery / media / album pages until limits.
    if (metrics.pages_crawled < maxPages) {
      const galleryLinks = extractGalleryLinks(
        rendered.html,
        next.url,
        rendered.links ?? [],
      );
      for (const link of galleryLinks) {
        if (input.crawledPages.has(link)) continue;
        if (queue.some((q) => q.url === link)) continue;
        if (
          metrics.gallery_pages_followed +
            queue.filter((q) => q.isGallery).length >=
          GOOGLE_IMAGES_GALLERY_PAGE_LIMIT
        ) {
          break;
        }
        queue.push({ url: link, isGallery: true });
        relatedCandidates.push({
          url: link,
          title: `Related media page for ${input.query}`,
          description:
            "Related gallery/media page discovered from Google Images source",
          query: input.query,
          source: "google_images_investigation",
          evidence_page_url: link,
          google_result_url: input.googleResultUrl,
          google_search_query: input.query,
          threat_signals: ["google-images-related-page"],
          page_crawled: false,
          finding_classification: "PROBABLE_DEEPFAKE",
          url_verification_status: "UNVERIFIED",
        });
      }
    }
  }

  return { crawled: anyCrawled, relatedCandidates, evidence, metrics };
}

/**
 * Process a single Google Images query — used by background workers.
 */
export async function processGoogleImagesQuery(input: {
  query: string;
  referenceImages: CollectedReferenceImage[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  seenImageUrls?: Set<string>;
  seenSha?: Set<string>;
  seenPhash?: Set<string>;
}): Promise<{
  metrics: Record<string, number>;
  candidates: GoogleImagesInvestigationCandidate[];
  evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[];
  failure: string | null;
  used_browser: boolean;
  browser_available: boolean;
}> {
  const seenImageUrls = input.seenImageUrls ?? new Set<string>();
  const seenSha = input.seenSha ?? new Set<string>();
  const seenPhash = input.seenPhash ?? new Set<string>();
  const metrics = {
    pages_loaded: 0,
    images_discovered: 0,
    images_downloaded: 0,
    duplicate_images: 0,
    valid_faces: 0,
    high_confidence_matches: 0,
    candidate_pages_crawled: 0,
    source_pages_discovered: 0,
    evidence_packages_created: 0,
    failed_downloads: 0,
    face_comparisons: 0,
    rejected_identities: 0,
    viewer_urls_discovered: 0,
    original_source_pages_extracted: 0,
    source_pages_crawled: 0,
    images_extracted_from_sources: 0,
    gallery_pages_followed: 0,
  };
  const candidates: GoogleImagesInvestigationCandidate[] = [];
  const evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[] =
    [];
  const crawledPages = new Set<string>();

  let collection;
  try {
    collection = await collectGoogleImagesMandatory({
      queries: [input.query],
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
      maxImages: 120,
    });
  } catch (error) {
    return {
      metrics,
      candidates,
      evidence_packages,
      failure: error instanceof Error ? error.message : String(error),
      used_browser: false,
      browser_available: false,
    };
  }

  metrics.pages_loaded = collection.pages_loaded;
  metrics.images_discovered = collection.images_discovered;

  if (!collection.hits.length) {
    return {
      metrics,
      candidates,
      evidence_packages,
      failure: collection.failure ?? "No images discovered for query",
      used_browser: collection.used_browser,
      browser_available: collection.browser_available,
    };
  }

  const references = await loadReferenceBytes(
    input.referenceImages,
    input.signal,
  );

  for (const hit of collection.hits) {
    assertNotAborted(input.signal);

    // Google viewer/SERP URLs are provenance only — never evidence targets.
    if (isGoogleImagesViewerUrl(hit.google_result_url)) {
      metrics.viewer_urls_discovered += 1;
    }
    if (
      hit.source_website_url &&
      isGoogleImagesViewerUrl(hit.source_website_url)
    ) {
      metrics.viewer_urls_discovered += 1;
      hit.source_website_url = null;
    }

    if (seenImageUrls.has(hit.image_url)) {
      metrics.duplicate_images += 1;
      continue;
    }
    seenImageUrls.add(hit.image_url);

    if (isUsableSourceWebsiteUrl(hit.source_website_url)) {
      metrics.source_pages_discovered += 1;
      metrics.original_source_pages_extracted += 1;
    }

    const urlSha = sha256OfUrl(hit.image_url);
    const urlPhash = perceptualHashOfUrl(hit.image_url);
    if (seenSha.has(urlSha) || seenPhash.has(urlPhash)) {
      metrics.duplicate_images += 1;
      continue;
    }

    try {
      metrics.images_downloaded += 1;
      const imageBytes = await downloadFaceImage(hit.image_url, {
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      });

      const contentSha = sha256OfBytes(imageBytes);
      const contentPhash = perceptualHashOfBytes(imageBytes);
      if (seenSha.has(contentSha) || seenPhash.has(contentPhash)) {
        metrics.duplicate_images += 1;
        continue;
      }
      seenSha.add(contentSha);
      seenSha.add(urlSha);
      seenPhash.add(contentPhash);
      seenPhash.add(urlPhash);

      const face = await detectReferenceFace({
        imageUrl: hit.image_url,
        imageBytes,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      });

      if (!face.usable) {
        metrics.rejected_identities += 1;
        continue;
      }

      metrics.valid_faces += 1;
      metrics.face_comparisons += 1;

      let match = {
        matched: false,
        similarity: 0,
        faceConfidence: face.faceConfidence,
      };

      if (references.bytes.length > 0) {
        const comparison = await compareAgainstReferences({
          referenceImages: references.bytes,
          discoveredImageUrl: hit.image_url,
          similarityThreshold: GOOGLE_IMAGES_MATCH_THRESHOLD,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
        });
        match = {
          matched: comparison.matched,
          similarity: comparison.similarity,
          faceConfidence: comparison.faceConfidence,
        };
      } else if (face.faceConfidence >= GOOGLE_IMAGES_HIGH_CONFIDENCE_THRESHOLD) {
        match = {
          matched: true,
          similarity: face.faceConfidence,
          faceConfidence: face.faceConfidence,
        };
      }

      if (!match.matched) {
        metrics.rejected_identities += 1;
        continue;
      }

      metrics.high_confidence_matches += 1;

      let pageCrawled = false;
      const sourcePage = isUsableSourceWebsiteUrl(hit.source_website_url)
        ? hit.source_website_url
        : null;

      // Without an original webpage (imgrefurl), we cannot complete the
      // Google Images → source page → evidence funnel for this hit.
      if (
        sourcePage &&
        crawledPages.size < GOOGLE_IMAGES_SOURCE_PAGE_LIMIT &&
        !crawledPages.has(sourcePage)
      ) {
        const pageResult = await investigateSourcePage({
          pageUrl: sourcePage,
          query: hit.query,
          googleResultUrl: hit.google_result_url,
          references,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
          seenImageUrls,
          seenSha,
          seenPhash,
          crawledPages,
        });
        pageCrawled = pageResult.crawled;
        metrics.candidate_pages_crawled += pageResult.metrics.pages_crawled;
        metrics.source_pages_crawled += pageResult.metrics.pages_crawled;
        metrics.images_discovered += pageResult.metrics.images_discovered;
        metrics.images_extracted_from_sources +=
          pageResult.metrics.images_extracted_from_sources;
        metrics.gallery_pages_followed +=
          pageResult.metrics.gallery_pages_followed;
        metrics.images_downloaded += pageResult.metrics.images_downloaded;
        metrics.face_comparisons += pageResult.metrics.face_comparisons;
        metrics.high_confidence_matches +=
          pageResult.metrics.high_confidence_matches;
        metrics.evidence_packages_created +=
          pageResult.metrics.evidence_packages_created;
        metrics.failed_downloads += pageResult.metrics.failed_downloads;
        candidates.push(
          ...pageResult.relatedCandidates.filter(
            (c) => !isGoogleImagesViewerUrl(c.url),
          ),
        );
        evidence_packages.push(...pageResult.evidence);
      }

      // Evidence only when we have a non-Google original source webpage.
      if (sourcePage) {
        evidence_packages.push(
          buildGoogleImagesEvidencePackage({
            query: hit.query,
            googleResultUrl: hit.google_result_url,
            sourceWebsiteUrl: sourcePage,
            imageUrl: hit.image_url,
            faceSimilarity: match.similarity,
            identityConfidence: match.faceConfidence,
            sha256: contentSha,
            perceptualHash: contentPhash,
            evidenceStatus: pageCrawled ? "captured" : "queued",
            crawlMetadata: {
              provider: "google_images",
              used_browser: collection.used_browser,
              source_page_crawled: pageCrawled,
              hostname: hit.hostname,
              surrounding_text: hit.surrounding_text,
              title: hit.title,
            },
          }),
        );
        metrics.evidence_packages_created += 1;

        const candidate = toCandidate(hit, match, { pageCrawled });
        if (candidate && !isGoogleImagesViewerUrl(candidate.url)) {
          candidates.push(candidate);
        }
      }
    } catch {
      metrics.failed_downloads += 1;
    }
  }

  return {
    metrics,
    candidates,
    evidence_packages,
    failure: null,
    used_browser: collection.used_browser,
    browser_available: collection.browser_available,
  };
}

/**
 * Run mandatory Google Images investigation for a protected identity.
 * @deprecated Use background job queue via queueAndDispatchGoogleImagesInvestigation.
 */
export async function runMandatoryGoogleImagesInvestigation(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  referenceImages: CollectedReferenceImage[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  onProgress?: (stage: string) => void | Promise<void>;
}): Promise<GoogleImagesInvestigationResult> {
  const diagnostics = emptyGoogleImagesDiagnostics();
  const candidates: GoogleImagesInvestigationCandidate[] = [];
  const evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[] =
    [];
  const seenImageUrls = new Set<string>();
  const seenSha = new Set<string>();
  const seenPhash = new Set<string>();

  const queries = buildGoogleImagesInvestigationQueries({
    name: input.name,
    aliases: input.aliases,
    handles: input.handles,
  });
  diagnostics.queries_planned = queries.length;

  await input.onProgress?.("Searching Google Images…");

  for (const query of queries) {
    assertNotAborted(input.signal);
    const result = await processGoogleImagesQuery({
      query,
      referenceImages: input.referenceImages,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
      seenImageUrls,
      seenSha,
      seenPhash,
    });
    diagnostics.queries_executed += 1;
    diagnostics.pages_loaded += result.metrics.pages_loaded;
    diagnostics.images_discovered += result.metrics.images_discovered;
    diagnostics.images_downloaded += result.metrics.images_downloaded;
    diagnostics.duplicate_images += result.metrics.duplicate_images;
    diagnostics.valid_faces += result.metrics.valid_faces;
    diagnostics.high_confidence_matches +=
      result.metrics.high_confidence_matches;
    diagnostics.candidate_pages_crawled +=
      result.metrics.candidate_pages_crawled;
    diagnostics.source_pages_discovered +=
      result.metrics.source_pages_discovered ?? 0;
    diagnostics.evidence_packages_created +=
      result.metrics.evidence_packages_created;
    diagnostics.failed_downloads += result.metrics.failed_downloads;
    diagnostics.face_comparisons += result.metrics.face_comparisons;
    diagnostics.rejected_identities += result.metrics.rejected_identities;
    diagnostics.viewer_urls_discovered +=
      result.metrics.viewer_urls_discovered ?? 0;
    diagnostics.original_source_pages_extracted +=
      result.metrics.original_source_pages_extracted ?? 0;
    diagnostics.source_pages_crawled +=
      result.metrics.source_pages_crawled ?? 0;
    diagnostics.images_extracted_from_sources +=
      result.metrics.images_extracted_from_sources ?? 0;
    diagnostics.gallery_pages_followed +=
      result.metrics.gallery_pages_followed ?? 0;
    diagnostics.used_browser =
      diagnostics.used_browser || result.used_browser;
    diagnostics.browser_available =
      diagnostics.browser_available || result.browser_available;
    if (result.failure && !diagnostics.failure_reason) {
      diagnostics.failure_reason = result.failure;
    }
    candidates.push(...result.candidates);
    evidence_packages.push(...result.evidence_packages);
  }

  diagnostics.provider_status = candidates.length
    ? "success"
    : diagnostics.failure_reason
      ? "unavailable"
      : "degraded";

  return { diagnostics, candidates, evidence_packages };
}

/** Build a findings upsert row from a Google Images identity match. */
export function findingRowFromGoogleImagesCandidate(input: {
  scanId: string;
  userId: string;
  candidate: GoogleImagesInvestigationCandidate;
}): Record<string, unknown> | null {
  if (isGoogleImagesViewerUrl(input.candidate.url)) return null;
  if (isGoogleImagesViewerUrl(input.candidate.evidence_page_url)) return null;
  const pageUrl = isUsableSourceWebsiteUrl(input.candidate.url)
    ? input.candidate.url
    : null;
  if (!pageUrl) return null;
  if (input.candidate.url_verification_status !== "URL_VERIFIED") return null;

  const similarity = input.candidate.face_similarity ?? 0;
  const classification =
    input.candidate.finding_classification ?? "PROBABLE_DEEPFAKE";

  return {
    scan_id: input.scanId,
    user_id: input.userId,
    url: pageUrl,
    source_host: (() => {
      try {
        return new URL(pageUrl).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })(),
    page_title: input.candidate.title ?? null,
    snippet: input.candidate.description ?? null,
    query: input.candidate.query,
    risk_level:
      classification === "VERIFIED_DEEPFAKE"
        ? similarity >= 95
          ? "CRITICAL"
          : "HIGH"
        : "MEDIUM",
    content_category: threatKeywordHit(input.candidate.query)
      ? "deepfake_porn"
      : "face_swap",
    confidence: Math.round(similarity),
    is_synthetic: threatKeywordHit(input.candidate.query),
    face_referenced: true,
    takedown_recommended: classification === "VERIFIED_DEEPFAKE",
    target_face_match: true,
    face_similarity: similarity,
    matched_face_id: input.candidate.matched_face_id ?? null,
    ai_reasoning:
      "Identity match discovered via Google Images investigation and source-page crawl.",
    finding_classification: classification,
    page_type: "image_gallery",
    identity_confidence: Math.round(similarity),
    synthetic_media_confidence: threatKeywordHit(input.candidate.query)
      ? Math.min(95, Math.round(similarity))
      : Math.round(similarity * 0.7),
    matched_evidence: [
      "google_images_face_match",
      ...(input.candidate.threat_signals ?? []),
    ],
    classification_explanation:
      "Face-matched Google Images result with crawled source webpage.",
    discovered_url: pageUrl,
    final_url: pageUrl,
    canonical_url: pageUrl,
    http_status: 200,
    redirect_chain: [],
    crawled_at: new Date().toISOString(),
    url_verification_status: "URL_VERIFIED",
    url_rejection_reason: null,
    review_status: "open",
  };
}
