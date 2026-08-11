/**
 * OpenAI Reasoning Agent — reasons over RETRIEVED evidence only.
 *
 * Grounding rules enforced here:
 *  - a verdict is kept only when its evidence packet had retrieved page text
 *    (otherwise it is marked MODEL_SUGGESTED and cannot promote a lead);
 *  - a verdict whose id matches no evidence packet is discarded;
 *  - the model is forbidden from declaring content defamatory or illegal.
 */

import { callScanAiJson, isReasoningEnabled, type AiCallBudget } from "./client.server";
import { evidenceHash } from "./evidence-hash";
import { AI_CONTENT_TYPES, type EvidencePacket, type ReasoningVerdict } from "./types";

const BATCH_SIZE = 6;
const MAX_BATCHES = 8;

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "subject_confidence",
          "evidence_confidence",
          "narrative",
          "content_type",
          "reputation_risk",
          "source_diversity",
          "discoverability",
          "recurrence_risk",
          "recommended_action",
          "reasoning_summary",
        ],
        properties: {
          id: { type: "string" },
          subject_confidence: { type: "integer" },
          evidence_confidence: { type: "integer" },
          narrative: { type: "string" },
          content_type: { type: "string", enum: [...AI_CONTENT_TYPES] },
          reputation_risk: { type: "string", enum: ["HIGH", "MEDIUM", "LOW", "NONE"] },
          source_diversity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          discoverability: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          recurrence_risk: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          recommended_action: {
            type: "string",
            enum: [
              "MONITOR",
              "HUMAN_REVIEW",
              "HUMAN_REVIEW_REQUIRED",
              "POTENTIAL_REPUTATION_RISK",
              "POTENTIAL_LEGAL_REVIEW",
              "NO_ACTION",
            ],
          },
          reasoning_summary: { type: "string" },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You analyse retrieved web evidence for a reputation-intelligence platform.
Use ONLY the supplied evidence packets. Never use outside memory, and never invent facts.
For every packet return exactly one verdict object with the same id.
Hard rules:
- Never state or imply that content is defamatory, illegal, or criminal. When evidence is
  suggestive but not conclusive use recommended_action POTENTIAL_REPUTATION_RISK,
  POTENTIAL_LEGAL_REVIEW, or HUMAN_REVIEW_REQUIRED.
- subject_confidence = how certain the evidence is about THIS target (0-100).
- evidence_confidence = how well the retrieved text supports the narrative (0-100).
- If the passages are thin or absent, lower confidence and recommend HUMAN_REVIEW_REQUIRED.
- reasoning_summary: max 2 sentences, referencing only the supplied text.`;

export interface ReasoningRunResult {
  verdicts: Map<string, ReasoningVerdict>;
  analyzed: number;
  failures: number;
  cacheHits: number;
  error?: string;
}

type CacheGet = (hash: string) => Promise<ReasoningVerdict | null>;
type CacheSet = (hash: string, verdict: ReasoningVerdict) => Promise<void>;

export async function runReasoningAgent(
  packets: EvidencePacket[],
  budget: AiCallBudget,
  cache?: { get: CacheGet; set: CacheSet },
): Promise<ReasoningRunResult> {
  const out: ReasoningRunResult = {
    verdicts: new Map(),
    analyzed: 0,
    failures: 0,
    cacheHits: 0,
  };
  if (!isReasoningEnabled()) {
    out.error = "disabled";
    return out;
  }
  if (!packets.length) return out;

  const hashes = new Map<string, string>();
  const pending: EvidencePacket[] = [];

  for (const packet of packets) {
    let hash = "";
    try {
      hash = await evidenceHash(packet);
      hashes.set(packet.id, hash);
    } catch {
      /* hashing failed — analyse without cache */
    }
    if (hash && cache) {
      try {
        const cached = await cache.get(hash);
        if (cached) {
          out.verdicts.set(packet.id, { ...cached, id: packet.id });
          out.cacheHits++;
          continue;
        }
      } catch {
        /* cache miss on error */
      }
    }
    pending.push(packet);
  }

  const batches: EvidencePacket[][] = [];
  for (let i = 0; i < pending.length && batches.length < MAX_BATCHES; i += BATCH_SIZE) {
    batches.push(pending.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    if (!budget.take()) {
      out.error = out.error ?? "budget exhausted";
      break;
    }
    const res = await callScanAiJson<{ verdicts: ReasoningVerdict[] }>({
      instructions: INSTRUCTIONS,
      input: JSON.stringify({ evidence: batch }),
      schemaName: "evidence_reasoning",
      schema: SCHEMA,
      effort: "low",
    });

    if (!res.ok) {
      out.failures += batch.length;
      out.error = res.error;
      continue;
    }

    const byId = new Map(batch.map((p) => [p.id, p]));
    for (const verdict of res.data.verdicts ?? []) {
      const packet = byId.get(verdict.id);
      if (!packet) {
        out.failures++;
        continue; // ungrounded verdict — discard
      }
      const grounded = packet.passages.trim().length >= 80;
      const final: ReasoningVerdict = {
        ...verdict,
        subject_confidence: clamp(verdict.subject_confidence),
        evidence_confidence: clamp(verdict.evidence_confidence),
        evidence_basis: grounded ? "SOURCE_VERIFIED" : "MODEL_SUGGESTED",
        evidence_urls: [packet.canonical_url],
        recommended_action: grounded ? verdict.recommended_action : "HUMAN_REVIEW_REQUIRED",
      };
      out.verdicts.set(packet.id, final);
      out.analyzed++;
      const hash = hashes.get(packet.id);
      if (hash && cache) {
        try {
          await cache.set(hash, final);
        } catch {
          /* caching is best-effort */
        }
      }
    }
    for (const p of batch) {
      if (!out.verdicts.has(p.id)) out.failures++;
    }
  }

  return out;
}

function clamp(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
