/**
 * Structured AI expansion query planning (client-safe).
 *
 * The AI layer may only PROPOSE search queries. Nothing here creates evidence,
 * findings, allegations, or narratives — queries are dispatched through the
 * existing DiscoveryRouter and every result still passes Eterna's verification
 * pipeline unchanged.
 *
 * Hard ceiling: pass 1 = 30 queries, pass 2 = 10 queries, total 40. No third
 * pass and no recursive/autonomous loop exists anywhere in this module.
 */

export const AI_PASS1_QUERY_CEILING = 30;
export const AI_PASS2_QUERY_CEILING = 10;
export const AI_TOTAL_QUERY_CEILING = AI_PASS1_QUERY_CEILING + AI_PASS2_QUERY_CEILING;

/** Marginal-gain floor: below this many genuinely new URLs, stop expanding. */
export const AI_MIN_NEW_URLS_FOR_NEXT_PASS = 5;

export const AI_SOURCE_TARGETS = ["web", "news", "youtube", "forum", "social"] as const;
export type AiSourceTarget = (typeof AI_SOURCE_TARGETS)[number];

export type AiQueryPriority = "HIGH" | "MEDIUM" | "LOW";

export interface AiQuerySpec {
  query: string;
  priority: AiQueryPriority;
  narrative: string;
  language: string;
  source_target: AiSourceTarget;
  reason: string;
  expected_information_gain: number;
  /** Filled by our code, never the model. */
  pass?: 1 | 2;
}

/** Discovery dimensions the planner is asked to spread queries across. */
export const AI_QUERY_DIMENSIONS = [
  "canonical name",
  "aliases / spelling variants",
  "Malayalam name",
  "Malayalam transliterations",
  "English transliterations",
  "controversy",
  "allegations",
  "criticism / backlash",
  "legal / dispute",
  "producer / industry disputes",
  "interviews / statements",
  "trolling / memes",
  "impersonation / fake accounts",
  "deepfake / manipulated media",
  "misinformation",
  "old stories resurfacing",
  "film / project-specific narratives",
  "associated people or entities",
  "Reddit / forum discussions",
  "news coverage",
  "social-platform-specific discovery",
] as const;

export function normalizeQuery(q: string): string {
  return q
    .trim()
    .replace(/\s+/g, " ")
    .replace(/["“”']/g, "")
    .replace(/[?!.]+$/g, "")
    .toLowerCase();
}

const PRIORITY_WEIGHT: Record<AiQueryPriority, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function score(spec: AiQuerySpec): number {
  const gain = Number.isFinite(spec.expected_information_gain)
    ? Math.max(0, Math.min(100, spec.expected_information_gain))
    : 0;
  return gain + PRIORITY_WEIGHT[spec.priority] * 10;
}

export interface DedupeResult {
  accepted: AiQuerySpec[];
  duplicates: number;
  rejected: number;
}

/**
 * Aggressive dedupe against base queries, previously executed queries and every
 * earlier AI pass, then highest-information-gain-first ordering.
 */
export function dedupeAndPrioritize(
  proposed: AiQuerySpec[],
  alreadySeenNormalized: Set<string>,
  limit: number,
): DedupeResult {
  const accepted: AiQuerySpec[] = [];
  let duplicates = 0;
  let rejected = 0;

  const sorted = [...proposed].sort((a, b) => score(b) - score(a));
  for (const spec of sorted) {
    const raw = typeof spec.query === "string" ? spec.query.trim().replace(/\s+/g, " ") : "";
    if (raw.length < 4 || raw.length > 180) {
      rejected++;
      continue;
    }
    const key = normalizeQuery(raw);
    if (!key || alreadySeenNormalized.has(key)) {
      duplicates++;
      continue;
    }
    alreadySeenNormalized.add(key);
    accepted.push({ ...spec, query: raw });
    if (accepted.length >= limit) break;
  }

  return { accepted, duplicates, rejected };
}

/** Coverage is "strong" enough to skip pass 2. */
export function hasStrongCoverage(input: {
  coverageAssessment: string;
  uniqueDomains: number;
  narratives: number;
  newUrlsFromPass1: number;
}): boolean {
  if (input.coverageAssessment === "COMPLETE") return true;
  return (
    input.uniqueDomains >= 25 &&
    input.narratives >= 8 &&
    input.newUrlsFromPass1 >= 25 &&
    input.coverageAssessment !== "SPARSE"
  );
}

/** Marginal information gain too poor to justify another pass. */
export function marginalGainExhausted(input: {
  newUniqueUrls: number;
  newDomains: number;
  newNarratives: number;
}): boolean {
  if (input.newUniqueUrls < AI_MIN_NEW_URLS_FOR_NEXT_PASS) return true;
  return input.newDomains === 0 && input.newNarratives === 0;
}
