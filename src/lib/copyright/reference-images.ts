/**
 * Discovered reference thumbnails for the live Copyright Intelligence carousel.
 * Persisted in copyright_scans.stats.reference_images (max 20, deduped by image URL).
 */

import { hostOf } from "./url.server";

export const REFERENCE_IMAGES_MAX = 20;

export type ReferenceImageSourceType =
  | "brightdata_serp"
  | "firecrawl_image"
  | "og_image"
  | "twitter_image"
  | "video_poster"
  | "youtube_thumbnail"
  | "page_screenshot";

export type ReferenceImageStatus = "discovered" | "validated" | "failed";

export interface ReferenceImage {
  image_url: string;
  page_url: string;
  source_domain: string | null;
  source_type: ReferenceImageSourceType;
  title: string | null;
  provider: string;
  status: ReferenceImageStatus;
  discovered_at: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function absoluteUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    if (trimmed.startsWith("//")) return new URL(`https:${trimmed}`).toString();
    if (/^https?:\/\//i.test(trimmed)) return new URL(trimmed).toString();
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Normalize image URLs for deduplication (strip query/hash, lowercase host). */
export function normalizeReferenceImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function isUsableReferenceImageUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return false;
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith("//");
}

export function parseReferenceImages(
  stats: Record<string, unknown> | null | undefined,
): ReferenceImage[] {
  const raw = stats?.reference_images;
  if (!Array.isArray(raw)) return [];
  const out: ReferenceImage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const imageUrl = str(r.image_url);
    const pageUrl = str(r.page_url);
    const sourceType = str(r.source_type) as ReferenceImageSourceType | null;
    const provider = str(r.provider);
    const status = str(r.status) as ReferenceImageStatus | null;
    const discoveredAt = str(r.discovered_at);
    if (!imageUrl || !pageUrl || !sourceType || !provider || !status || !discoveredAt) continue;
    if (!isUsableReferenceImageUrl(imageUrl)) continue;
    out.push({
      image_url: imageUrl,
      page_url: pageUrl,
      source_domain: str(r.source_domain),
      source_type: sourceType,
      title: str(r.title),
      provider,
      status,
      discovered_at: discoveredAt,
    });
  }
  return out;
}

export function appendReferenceImages(
  existing: ReferenceImage[],
  additions: ReferenceImage[],
): ReferenceImage[] {
  if (!additions.length) return existing;
  const seen = new Set(existing.map((img) => normalizeReferenceImageUrl(img.image_url)));
  const out = [...existing];
  for (const img of additions) {
    if (!isUsableReferenceImageUrl(img.image_url)) continue;
    const key = normalizeReferenceImageUrl(img.image_url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= REFERENCE_IMAGES_MAX) break;
  }
  return out;
}

