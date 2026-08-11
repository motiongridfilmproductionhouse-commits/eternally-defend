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

/** Per-pass expansion accounting (pass 1 and pass 2 reported separately). */
export interface AiExpansionPassStats {
  pass: 1 | 2;
  status: "OK" | "SKIPPED" | "FAILED";
  skip_reason?: string;
  queries_generated: number;
  queries_deduplicated: number;
  queries_executed: number;
  queries_failed: number;
  urls_discovered: number;
  new_unique_urls: number;
  new_domains: number;
  new_narratives: number;
  latency_ms: number;
  queries: Array<{
    query: string;
    priority: string;
    narrative: string;
    language: string;
    source_target: string;
    expected_information_gain: number;
    new_urls: number;
  }>;
}

export interface ScanAiDiagnostics {
  research_status: AiLayerStatus;
  coverage_assessment: CoverageAssessment;
  missing_narratives: number;
  expansion_queries_generated: number;
  expansion_queries_executed: number;
  expansion_new_urls: number;
  /** Query-dedup accounting for the expansion pass. */
  ai_queries_suggested: number;
  ai_queries_duplicate: number;
  ai_queries_executed: number;
  ai_queries_failed: number;
  /** Normalized base-discovery queries handed to the Research Agent. */
  base_queries_passed: number;
  /* ── Incremental-recall metrics (bounded two-pass expansion) ── */
  ai_queries_generated: number;
  ai_queries_deduplicated: number;
  ai_urls_discovered: number;
  ai_new_unique_urls: number;
  ai_new_domains: number;
  ai_new_narratives: number;
  ai_new_verified_findings: number;
  ai_new_needs_review: number;
  ai_incremental_recall_percent: number;
  cost_per_new_unique_url: number;
  ai_passes: AiExpansionPassStats[];
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
    ai_queries_suggested: 0,
    ai_queries_duplicate: 0,
    ai_queries_executed: 0,
    ai_queries_failed: 0,
    base_queries_passed: 0,
    ai_queries_generated: 0,
    ai_queries_deduplicated: 0,
    ai_urls_discovered: 0,
    ai_new_unique_urls: 0,
    ai_new_domains: 0,
    ai_new_narratives: 0,
    ai_new_verified_findings: 0,
    ai_new_needs_review: 0,
    ai_incremental_recall_percent: 0,
    cost_per_new_unique_url: 0,
    ai_passes: [],
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

