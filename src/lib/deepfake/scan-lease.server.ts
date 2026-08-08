/**
 * Lease TTLs, heartbeat loops, and stale-run recovery eligibility for
 * batch-based Deepfake Intelligence workers.
 */

import { leaseExpiresAtIso, type ScanRuntime } from "./scan-runtime.server";
import { touchScanProgress, type ScanOwnership } from "./scan-ownership.server";

/** Active worker lease — must exceed a single worker budget plus provider slack. */
export const WORKER_LEASE_TTL_MS = 180_000;

/** Continuation handoff — covers dispatch latency and next-worker cold start. */
export const CONTINUATION_HANDOFF_LEASE_TTL_MS = 300_000;

/** Do not mark failed until lease has been expired for at least this long. */
export const STALE_RECOVERY_GRACE_MS = 120_000;

/** Skip stale recovery when a continuation was scheduled within this window. */
export const CONTINUATION_SCHEDULED_GRACE_MS = 300_000;

/** Background heartbeat interval while a worker invocation is active. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 25_000;

export type ScanLeaseRow = {
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  discovery_metrics?: unknown;
  status?: string | null;
};

function objectish(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Returns true only when a running scan's lease is expired beyond grace and
 * there is no evidence of an in-flight worker or recent continuation handoff.
 */
export function isScanEligibleForStaleRecovery(row: ScanLeaseRow, nowMs = Date.now()): boolean {
  if (row.status && row.status !== "running") return false;

  const leaseExpiry = parseTimestamp(row.lease_expires_at);
  if (leaseExpiry == null) return false;

  if (leaseExpiry > nowMs) return false;

  if (nowMs - leaseExpiry < STALE_RECOVERY_GRACE_MS) return false;

  const metrics = objectish(row.discovery_metrics);
  if (metrics) {
    const continuationAt = parseTimestamp(metrics.continuation_scheduled_at);
    if (continuationAt != null && nowMs - continuationAt < CONTINUATION_SCHEDULED_GRACE_MS) {
      return false;
    }

    const workerLastBatchAt = parseTimestamp(metrics.worker_last_batch_at);
    if (workerLastBatchAt != null && nowMs - workerLastBatchAt < STALE_RECOVERY_GRACE_MS) {
      return false;
    }

    const workerHeartbeatAt = parseTimestamp(metrics.worker_heartbeat_at);
    if (workerHeartbeatAt != null && nowMs - workerHeartbeatAt < STALE_RECOVERY_GRACE_MS) {
      return false;
    }
  }

  const heartbeatAt = parseTimestamp(row.heartbeat_at);
  if (heartbeatAt != null && nowMs - heartbeatAt < STALE_RECOVERY_GRACE_MS) {
    return false;
  }

  return true;
}

export function staleRecoveryLeaseCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - STALE_RECOVERY_GRACE_MS).toISOString();
}

export async function renewScanLease(input: {
  supabase: any;
  ownership: ScanOwnership;
  leaseTtlMs?: number;
  patch?: Record<string, unknown>;
  nowMs?: number;
}): Promise<{ lease_expires_at: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const leaseTtlMs = input.leaseTtlMs ?? input.ownership.runtime.leaseTtlMs;
  const leaseExpiresAt = leaseExpiresAtIso(leaseTtlMs, nowMs);

  await touchScanProgress({
    supabase: input.supabase,
    ownership: input.ownership,
    leaseTtlMs,
    nowMs,
    patch: input.patch,
  });

  return { lease_expires_at: leaseExpiresAt };
}

/**
 * Periodic heartbeat while a worker processes provider calls. Stops when the
 * returned disposer is called or the scan abort signal fires.
 */
export function startWorkerHeartbeatLoop(input: {
  supabase: any;
  ownership: ScanOwnership;
  intervalMs?: number;
  leaseTtlMs?: number;
}): () => void {
  const intervalMs = input.intervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const leaseTtlMs = input.leaseTtlMs ?? input.ownership.runtime.leaseTtlMs;
  let stopped = false;

  const tick = async () => {
    if (stopped || input.ownership.runtime.signal.aborted) return;
    try {
      await renewScanLease({
        supabase: input.supabase,
        ownership: input.ownership,
        leaseTtlMs,
      });
    } catch {
      stopped = true;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  input.ownership.runtime.signal.addEventListener(
    "abort",
    () => {
      stopped = true;
      clearInterval(timer);
    },
    { once: true },
  );

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
