/**
 * Reverse-image discovery for the Copyright Intelligence engine.
 * Uses SerpApi Google Lens on a signed URL of the uploaded reference frame.
 */

export interface LensCandidate {
  url: string;
  title: string | null;
  source: string | null;
  thumbnail: string | null;
  imageUrl: string | null;
  /** true when Lens reported it inside the "exact matches" bucket */
  exact: boolean;
  frameIndex: number;
}

interface LensRaw {
  link?: string;
  source?: string;
  title?: string;
  thumbnail?: string;
  image?: string;
  image_url?: string;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function canonicalUrl(url: string): string {
  try {
    const p = new URL(url);
    p.hash = "";
    for (const k of [...p.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(k)) p.searchParams.delete(k);
    }
    p.hostname = p.hostname.toLowerCase().replace(/^www\./, "");
    p.pathname = p.pathname.replace(/\/$/, "") || "/";
    return p.toString();
  } catch {
    return url.trim();
  }
}

/** Run Lens against one signed frame URL. */
export async function lensLookup(
  imageUrl: string,
  query: string,
  frameIndex: number,
): Promise<{ candidates: LensCandidate[]; searchId: string | null }> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("Reverse image search is not configured (SERPAPI_API_KEY missing).");

  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
    no_cache: "true",
  });
  if (query.trim()) params.set("q", query.trim());

  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const payload = (await res.json()) as Record<string, any>;
  if (!res.ok || payload?.error) {
    throw new Error(payload?.error || `Reverse image search failed (${res.status}).`);
  }

  const buckets: Array<[LensRaw[], boolean]> = [
    [(payload.exact_matches ?? []) as LensRaw[], true],
    [(payload.image_sources ?? []) as LensRaw[], true],
    [(payload.visual_matches ?? []) as LensRaw[], false],
  ];

  const seen = new Set<string>();
  const candidates: LensCandidate[] = [];
  for (const [list, exact] of buckets) {
    for (const raw of list) {
      const link = raw.link ?? raw.image_url ?? raw.image;
      if (!link) continue;
      const key = canonicalUrl(link);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        url: key,
        title: raw.title ?? null,
        source: raw.source ?? hostOf(key),
        thumbnail: raw.thumbnail ?? raw.image ?? raw.image_url ?? null,
        imageUrl: raw.image_url ?? raw.image ?? null,
        exact,
        frameIndex,
      });
    }
  }

  return {
    candidates: candidates.slice(0, 60),
    searchId: payload.search_metadata?.id ?? null,
  };
}
