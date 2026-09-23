/**
 * Pre-Enrollment Intelligence — server-side scan continuation (pure planning).
 *
 * A scan never depends on a browser staying open. Three independent triggers
 * all run the same bounded, lease-protected step (runner-wiring.server.ts):
 *   1. the start/rescan request kicks the first step and dispatches the worker,
 *   2. the worker hook chains itself while scans still have work,
 *   3. pg_cron calls the worker hook every minute as a safety net
 *      (lost chain, crashed isolate, deploy, network blip).
 * Because each step re-derives state from stored rows and holds a lease,
 * overlapping triggers can never double-run or restart a scan.
 */

export interface WorkerScanRow {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  worker_lease_until: string | null;
}

export interface WorkerTickPlan {
  /** Runnable scans (queued/running, lease free), oldest first. */
  toAdvance: string[];
  /** Started scans past the maximum run time with no live lease: fail honestly. */
  toExpire: string[];
}

export const DEFAULT_MAX_SCAN_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
export const MAX_CHAIN_HOPS = 240; // ~2h of 30s hops; cron keeps going after that

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function planWorkerTick(
  rows: WorkerScanRow[],
  nowMs: number,
  opts: { maxAgeMs?: number; limit?: number } = {},
): WorkerTickPlan {
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_SCAN_AGE_MS;
  const limit = opts.limit ?? 5;
  const active = rows
    .filter((r) => r.status === "queued" || r.status === "running")
    .sort((a, b) => (ms(a.created_at) ?? 0) - (ms(b.created_at) ?? 0));

  const toAdvance: string[] = [];
  const toExpire: string[] = [];
  for (const r of active) {
    const lease = ms(r.worker_lease_until);
    const leaseHeld = lease != null && lease > nowMs;
    if (leaseHeld) continue; // another worker is on it right now
    // The run-time limit counts from when the scan actually started running.
    // A scan still waiting in the queue (never started — e.g. created while the
    // worker was unreachable) is always resumed, never expired.
    const startedAt = ms(r.started_at);
    if (startedAt != null && nowMs - startedAt > maxAge) toExpire.push(r.id);
    else if (toAdvance.length < limit) toAdvance.push(r.id);
  }
  return { toAdvance, toExpire };
}

/** Chain another worker invocation only while real work remains and progress is being made. */
export function shouldChain(input: {
  remaining: number;
  unitsRun: number;
  hop: number;
  maxHops?: number;
}): boolean {
  return input.remaining > 0 && input.unitsRun > 0 && input.hop < (input.maxHops ?? MAX_CHAIN_HOPS);
}
