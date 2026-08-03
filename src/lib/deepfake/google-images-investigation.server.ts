/**
 * Mandatory Google Images investigation for Deepfake Intelligence.
 * Required provider — failures degrade gracefully and never abort the scan.
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

export const GOOGLE_IMAGES_MATCH_THRESHOLD = 88;
export const GOOGLE_IMAGES_HIGH_CONFIDENCE_THRESHOLD = 90;

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

function toCandidate(
  hit: GoogleImagesBrowserHit,
  match: {
    matched: boolean;
    similarity: number;
    faceConfidence: number;
  },
): GoogleImagesInvestigationCandidate {
  const pageUrl = hit.source_website_url ?? hit.google_result_url;
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
  };
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
    evidence_packages_created: 0,
    failed_downloads: 0,
    face_comparisons: 0,
    rejected_identities: 0,
  };
  const candidates: GoogleImagesInvestigationCandidate[] = [];
  const evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[] = [];

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
    };
  }

  const references = await loadReferenceBytes(input.referenceImages, input.signal);

  for (const hit of collection.hits) {
    assertNotAborted(input.signal);
    if (seenImageUrls.has(hit.image_url)) {
      metrics.duplicate_images += 1;
      continue;
    }
    seenImageUrls.add(hit.image_url);

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
          },
        }),
      );
      metrics.evidence_packages_created += 1;
      if (hit.source_website_url) metrics.candidate_pages_crawled += 1;
      candidates.push(toCandidate(hit, match));
    } catch {
      metrics.failed_downloads += 1;
    }
  }

  return { metrics, candidates, evidence_packages, failure: null };
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
  const evidence_packages: ReturnType<typeof buildGoogleImagesEvidencePackage>[] = [];
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

  let collection;
  try {
    collection = await collectGoogleImagesMandatory({
      queries,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
    });
  } catch (error) {
    diagnostics.provider_status = "unavailable";
    diagnostics.failure_reason =
      error instanceof Error ? error.message : String(error);
    return { diagnostics, candidates, evidence_packages };
  }

  diagnostics.queries_executed = collection.queries_executed || queries.length;
  diagnostics.pages_loaded = collection.pages_loaded;
  diagnostics.images_discovered = collection.images_discovered;
  diagnostics.used_browser = collection.used_browser;
  diagnostics.browser_available = collection.browser_available;
  diagnostics.provider_status = collection.provider_status;
  diagnostics.failure_reason = collection.failure;

  if (!collection.hits.length) {
    if (!diagnostics.failure_reason) {
      diagnostics.failure_reason = "Google Images returned no image results";
    }
    diagnostics.provider_status = "unavailable";
    return { diagnostics, candidates, evidence_packages };
  }

  const references = await loadReferenceBytes(input.referenceImages, input.signal);

  await input.onProgress?.("Comparing Faces…");

  const comparisonBatchSize = 4;
  for (let i = 0; i < collection.hits.length; i += comparisonBatchSize) {
    assertNotAborted(input.signal);
    const batch = collection.hits.slice(i, i + comparisonBatchSize);

    const batchResults = await Promise.all(
      batch.map(async (hit) => {
        if (seenImageUrls.has(hit.image_url)) {
          diagnostics.duplicate_images += 1;
          return null;
        }
        seenImageUrls.add(hit.image_url);

        const urlSha = sha256OfUrl(hit.image_url);
        const urlPhash = perceptualHashOfUrl(hit.image_url);
        if (seenSha.has(urlSha) || seenPhash.has(urlPhash)) {
          diagnostics.duplicate_images += 1;
          return null;
        }

        try {
          diagnostics.images_downloaded += 1;
          const imageBytes = await downloadFaceImage(hit.image_url, {
            signal: input.signal,
            softDeadlineMs: input.softDeadlineMs,
          });

          const contentSha = sha256OfContent(imageBytes);
          if (seenSha.has(contentSha)) {
            diagnostics.duplicate_images += 1;
            return null;
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
            diagnostics.rejected_identities += 1;
            return null;
          }

          diagnostics.valid_faces += 1;
          diagnostics.face_comparisons += 1;

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
            diagnostics.rejected_identities += 1;
            return null;
          }

          diagnostics.high_confidence_matches += 1;

          const evidence = buildGoogleImagesEvidencePackage({
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
              browser_engine: collection.used_browser ? "playwright|crawl4ai" : "serpapi",
            },
          });
          evidence_packages.push(evidence);
          diagnostics.evidence_packages_created += 1;

          if (hit.source_website_url) {
            diagnostics.candidate_pages_crawled += 1;
          }

          return toCandidate(hit, match);
        } catch {
          diagnostics.failed_downloads += 1;
          return null;
        }
      }),
    );

    for (const row of batchResults) {
      if (row) candidates.push(row);
    }
  }

  if (candidates.length > 0) {
    diagnostics.provider_status = "success";
  } else if (collection.hits.length > 0) {
    diagnostics.provider_status = "degraded";
    if (!diagnostics.failure_reason) {
      diagnostics.failure_reason =
        "Google Images discovered results but no high-confidence identity matches were confirmed";
    }
  }

  return { diagnostics, candidates, evidence_packages };
}
