/**
 * Scan ownership, heartbeat/lease updates, terminal transitions, and
 * lease-based stale recovery for Deepfake Intelligence.
 */

import {
  ScanOwnershipLostError,
  createScanRunToken,
  leaseExpiresAtIso,
  type ScanRuntime,
} from "./scan-runtime.server";

export type DiscoveryFunnelMetrics = {
  queries_generated: number;
  queries_executed: number;
  provider_candidates: number;
  unique_candidates: number;
  crawl_succeeded: number;
  crawl_failed: number;
  identity_rejected: number;
  page_type_rejected: number;
  url_rejected: number;
  unverified: number;
  probable: number;
  verified: number;
  client_visible: number;
  provider_failures: number;
  query_failures: number;
};

export function createDiscoveryFunnelMetrics(): DiscoveryFunnelMetrics {
  return {
    queries_generated: 0,
    queries_executed: 0,
    provider_candidates: 0,
    unique_candidates: 0,
    crawl_succeeded: 0,
    crawl_failed: 0,
    identity_rejected: 0,
    page_type_rejected: 0,
    url_rejected: 0,
    unverified: 0,
    probable: 0,
    verified: 0,
    client_visible: 0,
    provider_failures: 0,
    query_failures: 0,
  };
}

export type TerminalScanStatus = "completed" | "partial" | "failed";

export type ScanOwnership = {
  scanId: string;
  scanRunToken: string;
  runtime: ScanRuntime;
};

function ownershipFilter(query: any, ownership: ScanOwnership) {
  return query
    .eq("id", ownership.scanId)
    .eq("status", "running")
    .eq("scan_run_token", ownership.scanRunToken);
}

async function applyUpdateWithLegacyFallback(input: {
  supabase: any;
  ownership: ScanOwnership;
  patch: Record<string, unknown>;
}): Promise<number> {
  const { supabase, ownership, patch } = input;

  let updateQuery = ownershipFilter(
    supabase.from("deepfake_scans").update(patch as any),
    ownership,
  );

  let { data, error } = await updateQuery.select("id");

  if (error) {
    const missingColumn =
      /scan_run_token|heartbeat_at|lease_expires_at|discovery_metrics|column .* does not exist|schema cache/i.test(
        error.message,
      );

    if (!missingColumn) {
      throw new Error(error.message);
    }

    const legacy = { ...patch };
    delete legacy.scan_run_token;
    delete legacy.heartbeat_at;
    delete legacy.lease_expires_at;
    if (/discovery_metrics/i.test(error.message)) {
      delete legacy.discovery_metrics;
    }

    /*
     * Without scan_run_token column, fall back to id + status = running only.
     * This still refuses to revive terminal rows.
     */
    const legacyResult = await supabase
      .from("deepfake_scans")
      .update(legacy as any)
      .eq("id", ownership.scanId)
      .eq("status", "running")
      .select("id");

    if (legacyResult.error) {
      throw new Error(legacyResult.error.message);
    }

    data = legacyResult.data;
    error = null;
  }

  return Array.isArray(data) ? data.length : 0;
}

/**
 * Progress / heartbeat / lease update. Must match scan id + running + token.
 * Zero rows ⇒ ownership lost ⇒ abort immediately.
 */
