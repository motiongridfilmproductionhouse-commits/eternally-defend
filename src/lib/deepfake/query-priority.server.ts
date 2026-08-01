/**
 * Prioritize deepfake discovery queries so exact-name / deepfake /
 * face-swap / fake-nude work runs before lower-priority expansion.
 */

export function scoreDeepfakeQueryPriority(query: string): number {
  const q = query.toLowerCase();
  let score = 0;

  if (/\bdeepfake\b/.test(q)) score += 75;
  if (/\b(?:face\s*swap|faceswap)\b/.test(q)) score += 65;
  if (/\b(?:fake\s*nude|ai\s*nude)\b/.test(q)) score += 55;
  if (/\b(?:deepfake\s*porn|ai\s*porn)\b/.test(q)) score += 30;
  if (/\b(?:morphed|synthetic\s*media)\b/.test(q)) score += 20;
  if (/\b(?:leaked|fake\s*leak)\b/.test(q)) score += 15;
  if (/\b(?:nude|nsfw|explicit|porn)\b/.test(q)) score += 10;
  if (/\b(?:gallery|images|video|mirror|download)\b/.test(q)) score += 5;

  // Prefer shorter exact-name high-signal queries over long domain-expansion ones.
  const lengthPenalty = Math.min(20, Math.floor(q.length / 20));
  score -= lengthPenalty;

  // Domain-expansion / site exclusions are lower priority once core terms ran.
  if ((q.match(/-site:/g) ?? []).length >= 8) score -= 8;

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
  const initial = Math.max(
    1,
    Math.min(input.initialCount ?? 15, prioritized.length),
  );
  // Full prioritized list is retained; callers slice by next_query_index.
  // initialCount only documents the preferred first wave size.
  void initial;
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
