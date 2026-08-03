/**
 * Pure UI-state helpers for the Deepfake Intelligence dashboard.
 *
 * The scan request runs the whole pipeline inline and can outlive (or die
 * before) the HTTP response, so the UI must derive "is this still scanning"
 * from the polled scan row instead of the mutation's pending flag.
 */

export type ScanStatus = "running" | "completed" | "partial" | "failed" | string;

export const SCAN_POLL_INTERVAL_MS = 3_000;
export const SCAN_STALL_WARNING_MS = 15_000;

export function isTerminalScanStatus(status: ScanStatus | null | undefined): boolean {
  return status === "completed" || status === "partial" || status === "failed";
}

/** Poll every 3s while the scan runs, or while a scan request is still in flight. */
export function scanPollInterval(input: {
  status?: ScanStatus | null;
  requestPending: boolean;
}): number | false {
  if (input.status === "running") return SCAN_POLL_INTERVAL_MS;
  if (isTerminalScanStatus(input.status)) return false;
  return input.requestPending ? SCAN_POLL_INTERVAL_MS : false;
}

/** Auto-select the scan created by an in-flight request so results stream in. */
export function pickLiveScanId(input: {
  scans: Array<{ id: string; status: ScanStatus; target_name: string }>;
  targetName: string;
  selectedScanId: string | null;
  requestPending: boolean;
}): string | null {
  if (!input.requestPending || input.selectedScanId) return null;
  const name = input.targetName.trim().toLowerCase();
  const match = input.scans.find(
    (scan) =>
      scan.status === "running" &&
      (!name || scan.target_name.trim().toLowerCase() === name),
  );
  return match?.id ?? null;
}

/** Findings must render during "running"; only block on the very first fetch. */
export function shouldShowResultsLoader(input: {
  isLoading: boolean;
  hasScan: boolean;
}): boolean {
  return input.isLoading && !input.hasScan;
}

/** Signature of everything polling can change; used to detect a stalled run. */
export function scanProgressSignature(input: {
  status?: ScanStatus | null;
  metrics?: unknown;
  findingCount: number;
  discoveryCount: number;
}): string {
  return JSON.stringify({
    status: input.status ?? null,
    metrics: input.metrics ?? null,
    findings: input.findingCount,
    discoveries: input.discoveryCount,
  });
}

export function isScanStalled(input: {
  status?: ScanStatus | null;
  lastChangeAt: number;
  now: number;
}): boolean {
  if (input.status !== "running") return false;
  return input.now - input.lastChangeAt >= SCAN_STALL_WARNING_MS;
}

/** History must not flash “No scans yet” before the first fetch resolves. */
export function shouldShowHistoryLoading(input: {
  isLoading: boolean;
  isFetching: boolean;
  hasData: boolean;
}): boolean {
  return input.isLoading || (input.isFetching && !input.hasData);
}

export function shouldShowHistoryEmpty(input: {
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  count: number;
}): boolean {
  if (input.isError) return false;
  if (shouldShowHistoryLoading({
    isLoading: input.isLoading,
    isFetching: input.isFetching,
    hasData: input.count > 0,
  })) {
    return false;
  }
  return input.count === 0;
}

/** Failed scans stay out of SCAN HISTORY (partial/completed/running remain). */
export function isVisibleScanHistoryStatus(
  status: ScanStatus | null | undefined,
): boolean {
  return status !== "failed";
}

export function filterScanHistory<T extends { status: ScanStatus }>(
  scans: T[],
): T[] {
  return scans.filter((scan) => isVisibleScanHistoryStatus(scan.status));
}
