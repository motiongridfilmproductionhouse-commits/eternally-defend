/**
 * Resolve publicly available media for a post permalink.
 *
 * Strictly permitted retrieval only: a plain anonymous GET of the page and the
 * public metadata the platform itself publishes (Open Graph / oEmbed). If the
 * platform requires a login or blocks anonymous access we STOP and report it —
 * we never work around access controls, and the caller falls back to upload.
 */
import { parsePostUrl, type SocialAssetPlatform } from "./provenance";

export interface ResolvedPostMedia {
  platform: SocialAssetPlatform;
  canonicalUrl: string;
  postId: string | null;
  title: string | null;
  mediaUrls: string[];
  blocked: boolean;
  blockedReason: string | null;
}

const UA = "EternaSentinel/1.0 (+https://eternasentinel.com) public-metadata-reader";

function metaContent(html: string, keys: string[]): string[] {
  const out: string[] = [];
  const tagRe = /<meta\s+[^>]*>/gi;
  for (const tag of html.match(tagRe) ?? []) {
    const prop = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (prop && content && keys.includes(prop)) out.push(content);
  }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function resolvePublicPostMedia(rawUrl: string): Promise<ResolvedPostMedia | null> {
  const parsed = parsePostUrl(rawUrl);
  if (!parsed) return null;

  const base: ResolvedPostMedia = {
    platform: parsed.platform,
    canonicalUrl: parsed.canonicalUrl,
    postId: parsed.postId,
    title: null,
    mediaUrls: [],
    blocked: false,
    blockedReason: null,
  };

  // 1) Platform-published oEmbed (no credentials, no scraping).
  const oembed = oembedEndpoint(parsed.platform, parsed.canonicalUrl);
  if (oembed) {
    try {
      const res = await fetch(oembed, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok) {
        const payload = (await res.json()) as { title?: string; thumbnail_url?: string };
        if (payload.thumbnail_url) {
          return { ...base, title: payload.title ?? null, mediaUrls: [payload.thumbnail_url] };
        }
      }
    } catch {
      // fall through to public page metadata
    }
  }

  // 2) Public Open Graph metadata from the permalink itself.
  try {
    const res = await fetch(parsed.canonicalUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { ...base, blocked: true, blockedReason: `platform_returned_${res.status}` };
    }
    if (!res.ok) {
      return { ...base, blocked: true, blockedReason: `platform_returned_${res.status}` };
    }
    const html = (await res.text()).slice(0, 600_000);
    const loginWalled = /accounts\/login|Log in to Instagram|"require_login"/i.test(html);
    const images = metaContent(html, ["og:image", "og:image:secure_url", "twitter:image"]);
    const videos = metaContent(html, ["og:video", "og:video:url", "og:video:secure_url"]);
    const title = metaContent(html, ["og:title", "twitter:title"])[0] ?? null;
    const mediaUrls = [...new Set([...videos, ...images].map(decodeEntities))].filter((u) =>
      /^https?:\/\//i.test(u),
    );
    if (!mediaUrls.length) {
      return {
        ...base,
        blocked: true,
        blockedReason: loginWalled ? "login_required" : "no_public_media_metadata",
      };
    }
    return { ...base, title: title ? decodeEntities(title) : null, mediaUrls };
  } catch (error) {
    return {
      ...base,
      blocked: true,
      blockedReason: error instanceof Error ? error.message.slice(0, 120) : "fetch_failed",
    };
  }
}

function oembedEndpoint(platform: SocialAssetPlatform, url: string): string | null {
  const encoded = encodeURIComponent(url);
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/oembed?format=json&url=${encoded}`;
    case "tiktok":
      return `https://www.tiktok.com/oembed?url=${encoded}`;
    default:
      // Instagram/Facebook oEmbed requires an approved Meta app token; without an
      // authorized connection we only read public page metadata.
      return null;
  }
}
