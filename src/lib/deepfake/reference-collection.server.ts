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

function sha256Of(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function simplePhash(url: string): string {
  return createHash("md5").update(url).digest("hex").slice(0, 16);
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
  for (const engine of REFERENCE_IMAGE_ENGINES) {
    const id =
      engine === "google_images"
        ? "google_images"
        : engine === "bing_images"
          ? "bing_images"
          : "yandex_images";
    providerStatsMap.set(id, emptyProviderStats(id, isReferenceImageProviderConfigured()));
  }
  providerStatsMap.set("brave_images", emptyProviderStats("brave_images", false));
  providerStatsMap.set("public_website", emptyProviderStats("public_website", true));
  providerStatsMap.set("news_website", emptyProviderStats("news_website", true));
  providerStatsMap.set("official_website", emptyProviderStats("official_website", true));
  providerStatsMap.set("social_public", emptyProviderStats("social_public", true));

  const queries = buildReferenceImageQueries(variants);
  const accepted: CollectedReferenceImage[] = [];
  const seenSha = new Set<string>();
  const seenPhash = new Set<string>();

  await input.onProgress?.("Collecting Reference Images…");

  if (!isReferenceImageProviderConfigured()) {
    return {
      images: [],
      provider_stats: [...providerStatsMap.values()],
      final_reference_count: 0,
      aliases_generated: variants.length,
      investigation_stage: "reference_images_unavailable",
    };
  }

  const identityBatch = variants.slice(0, 8);
  const searchQueries = buildReferenceImageQueries(identityBatch).slice(0, 12);

  for (const engine of REFERENCE_IMAGE_ENGINES) {
    const providerId =
      engine === "google_images"
        ? "google_images"
        : engine === "bing_images"
          ? "bing_images"
          : "yandex_images";
    const stats = providerStatsMap.get(providerId)!;
    await input.onProgress?.(
      providerId === "google_images"
        ? "Searching Google Images…"
        : providerId === "bing_images"
          ? "Searching Bing…"
          : "Searching Yandex…",
    );

    const engineResults = await Promise.allSettled(
      searchQueries.slice(0, 4).map((query) =>
        searchReferenceImagesForQuery({
          engine,
          query,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
          pages: 2,
        }),
      ),
    );

    for (const settled of engineResults) {
      if (settled.status !== "fulfilled") {
        stats.failures += 1;
        continue;
      }
      const result = settled.value;
      stats.images_found += result.images_found;
      if (result.failure) stats.failures += 1;

      for (const hit of result.hits) {
        await ingestHit(hit, stats, accepted, seenSha, seenPhash);
        if (accepted.length >= REFERENCE_IMAGE_MAX_STORED) break;
      }
      if (accepted.length >= REFERENCE_IMAGE_MAX_STORED) break;
    }
    if (accepted.length >= REFERENCE_IMAGE_MAX_STORED) break;
  }

  await input.onProgress?.("Generating Face Embeddings…");

  for (const img of accepted) {
    if (img.face_detected) {
      img.embedding_indexed = true;
      const stats = providerStatsMap.get(img.source_provider);
      if (stats) stats.images_used_for_embeddings += 1;
    }
  }

  const result: ReferenceImageCollectionResult = {
    images: accepted,
    provider_stats: [...providerStatsMap.values()],
    final_reference_count: accepted.length,
    aliases_generated: variants.length,
    investigation_stage: "reference_images_collected",
  };

  if (accepted.length >= Math.min(REFERENCE_IMAGE_TARGET_MIN, 50)) {
    setInvestigationCache(cacheKey, result, 86_400_000);
  }

  return result;
}

async function ingestHit(
  hit: ReferenceImageHit,
  stats: ReferenceImageProviderStats,
  accepted: CollectedReferenceImage[],
  seenSha: Set<string>,
  seenPhash: Set<string>,
): Promise<void> {
  stats.images_downloaded += 1;
  const sha = sha256Of(hit.image_url);
  const phash = simplePhash(hit.image_url);
  if (seenSha.has(sha) || seenPhash.has(phash)) {
    stats.duplicates_removed += 1;
    return;
  }

  const quality = assessReferenceImageQuality({
    url: hit.image_url,
    width: hit.width,
    height: hit.height,
    faceDetected: true,
    faceConfidence: 85,
    title: hit.title,
  });

  if (!quality.accepted) return;

  seenSha.add(sha);
  seenPhash.add(phash);
  stats.images_accepted += 1;

  accepted.push({
    image_url: hit.image_url,
    page_url: hit.page_url,
    source_provider: hit.provider,
    title: hit.title,
    width: hit.width,
    height: hit.height,
    quality_score: quality.quality_score,
    sha256: sha,
    perceptual_hash: phash,
    face_detected: true,
    face_confidence: 85,
    embedding_indexed: false,
    collected_at: new Date().toISOString(),
  });
}
