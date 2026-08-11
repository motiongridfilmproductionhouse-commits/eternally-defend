/**
 * Web Scan — pipeline funnel counters (client-safe).
 *
 * Discovered → Extracted → Verified → Needs Review → Excluded.
 * Every stage is counted, and nothing is silently dropped: exclusions must
 * carry a reason code.
 */

import type { ScanAiDiagnostics } from "./openai/types";
import type { DiscoveryRouterReport } from "./discovery/types";
import type { ExtractionStats } from "./page-extract-types";

export interface ScanPipelineFunnel {
  queries_planned: number;
  queries_executed: number;
  queries_failed: number;
  discovered: number;
  unique: number;
  duplicates_removed: number;
  extracted: number;
  extraction_attempted: number;
  extraction_failed: number;
  verified: number;
  probable: number;
  needs_review: number;
  excluded: number;
  excluded_reasons: Record<string, number>;
  persisted: number;
  /** OpenAI Research & Reasoning layer counters (optional, additive). */
  ai?: ScanAiDiagnostics;
  /** Per-provider discovery health — failure is never reported as "0 results". */
  discovery?: DiscoveryRouterReport;
  /** Crawl4AI vs plain-fetch extraction telemetry. */
  extraction?: ExtractionStats;
}


export function emptyScanFunnel(): ScanPipelineFunnel {
  return {
    queries_planned: 0,
    queries_executed: 0,
    queries_failed: 0,
    discovered: 0,
    unique: 0,
    duplicates_removed: 0,
    extracted: 0,
    extraction_attempted: 0,
    extraction_failed: 0,
    verified: 0,
    probable: 0,
    needs_review: 0,
    excluded: 0,
    excluded_reasons: {},
    persisted: 0,
  };
}

export function countExclusion(funnel: ScanPipelineFunnel, reason: string): void {
  funnel.excluded++;
  funnel.excluded_reasons[reason] = (funnel.excluded_reasons[reason] ?? 0) + 1;
}

export const SCAN_FUNNEL_STAGES: Array<{ key: keyof ScanPipelineFunnel; label: string }> = [
  { key: "discovered", label: "Discovered" },
  { key: "extracted", label: "Extracted" },
  { key: "verified", label: "Verified" },
  { key: "needs_review", label: "Needs Review" },
  { key: "excluded", label: "Excluded" },
];
