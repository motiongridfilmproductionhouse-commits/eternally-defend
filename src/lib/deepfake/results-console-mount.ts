/**
 * Pure mount/view helpers for the Deepfake Intelligence results console.
 *
 * Keeps route rendering decisions free of scan-lifecycle side effects:
 * no dependency on completed status, mutation settled state, diagnostics open,
 * or unfinished generated queries.
 */

import {
  displayableFindings,
  normalizeClientFindings,
  type ClientFinding,
} from "./results-dashboard";
import { explainNoDeepfakeResults } from "./scan-diagnostics";

export type GetDeepfakeScanPayload = {
  scan?: {
    id?: string;
    status?: string | null;
    target_name?: string | null;
    discovery_metrics?: unknown;
    scan_checkpoint?: unknown;
    profile_id?: string | null;
    error_message?: string | null;
    total_results?: number | null;
  } | null;
  findings?: unknown;
  discoveries?: unknown;
};

export type ResultsConsoleMountInput = {
  selectedScanId: string | null | undefined;
  hasScanRow: boolean;
  visibleFindingCount: number;
  showLoader: boolean;
};

export type ResultsConsoleMountDecision = {
  mount: boolean;
  reason: string;
};

/** Extract and normalize findings from a production getDeepfakeScan payload. */
export function extractClientVisibleFindings(
  payload: GetDeepfakeScanPayload | null | undefined,
): ClientFinding[] {
  const raw = payload?.findings;
  const list = Array.isArray(raw) ? raw : [];
  return displayableFindings(normalizeClientFindings(list));
}

export function shouldMountResultsIntelligenceConsole(input: ResultsConsoleMountInput): boolean {
  return decideResultsConsoleMount(input).mount;
}

/**
 * Mount the premium console only when a scan is selected/loaded and at least
 * one client-visible saved finding exists. Status may be running | partial |
 * completed | failed — none of those block the console.
 */
export function decideResultsConsoleMount(
  input: ResultsConsoleMountInput,
): ResultsConsoleMountDecision {
  if (!input.selectedScanId) {
    return { mount: false, reason: "no_selected_scan" };
  }
  if (input.showLoader) {
    return { mount: false, reason: "initial_scan_loading" };
  }
  if (!input.hasScanRow) {
    return { mount: false, reason: "scan_row_missing" };
  }
  if (input.visibleFindingCount <= 0) {
    return { mount: false, reason: "zero_client_visible_findings" };
  }
  return { mount: true, reason: "selected_scan_with_visible_findings" };
}

/**
 * Development-only explanation for why the console did not mount.
 * Never include raw provider payloads, URLs, or finding bodies.
 */
export function explainResultsConsoleMountDecision(
  input: ResultsConsoleMountInput & {
    scanStatus?: string | null;
  },
): string {
  const decision = decideResultsConsoleMount(input);
  if (decision.mount) {
    return `mount=true reason=${decision.reason} findings=${input.visibleFindingCount} status=${input.scanStatus ?? "unknown"}`;
  }
  return `mount=false reason=${decision.reason} findings=${input.visibleFindingCount} status=${input.scanStatus ?? "unknown"} selected=${Boolean(input.selectedScanId)} hasScan=${input.hasScanRow} loader=${input.showLoader}`;
}

/** True when the legacy FindingCard list must stay disabled. */
export function shouldRenderLegacyFindingCards(input: { consoleMounted: boolean }): boolean {
  // Legacy cards are retired once the intelligence console path exists.
  void input.consoleMounted;
  return false;
}

export function emptyFindingsStatusMessage(input: {
  status?: string | null;
  errorMessage?: string | null;
  discoveryMetrics?: Record<string, unknown> | null;
}): string {
  if (input.status === "running") {
    return "Sweep in progress — verified results appear as batches are saved.";
  }
  if (input.status === "partial") {
    return "Partial scan finished with no client-visible threats at this risk level. Check public leads below.";
  }
  if (input.status === "failed") {
    return input.errorMessage || "Scan failed before verified progress was saved.";
  }

  const explained = explainNoDeepfakeResults(input.discoveryMetrics ?? null, input.status);
  if (explained.reasons.length) {
    return `${explained.headline}: ${explained.reasons[0]}`;
  }
  return "No findings at this risk level.";
}

export function emptyFindingsDetailLines(input: {
  status?: string | null;
  discoveryMetrics?: Record<string, unknown> | null;
}): string[] {
  return explainNoDeepfakeResults(input.discoveryMetrics ?? null, input.status).reasons;
}
