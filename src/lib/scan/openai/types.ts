/**
 * Web Scan — OpenAI Research & Reasoning layer shared types (client-safe).
 *
 * This layer NEVER produces findings on its own. Research output only creates
 * additional search queries; reasoning output only annotates leads that already
 * have a retrieved source.
 */

export type AiLayerStatus =
  | "OK"
  | "SKIPPED"
  | "DISABLED"
  | "OPENAI_RESEARCH_UNAVAILABLE"
  | "OPENAI_REASONING_UNAVAILABLE";

export type CoverageAssessment = "COMPLETE" | "PARTIAL" | "SPARSE" | "UNKNOWN";

export type QueryOrigin = "PIPELINE" | "OPENAI_RESEARCH";

export interface MissingNarrative {
  topic: string;
  reason: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  suggested_queries: string[];
}

export interface ResearchAgentOutput {
  coverage_assessment: CoverageAssessment;
  missing_narratives: MissingNarrative[];
  suggested_platform_queries: string[];
  suggested_local_language_queries: string[];
}

export const AI_CONTENT_TYPES = [
  "FACTUAL_REPORTING",
  "ALLEGATION",
  "OPINION",
  "CRITICISM",
  "USER_GENERATED_ACCUSATION",
  "SATIRE",
  "HARASSMENT",
  "IMPERSONATION",
  "MANIPULATED_MEDIA",
  "DEEPFAKE",
  "COPYRIGHT_CONCERN",
  "PRIVACY_CONCERN",
  "UNKNOWN",
] as const;

export type AiContentType = (typeof AI_CONTENT_TYPES)[number];

export const AI_RECOMMENDED_ACTIONS = [
  "MONITOR",
  "HUMAN_REVIEW",
  "HUMAN_REVIEW_REQUIRED",
  "POTENTIAL_REPUTATION_RISK",
  "POTENTIAL_LEGAL_REVIEW",
  "NO_ACTION",
] as const;

export type AiRecommendedAction = (typeof AI_RECOMMENDED_ACTIONS)[number];

/** SOURCE_VERIFIED = grounded in retrieved page text. MODEL_SUGGESTED = not grounded. */
export type EvidenceBasis = "MODEL_SUGGESTED" | "SOURCE_VERIFIED";

/** Compact packet sent to the reasoning agent — never raw HTML. */
export interface EvidencePacket {
  id: string;
  title: string;
  canonical_url: string;
  platform: string;
  source: string;
  published_date: string | null;
  author: string | null;
  passages: string;
  entity_confidence: number;
  identity_tier: string;
  classifier_output: string;
}

export interface ReasoningVerdict {
  id: string;
  subject_confidence: number;
  evidence_confidence: number;
  narrative: string;
  content_type: AiContentType;
  reputation_risk: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  source_diversity: "HIGH" | "MEDIUM" | "LOW";
  discoverability: "HIGH" | "MEDIUM" | "LOW";
  recurrence_risk: "HIGH" | "MEDIUM" | "LOW";
  recommended_action: AiRecommendedAction;
  reasoning_summary: string;
  /** Filled in by our code, not the model. */
  evidence_basis?: EvidenceBasis;
  evidence_urls?: string[];
}

export interface ScanAiDiagnostics {
  research_status: AiLayerStatus;
  coverage_assessment: CoverageAssessment;
  missing_narratives: number;
  expansion_queries_generated: number;
  expansion_queries_executed: number;
  expansion_new_urls: number;
  reasoning_status: AiLayerStatus;
  evidence_analyzed: number;
  high_risk: number;
  medium_risk: number;
  needs_review: number;
  ai_failures: number;
  cache_hits: number;
  model: string;
  notes: string[];
}

export function emptyScanAiDiagnostics(): ScanAiDiagnostics {
  return {
    research_status: "SKIPPED",
    coverage_assessment: "UNKNOWN",
    missing_narratives: 0,
    expansion_queries_generated: 0,
    expansion_queries_executed: 0,
    expansion_new_urls: 0,
    reasoning_status: "SKIPPED",
    evidence_analyzed: 0,
    high_risk: 0,
    medium_risk: 0,
    needs_review: 0,
    ai_failures: 0,
    cache_hits: 0,
    model: "",
    notes: [],
  };
}
