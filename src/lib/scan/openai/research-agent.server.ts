/**
 * OpenAI Research Agent — coverage-gap detection for the Web Scan pipeline.
 *
 * Output is treated ONLY as a source of additional search queries. Nothing the
 * model writes becomes evidence or a finding.
 */

import { callScanAiJson, isResearchEnabled, type AiCallBudget } from "./client.server";
import type { ResearchAgentOutput } from "./types";

export interface ResearchContext {
  target: string;
  aliases: string[];
  variations: string[];
  profession?: string | null;
  knownWorks?: string[];
  queriesExecuted: string[];
  domainsCovered: string[];
  narrativeClusters: string[];
  evidenceSummaries: Array<{ title: string; url: string; excerpt: string }>;
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "coverage_assessment",
    "missing_narratives",
    "suggested_platform_queries",
    "suggested_local_language_queries",
  ],
  properties: {
    coverage_assessment: { type: "string", enum: ["COMPLETE", "PARTIAL", "SPARSE", "UNKNOWN"] },
    missing_narratives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "reason", "priority", "suggested_queries"],
        properties: {
          topic: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          suggested_queries: { type: "array", items: { type: "string" } },
        },
      },
    },
    suggested_platform_queries: { type: "array", items: { type: "string" } },
    suggested_local_language_queries: { type: "array", items: { type: "string" } },
  },
};

const INSTRUCTIONS = `You are a research planner for a reputation-intelligence scanner.
You do NOT report facts and you do NOT make claims about any person.
Your only job: given what a scan already found, identify which publicly discoverable
reputation-risk NARRATIVES may still be missing (allegations, controversies, criticism,
impersonation, manipulated media, deepfakes, harassment, trolling, reaction content,
copyright or privacy concerns) and propose concrete web search queries that would find them.
Rules:
- Never assert that any narrative is true; only propose search directions.
- Queries must be short, literal search strings including the target name or an alias.
- Prefer queries that target platforms and local-language phrasings not yet covered.
- Return at most 6 missing narratives, each with at most 3 queries.`;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export async function runResearchAgent(
  ctx: ResearchContext,
  budget: AiCallBudget,
): Promise<{ ok: true; data: ResearchAgentOutput } | { ok: false; error: string }> {
  if (!isResearchEnabled()) return { ok: false, error: "disabled" };
  if (!budget.take()) return { ok: false, error: "budget exhausted" };

  const packet = {
    target_canonical_name: ctx.target,
    aliases: ctx.aliases.slice(0, 12),
    name_variations: ctx.variations.slice(0, 12),
    profession: ctx.profession ?? null,
    known_works: (ctx.knownWorks ?? []).slice(0, 10),
    queries_already_executed: ctx.queriesExecuted.slice(0, 60),
    domains_already_covered: ctx.domainsCovered.slice(0, 60),
    narrative_clusters_found: ctx.narrativeClusters.slice(0, 30),
    representative_evidence: ctx.evidenceSummaries.slice(0, 25).map((e) => ({
      title: truncate(e.title, 160),
      url: e.url,
      excerpt: truncate(e.excerpt, 400),
    })),
  };

  const res = await callScanAiJson<ResearchAgentOutput>({
    instructions: INSTRUCTIONS,
    input: JSON.stringify(packet),
    schemaName: "coverage_gap_research",
    schema: SCHEMA,
    effort: "low",
  });

  if (!res.ok) return res;

  const data = res.data;
  return {
    ok: true,
    data: {
      coverage_assessment: data.coverage_assessment ?? "UNKNOWN",
      missing_narratives: Array.isArray(data.missing_narratives)
        ? data.missing_narratives.slice(0, 6)
        : [],
      suggested_platform_queries: Array.isArray(data.suggested_platform_queries)
        ? data.suggested_platform_queries.slice(0, 10)
        : [],
      suggested_local_language_queries: Array.isArray(data.suggested_local_language_queries)
        ? data.suggested_local_language_queries.slice(0, 10)
        : [],
    },
  };
}
