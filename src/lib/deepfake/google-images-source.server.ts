/**
 * Shared helpers for Google Images discovery metadata.
 * Never treat Google SERP / viewer URLs as hosting or evidence pages.
 *
 * Google Images is only the discovery entry point.
 * The original source webpage (imgrefurl) is the evidence target.
 */

import { isSafePublicHttpUrl } from "./url-safety.server";

const GOOGLE_HOST_RE =
  /(?:^|\.)(?:google|gstatic|googleusercontent|ggpht|googleapis)\./i;

export function isGoogleOwnedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  return GOOGLE_HOST_RE.test(host) || host === "google.com";
}

/**
 * Google Images viewer / SERP pages — including tbnid, udm=2 rimg, #sv= fragments.
 * These must never be stored as evidence or source webpage URLs.
 */
export function isGoogleImagesViewerUrl(
  value: string | null | undefined,
): boolean {
  if (!value || typeof value !== "string") return false;
  try {
    const parsed = new URL(value.trim());
    if (!isGoogleOwnedHost(parsed.hostname)) return false;

    const path = parsed.pathname.toLowerCase();
    if (/\/imgres\b/i.test(path)) return true;
    if (/\/search\b/i.test(path)) return true;
    if (parsed.searchParams.has("imgurl") || parsed.searchParams.has("tbnid")) {
      return true;
    }
    // Hash fragments used by the Images viewer (e.g. #sv=CAMS…)
    if (/^#sv=/i.test(parsed.hash) || /[#&]sv=/i.test(parsed.hash)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True when a URL can be used as a candidate source webpage (not Google SERP/viewer). */
export function isUsableSourceWebsiteUrl(
  value: string | null | undefined,
): value is string {
  if (!isSafePublicHttpUrl(value)) return false;
  if (isGoogleImagesViewerUrl(value)) return false;
  try {
    const parsed = new URL(value.trim());
    if (isGoogleOwnedHost(parsed.hostname)) return false;
    if (/\/imgres\b/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export type GoogleImagesHitMeta = {
  image_url: string | null;
  source_website_url: string | null;
  title: string | null;
  hostname: string | null;
  thumbnail_url: string | null;
  surrounding_text: string | null;
  tbnid: string | null;
};

/**
 * Prefer imgrefurl / referring URL for the hosting page; keep imgurl for the image.
 * Never returns a Google viewer/SERP URL.
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
        parsed.searchParams.get("ru") ||
        parsed.searchParams.get("imgrefurl".toUpperCase());
      if (isUsableSourceWebsiteUrl(fromParams)) return fromParams.trim();

      // Some viewer hrefs encode nested query strings.
      for (const key of ["imgrefurl", "imgref", "ru", "q"]) {
        const raw = parsed.searchParams.get(key);
        if (!raw) continue;
        try {
          const nested = decodeURIComponent(raw);
          if (isUsableSourceWebsiteUrl(nested)) return nested.trim();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Never fall back to imgurl — that is the image bytes URL, not the page.
  // Never fall back to Google viewer hrefs.
  return null;
}

/** Extract original image URLs ("ou") and referring page URLs ("ru") from Google HTML/JSON blobs. */
export function extractGoogleImagesMetaFromHtml(html: string): Array<{
  image_url: string;
  source_website_url: string | null;
  title: string | null;
  thumbnail_url: string | null;
  surrounding_text: string | null;
}> {
  const out: Array<{
    image_url: string;
    source_website_url: string | null;
    title: string | null;
    thumbnail_url: string | null;
    surrounding_text: string | null;
  }> = [];
  const byImage = new Map<
    string,
    {
      source: string | null;
      title: string | null;
      thumb: string | null;
      text: string | null;
    }
  >();

  const upsert = (
    rawImage: string,
    rawSource: string | null,
    extras?: { title?: string | null; thumb?: string | null; text?: string | null },
  ) => {
    const imageUrl = decodeGoogleJsonUrl(rawImage);
    if (!isSafePublicHttpUrl(imageUrl)) return;
    if (isGoogleImagesViewerUrl(imageUrl)) return;
    const source = rawSource ? decodeGoogleJsonUrl(rawSource) : null;
    const usable = isUsableSourceWebsiteUrl(source) ? source : null;
    const existing = byImage.get(imageUrl);
    if (!existing) {
      byImage.set(imageUrl, {
        source: usable,
        title: extras?.title ?? null,
        thumb: extras?.thumb ?? null,
        text: extras?.text ?? null,
      });
      return;
    }
    if (!existing.source && usable) existing.source = usable;
    if (!existing.title && extras?.title) existing.title = extras.title;
    if (!existing.thumb && extras?.thumb) existing.thumb = extras.thumb;
    if (!existing.text && extras?.text) existing.text = extras.text;
  };

  // Explicit ou→ru and ru→ou pairs
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

  // imgurl / imgrefurl in anchor hrefs embedded in HTML
  const hrefRe =
    /href=["']([^"']*(?:imgurl|imgrefurl|imgres)[^"']*)["']/gi;
  while ((match = hrefRe.exec(html))) {
    const href = decodeGoogleJsonUrl(match[1] ?? "");
    try {
      const parsed = new URL(href, "https://www.google.com");
      const imgurl =
        parsed.searchParams.get("imgurl") || parsed.searchParams.get("url");
      const imgrefurl =
        parsed.searchParams.get("imgrefurl") ||
        parsed.searchParams.get("imgref") ||
        parsed.searchParams.get("ru");
      if (imgurl) upsert(imgurl, imgrefurl);
    } catch {
      /* ignore */
    }
  }

  // Standalone "ou" values
  const ouRe = /"ou"\s*:\s*"(https?:[^"\\]+)"/gi;
  while ((match = ouRe.exec(html))) {
    upsert(match[1] ?? "", null);
  }

  // Titles near ou blocks
  const ouTitleRe =
    /"ou"\s*:\s*"(https?:[^"\\]+)"[^{}\[\]]*?"pt"\s*:\s*"([^"\\]+)"/gi;
  while ((match = ouTitleRe.exec(html))) {
    upsert(match[1] ?? "", null, { title: decodeGoogleJsonUrl(match[2] ?? "") });
  }

  for (const [image_url, meta] of byImage) {
    out.push({
      image_url,
      source_website_url: meta.source,
      title: meta.title,
      thumbnail_url: meta.thumb,
      surrounding_text: meta.text,
    });
  }
  return out;
}

export function hostnameOfSourceUrl(
  value: string | null | undefined,
): string | null {
  if (!isUsableSourceWebsiteUrl(value)) return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Same-domain gallery / media / album page heuristic. */
export function isSameDomainGalleryLink(
  link: string,
  basePageUrl: string,
): boolean {
  if (!isUsableSourceWebsiteUrl(link)) return false;
  try {
    const base = new URL(basePageUrl);
    const next = new URL(link);
    if (base.hostname.replace(/^www\./i, "") !== next.hostname.replace(/^www\./i, "")) {
      return false;
    }
    const haystack = `${next.pathname} ${next.search}`.toLowerCase();
    return /gallery|photo|image|album|pics|media|mirror|pictures|photos|slideshow|carousel|next|prev/i.test(
      haystack,
    );
  } catch {
    return false;
  }
}

function decodeGoogleJsonUrl(raw: string): string {
  return raw
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');
}
