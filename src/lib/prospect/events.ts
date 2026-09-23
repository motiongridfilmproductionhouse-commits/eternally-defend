/**
 * Pre-Enrollment Intelligence — live scan event model (pure, client-safe).
 *
 * Every event is a row in prospect_scan_events (append-only). The event type is
 * stored in `detail.type`; the human message is what staff read in the live
 * stream. The UI derives source states, stage progress and counters from
 * stored rows — events only tell it *what just happened* and when to refresh.
 */

export const SCAN_EVENT_TYPES = [
  "SCAN_STARTED",
  "PROVIDER_STARTED",
  "PROVIDER_RESULT",
  "CANDIDATE_DISCOVERED",
  "IDENTITY_RESOLUTION_STARTED",
  "IDENTITY_MATCHED",
  "IDENTITY_REVIEW_REQUIRED",
  "IDENTITY_UNRELATED",
  "EVIDENCE_CAPTURED",
  "ITEM_CLASSIFIED",
  "PROVIDER_COMPLETED",
  "PROVIDER_FAILED",
  "SOURCE_UNAVAILABLE",
  "POLICY_EXCLUDED",
  "STAGE_STARTED",
  "STAGE_COMPLETED",
  "ANALYSIS_UNAVAILABLE",
  "CATEGORY_UPDATED",
  "COVERAGE_COMPUTED",
  "SCORES_COMPUTED",
  "SCAN_COMPLETED",
  "SCAN_FAILED",
] as const;

export type ScanEventType = (typeof SCAN_EVENT_TYPES)[number];

export type ScanEventLevel = "info" | "success" | "warning" | "error" | "debug";

export interface ScanEventInput {
  type: ScanEventType;
  message: string;
  level?: ScanEventLevel;
  stage?: string | null;
  familyKey?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Provider status vocabulary shown in the source rail — derived from the real
 * provider failure kinds in src/lib/scan/discovery/types.ts.
 */
export type ProviderStatus =
  | "CONNECTING"
  | "SEARCHING"
  | "COMPLETE"
  | "NO_RESULTS"
  | "CREDIT_EXHAUSTED"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "POLICY_DISABLED";

export function providerStatusForFailure(kind: string | null | undefined): ProviderStatus {
  switch (kind) {
    case "credits_exhausted":
      return "CREDIT_EXHAUSTED";
    case "rate_limited":
      return "RATE_LIMITED";
    case "auth_failed":
      return "AUTH_FAILED";
    case "timeout":
      return "TIMEOUT";
    default:
      return "PROVIDER_ERROR";
  }
}

/** Analysis stages, in the order the staff rail shows them. */
export const ANALYSIS_STAGES = [
  { key: "ai_manipulation", rail: "01", label: "Deepfake", long: "Deepfake & AI Manipulation" },
  {
    key: "harmful_content",
    rail: "02",
    label: "Reputation",
    long: "Harmful & Reputation-Risk Content",
  },
  { key: "impersonation", rail: "03", label: "Impersonation", long: "Identity Impersonation" },
  { key: "privacy_exposure", rail: "04", label: "Privacy", long: "Privacy Exposure" },
  { key: "search_reputation", rail: "05", label: "Search Reputation", long: "Search Reputation" },
  { key: "propagation", rail: "06", label: "Propagation", long: "Content Propagation" },
] as const;

export type AnalysisStageKey = (typeof ANALYSIS_STAGES)[number]["key"];

/** Discovery methods stored on every discovery. */
export type DiscoveryMethod =
  | "WEB_SEARCH"
  | "IMAGE_SEARCH"
  | "PLATFORM_API"
  | "REFERENCE_API"
  | "FACT_CHECK_API";

export function discoveryMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "WEB_SEARCH":
      return "Web search";
    case "IMAGE_SEARCH":
      return "Image search";
    case "PLATFORM_API":
      return "Platform API";
    case "REFERENCE_API":
      return "Reference API";
    case "FACT_CHECK_API":
      return "Fact-check API";
    default:
      return method ?? "Unknown";
  }
}
