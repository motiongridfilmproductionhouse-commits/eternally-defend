/**
 * AI Expansion Query Planner — bounded two-pass coverage-gap research.
 *
 * PASS 1: up to 30 structured queries spread across discovery dimensions.
 * PASS 2: up to 10 gap queries, given a compact coverage summary of pass 1.
 * There is no pass 3 and no recursive loop.
 *
 * The model NEVER produces evidence, findings or claims — only search strings.
 */

import { callScanAiJson, isResearchEnabled, type AiCallBudget } from "./client.server";
import {
  AI_PASS1_QUERY_CEILING,
  AI_PASS2_QUERY_CEILING,
  AI_QUERY_DIMENSIONS,
  AI_SOURCE_TARGETS,
  type AiQuerySpec,
} from "./query-plan";

const QUERY_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "query",
    "priority",
    "narrative",
    "language",
    "source_target",
    "reason",
    "expected_information_gain",
  ],
  properties: {
    query: { type: "string" },
    priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    narrative: { type: "string" },
    language: { type: "string" },
    source_target: { type: "string", enum: [...AI_SOURCE_TARGETS] },
    reason: { type: "string" },
    expected_information_gain: { type: "number" },
  },
};

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["coverage_assessment", "narratives_missing", "queries"],
  properties: {
    coverage_assessment: {
      type: "string",
      enum: ["COMPLETE", "PARTIAL", "SPARSE", "UNKNOWN"],
    },
    narratives_missing: { type: "array", items: { type: "string" } },
    queries: { type: "array", items: QUERY_ITEM_SCHEMA },
  },
};

export interface QueryPlanOutput {
  coverage_assessment: "COMPLETE" | "PARTIAL" | "SPARSE" | "UNKNOWN";
  narratives_missing: string[];
  queries: AiQuerySpec[];
}

const BASE_RULES = `You are a research query planner for a reputation-intelligence scanner.
You do NOT report facts and you do NOT make claims about any person or company.
You never assert that an allegation, controversy or threat is real. You only propose
literal web search strings that a crawler could run to FIND publicly available sources.
Rules:
- Every query must be a short literal search string containing the target name, an alias,
  a transliteration, or a closely associated entity.
- expected_information_gain is 0-100: your estimate of the chance this query surfaces
  sources the scan has not already seen.
- Never repeat or trivially reword a query that was already executed.
- Do not output commentary, only the JSON object.`;

const PASS1_INSTRUCTIONS = `${BASE_RULES}
PASS 1: propose up to ${AI_PASS1_QUERY_CEILING} DISTINCT high-value queries that deliberately
spread across these discovery dimensions (do not produce 30 variations of one idea):
${AI_QUERY_DIMENSIONS.map((d) => `- ${d}`).join("\n")}
Cover multiple languages and multiple source_target values where plausible.`;

const PASS2_INSTRUCTIONS = `${BASE_RULES}
PASS 2 (final pass — there is no further pass): you are given a compact coverage summary of
what pass 1 already discovered. Propose at most ${AI_PASS2_QUERY_CEILING} queries that target
the REMAINING gaps only: narratives, languages, source types, platforms or associated entities
that are still unrepresented. Skip anything already covered.`;

export interface PlannerContext {
  target: string;
  aliases: string[];
  variations: string[];
  profession?: string | null;
  knownWorks?: string[];
  queriesExecuted: string[];
  domainsCovered: string[];
  sourceTypes?: string[];
  languages?: string[];
  narrativeClusters: string[];
  evidenceSummaries: Array<{ title: string; url: string; excerpt: string }>;
  knownUrlCount?: number;
  evidenceGaps?: string[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function packet(ctx: PlannerContext) {
  return {
    target_canonical_name: ctx.target,
    aliases: ctx.aliases.slice(0, 12),
    name_variations: ctx.variations.slice(0, 12),
    profession: ctx.profession ?? null,
    known_works: (ctx.knownWorks ?? []).slice(0, 10),
    queries_already_executed: ctx.queriesExecuted.slice(0, 120),
    domains_already_covered: ctx.domainsCovered.slice(0, 80),
    source_types_covered: (ctx.sourceTypes ?? []).slice(0, 20),
    languages_represented: (ctx.languages ?? []).slice(0, 12),
    narrative_clusters_found: ctx.narrativeClusters.slice(0, 40),
    urls_already_known: ctx.knownUrlCount ?? 0,
    obvious_evidence_gaps: (ctx.evidenceGaps ?? []).slice(0, 20),
    representative_evidence: ctx.evidenceSummaries.slice(0, 20).map((e) => ({
      title: truncate(e.title, 140),
      url: e.url,
      excerpt: truncate(e.excerpt, 320),
    })),
  };
}

async function runPlan(
  pass: 1 | 2,
  ctx: PlannerContext,
  budget: AiCallBudget,
): Promise<{ ok: true; data: QueryPlanOutput } | { ok: false; error: string }> {
  if (!isResearchEnabled()) return { ok: false, error: "disabled" };
  if (!budget.take()) return { ok: false, error: "budget exhausted" };

  const res = await callScanAiJson<QueryPlanOutput>({
    instructions: pass === 1 ? PASS1_INSTRUCTIONS : PASS2_INSTRUCTIONS,
    input: JSON.stringify(packet(ctx)),
    schemaName: pass === 1 ? "expansion_query_plan_pass1" : "expansion_query_plan_pass2",
    schema: PLAN_SCHEMA,
    effort: "low",
  });
  if (!res.ok) return res;

  const ceiling = pass === 1 ? AI_PASS1_QUERY_CEILING : AI_PASS2_QUERY_CEILING;
  const queries = Array.isArray(res.data.queries) ? res.data.queries : [];
  return {
    ok: true,
    data: {
      coverage_assessment: res.data.coverage_assessment ?? "UNKNOWN",
      narratives_missing: Array.isArray(res.data.narratives_missing)
        ? res.data.narratives_missing.slice(0, 20)
        : [],
      queries: queries.slice(0, ceiling).map((q) => ({ ...q, pass })),
    },
  };
}

export function planPass1(ctx: PlannerContext, budget: AiCallBudget) {
  return runPlan(1, ctx, budget);
}

export function planPass2(ctx: PlannerContext, budget: AiCallBudget) {
  return runPlan(2, ctx, budget);
}
