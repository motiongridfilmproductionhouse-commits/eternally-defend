/**
 * Shared, browser-safe types for unified scan reports. Reporting is purely
 * additive and read-only with respect to enforcement: nothing in this
 * feature creates cases, jobs, notices, or contacts any platform.
 */

export type ReportEligibility = "REMOVAL_ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_REMOVAL_ELIGIBLE";

/** Lifecycle of automatic enforcement for one removal-eligible discovery. */
export type EnforcementState =
  | "NOT_APPLICABLE"
  | "BLOCKED"
  | "QUEUED"
  | "UNDER_REVIEW"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "COMPLETED"
  | "FAILED";

export interface DiscoveryEnforcement {
  state: EnforcementState;
  /** Plain-language explanation of the current enforcement state. */
  detail: string;
  caseId: string | null;
  caseStatus: string | null;
  basis: string | null;
  route: string | null;
  jobStatus: string | null;
  queuedAt: string | null;
  updatedAt: string | null;
  /** True while enforcement runs in test mode / live sending is disabled. */
  testMode: boolean;
}

/** One discovery, normalized across every module's own finding schema. */
export interface ReportDiscovery {
  id: string;
  module: string;
  title: string;
  sourceUrl: string | null;
  discoveredAt: string | null;
  /** 0-100 where the module provides one; null when the module has no score. */
  confidence: number | null;
  confidenceLabel: string;
  evidence: string[];
  status: string;
  /** Module-native verification: did this clear the module's own verified bar? */
  moduleVerified: boolean;
  /** Module-native risk classification, used to derive the enforcement basis. */
  riskType?: string | null;
  /** Platform/host label as recorded by the module. */
  platform?: string | null;
}

export interface ClassifiedDiscovery extends ReportDiscovery {
  eligibility: ReportEligibility;
  eligibilityReasons: string[];
  enforcement?: DiscoveryEnforcement;
}


export interface ScanReportPayload {
  moduleKey: string;
  moduleLabel: string;
  scanId: string;
  runStatus: string;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  discoveries: ClassifiedDiscovery[];
  counts: {
    discovered: number;
    eligible: number;
    review: number;
    notEligible: number;
  };
}

export interface ScanReportRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  pdf_url: string | null;
  findings_count: number;
  created_at: string;
  module_key: string | null;
  scan_id: string | null;
  run_started_at: string | null;
  run_completed_at: string | null;
  discovered_count: number | null;
  eligible_count: number | null;
  review_count: number | null;
  not_eligible_count: number | null;
  payload: ScanReportPayload | null;
}

export const ELIGIBILITY_LABEL: Record<ReportEligibility, string> = {
  REMOVAL_ELIGIBLE: "Removal eligible",
  REQUIRES_REVIEW: "Requires review",
  NOT_REMOVAL_ELIGIBLE: "Not removal eligible",
};
