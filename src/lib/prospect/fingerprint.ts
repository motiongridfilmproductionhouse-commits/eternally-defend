/**
 * Pre-Enrollment Intelligence — canonicalisation and dedupe fingerprints.
 *
 * Four providers returning the same page must count once. The canonical URL
 * plus a content fingerprint form the dedupe key (matching the UNIQUE
 * constraint on prospect_discoveries); every provider observation is still
 * stored separately for audit.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|igshid|mc_|ref|ref_src|si|feature|spm|yclid|_ga)/i;

export function canonicalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim().toLowerCase();
  }

  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  const keep: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.test(key)) keep.push([key, value]);
  });
  keep.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of keep) url.searchParams.append(key, value);

  // YouTube: collapse every watch form to the canonical watch URL.
  if (url.hostname === "youtu.be") {
    const id = url.pathname.replace(/^\//, "");
    if (id) return `https://youtube.com/watch?v=${id}`;
  }
  if (url.hostname.endsWith("youtube.com")) {
    const id = url.searchParams.get("v");
    if (id) return `https://youtube.com/watch?v=${id}`;
    const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts) return `https://youtube.com/watch?v=${shorts[1]}`;
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString().replace(/\/$/, "");
}

/** Stable 64-bit-ish hex hash (FNV-1a variant) — no crypto dependency. */
export function stableHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = (h1 ^ c) * 0x01000193;
    h2 = (h2 + c * (i + 1)) ^ (h2 << 5);
    h1 >>>= 0;
    h2 >>>= 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 16);
}

function normalizeForFingerprint(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[^a-z0-9\u0D00-\u0D7F ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Content fingerprint: derived from the retrieved title plus the head of the
 * extracted text. Empty string when neither is available — the canonical URL
 * then carries the dedupe on its own.
 */
export function contentFingerprint(input: {
  title?: string | null;
  text?: string | null;
  mediaHash?: string | null;
}): string {
  if (input.mediaHash) return `media:${input.mediaHash}`;
  const title = normalizeForFingerprint(String(input.title ?? ""));
  const text = normalizeForFingerprint(String(input.text ?? "")).slice(0, 600);
  if (!title && !text) return "";
  return `txt:${stableHash(`${title}|${text}`)}`;
}

export interface DedupeKey {
  canonicalUrl: string;
  fingerprint: string;
}

export function dedupeKey(input: {
  url: string;
  title?: string | null;
  text?: string | null;
  mediaHash?: string | null;
}): DedupeKey {
  return {
    canonicalUrl: canonicalizeUrl(input.url),
    fingerprint: contentFingerprint(input),
  };
}

/**
 * Group raw provider hits into one entry per underlying page.
 *
 * Grouping is by canonical URL ONLY. Providers describe the same page with
 * different titles and snippets (Google's title is not Brave's title), so a
 * snippet-derived fingerprint must never split one page into two items. The
 * content fingerprint is computed later from the retrieved page itself and is
 * used to collapse *different* URLs that carry identical content.
 */
export function groupObservations<
  T extends { url: string; title?: string | null; text?: string | null },
>(hits: T[]): Array<{ key: DedupeKey; primary: T; observations: T[] }> {
  const groups = new Map<string, { key: DedupeKey; primary: T; observations: T[] }>();
  for (const hit of hits) {
    if (!hit.url) continue;
    const canonicalUrl = canonicalizeUrl(hit.url);
    const existing = groups.get(canonicalUrl);
    if (existing) {
      existing.observations.push(hit);
    } else {
      groups.set(canonicalUrl, { key: dedupeKey(hit), primary: hit, observations: [hit] });
    }
  }
  return Array.from(groups.values());
}

/**
 * Primary-total identity of a stored discovery: identical retrieved content at
 * two URLs counts once; otherwise the canonical URL is the item.
 */
export function contentItemKey(row: {
  canonical_url: string;
  content_fingerprint?: string | null;
}): string {
  return row.content_fingerprint ? row.content_fingerprint : `url:${row.canonical_url}`;
}
