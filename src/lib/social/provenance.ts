/**
 * Social asset provenance — pure helpers shared by client and server.
 *
 * Every protected asset that originates from a social platform records where it
 * came from (`source_platform`, `source_post_url`, `import_method`) so evidence
 * packages can state provenance without re-fetching the original post.
 */

export const SOCIAL_ASSET_PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "threads",
  "other",
] as const;

export type SocialAssetPlatform = (typeof SOCIAL_ASSET_PLATFORMS)[number];

export type SocialAccountMode = "PUBLIC_REFERENCE" | "AUTHORIZED_CONNECTED";

/** How the media bytes reached Eterna. Never implies ownership verification. */
export type ImportMethod = "AUTHORIZED_API" | "PUBLIC_LINK" | "MANUAL_UPLOAD";

const HOST_PLATFORMS: Array<{ platform: SocialAssetPlatform; hosts: string[] }> = [
  { platform: "instagram", hosts: ["instagram.com", "instagr.am"] },
  { platform: "facebook", hosts: ["facebook.com", "fb.com", "fb.watch"] },
  { platform: "x", hosts: ["x.com", "twitter.com"] },
  { platform: "tiktok", hosts: ["tiktok.com"] },
  { platform: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "linkedin", hosts: ["linkedin.com"] },
  { platform: "threads", hosts: ["threads.net", "threads.com"] },
];

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function platformFromUrl(url: string): SocialAssetPlatform {
  const host = hostOf(url);
  if (!host) return "other";
  for (const entry of HOST_PLATFORMS) {
    if (entry.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return entry.platform;
  }
  return "other";
}

/** Normalize a self-declared profile link. Returns null when it isn't a usable http(s) URL. */
export function normalizeProfileUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Best-effort handle extraction from a public profile URL. Presentation only. */
export function handleFromProfileUrl(raw: string): string | null {
  const normalized = normalizeProfileUrl(raw);
  if (!normalized) return null;
  try {
    const { pathname } = new URL(normalized);
    const segment = pathname.split("/").filter(Boolean)[0];
    if (!segment) return null;
    const handle = decodeURIComponent(segment).replace(/^@/, "");
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) return null;
    const reserved = new Set(["p", "reel", "reels", "tv", "watch", "video", "shorts", "status"]);
    if (reserved.has(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}

export interface ParsedPostRef {
  platform: SocialAssetPlatform;
  canonicalUrl: string;
  postId: string | null;
  kind: "post" | "reel" | "video" | "unknown";
}

/** Parse a public post/reel/video permalink into a stable reference. */
export function parsePostUrl(raw: string): ParsedPostRef | null {
  const normalized = normalizeProfileUrl(raw);
  if (!normalized) return null;
  const platform = platformFromUrl(normalized);
  let kind: ParsedPostRef["kind"] = "unknown";
  let postId: string | null = null;
  try {
    const { pathname } = new URL(normalized);
    const parts = pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) =>
      ["p", "reel", "reels", "tv", "status", "video", "shorts", "watch"].includes(p.toLowerCase()),
    );
    if (idx >= 0) {
      const marker = parts[idx]!.toLowerCase();
      kind =
        marker === "p"
          ? "post"
          : marker === "reel" || marker === "reels"
            ? "reel"
            : marker === "status"
              ? "post"
              : "video";
      postId = parts[idx + 1] ?? null;
    } else if (platform === "youtube") {
      kind = "video";
      postId = new URL(normalized).pathname.replace(/^\//, "") || null;
    }
  } catch {
    return null;
  }
  return { platform, canonicalUrl: normalized, postId, kind };
}

export interface AssetProvenance {
  source_platform: SocialAssetPlatform;
  source_post_url: string | null;
  source_profile_url: string | null;
  source_handle: string | null;
  source_media_url: string | null;
  source_post_id: string | null;
  import_method: ImportMethod;
  ownership_basis: "SELF_DECLARED" | "PLATFORM_AUTHORIZED";
  social_account_id: string | null;
  imported_at: string;
}

export function buildProvenance(input: {
  platform: SocialAssetPlatform;
  importMethod: ImportMethod;
  postUrl?: string | null;
  profileUrl?: string | null;
  handle?: string | null;
  mediaUrl?: string | null;
  postId?: string | null;
  socialAccountId?: string | null;
  now?: Date;
}): AssetProvenance {
  return {
    source_platform: input.platform,
    source_post_url: input.postUrl ?? null,
    source_profile_url: input.profileUrl ?? null,
    source_handle: input.handle ?? null,
    source_media_url: input.mediaUrl ?? null,
    source_post_id: input.postId ?? null,
    import_method: input.importMethod,
    // An authorized platform connection is the only stronger-than-self-declared
    // signal we accept. It is still not legal ownership proof.
    ownership_basis: input.importMethod === "AUTHORIZED_API" ? "PLATFORM_AUTHORIZED" : "SELF_DECLARED",
    social_account_id: input.socialAccountId ?? null,
    imported_at: (input.now ?? new Date()).toISOString(),
  };
}

/** Stable per-post dedupe key so re-importing the same media is a no-op. */
export function postDedupeKey(platform: string, postUrl: string, mediaUrl?: string | null): string {
  return [platform, normalizeProfileUrl(postUrl) ?? postUrl, mediaUrl ?? ""].join("|").toLowerCase();
}
