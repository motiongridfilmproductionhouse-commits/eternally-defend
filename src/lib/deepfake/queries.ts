// Query builder for Deepfake & Synthetic Media Intelligence agent.
// Generates a bounded set of high-signal search variations per target.

export const DEEPFAKE_MODIFIERS: string[] = [
  "deepfake",
  "ai deepfake",
  "fake video",
  "fake images",
  "fake nude",
  "ai nude",
  "ai nudes",
  "ai porn",
  "synthetic media",
  "face swap",
  "faceswap",
  "fake leak",
  "leaked",
  "leaked photos",
  "leaked video",
  "explicit",
  "nsfw",
  "revenge porn",
  "manipulated image",
  "fake onlyfans",
  "telegram leak",
  "discord leak",
  "mega folder",
  "imageboard",
];

// Sites that host most of the abuse / discussion (Reddit intentionally excluded).
export const SITE_FILTERS: string[] = [
  "site:x.com",
  "site:twitter.com",
  "site:imgur.com",
  "site:medium.com",
  "site:github.com",
  "site:youtube.com",
  "site:vimeo.com",
  "site:facebook.com",
  "site:instagram.com",
  "site:tiktok.com",
  "site:threads.net",
];

export interface QueryPlan {
  targets: string[]; // quoted name / alias variants
  queries: string[];
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const t = v.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Build a bounded query plan. We cap total queries to keep search cost sane.
 * maxQueries defaults to 24 — enough coverage without runaway Firecrawl usage.
 */
export function buildQueryPlan(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  maxQueries?: number;
}): QueryPlan {
  const targets = dedupe([input.name, ...(input.aliases ?? []), ...(input.handles ?? [])])
    .map((t) =>
      t
        .replace(/^actress\s+/i, "")
        .replace(/^actor\s+/i, "")
        .replace(/^celebrity\s+/i, "")
        .replace(/^creator\s+/i, "")
        .trim(),
    )
    .filter(Boolean);

  const searchableTargets = targets;
  const max = input.maxQueries ?? 24;

  const queries: string[] = [];
  // 1. per-target modifier queries (core signal)
  for (const q of searchableTargets) {
    for (const m of DEEPFAKE_MODIFIERS) {
      queries.push(`${q} ${m}`);
    }
  }
  // 2. site-scoped queries against the primary name
  const primary = searchableTargets[0];
  if (primary) {
    for (const s of SITE_FILTERS) {
      queries.push(`${s} ${primary} deepfake OR fake OR leaked OR nude`);
    }
  }

  return { targets, queries: dedupe(queries).slice(0, max) };
}

const BLOCKED_HOSTS = new Set<string>([
  "reddit.com", "www.reddit.com", "old.reddit.com", "np.reddit.com", "redd.it",
]);

export function isBlockedHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.endsWith(".reddit.com")) return true;
  return false;
}
