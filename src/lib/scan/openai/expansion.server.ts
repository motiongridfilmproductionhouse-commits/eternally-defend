/**
 * Research Expansion Pass — executes OpenAI-suggested queries through the
 * EXISTING discovery providers. Deduplicated, budgeted, concurrency-limited,
 * single depth (no recursion possible).
 */

import type { ResearchAgentOutput, QueryOrigin } from "./types";

export interface ExpansionHit {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  author?: string;
  date?: string;
  publishedDate?: string;
  queryUsed?: string;
  queryOrigin?: QueryOrigin;
  [key: string]: unknown;
}

export type ExpansionSearcher = (query: string, limit: number) => Promise<ExpansionHit[]>;

function maxQueries(): number {
  const raw = Number(process.env["SCAN_AI_MAX_EXPANSION_QUERIES"]);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30) : 12;
}

function normalize(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Priority-sorted, deduplicated query list derived from the research output. */
export function planExpansionQueries(
  research: ResearchAgentOutput,
  alreadyExecuted: string[],
): string[] {
  const seen = new Set(alreadyExecuted.map(normalize));
  const out: string[] = [];
  const push = (q: unknown) => {
    if (typeof q !== "string") return;
    const clean = q.trim().replace(/\s+/g, " ");
    if (clean.length < 4 || clean.length > 180) return;
    const key = normalize(clean);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  for (const priority of ["HIGH", "MEDIUM", "LOW"] as const) {
    for (const n of research.missing_narratives) {
      if (n.priority !== priority) continue;
      for (const q of n.suggested_queries ?? []) push(q);
    }
  }
  for (const q of research.suggested_platform_queries ?? []) push(q);
  for (const q of research.suggested_local_language_queries ?? []) push(q);

  return out.slice(0, maxQueries());
}

export interface ExpansionResult {
  queriesGenerated: number;
  queriesExecuted: number;
  queriesFailed: number;
  hits: ExpansionHit[];
}

/**
 * Runs the expansion queries with bounded concurrency via the caller-supplied
 * searcher (the pipeline's own provider), tagging every hit as OPENAI_RESEARCH.
 */
export async function runExpansionPass(
  queries: string[],
  searcher: ExpansionSearcher,
  opts: { concurrency?: number; limitPerQuery?: number; knownUrls?: Set<string> } = {},
): Promise<ExpansionResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 6));
  const limit = Math.max(1, Math.min(opts.limitPerQuery ?? 5, 10));
  const known = opts.knownUrls ?? new Set<string>();
  const hits: ExpansionHit[] = [];
  let executed = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queries.length) {
      const q = queries[cursor++];
      try {
        const res = await searcher(q, limit);
        executed++;
        for (const hit of res) {
          if (!hit.url || known.has(hit.url)) continue;
          known.add(hit.url);
          hit.queryUsed = q;
          hit.queryOrigin = "OPENAI_RESEARCH";
          hits.push(hit);
        }
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queries.length) }, worker),
  );

  return { queriesGenerated: queries.length, queriesExecuted: executed, queriesFailed: failed, hits };
}
