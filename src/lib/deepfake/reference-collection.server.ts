/**
 * Reference image collection orchestration — parallel multi-provider harvest.
 */

import { createHash } from "node:crypto";
import {
  REFERENCE_IMAGE_MAX_STORED,
  REFERENCE_IMAGE_TARGET_MIN,
  emptyProviderStats,
  type CollectedReferenceImage,
  type ReferenceImageCollectionResult,
  type ReferenceImageProviderStats,
} from "./reference-images";
import { assessReferenceImageQuality } from "./image-quality.server";
import {
  buildReferenceImageQueries,
  isReferenceImageProviderConfigured,
  REFERENCE_IMAGE_ENGINES,
  searchReferenceImagesForQuery,
  type ReferenceImageHit,
} from "./image-discovery-providers.server";
import { expandIdentityVariants } from "./identity-variants.server";
import { getInvestigationCache, setInvestigationCache } from "./investigation-cache.server";
import { searchBraveImagesBatch, isBraveImageSearchConfigured } from "./brave-images.server";
import { collectGoogleImagesViaBrowser } from "./google-images-collector.server";
import { collectWebsiteReferenceImages } from "./website-reference-providers.server";
import { detectReferenceFace } from "./reference-face-detect.server";
import { mergeCollectedIntoEmbeddingLibrary } from "./reference-embedding-library.server";
import {
  indexDeepfakeReferenceFace,
  isDeepfakeFaceEnrollmentConfigured,
} from "./face-enrollment.server";
import { downloadFaceImage } from "./face-match.server";

