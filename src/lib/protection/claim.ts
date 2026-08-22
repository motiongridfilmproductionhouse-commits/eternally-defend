/**
 * Stale-claim recovery for scan_module_enrollments.
 *
 * The orchestrator's atomic compare-and-swap claim (UPDATE ... WHERE id=?
 * AND current_status=?) already makes concurrent claims of the same row
 * safe — two overlapping cron ticks or two workers racing on the same row
 * can't both succeed (duplicate-safety audit: confirmed, no change needed).
 *
 * The gap this fixes: if a worker crashes/times out *after* claiming a row
 * (current_status='RUNNING') but *before* it writes the final status update,
 * that row is stuck at RUNNING forever — the due-row query permanently
 * excludes RUNNING/QUEUED rows, so a single crash disables all future
 * automatic scanning for that customer+module. scan_module_enrollments
 * already has an updated_at column bumped on every write (including the
 * claim itself, via the existing trg_scan_module_enrollments_updated
 * trigger), so a claim stuck longer than a safety window is distinguishable
 * from one genuinely in progress without adding any new column.
 */

/** How long a RUNNING/QUEUED claim can go without being reclaimed as stale. */
export const STALE_CLAIM_MINUTES = 20;

/**
 * Builds the PostgREST `.or()` filter expression that makes a due-row query
 * select rows that are either not currently claimed, or claimed but stale
 * (last touched before the cutoff). Combined via AND with the caller's other
 * `.eq()`/`.lte()` filters (enabled, eligible, next_scan_at <= now).
 */
export function buildDueRowFilter(staleCutoffIso: string): string {
  return `current_status.not.in.(RUNNING,QUEUED),updated_at.lte.${staleCutoffIso}`;
}

/** Pure predicate mirroring the same semantics, for direct unit testing. */
export function isRowClaimable(
  currentStatus: string,
  updatedAt: string,
  nowMs: number,
  staleMinutes: number = STALE_CLAIM_MINUTES,
): boolean {
  if (currentStatus !== "RUNNING" && currentStatus !== "QUEUED") return true;
  const updatedMs = new Date(updatedAt).getTime();
  return nowMs - updatedMs >= staleMinutes * 60_000;
}
