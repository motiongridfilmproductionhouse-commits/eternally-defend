/**
 * Shared URL helpers + candidate shape for the Copyright Intelligence engine.
 * Discovery is Firecrawl + AI Vision only (no SerpApi / Google Lens).
 */

export interface DiscoveryCandidate {
  url: string;
  title: string | null;
  source: string | null;
  thumbnail: string | null;
  imageUrl: string | null;
  /** true when the discovery layer treated this as a high-signal lead */
  exact: boolean;
  frameIndex: number;
  /** query that surfaced this candidate, kept for evidence */
  query?: string | null;
  /** coarse piracy taxonomy (streaming_site, torrent, cam_theatre_leak, ...) */
  category?: string | null;
  /** detected content language for this candidate */
  language?: string | null;
  /** the keyword/query variation that matched */
  keywordMatch?: string | null;
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
