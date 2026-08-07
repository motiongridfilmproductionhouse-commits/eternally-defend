/**
 * Durable, sanitized failure diagnostics for Copyright Intelligence scans.
 *
 * Every non-completed scan must record which stage failed, a stable failure
 * code, stage-level counters, and provider failure categories — never provider
 * names, API keys, URLs with credentials, or stack traces.
 */

import { sanitizeProviderFailureDetail } from "./provider-failures";

export const COPYRIGHT_SCAN_STAGES = [
  "scan_created",
  "reference_read",
  "reference_analysis",
  "historical_seed",
  "query_generation",
  "provider_discovery",
  "candidate_evaluation",
  "page_crawl",
  "classification",
  "persistence",
  "monitor_pass",
  "completion",
] as const;

export type CopyrightScanStage = (typeof COPYRIGHT_SCAN_STAGES)[number];

export type CopyrightFailureCode =
  | "reference_unreadable"
  | "reference_analysis_failed"
  | "query_generation_empty"
  | "discovery_providers_unavailable"
  | "crawl_failed"
  | "classification_failed"
  | "persistence_failed"
  | "internal_error";

/** Client-safe copy. Never states that the internet was searched successfully. */
export const USER_SAFE_SCAN_FAILURE_MESSAGE =
  "Scan could not complete because discovery services were unavailable. No conclusion has been made about whether unauthorized copies exist.";

export interface CopyrightScanFailureDiagnostics {
  failed_stage: CopyrightScanStage;
  failure_code: CopyrightFailureCode;
  failure_message: string;
  provider_failures: Array<{ category: string; count: number }>;
  queries_generated: number;
  providers_attempted: number;
  provider_requests_succeeded: number;
  candidate_pages_discovered: number;
  pages_crawled: number;
  worker_started_at: string;
  worker_last_heartbeat_at: string;
  terminal_status: "failed" | "partial";
}

export interface DiscoveryDiagnosticsLike {
  providerSummaries?: Record<
    string,
    { configured?: boolean; attempts?: number; successes?: number; failureCategory?: string }
  >;
  totalQueries?: number;
  successfulQueries?: number;
  failedQueries?: number;
  fallbackUsed?: boolean;
}

/**
 * Aggregate provider failure categories without exposing provider identity.
 */
export function providerFailuresFromDiscovery(
  diagnostics: DiscoveryDiagnosticsLike | null | undefined,
): Array<{ category: string; count: number }> {
  const summaries = diagnostics?.providerSummaries;
  if (!summaries) return [];
  const counts = new Map<string, number>();
  for (const summary of Object.values(summaries)) {
    const category = summary?.failureCategory;
    if (!category) continue;
    const failed = Math.max(1, (summary.attempts ?? 0) - (summary.successes ?? 0));
    counts.set(category, (counts.get(category) ?? 0) + failed);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Mutable stage tracker threaded through the scan executor so a failure at any
 * point records truthful stage-level accounting.
 */
export class CopyrightScanTracker {
  stage: CopyrightScanStage = "scan_created";
  failureCode: CopyrightFailureCode = "internal_error";
  queriesGenerated = 0;
  providersAttempted = 0;
  providerRequestsSucceeded = 0;
  candidatePagesDiscovered = 0;
  pagesCrawled = 0;
  providerFailures: Array<{ category: string; count: number }> = [];
  readonly workerStartedAt = new Date().toISOString();
  private heartbeatAt = new Date().toISOString();

  enter(stage: CopyrightScanStage, failureCode: CopyrightFailureCode = "internal_error"): void {
    this.stage = stage;
    this.failureCode = failureCode;
    this.heartbeat();
  }

  heartbeat(): void {
    this.heartbeatAt = new Date().toISOString();
  }

  absorbDiscovery(diagnostics: DiscoveryDiagnosticsLike | null | undefined): void {
    if (!diagnostics) return;
    this.queriesGenerated = Math.max(this.queriesGenerated, diagnostics.totalQueries ?? 0);
    this.providersAttempted = Math.max(
      this.providersAttempted,
      Object.values(diagnostics.providerSummaries ?? {}).filter((s) => (s?.attempts ?? 0) > 0)
        .length,
    );
    this.providerRequestsSucceeded = Math.max(
      this.providerRequestsSucceeded,
      diagnostics.successfulQueries ?? 0,
    );
    this.providerFailures = providerFailuresFromDiscovery(diagnostics);
    this.heartbeat();
  }

  /** Build the durable, sanitized diagnostics block written to scan.stats. */
  build(
    error: unknown,
    terminalStatus: "failed" | "partial" = "failed",
  ): CopyrightScanFailureDiagnostics {
    return {
      failed_stage: this.stage,
      failure_code: this.failureCode,
      failure_message: sanitizeProviderFailureDetail(error, 400),
      provider_failures: this.providerFailures,
      queries_generated: this.queriesGenerated,
      providers_attempted: this.providersAttempted,
      provider_requests_succeeded: this.providerRequestsSucceeded,
      candidate_pages_discovered: this.candidatePagesDiscovered,
      pages_crawled: this.pagesCrawled,
      worker_started_at: this.workerStartedAt,
      worker_last_heartbeat_at: this.heartbeatAt,
      terminal_status: terminalStatus,
    };
  }
}

/**
 * A scan is `partial` when discovery genuinely produced coverage but a later
 * required stage failed. Otherwise it is `failed`.
 */
export function resolveTerminalStatus(tracker: CopyrightScanTracker): "failed" | "partial" {
  const discoveryWorked =
    tracker.providerRequestsSucceeded > 0 && tracker.candidatePagesDiscovered > 0;
  return discoveryWorked && tracker.stage !== "provider_discovery" ? "partial" : "failed";
}

export function failureDiagnosticsFromStats(
  stats: Record<string, unknown> | null | undefined,
): CopyrightScanFailureDiagnostics | null {
  const raw = stats?.failure_diagnostics;
  if (!raw || typeof raw !== "object") return null;
  return raw as CopyrightScanFailureDiagnostics;
}
