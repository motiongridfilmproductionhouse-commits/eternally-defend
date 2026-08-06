/**
 * Mixed reference materials for the live Copyright Intelligence reel.
 * Persisted in copyright_scans.stats.reference_materials (max 40).
 */

import { hostOf } from "./url.server";
import {
  normalizeReferenceImageUrl,
  parseReferenceImages,
  type ReferenceImage,
} from "./reference-images";
import type { YtVideo } from "./youtube-monitor.server";

export const REFERENCE_MATERIALS_MAX = 40;

export type ReferenceMaterialType =
  | "original_reference"
  | "poster"
  | "backdrop"
  | "og_image"
  | "trailer"
  | "teaser"
  | "review_video"
  | "reaction_video"
  | "interview_video"
  | "news_image"
  | "candidate_page"
  | "website_result"
  | "provider_status";

export type ReferenceMaterialClassification =
  | "Official"
  | "Promotional"
  | "Review"
  | "Reaction"
  | "News"
  | "Candidate"
  | "Investigating"
  | "Rejected"
  | "Potential distribution"
  | "Verified evidence";

export interface ReferenceMaterial {
  id: string;
  material_type: ReferenceMaterialType;
  title: string | null;
  image_url: string | null;
  video_url: string | null;
  page_url: string | null;
  source_domain: string | null;
  source_name: string | null;
  provider: string;
  channel_name: string | null;
  duration_seconds: number | null;
  status: string;
  classification: ReferenceMaterialClassification;
  discovered_at: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function materialId(parts: string[]): string {
  return parts.filter(Boolean).join("::").slice(0, 240);
}

export function parseReferenceMaterials(
  stats: Record<string, unknown> | null | undefined,
): ReferenceMaterial[] {
  const raw = stats?.reference_materials;
  const out: ReferenceMaterial[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = str(r.id);
      const materialType = str(r.material_type) as ReferenceMaterialType | null;
      const provider = str(r.provider);
      const status = str(r.status);
      const classification = str(r.classification) as ReferenceMaterialClassification | null;
      const discoveredAt = str(r.discovered_at);
      if (!id || !materialType || !provider || !status || !classification || !discoveredAt) {
        continue;
      }
      out.push({
        id,
        material_type: materialType,
        title: str(r.title),
        image_url: str(r.image_url),
        video_url: str(r.video_url),
        page_url: str(r.page_url),
        source_domain: str(r.source_domain),
        source_name: str(r.source_name),
        provider,
        channel_name: str(r.channel_name),
        duration_seconds:
          typeof r.duration_seconds === "number" && Number.isFinite(r.duration_seconds)
            ? r.duration_seconds
            : null,
        status,
        classification,
        discovered_at: discoveredAt,
      });
    }
  }

  if (out.length) return out;

  // Legacy fallback: reference_images → materials
  return parseReferenceImages(stats).map(referenceImageToMaterial);
}

function referenceImageToMaterial(img: ReferenceImage): ReferenceMaterial {
  const typeMap: Record<string, ReferenceMaterialType> = {
    brightdata_serp: "poster",
    firecrawl_image: "poster",
    og_image: "og_image",
    twitter_image: "og_image",
    video_poster: "teaser",
    youtube_thumbnail: "trailer",
    page_screenshot: "candidate_page",
  };
  return {
    id: materialId(["legacy", img.image_url, img.page_url]),
    material_type: typeMap[img.source_type] ?? "poster",
    title: img.title,
    image_url: img.image_url,
    video_url: null,
    page_url: img.page_url,
    source_domain: img.source_domain,
    source_name: img.source_domain,
    provider: img.provider,
    channel_name: null,
    duration_seconds: null,
    status: img.status,
    classification: "Candidate",
    discovered_at: img.discovered_at,
  };
}

