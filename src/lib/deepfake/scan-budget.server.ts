/**
 * Soft-deadline time-budget allocation for interleaved deepfake scans.
 *
 * Reserve roughly:
 *   25% discovery
 *   55% verification/classification
 *   20% final persistence and cleanup
 */

import type { ScanRuntime } from "./scan-runtime.server";
import { remainingMs } from "./scan-runtime.server";

export const DISCOVERY_BUDGET_RATIO = 0.25;
export const VERIFICATION_BUDGET_RATIO = 0.55;
export const CLEANUP_BUDGET_RATIO = 0.2;

export const INITIAL_PRIORITY_QUERY_COUNT = 15;
export const QUERY_BATCH_SIZE = 5;
export const VERIFY_CANDIDATE_BATCH_SIZE = 12;
export const MIN_PROVIDER_TIME_MS = 8_000;
export const TARGET_FIRST_VERIFY_MS = 40_000;

export type ScanStage =
  "discovering" | "verifying" | "classifying" | "saving" | "checkpoint" | "done";

export type ScanBudget = {
  startedAtMs: number;
  softDeadlineMs: number;
  totalBudgetMs: number;
  discoveryBudgetMs: number;
  verificationBudgetMs: number;
  cleanupBudgetMs: number;
  discoverySpentMs: number;
  verificationSpentMs: number;
};

export function createScanBudget(runtime: ScanRuntime, nowMs = Date.now()): ScanBudget {
  const totalBudgetMs = Math.max(runtime.softDeadlineMs - runtime.startedAtMs, 1_000);
  return {
    startedAtMs: runtime.startedAtMs,
    softDeadlineMs: runtime.softDeadlineMs,
    totalBudgetMs,
    discoveryBudgetMs: Math.floor(totalBudgetMs * DISCOVERY_BUDGET_RATIO),
    verificationBudgetMs: Math.floor(totalBudgetMs * VERIFICATION_BUDGET_RATIO),
    cleanupBudgetMs: Math.floor(totalBudgetMs * CLEANUP_BUDGET_RATIO),
    discoverySpentMs: 0,
    verificationSpentMs: 0,
  };
}

export function discoveryBudgetRemaining(budget: ScanBudget, nowMs = Date.now()): number {
  const wallRemaining = remainingMs({ softDeadlineMs: budget.softDeadlineMs }, nowMs);
  const discoveryLeft = budget.discoveryBudgetMs - budget.discoverySpentMs;
  // Keep cleanup/verification reserve intact.
  const reservedForLater =
    budget.verificationBudgetMs + budget.cleanupBudgetMs - budget.verificationSpentMs;
  const wallAfterReserve = wallRemaining - Math.max(reservedForLater, 0);
  return Math.max(0, Math.min(discoveryLeft, wallAfterReserve));
}

export function verificationBudgetRemaining(budget: ScanBudget, nowMs = Date.now()): number {
  const wallRemaining = remainingMs({ softDeadlineMs: budget.softDeadlineMs }, nowMs);
  const verificationLeft = budget.verificationBudgetMs - budget.verificationSpentMs;
  const cleanupReserve = Math.max(
    budget.cleanupBudgetMs * 0.5,
    budget.cleanupBudgetMs - (nowMs - budget.startedAtMs) * 0.05,
  );
  return Math.max(0, Math.min(verificationLeft, wallRemaining - cleanupReserve));
}

export function canStartProviderCall(
  budget: ScanBudget,
  estimatedMs: number,
  nowMs = Date.now(),
): boolean {
  return discoveryBudgetRemaining(budget, nowMs) >= Math.max(estimatedMs, MIN_PROVIDER_TIME_MS);
}

export function canStartVerification(budget: ScanBudget, nowMs = Date.now()): boolean {
  return verificationBudgetRemaining(budget, nowMs) >= MIN_PROVIDER_TIME_MS;
}

export function recordSpend(
  budget: ScanBudget,
  kind: "discovery" | "verification",
  spentMs: number,
): void {
  const safe = Math.max(0, spentMs);
  if (kind === "discovery") budget.discoverySpentMs += safe;
  else budget.verificationSpentMs += safe;
}

export function adaptivePerQueryLimit(input: {
  baseLimit: number;
  averageProviderLatencyMs: number;
  discoveryRemainingMs: number;
}): number {
  const base = Math.min(20, Math.max(5, input.baseLimit));
  if (input.averageProviderLatencyMs <= 0) return base;
  if (input.discoveryRemainingMs < 20_000) return Math.min(base, 8);
  if (input.averageProviderLatencyMs > 12_000) return Math.min(base, 10);
  if (input.averageProviderLatencyMs > 8_000) return Math.min(base, 14);
  return base;
}

export function elapsedMs(startedAtMs: number, nowMs = Date.now()): number {
  return Math.max(0, nowMs - startedAtMs);
}
