/**
 * Relevance gate for Copyright Intelligence results.
 *
 * Two categories of noise must never be presented as unauthorized
 * distribution of a protected work:
 *
 * 1. Promotional / fragment content — trailers, teasers, songs, reviews,
 *    interviews, reaction videos, scene clips, shorts. These are not full-work
 *    distribution even when hosted on a video re-upload platform.
 * 2. A *different* work that merely shares a common word with the protected
 *    title (e.g. "Oru Anveshanathinte Thudakkam" for the protected work
 *    "Thudakkam").
 */

/** Words that carry no work-identity signal on piracy pages. */
const FILLER_TOKENS = new Set([
  "movie",
  "movies",
  "film",
  "cinema",
  "full",
  "watch",
  "online",
  "free",
  "download",
  "hd",
  "hq",
  "sd",
  "4k",
  "1080p",
  "720p",
  "480p",
  "webrip",
  "web",
  "dl",
  "hdrip",
  "dvdrip",
  "bluray",
  "cam",
  "print",
  "quality",
  "streaming",
  "stream",
  "new",
  "latest",
  "official",
  "video",
  "subtitle",
  "subtitles",
  "malayalam",
  "tamil",
  "telugu",
  "hindi",
  "kannada",
  "english",
  "dubbed",
  "dual",
  "audio",
  "the",
  "a",
  "an",
  "of",
  "and",
  "or",
  "in",
  "to",
  "part",
  "with",
  "for",
]);

/** Promotional / fragment markers matched against page title and URL path. */
const PROMOTIONAL_PATTERNS: RegExp[] = [
  /\btrailers?\b/,
  /\bteasers?\b/,
  /\bpromos?\b/,
  /\bfirst\s*look\b/,
  /\bmotion\s*poster\b/,
  /\bsneak\s*peek\b/,
  /\blyrical?\b/,
  /\bsongs?\b/,
  /\bjukebox\b/,
  /\bbgm\b/,
  /\bringtone\b/,
  /\bwhatsapp\s*status\b/,
  /\bstatus\s*video\b/,
  /\bshorts?\b/,
  /\breels?\b/,
  /\breview\b/,
  /\breaction\b/,
  /\binterview\b/,
  /\bpress\s*meet\b/,
  /\baudio\s*launch\b/,
  /\bmaking\b/,
  /\bbehind\s+the\s+scenes?\b/,
  /\bdeleted\s+scenes?\b/,
  /\bscene\b/,
  /\bclips?\b/,
  /\bcomedy\b/,
  /\bfight\s*scene\b/,
  /\bbox\s*office\b/,
  /\bcast\s*(?:and|&)\s*crew\b/,
  /\brelease\s*date\b/,
  /\bposter\s*(?:launch|gallery)\b/,
];

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identityTokens(value: string | null | undefined): string[] {
  return normalize(value)
    .split(" ")
    .filter((t) => t.length > 1 && !FILLER_TOKENS.has(t));
}

/** True when the text describes promotional or fragment content, not the work itself. */
export function isPromotionalOrFragment(...values: Array<string | null | undefined>): boolean {
  const haystack = values
    .map((v) => {
      if (!v) return "";
      // For URLs keep the path only; hosts like "trailerhub" must not trip this.
      try {
        const u = new URL(v);
        return `${u.pathname} ${u.search}`;
      } catch {
        return v;
      }
    })
    .map((v) => normalize(v))
    .join(" ");
  if (!haystack) return false;
  return PROMOTIONAL_PATTERNS.some((re) => re.test(haystack));
}

/**
 * True when the page clearly refers to a different work: the protected title
 * contributes only a single identity token, and the page title carries two or
 * more additional identity tokens of its own.
 */
export function looksLikeDifferentWork(
  pageTitle: string | null | undefined,
  protectedTitles: Array<string | null | undefined>,
): boolean {
  const page = identityTokens(pageTitle);
  if (page.length === 0) return false;

  const titleSets = protectedTitles
    .map((t) => identityTokens(t))
    .filter((tokens) => tokens.length > 0);
  if (titleSets.length === 0) return false;

  for (const tokens of titleSets) {
    const present = tokens.filter((t) => page.some((p) => p === t || p.includes(t)));
    if (present.length === 0) continue;
    // Multi-token protected titles fully present -> definitely the same work.
    if (tokens.length >= 2 && present.length >= tokens.length - 0) return false;
    if (tokens.length >= 2 && present.length >= Math.ceil(tokens.length * 0.8)) return false;
    const extra = page.filter((p) => !tokens.some((t) => p === t || p.includes(t)));
    if (extra.length < 2) return false;
  }
  return true;
}

export type LeadRelevance = {
  relevant: boolean;
  reason: "relevant" | "promotional_or_fragment" | "different_work";
};

/** Single gate used by the executor and by the results list. */
export function assessLeadRelevance(input: {
  url?: string | null;
  title?: string | null;
  protectedTitles?: Array<string | null | undefined>;
}): LeadRelevance {
  if (isPromotionalOrFragment(input.title, input.url)) {
    return { relevant: false, reason: "promotional_or_fragment" };
  }
  if (input.title && looksLikeDifferentWork(input.title, input.protectedTitles ?? [])) {
    return { relevant: false, reason: "different_work" };
  }
  return { relevant: true, reason: "relevant" };
}
