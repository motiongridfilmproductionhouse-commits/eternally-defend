/**
 * Copyright scan lifecycle helpers: stage timestamps, terminal status rules,
 * and executor-start watchdog.
 *
 * A scan must never become `completed` when discovery never started.
 */

import type { ProviderFailureCategory } from "./provider-failures";

export const COPYRIGHT_SCAN_STAGES = [
  "scan_created",
  "executor_started",
  "queries_generated",
  "discovery_started",
  "first_provider_response",
  "first_page_crawled",
  "classification_started",
  "finished_at",
] as const;

export type CopyrightScanStage = (typeof COPYRIGHT_SCAN_STAGES)[number];

/** How long a scan may remain running without executor_started_at. */
export const EXECUTOR_START_WATCHDOG_MS = 45_000;

export type CopyrightTerminalStatus = "completed" | "failed" | "partial";

export interface DiscoveryOutcomeInput {
  executorStarted: boolean;
  queriesGenerated: number;
  queriesExecuted: number;
  /** Provider HTTP requests that returned a usable payload (not merely attempted). */
  providerSuccesses: number;
  providerFailures: number;
  providerCandidates: number;
  /** Accepted known URLs that received a crawl attempt. */
  knownUrlsAttempted?: number;
  knownUrlsAccepted?: number;
  pagesCrawled: number;
  clientVisibleFindings: number;
  abortedByDeadline?: boolean;
  firecrawlCircuitOpened?: boolean;
  serpapiSuccesses?: number;
  serpapiCandidates?: number;
  /** Explicit fatal reason when discovery could not start. */
  fatalReason?: string | null;
}

export interface DiscoveryOutcomeDecision {
  status: CopyrightTerminalStatus;
  reason: string | null;
}

/**
 * Decide terminal status from discovery/crawl outcomes.
 *
 * - Zero providers executed / zero queries attempted → failed
 * - Providers ran successfully with genuinely zero candidates → completed
 * - Some pages processed before timeout → partial
 * - Executor never started → failed
 */
export function decideCopyrightTerminalStatus(
  input: DiscoveryOutcomeInput,
): DiscoveryOutcomeDecision {
  if (!input.executorStarted) {
    return {
      status: "failed",
      reason:
        input.fatalReason ||
        "Copyright scan executor never started (executor_not_started).",
    };
  }

  if (input.fatalReason) {
    return { status: "failed", reason: input.fatalReason };
  }

  if (input.queriesGenerated <= 0 && input.queriesExecuted <= 0) {
    return {
      status: "failed",
      reason:
        "No discovery queries were generated or attempted — scan cannot complete successfully.",
    };
  }

  const knownAttempted = input.knownUrlsAttempted ?? 0;
  const knownAccepted = input.knownUrlsAccepted ?? 0;
  const serpapiSuccesses = input.serpapiSuccesses ?? 0;
  const serpapiCandidates = input.serpapiCandidates ?? 0;

  if (input.queriesExecuted <= 0 && knownAccepted <= 0 && serpapiCandidates <= 0) {
    return {
      status: "failed",
      reason:
        "Zero discovery queries were executed — provider search never ran.",
    };
  }

  const anyDiscoverySuccess =
    input.providerSuccesses > 0 || serpapiSuccesses > 0 || serpapiCandidates > 0;
  const anyCandidates = input.providerCandidates > 0 || serpapiCandidates > 0;

  if (
    input.providerSuccesses <= 0 &&
    input.providerFailures > 0 &&
    knownAttempted <= 0 &&
    serpapiSuccesses <= 0 &&
    serpapiCandidates <= 0
  ) {
    return {
      status: "failed",
      reason:
        "All discovery provider requests failed — no successful search responses. See provider_failures_by_category.",
    };
  }

  if (!anyDiscoverySuccess && !anyCandidates && knownAttempted <= 0 && knownAccepted <= 0) {
    return {
      status: "failed",
      reason:
        "Discovery never received a successful provider response — not a legitimate zero-result scan.",
    };
  }

  if (
    input.firecrawlCircuitOpened &&
    (knownAttempted > 0 || anyCandidates || input.pagesCrawled > 0 || input.clientVisibleFindings > 0)
  ) {
    return {
      status: "partial",
      reason:
        input.abortedByDeadline
          ? "Scan deadline reached after partial progress — saved crawled pages and findings."
          : "Firecrawl circuit opened after consecutive provider failures — partial discovery saved; see firecrawl_operator_action.",
    };
  }

  if (input.abortedByDeadline && (input.pagesCrawled > 0 || input.clientVisibleFindings > 0)) {
    return {
      status: "partial",
      reason:
        "Scan deadline reached after partial progress — saved crawled pages and findings.",
    };
  }

  // Providers succeeded (even with zero candidates) → completed is valid.
  return { status: "completed", reason: null };
}

export function markStage(
  stages: Record<string, string | null | undefined>,
  stage: CopyrightScanStage,
  at: Date = new Date(),
): Record<string, string> {
  const next = { ...stages } as Record<string, string>;
  if (!next[stage]) next[stage] = at.toISOString();
  next.last_progress_at = at.toISOString();
  return next;
}

export function isExecutorWatchdogExpired(opts: {
  status: string;
  createdAt: string | null | undefined;
  executorStartedAt: string | null | undefined;
  now?: number;
  watchdogMs?: number;
}): boolean {
  if (opts.status !== "running" && opts.status !== "pending") return false;
  if (opts.executorStartedAt) return false;
  if (!opts.createdAt) return false;
  const created = Date.parse(opts.createdAt);
  if (!Number.isFinite(created)) return false;
  const now = opts.now ?? Date.now();
  return now - created >= (opts.watchdogMs ?? EXECUTOR_START_WATCHDOG_MS);
}

export function watchdogFailureStats(existing?: Record<string, unknown> | null): Record<string, unknown> {
  const providerFailures = {
    ...((existing?.provider_failures_by_category as Record<string, number> | undefined) ?? {}),
    executor_not_started:
      Number(
        (existing?.provider_failures_by_category as Record<string, number> | undefined)
          ?.executor_not_started ?? 0,
      ) + 1,
  };
  return {
    ...(existing ?? {}),
    provider_failures_by_category: providerFailures,
    executor_started_at: null,
    finished_at: new Date().toISOString(),
    last_progress_at: new Date().toISOString(),
    failure_category: "executor_not_started" satisfies ProviderFailureCategory,
    discovery_never_started: true,
  };
}

/** Immediate start response must not imply completion. */
export function isImmediateStartResponse(res: {
  scanId?: string;
  started?: boolean;
  status?: string;
  stats?: { matches?: number; candidates?: number } | null;
}): boolean {
  return Boolean(
    res.started === true &&
      res.scanId &&
      (res.status === "running" || res.status === "pending") &&
      res.stats == null,
  );
}
