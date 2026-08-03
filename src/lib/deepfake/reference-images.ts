/**
 * Reference image collection types and stats for Deepfake Intelligence.
 */

export const REFERENCE_IMAGE_TARGET_MIN = 300;
export const REFERENCE_IMAGE_TARGET_MAX = 1000;
export const REFERENCE_IMAGE_MAX_STORED = 512;

export type ReferenceImageProviderId =
  | "google_images"
  | "bing_images"
  | "yandex_images"
  | "brave_images"
  | "public_website"
  | "news_website"
  | "official_website"
  | "social_public"
  | "user_upload";

export interface ReferenceImageProviderStats {
  provider: ReferenceImageProviderId;
  images_found: number;
  images_downloaded: number;
  images_accepted: number;
  duplicates_removed: number;
  images_used_for_embeddings: number;
  failures: number;
  configured: boolean;
}

export interface CollectedReferenceImage {
  image_url: string;
  page_url: string;
  source_provider: ReferenceImageProviderId;
  title: string | null;
  width: number | null;
  height: number | null;
  quality_score: number;
  sha256: string | null;
  perceptual_hash: string | null;
  face_detected: boolean;
  face_confidence: number | null;
  embedding_indexed: boolean;
  collected_at: string;
}

export interface ReferenceImageCollectionResult {
  images: CollectedReferenceImage[];
  provider_stats: ReferenceImageProviderStats[];
  final_reference_count: number;
  aliases_generated: number;
  investigation_stage: string;
}

export function emptyProviderStats(
  provider: ReferenceImageProviderId,
  configured = true,
): ReferenceImageProviderStats {
  return {
    provider,
    images_found: 0,
    images_downloaded: 0,
    images_accepted: 0,
    duplicates_removed: 0,
    images_used_for_embeddings: 0,
    failures: 0,
    configured,
  };
}

export function providerLabel(id: ReferenceImageProviderId): string {
  const labels: Record<ReferenceImageProviderId, string> = {
    google_images: "Google Images",
    bing_images: "Bing Images",
    yandex_images: "Yandex Images",
    brave_images: "Brave Image Search",
    public_website: "Public Websites",
    news_website: "News Websites",
    official_website: "Official Websites",
    social_public: "Social Media (public)",
    user_upload: "User Upload",
  };
  return labels[id];
}

export function parseReferenceImagesFromMetrics(
  metrics: Record<string, unknown> | null | undefined,
): CollectedReferenceImage[] {
  const raw = metrics?.reference_images;
  if (!Array.isArray(raw)) return [];
  const out: CollectedReferenceImage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const imageUrl = typeof r.image_url === "string" ? r.image_url : null;
    const pageUrl = typeof r.page_url === "string" ? r.page_url : null;
    const provider = r.source_provider as ReferenceImageProviderId;
    if (!imageUrl || !pageUrl || !provider) continue;
    out.push({
      image_url: imageUrl,
      page_url: pageUrl,
      source_provider: provider,
      title: typeof r.title === "string" ? r.title : null,
      width: typeof r.width === "number" ? r.width : null,
      height: typeof r.height === "number" ? r.height : null,
      quality_score: typeof r.quality_score === "number" ? r.quality_score : 0,
      sha256: typeof r.sha256 === "string" ? r.sha256 : null,
      perceptual_hash: typeof r.perceptual_hash === "string" ? r.perceptual_hash : null,
      face_detected: r.face_detected === true,
      face_confidence: typeof r.face_confidence === "number" ? r.face_confidence : null,
      embedding_indexed: r.embedding_indexed === true,
      collected_at: typeof r.collected_at === "string" ? r.collected_at : new Date().toISOString(),
    });
  }
  return out;
}

export function parseProviderStatsFromMetrics(
  metrics: Record<string, unknown> | null | undefined,
): ReferenceImageProviderStats[] {
  const raw = metrics?.reference_image_provider_stats;
  if (!Array.isArray(raw)) return [];
  const out: ReferenceImageProviderStats[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const provider = r.provider as ReferenceImageProviderId;
    if (!provider) continue;
    out.push({
      provider,
      images_found: Number(r.images_found) || 0,
      images_downloaded: Number(r.images_downloaded) || 0,
      images_accepted: Number(r.images_accepted) || 0,
      duplicates_removed: Number(r.duplicates_removed) || 0,
      images_used_for_embeddings: Number(r.images_used_for_embeddings) || 0,
      failures: Number(r.failures) || 0,
      configured: r.configured !== false,
    });
  }
  return out;
}