function sha256Of(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function simplePhash(url: string): string {
  return createHash("md5").update(url).digest("hex").slice(0, 16);
}

type IngestContext = {
  stats: ReferenceImageProviderStats;
  accepted: CollectedReferenceImage[];
  seenSha: Set<string>;
  seenPhash: Set<string>;
  rekognitionFaceIds: Map<string, string>;
  celebrityName: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
};

async function ingestHit(hit: ReferenceImageHit, ctx: IngestContext): Promise<void> {
  ctx.stats.images_downloaded += 1;
  const sha = sha256Of(hit.image_url);
  const phash = simplePhash(hit.image_url);
  if (ctx.seenSha.has(sha) || ctx.seenPhash.has(phash)) {
    ctx.stats.duplicates_removed += 1;
    return;
  }

  const face = await detectReferenceFace({
    imageUrl: hit.image_url,
    signal: ctx.signal,
    softDeadlineMs: ctx.softDeadlineMs,
  });

  const quality = assessReferenceImageQuality({
    url: hit.image_url,
    width: hit.width,
    height: hit.height,
    faceDetected: face.faceDetected,
    faceConfidence: face.faceConfidence,
    title: hit.title,
  });

  if (!quality.accepted || !face.usable) return;

  ctx.seenSha.add(sha);
  ctx.seenPhash.add(phash);
  ctx.stats.images_accepted += 1;

  const collected: CollectedReferenceImage = {
    image_url: hit.image_url,
    page_url: hit.page_url,
    source_provider: hit.provider,
    title: hit.title,
    width: hit.width,
    height: hit.height,
    quality_score: quality.quality_score,
    sha256: sha,
    perceptual_hash: phash,
    face_detected: face.faceDetected,
    face_confidence: face.faceConfidence,
    embedding_indexed: false,
    collected_at: new Date().toISOString(),
  };

  if (isDeepfakeFaceEnrollmentConfigured() && ctx.accepted.length < 64) {
    try {
      const bytes = await downloadFaceImage(hit.image_url, {
        signal: ctx.signal,
        softDeadlineMs: ctx.softDeadlineMs,
      });
      const indexed = await indexDeepfakeReferenceFace({
        imageBytes: bytes,
        targetProfileId: ctx.celebrityName.replace(/\s+/g, "_").slice(0, 40),
        referenceFaceId: sha.slice(0, 16),
      });
      ctx.rekognitionFaceIds.set(sha, indexed.faceId);
      collected.embedding_indexed = true;
      ctx.stats.images_used_for_embeddings += 1;
    } catch {
      collected.embedding_indexed = face.faceDetected;
    }
  } else {
    collected.embedding_indexed = face.faceDetected;
  }

  ctx.accepted.push(collected);
}

async function ingestHits(
  hits: ReferenceImageHit[],
  stats: ReferenceImageProviderStats,
  ctx: IngestContext,
  maxToAccept: number,
): Promise<void> {
  for (const hit of hits) {
    if (ctx.accepted.length >= maxToAccept) break;
    await ingestHit(hit, { ...ctx, stats });
  }
}

export async function collectReferenceImages(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  onProgress?: (stage: string) => void | Promise<void>;
}): Promise<ReferenceImageCollectionResult> {
  const cacheKey = `ref:${input.name.toLowerCase()}`;
  const cached = getInvestigationCache<ReferenceImageCollectionResult>(cacheKey);
  if (cached && cached.final_reference_count >= REFERENCE_IMAGE_TARGET_MIN) {
    return cached;
  }

  const variants = expandIdentityVariants({
    name: input.name,
    aliases: input.aliases,
    handles: input.handles,
  });

  const providerStatsMap = new Map<string, ReferenceImageProviderStats>();
  providerStatsMap.set(
    "firecrawl_images",
    emptyProviderStats("firecrawl_images", isFirecrawlImageSearchConfigured()),
  );

  const accepted: CollectedReferenceImage[] = [];
  const seenSha = new Set<string>();
  const seenPhash = new Set<string>();
  const rekognitionFaceIds = new Map<string, string>();

  await input.onProgress?.("Collecting Reference Images…");

  const identityBatch = variants.slice(0, 12);
  const searchQueries = buildReferenceImageQueries(identityBatch).slice(0, 18);

  const ingestCtx: IngestContext = {
    stats: providerStatsMap.get("firecrawl_images")!,
    accepted,
    seenSha,
    seenPhash,
    rekognitionFaceIds,
    celebrityName: input.name,
    signal: input.signal,
    softDeadlineMs: input.softDeadlineMs,
  };

  if (!isFirecrawlImageSearchConfigured()) {
    return {
      images: [],
      provider_stats: [...providerStatsMap.values()],
      final_reference_count: 0,
      aliases_generated: variants.length,
      investigation_stage: "reference_images_unavailable",
    };
  }

  await input.onProgress?.("Searching with Firecrawl…");

  const stats = providerStatsMap.get("firecrawl_images")!;
  const firecrawlResult = await searchFirecrawlImagesBatch({
    queries: searchQueries.slice(0, 12),
    signal: input.signal,
    softDeadlineMs: input.softDeadlineMs,
  });
  stats.images_found += firecrawlResult.images_found;
  stats.failures += firecrawlResult.failures;
  await ingestHits(firecrawlResult.hits, stats, ingestCtx, REFERENCE_IMAGE_MAX_STORED);


  await input.onProgress?.("Generating Face Embeddings…");

  for (const img of accepted) {
    if (img.embedding_indexed) {
      const stats = providerStatsMap.get(img.source_provider);
      if (stats) stats.images_used_for_embeddings += 1;
    }
  }

  mergeCollectedIntoEmbeddingLibrary({
    celebrityName: input.name,
    images: accepted,
    rekognitionFaceIds,
  });

  const result: ReferenceImageCollectionResult = {
    images: accepted,
    provider_stats: [...providerStatsMap.values()],
    final_reference_count: accepted.length,
    aliases_generated: variants.length,
    investigation_stage:
      accepted.length > 0 ? "reference_images_collected" : "reference_images_unavailable",
  };

  if (accepted.length >= Math.min(REFERENCE_IMAGE_TARGET_MIN, 50)) {
    setInvestigationCache(cacheKey, result, 86_400_000);
  } else if (accepted.length >= 20) {
    setInvestigationCache(cacheKey, result, 43_200_000);
  }

  return result;
}
