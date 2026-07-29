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
  return { targets, queries: dedupe(queries).slice(0, max) };
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.replace(/^www\./, "").toLowerCase();
  const blockedDomains = [
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "tiktok.com",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "threads.net",
    "reddit.com",
    "redd.it",
    "medium.com",
  ];

  return blockedDomains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}
