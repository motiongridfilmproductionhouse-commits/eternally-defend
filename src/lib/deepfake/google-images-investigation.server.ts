/**
 * Mandatory Google Images investigation for Deepfake Intelligence.
 * Required provider — failures degrade gracefully and never abort the scan.
 *
 * Flow per query:
 * 1) Browser/SerpAPI Google Images collection
 * 2) Download + face compare against enrolled references
 * 3) For identity matches: treat source website as discovery candidate,
 *    crawl the page for additional images, and build evidence packages
 */

import { createHash } from "node:crypto";
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
  perceptualHashOfUrl,
  sha256OfUrl,
} from "./google-images-evidence.server";
import { detectReferenceFace } from "./reference-face-detect.server";
import { compareAgainstReferences } from "./face-match.server";
import { downloadFaceImage } from "./face-match.server";
import { assertNotAborted } from "./scan-runtime.server";
import { crawl4aiRenderPage } from "@/lib/copyright/crawl4ai-render.server";
import { isSafePublicHttpUrl } from "./url-safety.server";
import { isUsableSourceWebsiteUrl } from "./google-images-source.server";

export const GOOGLE_IMAGES_MATCH_THRESHOLD = 88;
export const GOOGLE_IMAGES_HIGH_CONFIDENCE_THRESHOLD = 90;
export const GOOGLE_IMAGES_SOURCE_PAGE_LIMIT = 4;
export const GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT = 8;

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

