/**
 * Investigation-grade reference embedding library.
 * Caches indexed face metadata per celebrity for reuse across scans.
 */

import type { CollectedReferenceImage } from "./reference-images";
import { getInvestigationCache, setInvestigationCache } from "./investigation-cache.server";

export interface StoredReferenceEmbedding {
  reference_id: string;
  celebrity_key: string;
  image_url: string;
  page_url: string;
  source_provider: string;
  quality_score: number;
  sha256: string;
  rekognition_face_id: string | null;
  face_confidence: number;
  collected_at: string;
}

const EMBEDDING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function celebrityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function embeddingCacheKey(name: string): string {
  return `embeddings:${celebrityKey(name)}`;
}

export function loadReferenceEmbeddingLibrary(celebrityName: string): StoredReferenceEmbedding[] {
  return getInvestigationCache<StoredReferenceEmbedding[]>(embeddingCacheKey(celebrityName)) ?? [];
}

export function storeReferenceEmbeddingLibrary(
  celebrityName: string,
  embeddings: StoredReferenceEmbedding[],
): void {
  setInvestigationCache(embeddingCacheKey(celebrityName), embeddings, EMBEDDING_CACHE_TTL_MS);
}

export function mergeCollectedIntoEmbeddingLibrary(input: {
  celebrityName: string;
  images: CollectedReferenceImage[];
  rekognitionFaceIds?: Map<string, string>;
}): StoredReferenceEmbedding[] {
  const existing = loadReferenceEmbeddingLibrary(input.celebrityName);
  const bySha = new Map(existing.map((row) => [row.sha256, row]));

  for (const img of input.images) {
    if (!img.sha256 || !img.face_detected) continue;
    if (bySha.has(img.sha256)) continue;
    bySha.set(img.sha256, {
      reference_id: img.sha256.slice(0, 16),
      celebrity_key: celebrityKey(input.celebrityName),
      image_url: img.image_url,
      page_url: img.page_url,
      source_provider: img.source_provider,
      quality_score: img.quality_score,
      sha256: img.sha256,
      rekognition_face_id: input.rekognitionFaceIds?.get(img.sha256) ?? null,
      face_confidence: img.face_confidence ?? 0,
      collected_at: img.collected_at,
    });
  }

  const merged = [...bySha.values()].sort((a, b) => b.quality_score - a.quality_score);
  storeReferenceEmbeddingLibrary(input.celebrityName, merged);
  return merged;
}

export function topReferenceImageUrls(celebrityName: string, limit = 24): string[] {
  return loadReferenceEmbeddingLibrary(celebrityName)
    .slice(0, limit)
    .map((row) => row.image_url);
}