export function classifyYoutubeMaterial(video: YtVideo): {
  material_type: ReferenceMaterialType;
  classification: ReferenceMaterialClassification;
} {
  const text = `${video.title} ${video.matchedQuery} ${video.description}`.toLowerCase();
  if (/\bofficial trailer\b|\bteaser trailer\b|trailer\s*\|/.test(text)) {
    return { material_type: "trailer", classification: "Promotional" };
  }
  if (/\btrailer\b|\bteaser\b/.test(text)) {
    return { material_type: "teaser", classification: "Promotional" };
  }
  if (/\breview\b|\brating\b|\bexplained\b/.test(text)) {
    return { material_type: "review_video", classification: "Review" };
  }
  if (/\breaction\b/.test(text)) {
    return { material_type: "reaction_video", classification: "Reaction" };
  }
  if (/\binterview\b|\bpress\b/.test(text)) {
    return { material_type: "interview_video", classification: "News" };
  }
  if (/\bfull movie\b|\bwatch online\b|\bleak\b|\bcam\b|\bhdrip\b/.test(text)) {
    return { material_type: "candidate_page", classification: "Candidate" };
  }
  return { material_type: "teaser", classification: "Investigating" };
}

export function materialFromYoutubeVideo(video: YtVideo): ReferenceMaterial | null {
  if (!video.thumbnailUrl) return null;
  const { material_type, classification } = classifyYoutubeMaterial(video);
  return {
    id: materialId(["youtube", video.videoId]),
    material_type,
    title: video.title,
    image_url: video.thumbnailUrl,
    video_url: video.videoUrl,
    page_url: video.videoUrl,
    source_domain: "youtube.com",
    source_name: video.channelTitle,
    provider: "youtube",
    channel_name: video.channelTitle,
    duration_seconds: video.durationSeconds,
    status: "discovered",
    classification,
    discovered_at: new Date().toISOString(),
  };
}

export function materialFromReferenceImage(img: ReferenceImage): ReferenceMaterial {
  return referenceImageToMaterial(img);
}

export function appendReferenceMaterials(
  existing: ReferenceMaterial[],
  additions: ReferenceMaterial[],
): ReferenceMaterial[] {
  if (!additions.length) return existing;
  const seen = new Set(
    existing.map((m) =>
      m.image_url
        ? normalizeReferenceImageUrl(m.image_url)
        : materialId([m.page_url ?? "", m.video_url ?? ""]),
    ),
  );
  const out = [...existing];
  for (const item of additions) {
    const key = item.image_url
      ? normalizeReferenceImageUrl(item.image_url)
      : materialId([item.page_url ?? "", item.video_url ?? ""]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= REFERENCE_MATERIALS_MAX) break;
  }
  return out;
}

export class ReferenceMaterialRecorder {
  private materials: ReferenceMaterial[] = [];

  restoreFromStats(stats: Record<string, unknown> | null | undefined): void {
    this.materials = parseReferenceMaterials(stats ?? {});
  }

  append(additions: ReferenceMaterial[]): void {
    this.materials = appendReferenceMaterials(this.materials, additions);
  }

  appendImages(images: ReferenceImage[]): void {
    this.append(images.map(referenceImageToMaterial));
  }

  mergeToStats(stats: Record<string, unknown>): Record<string, unknown> {
    return {
      ...stats,
      reference_materials: this.materials,
      reference_materials_count: this.materials.length,
      // Keep legacy field in sync for older clients
      reference_images: this.materials
        .filter((m) => m.image_url && m.page_url)
        .slice(0, 20)
        .map((m) => ({
          image_url: m.image_url!,
          page_url: m.page_url!,
          source_domain: m.source_domain,
          source_type: m.material_type,
          title: m.title,
          provider: m.provider,
          status: m.status,
          discovered_at: m.discovered_at,
        })),
      reference_images_count: this.materials.filter((m) => m.image_url).length,
    };
  }

  count(): number {
    return this.materials.length;
  }
}

export function isYoutubeConfigured(): boolean {
  return Boolean((process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").trim());
}