function sha256OfContent(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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

function extractPageImageUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pattern =
    /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;
  const matches = html.match(pattern) ?? [];
  for (const raw of matches) {
    const cleaned = raw.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    if (!isSafePublicHttpUrl(cleaned)) continue;
    if (/googleusercontent\.com|gstatic\.com|sprite|logo|icon/i.test(cleaned)) {
      continue;
    }
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT) break;
  }

  // Relative img src via simple attribute scrape
  if (out.length < GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT) {
    const srcRe = /<img[^>]+src=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while (
      (match = srcRe.exec(html)) &&
      out.length < GOOGLE_IMAGES_SOURCE_PAGE_IMAGE_LIMIT
    ) {
      try {
        const absolute = new URL(match[1]!, pageUrl).toString();
        if (!isSafePublicHttpUrl(absolute)) continue;
        if (seen.has(absolute)) continue;
        if (/\.gif(?:$|[?#])/i.test(absolute)) continue;
        seen.add(absolute);
        out.push(absolute);
      } catch {
        /* ignore bad urls */
      }
    }
  }

  return out;
}

async function investigateSourcePage(input: {
  pageUrl: string;
  query: string;
  references: ReferenceBytes;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  seenImageUrls: Set<string>;
  seenSha: Set<string>;
  seenPhash: Set<string>;
}): Promise<{
  crawled: boolean;
  relatedCandidates: GoogleImagesInvestigationCandidate[];
  evidence: ReturnType<typeof buildGoogleImagesEvidencePackage>[];
  metrics: {
    pages_crawled: number;
    images_discovered: number;
    images_downloaded: number;
    face_comparisons: number;
    high_confidence_matches: number;
    evidence_packages_created: number;
    failed_downloads: number;
  };
}> {
  const metrics = {
    pages_crawled: 0,
    images_discovered: 0,
    images_downloaded: 0,
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

  let rendered;
  try {
    rendered = await crawl4aiRenderPage(input.pageUrl, input.signal);
  } catch {
    return { crawled: false, relatedCandidates, evidence, metrics };
  }

  if (!rendered.ok || !rendered.html) {
    return { crawled: false, relatedCandidates, evidence, metrics };
  }

  metrics.pages_crawled = 1;
  const pageImages = extractPageImageUrls(rendered.html, input.pageUrl);
  metrics.images_discovered = pageImages.length;

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
      const contentSha = sha256OfContent(imageBytes);
      if (input.seenSha.has(contentSha)) continue;
      input.seenSha.add(contentSha);

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
        source_website_url: input.pageUrl,
        google_result_url: input.pageUrl,
        query: input.query,
        title: rendered.pageTitle,
        width: null,
        height: null,
      };
      const candidate = toCandidate(hit, match, { pageCrawled: true });
      if (candidate) relatedCandidates.push(candidate);

      evidence.push(
        buildGoogleImagesEvidencePackage({
          query: input.query,
          googleResultUrl: input.pageUrl,
          sourceWebsiteUrl: input.pageUrl,
          imageUrl,
          faceSimilarity: match.similarity,
          identityConfidence: match.faceConfidence,
          sha256: contentSha,
          perceptualHash: perceptualHashOfUrl(imageUrl),
          crawlMetadata: {
            provider: "google_images_source_page",
            used_browser: true,
          },
        }),
      );
      metrics.evidence_packages_created += 1;
    } catch {
      metrics.failed_downloads += 1;
    }
  }

  // Related / gallery-ish same-host links (discovery only, capped)
  const relatedLinks = (rendered.links ?? [])
    .filter((link) => isUsableSourceWebsiteUrl(link))
    .filter((link) => {
      try {
        return new URL(link).hostname === new URL(input.pageUrl).hostname;
      } catch {
        return false;
      }
    })
    .filter((link) =>
      /gallery|photo|image|album|pics|media|mirror/i.test(link),
    )
    .slice(0, 3);

  for (const link of relatedLinks) {
    relatedCandidates.push({
      url: link,
      title: `Related media page for ${input.query}`,
      description: "Related gallery/media page discovered from Google Images source",
      query: input.query,
      source: "google_images_investigation",
      evidence_page_url: link,
      google_search_query: input.query,
      threat_signals: ["google-images-related-page"],
      page_crawled: false,
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "UNVERIFIED",
    });
  }

  return { crawled: true, relatedCandidates, evidence, metrics };
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
    if (seenImageUrls.has(hit.image_url)) {
      metrics.duplicate_images += 1;
      continue;
    }
    seenImageUrls.add(hit.image_url);

    if (isUsableSourceWebsiteUrl(hit.source_website_url)) {
      metrics.source_pages_discovered += 1;
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

      const contentSha = sha256OfContent(imageBytes);
      if (seenSha.has(contentSha)) {
        metrics.duplicate_images += 1;
        continue;
      }
      seenSha.add(contentSha);
      seenSha.add(urlSha);
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

      if (
        sourcePage &&
        crawledPages.size < GOOGLE_IMAGES_SOURCE_PAGE_LIMIT &&
        !crawledPages.has(sourcePage)
      ) {
        crawledPages.add(sourcePage);
        const pageResult = await investigateSourcePage({
          pageUrl: sourcePage,
          query: hit.query,
          references,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
          seenImageUrls,
          seenSha,
          seenPhash,
        });
        pageCrawled = pageResult.crawled;
        metrics.candidate_pages_crawled += pageResult.metrics.pages_crawled;
        metrics.images_discovered += pageResult.metrics.images_discovered;
        metrics.images_downloaded += pageResult.metrics.images_downloaded;
        metrics.face_comparisons += pageResult.metrics.face_comparisons;
        metrics.high_confidence_matches +=
          pageResult.metrics.high_confidence_matches;
        metrics.evidence_packages_created +=
          pageResult.metrics.evidence_packages_created;
        metrics.failed_downloads += pageResult.metrics.failed_downloads;
        candidates.push(...pageResult.relatedCandidates);
        evidence_packages.push(...pageResult.evidence);
      }

      evidence_packages.push(
        buildGoogleImagesEvidencePackage({
          query: hit.query,
          googleResultUrl: hit.google_result_url,
          sourceWebsiteUrl: hit.source_website_url,
          imageUrl: hit.image_url,
          faceSimilarity: match.similarity,
          identityConfidence: match.faceConfidence,
          sha256: contentSha,
          perceptualHash: urlPhash,
          crawlMetadata: {
            provider: "google_images",
            used_browser: collection.used_browser,
            source_page_crawled: pageCrawled,
          },
        }),
      );
      metrics.evidence_packages_created += 1;

      const candidate = toCandidate(hit, match, { pageCrawled });
      if (candidate) candidates.push(candidate);
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