export async function touchScanProgress(input: {
  supabase: any;
  ownership: ScanOwnership;
  patch?: Record<string, unknown>;
  nowMs?: number;
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  const heartbeatPatch: Record<string, unknown> = {
    heartbeat_at: new Date(nowMs).toISOString(),
    lease_expires_at: leaseExpiresAtIso(
      input.ownership.runtime.leaseTtlMs,
      nowMs,
    ),
    ...(input.patch ?? {}),
  };

  const affected = await applyUpdateWithLegacyFallback({
    supabase: input.supabase,
    ownership: input.ownership,
    patch: heartbeatPatch,
  });

  if (affected === 0) {
    if (!input.ownership.runtime.controller.signal.aborted) {
      input.ownership.runtime.controller.abort(
        new ScanOwnershipLostError(),
      );
    }
    throw new ScanOwnershipLostError();
  }
}

/**
 * Idempotent terminal transition. Clears/invalidates scan_run_token.
 * Only updates rows that are still running with this token.
 */
export async function finalizeScanStatus(input: {
  supabase: any;
  ownership: ScanOwnership;
  status: TerminalScanStatus;
  patch?: Record<string, unknown>;
  errorMessage?: string | null;
  nowMs?: number;
}): Promise<{ applied: boolean }> {
  const nowMs = input.nowMs ?? Date.now();
  const terminalPatch: Record<string, unknown> = {
    status: input.status,
    scan_run_token: null,
    finished_at: new Date(nowMs).toISOString(),
    heartbeat_at: new Date(nowMs).toISOString(),
    lease_expires_at: null,
    ...(input.patch ?? {}),
  };

  if (input.errorMessage != null) {
    terminalPatch.error_message = input.errorMessage.slice(0, 500);
  }

  const affected = await applyUpdateWithLegacyFallback({
    supabase: input.supabase,
    ownership: input.ownership,
    patch: terminalPatch,
  });

  if (affected > 0) {
    return { applied: true };
  }

  /*
   * Idempotent: if another path already finalized this scan, treat as success
   * when the row is already terminal.
   */
  const { data } = await input.supabase
    .from("deepfake_scans")
    .select("id, status")
    .eq("id", input.ownership.scanId)
    .maybeSingle();

  const status = (data as { status?: string } | null)?.status;
  if (status === "completed" || status === "partial" || status === "failed") {
    return { applied: false };
  }

  /*
   * Last-resort write without token match — still refuse to revive by only
   * updating running rows. Prefer failed so nothing stays RUNNING.
   */
  const fallback = await input.supabase
    .from("deepfake_scans")
    .update({
      status: input.status,
      scan_run_token: null,
      finished_at: new Date(nowMs).toISOString(),
      lease_expires_at: null,
      error_message:
        input.errorMessage?.slice(0, 500) ??
        (terminalPatch.error_message as string | undefined) ??
        null,
      ...(input.patch ?? {}),
    } as any)
    .eq("id", input.ownership.scanId)
    .eq("status", "running")
    .select("id");

  return {
    applied: Array.isArray(fallback.data) && fallback.data.length > 0,
  };
}

export function decideTerminalStatus(input: {
  abortedByDeadline: boolean;
  hasValidProgress: boolean;
  errorMessage?: string | null;
}): {
  status: TerminalScanStatus;
  reason: string | null;
} {
  if (!input.errorMessage && !input.abortedByDeadline) {
    return { status: "completed", reason: null };
  }

  if (input.abortedByDeadline) {
    if (input.hasValidProgress) {
      return {
        status: "partial",
        reason:
          "Scan reached the execution deadline with verified progress saved. Partial results are available.",
      };
    }
    return {
      status: "failed",
      reason:
        "Scan reached the execution deadline before any verified progress could be saved.",
    };
  }

  if (input.hasValidProgress) {
    return {
      status: "partial",
      reason:
        (input.errorMessage ??
          "Scan stopped early after saving verified progress.") +
        " Partial results are available.",
    };
  }

  return {
    status: "failed",
    reason: input.errorMessage ?? "Scan failed before verified progress was saved.",
  };
}

/**
 * Valid progress for PARTIAL status requires rows that were actually
 * persisted (discoveries and/or findings). In-memory crawl/classification
 * counters alone must not produce PARTIAL.
 */
export function hasValidScanProgress(input: {
  metrics?: DiscoveryFunnelMetrics;
  discoveryCount?: number;
  findingCount?: number;
  clientVisibleCount?: number;
}): boolean {
  return (
    (input.findingCount ?? 0) > 0 ||
    (input.discoveryCount ?? 0) > 0
  );
}

/**
 * Recover only when lease_expires_at has passed. Never fail a scan that
 * still holds a valid heartbeat lease. Atomically updates only running rows
 * with expired leases.
 */
export async function recoverExpiredScanLease(input: {
  supabase: any;
  scanId: string;
  nowMs?: number;
}): Promise<{ recovered: boolean; status?: string }> {
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();

  const { data, error } = await input.supabase
    .from("deepfake_scans")
    .update({
      status: "failed",
      scan_run_token: null,
      finished_at: nowIso,
      lease_expires_at: null,
      error_message:
        "Scan lease expired without a fresh heartbeat. Marked failed by stale-run recovery.",
    } as any)
    .eq("id", input.scanId)
    .eq("status", "running")
    .lt("lease_expires_at", nowIso)
    .select("id, status");

  if (error) {
    /*
     * Column may not exist yet — do not use started_at alone.
     */
    if (
      /lease_expires_at|scan_run_token|column .* does not exist|schema cache/i.test(
        error.message,
      )
    ) {
      return { recovered: false };
    }
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  return {
    recovered: Boolean(row),
    status: row?.status,
  };
}

export async function recoverExpiredScansForUser(input: {
  supabase: any;
  userId: string;
  nowMs?: number;
}): Promise<number> {
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();

  const { data, error } = await input.supabase
    .from("deepfake_scans")
    .update({
      status: "failed",
      scan_run_token: null,
      finished_at: nowIso,
      lease_expires_at: null,
      error_message:
        "Scan lease expired without a fresh heartbeat. Marked failed by stale-run recovery.",
    } as any)
    .eq("user_id", input.userId)
    .eq("status", "running")
    .lt("lease_expires_at", nowIso)
    .select("id");

  if (error) {
    if (
      /lease_expires_at|scan_run_token|column .* does not exist|schema cache/i.test(
        error.message,
      )
    ) {
      return 0;
    }
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data.length : 0;
}

export { createScanRunToken };