export function youtubeThumbnailFromPageUrl(
  pageUrl: string,
  title?: string | null,
  provider = "direct_retrieval",
): ReferenceImage | null {
  try {
    const parsed = new URL(pageUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "youtube.com" && host !== "youtu.be" && host !== "m.youtube.com") {
      return null;
    }
    let videoId: string | null = null;
    if (host === "youtu.be") {
      videoId = parsed.pathname.replace(/^\//, "").split("/")[0] ?? null;
    } else {
      videoId = parsed.searchParams.get("v");
      if (!videoId && parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.split("/")[2] ?? null;
      }
    }
    if (!videoId || videoId.length < 6) return null;
    const imageUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    return {
      image_url: imageUrl,
      page_url: pageUrl,
      source_domain: host,
      source_type: "youtube_thumbnail",
      title: title ?? null,
      provider,
      status: "discovered",
      discovered_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function referenceImageFromDiscoveryCandidate(input: {
  pageUrl: string;
  imageUrl: string;
  title?: string | null;
  provider?: string;
  sourceType?: ReferenceImageSourceType;
}): ReferenceImage | null {
  const resolved = absoluteUrl(input.imageUrl, input.pageUrl);
  if (!resolved || !isUsableReferenceImageUrl(resolved)) return null;
  return {
    image_url: resolved,
    page_url: input.pageUrl,
    source_domain: hostOf(input.pageUrl),
    source_type: input.sourceType ?? "firecrawl_image",
    title: input.title ?? null,
    provider: input.provider ?? "firecrawl",
    status: "discovered",
    discovered_at: new Date().toISOString(),
  };
}

export function referenceImageFromBrightDataHit(input: {
  pageUrl: string;
  imageUrl: string;
  title?: string | null;
  domain?: string | null;
}): ReferenceImage | null {
  const resolved = absoluteUrl(input.imageUrl, input.pageUrl);
  if (!resolved || !isUsableReferenceImageUrl(resolved)) return null;
  return {
    image_url: resolved,
    page_url: input.pageUrl,
    source_domain: input.domain ?? hostOf(input.pageUrl),
    source_type: "brightdata_serp",
    title: input.title ?? null,
    provider: "brightdata",
    status: "discovered",
    discovered_at: new Date().toISOString(),
  };
}

function metaImage(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(metadata[key]);
    if (value) return value;
  }
  return null;
}

function extractFromHtml(html: string, pageUrl: string): ReferenceImage[] {
  const out: ReferenceImage[] = [];
  const patterns: Array<{ regex: RegExp; sourceType: ReferenceImageSourceType }> = [
    {
      regex:
        /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      sourceType: "og_image",
    },
    {
      regex:
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:secure_url)["'][^>]*>/gi,
      sourceType: "og_image",
    },
    {
      regex:
        /<meta[^>]+(?:property|name)=["'](?:twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      sourceType: "twitter_image",
    },
    {
      regex:
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:twitter:image|twitter:image:src)["'][^>]*>/gi,
      sourceType: "twitter_image",
    },
    {
      regex: /<video[^>]+poster=["']([^"']+)["'][^>]*>/gi,
      sourceType: "video_poster",
    },
  ];

  for (const { regex, sourceType } of patterns) {
    for (const match of html.matchAll(regex)) {
      const resolved = absoluteUrl(match[1] ?? "", pageUrl);
      if (!resolved || !isUsableReferenceImageUrl(resolved)) continue;
      out.push({
        image_url: resolved,
        page_url: pageUrl,
        source_domain: hostOf(pageUrl),
        source_type: sourceType,
        title: null,
        provider: "direct_retrieval",
        status: "discovered",
        discovered_at: new Date().toISOString(),
      });
      break;
    }
  }
  return out;
}

/** Extract carousel thumbnails from retrieved page metadata / HTML / screenshot. */
export function extractReferenceImagesFromPage(input: {
  pageUrl: string;
  title?: string | null;
  metadata?: Record<string, unknown> | null;
  html?: string | null;
  screenshot?: string | null;
  provider?: string;
}): ReferenceImage[] {
  const pageUrl = input.pageUrl;
  const provider = input.provider ?? "direct_retrieval";
  const title = input.title ?? null;
  const out: ReferenceImage[] = [];
  const now = new Date().toISOString();

  const yt = youtubeThumbnailFromPageUrl(pageUrl, title, provider);
  if (yt) out.push(yt);

  const meta = input.metadata ?? {};
  const og = metaImage(meta, ["ogImage", "og:image", "og:image:secure_url"]);
  if (og) {
    const resolved = absoluteUrl(og, pageUrl);
    if (resolved && isUsableReferenceImageUrl(resolved)) {
      out.push({
        image_url: resolved,
        page_url: pageUrl,
        source_domain: hostOf(pageUrl),
        source_type: "og_image",
        title,
        provider,
        status: "discovered",
        discovered_at: now,
      });
    }
  }

  const twitter = metaImage(meta, ["twitter:image", "twitter:image:src"]);
  if (twitter) {
    const resolved = absoluteUrl(twitter, pageUrl);
    if (resolved && isUsableReferenceImageUrl(resolved)) {
      out.push({
        image_url: resolved,
        page_url: pageUrl,
        source_domain: hostOf(pageUrl),
        source_type: "twitter_image",
        title,
        provider,
        status: "discovered",
        discovered_at: now,
      });
    }
  }

  if (input.html) {
    out.push(...extractFromHtml(input.html, pageUrl));
  }

  const shot = str(input.screenshot);
  if (shot && (shot.startsWith("http://") || shot.startsWith("https://"))) {
    out.push({
      image_url: shot,
      page_url: pageUrl,
      source_domain: hostOf(pageUrl),
      source_type: "page_screenshot",
      title,
      provider,
      status: "discovered",
      discovered_at: now,
    });
  }

  return out;
}

/** In-memory recorder for the active scan executor. */
export class ReferenceImageRecorder {
  private images: ReferenceImage[] = [];

  restoreFromStats(stats: Record<string, unknown> | null | undefined): void {
    this.images = parseReferenceImages(stats ?? {});
  }

  append(additions: ReferenceImage[]): void {
    this.images = appendReferenceImages(this.images, additions);
  }

  mergeToStats(stats: Record<string, unknown>): Record<string, unknown> {
    return {
      ...stats,
      reference_images: this.images,
      reference_images_count: this.images.length,
    };
  }

  count(): number {
    return this.images.length;
  }
}

/** Client-side safe image proxy path (never forwards secrets). */
export function proxiedReferenceImageUrl(remoteUrl: string): string {
  if (!remoteUrl) return remoteUrl;
  const trimmed = remoteUrl.trim();
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `/api/public/image-proxy?key=${encodeURIComponent(trimmed)}`;
  }
  return `/api/public/image-proxy?url=${encodeURIComponent(trimmed)}`;
}
