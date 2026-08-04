/**
 * Shared helpers for Google Images discovery metadata.
 * Never treat Google SERP URLs as hosting/source pages.
 */

import { isSafePublicHttpUrl } from "./url-safety.server";

const GOOGLE_HOST_RE =
  /(?:^|\.)(?:google|gstatic|googleusercontent|ggpht|googleapis)\./i;

export function isGoogleOwnedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  return GOOGLE_HOST_RE.test(host) || host === "google.com";
}

/** True when a URL can be used as a candidate source webpage (not Google SERP). */
export function isUsableSourceWebsiteUrl(
  value: string | null | undefined,
): value is string {
  if (!isSafePublicHttpUrl(value)) return false;
  try {
    const parsed = new URL(value.trim());
    if (isGoogleOwnedHost(parsed.hostname)) return false;
    // Google Images result wrappers
    if (/\/imgres\b/i.test(parsed.pathname)) return false;
    if (parsed.searchParams.has("imgurl") && /google\./i.test(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer imgrefurl / referring URL for the hosting page; keep imgurl for the image.
 */
export function resolveGoogleImagesSourceWebsite(input: {
  href?: string | null;
  imgurl?: string | null;
  imgrefurl?: string | null;
  ru?: string | null;
  explicitSource?: string | null;
}): string | null {
  const candidates = [
    input.explicitSource,
    input.imgrefurl,
    input.ru,
  ];

  for (const candidate of candidates) {
    if (isUsableSourceWebsiteUrl(candidate)) return candidate.trim();
  }

  if (input.href && isSafePublicHttpUrl(input.href)) {
    try {
      const parsed = new URL(input.href);
      const fromParams =
        parsed.searchParams.get("imgrefurl") ||
        parsed.searchParams.get("imgref") ||
        parsed.searchParams.get("ru");
      if (isUsableSourceWebsiteUrl(fromParams)) return fromParams.trim();
    } catch {
      /* ignore */
    }
  }

  // Never fall back to imgurl — that is the image bytes URL, not the page.
  return null;
}

/** Extract original image URLs ("ou") and referring page URLs ("ru") from Google HTML/JSON blobs. */
export function extractGoogleImagesMetaFromHtml(html: string): Array<{
  image_url: string;
  source_website_url: string | null;
}> {
  const out: Array<{ image_url: string; source_website_url: string | null }> = [];
  const byImage = new Map<string, string | null>();

  const upsert = (rawImage: string, rawSource: string | null) => {
    const imageUrl = decodeGoogleJsonUrl(rawImage);
    if (!isSafePublicHttpUrl(imageUrl)) return;
    const source = rawSource ? decodeGoogleJsonUrl(rawSource) : null;
    const usable = isUsableSourceWebsiteUrl(source) ? source : null;
    const existing = byImage.get(imageUrl);
    if (existing === undefined || (!existing && usable)) {
      byImage.set(imageUrl, usable);
    }
  };

  // Explicit ou→ru and ru→ou pairs (optional groups skip "ru" too eagerly).
  const ouThenRu =
    /"ou"\s*:\s*"(https?:[^"\\]+)"[^{}\[\]]*?"ru"\s*:\s*"(https?:[^"\\]+)"/gi;
  const ruThenOu =
    /"ru"\s*:\s*"(https?:[^"\\]+)"[^{}\[\]]*?"ou"\s*:\s*"(https?:[^"\\]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = ouThenRu.exec(html))) {
    upsert(match[1] ?? "", match[2] ?? null);
  }
  while ((match = ruThenOu.exec(html))) {
    upsert(match[2] ?? "", match[1] ?? null);
  }

  // Standalone "ou" values (keep if not already paired)
  const ouRe = /"ou"\s*:\s*"(https?:[^"\\]+)"/gi;
  while ((match = ouRe.exec(html))) {
    upsert(match[1] ?? "", null);
  }

  for (const [image_url, source_website_url] of byImage) {
    out.push({ image_url, source_website_url });
  }
  return out;
}

function decodeGoogleJsonUrl(raw: string): string {
  return raw
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}
