/**
 * Prioritize deepfake discovery queries so known high-risk domain queries
 * and exact-target threat-intent queries run before open-web expansion.
 */

import { SEED_HIGH_RISK_DOMAINS } from "./high-risk-registry.server";

export function scoreDeepfakeQueryPriority(query: string): number {
  const q = query.toLowerCase();
  let score = 0;

  // Tier 1 High-Risk Domain bonus
  const isHighRiskDomainQuery = SEED_HIGH_RISK_DOMAINS.some((domain) =>
    q.includes(`site:${domain}`),
  ) || /\bsite:(?:desifakes|imgfy)\b/.test(q);

  if (isHighRiskDomainQuery) {
    score += 120;
  } else if (/\bsite:/.test(q)) {
    if (/\bsite:(?:reddit\.com|t\.me|x\.com)\b/.test(q)) {
      score += 40;
    } else if (/\bsite:archive\.org\b/.test(q)) {
      score -= 100; // Deprioritize generic archive queries
    } else {
      score += 20;
    }
  }

  // Tier 2 Threat terms
  if (/\bdeepfake\b/.test(q)) score += 75;
  if (/\b(?:face\s*swap|faceswap)\b/.test(q)) score += 65;
  if (/\b(?:fake\s*nude|ai\s*nude|nude\s*fake)\b/.test(q)) score += 60;
  if (/\b(?:ai\s*fake|synthetic\s*media)\b/.test(q)) score += 50;
  if (/\b(?:fake\s*video|fake\s*images)\b/.test(q)) score += 40;
  if (/\b(?:explicit\s*ai|leaked\s*ai)\b/.test(q)) score += 30;

  return score;
}

export function prioritizeDeepfakeQueries(queries: string[]): string[] {
  return [...queries]
    .map((query, index) => ({
      query,
      index,
      score: scoreDeepfakeQueryPriority(query),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.query);
}

/**
 * Build an adaptive execution schedule: start with a high-priority head,
 * then append lower-priority expansion only as callers pull more batches.
 */
export function buildAdaptiveQuerySchedule(input: {
  queries: string[];
  initialCount?: number;
}): string[] {
  const prioritized = prioritizeDeepfakeQueries(input.queries);
  return prioritized;
}

export function nextQueryBatch(
  queries: string[],
  nextIndex: number,
  batchSize: number,
): { batch: string[]; nextIndex: number } {
  const start = Math.max(0, nextIndex);
  const end = Math.min(queries.length, start + Math.max(1, batchSize));
  return {
    batch: queries.slice(start, end),
    nextIndex: end,
  };
}
