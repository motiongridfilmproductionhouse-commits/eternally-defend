/**
 * Client-safe helpers for rendering preview images and titles reliably.
 * No server-only imports here — used in both browser and server code.
 */

const BAD_TITLE_RX = /^(undefined|null|none|nan)$/i;

export function hostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function faviconUrl(url?: string | null, size = 64): string | null {
  const host = hostFromUrl(url);
  if (!host) return null;
  // Google's public S2 favicon service — reliable, always CORS-safe.
  return `https://www.google.com/s2/favicons?sz=${size}&domain=${host}`;
}

/**
 * Turn a URL/slug into a readable title.
 * "renu-sudhi-saying-about-her-real-name" -> "Renu Sudhi Saying About Her Real Name"
 */
export function readableFromSlug(input?: string | null): string {
  if (!input) return "";
  const raw = input.split("?")[0].split("#")[0];
  const seg = raw.split("/").filter(Boolean).pop() ?? raw;
  const words = seg
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return words
    .split(" ")
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Fallback chain for visible titles.
 * Never returns "undefined", "null", empty strings, or raw slug prefixes.
 */
export function cleanTitle(...candidates: (string | null | undefined)[]): string {
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = String(c).trim();
    if (!trimmed) continue;
    if (BAD_TITLE_RX.test(trimmed)) continue;
    // Reject raw slugs like "undefined | renu-sudhi-saying-about-her-real-name"
    if (/^undefined\s*[|\-·]/i.test(trimmed)) {
      // Try to recover the slug portion
      const tail = trimmed.split(/[|\-·]/).slice(1).join(" ").trim();
      const recovered = readableFromSlug(tail);
      if (recovered) return recovered;
      continue;
    }
    // Looks like a bare slug? Humanize it.
    if (/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/.test(trimmed)) {
      const readable = readableFromSlug(trimmed);
      if (readable) return readable;
    }
    return trimmed;
  }
  return "Untitled source";
}

/**
 * Validate a preview image URL client-side (cheap).
 * Rejects data URLs, http:// (when https available), and tiny known trackers.
 */
export function isValidImageUrl(url?: string | null): boolean {
  if (!url) return false;
  const u = url.trim();
  if (!u) return false;
  if (u.startsWith("data:")) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  // 1x1 pixel trackers or empty gifs
  if (/\/(pixel|beacon|blank|spacer|1x1|transparent)\.(gif|png)/i.test(u)) return false;
  return true;
}

/**
 * Route an external image through our secure proxy to bypass CORS / hotlink /
 * referer blocks. YouTube thumbnails already work directly — skip proxy for them.
 */
export function viaProxy(url?: string | null): string | null {
  if (!isValidImageUrl(url)) return null;
  const raw = url!.trim();
  if (/(?:ytimg\.com|googleusercontent\.com|ggpht\.com)/i.test(raw)) return raw;
  return `/api/media/preview?u=${encodeURIComponent(raw)}`;
}

/**
 * Extract a YouTube video ID from any watch/shorts/embed/youtu.be URL.
 * Channel URLs return null (no per-video thumbnail).
 */
export function youtubeIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split(/[/?#]/)[0] || null;
    if (!/youtube\.com$/.test(host)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

/**
 * Public YouTube CDN thumbnail — no API key required, always CORS-safe.
 * hqdefault exists for every public/unlisted video; maxresdefault is best-effort.
 */
export function youtubeThumbFromUrl(url?: string | null, quality: "maxres" | "hq" = "hq"): string | null {
  const id = youtubeIdFromUrl(url);
  if (!id) return null;
  return `https://i.ytimg.com/vi/${id}/${quality === "maxres" ? "maxresdefault" : "hqdefault"}.jpg`;
}
