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

function isMissingColumnError(message: string, column: string): boolean {
  return new RegExp(`${column}|column .* does not exist|schema cache`, "i").test(
    message,
  );
}

/**
 * Prefer service-role writer so runtime fields stay server-managed under RLS
 * triggers. Fall back to the caller client in tests / local without admin key.
 */
async function resolveScanWriter(fallback: any): Promise<any> {
  try {
    const mod = await import("@/integrations/supabase/client.server");
    void Reflect.get(mod.supabaseAdmin, "from");
    return mod.supabaseAdmin;
  } catch {
    return fallback;
  }
}

/**
 * Ownership-safe update. Always requires scan id + running + scan_run_token.
 * Optional columns may be stripped and retried, but the token filter is never
 * removed — stale invocations after continuation cannot write.
 */
async function applyOwnedUpdate(input: {
  supabase: any;
  ownership: ScanOwnership;
  patch: Record<string, unknown>;
}): Promise<number> {
  const supabase = await resolveScanWriter(input.supabase);
  const { ownership } = input;
  let patch = { ...input.patch };

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await ownershipFilter(
      supabase.from("deepfake_scans").update(patch as any),
      ownership,
    ).select("id");

    if (!error) {
      return Array.isArray(data) ? data.length : 0;
    }

    const message = error.message ?? "";
    let stripped = false;

    if (
      "scan_checkpoint" in patch &&
      isMissingColumnError(message, "scan_checkpoint")
    ) {
      delete patch.scan_checkpoint;
      stripped = true;
    }
    if (
      "discovery_metrics" in patch &&
      isMissingColumnError(message, "discovery_metrics")
    ) {
      delete patch.discovery_metrics;
      stripped = true;
    }
    if (
      "heartbeat_at" in patch &&
      isMissingColumnError(message, "heartbeat_at")
    ) {
      delete patch.heartbeat_at;
      stripped = true;
    }
    if (
      "lease_expires_at" in patch &&
      isMissingColumnError(message, "lease_expires_at")
    ) {
      delete patch.lease_expires_at;
      stripped = true;
    }

    /*
     * Pre-ownership schemas without scan_run_token cannot enforce CAS.
     * Fail closed rather than writing with id+running only — continuation
     * safety requires the token column from the ownership migration.
     */
    if (isMissingColumnError(message, "scan_run_token")) {
      throw new Error(
        "deepfake_scans.scan_run_token is required for ownership-safe writes",
      );
    }

    if (!stripped) {
      throw new Error(message);
    }
  }

  return 0;
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

  const affected = await applyOwnedUpdate({
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
 * Never falls back to a tokenless write — a continued scan with a new token
 * must leave the stale invocation unable to finalize.
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

  const affected = await applyOwnedUpdate({
    supabase: input.supabase,
    ownership: input.ownership,
    patch: terminalPatch,
  });

  if (affected > 0) {
    return { applied: true };
  }

  /*
   * Idempotent: if another path already finalized this scan, or ownership
   * was lost to continuation, treat as success only when the row is already
   * terminal. Do NOT write without the token.
   */
  const { data } = await input.supabase
    .from("deepfake_scans")
    .select("id, status, scan_run_token")
    .eq("id", input.ownership.scanId)
    .maybeSingle();

  const row = data as { status?: string; scan_run_token?: string | null } | null;
  const status = row?.status;
  if (status === "completed" || status === "partial" || status === "failed") {
    return { applied: false };
  }

  if (
    row?.scan_run_token &&
    row.scan_run_token !== input.ownership.scanRunToken
  ) {
    return { applied: false };
  }

  return { applied: false };
}

export function decideTerminalStatus(input: {
  abortedByDeadline: boolean;
  hasValidProgress: boolean;
  errorMessage?: string | null;
  pendingWork?: boolean;
  checkpointPause?: boolean;
}): {
  status: TerminalScanStatus;
  reason: string | null;
} {
  if (
    !input.errorMessage &&
    !input.abortedByDeadline &&
    !input.checkpointPause
  ) {
    return { status: "completed", reason: null };
  }

  if (input.abortedByDeadline || input.checkpointPause) {
    if (input.hasValidProgress) {
      return {
        status: "partial",
        reason:
          input.pendingWork || input.checkpointPause
            ? "Scan paused at the time budget after saving verified progress. Saved results remain available — use Continue scan to resume from the checkpoint without repeating completed queries."
            : "Scan reached the execution deadline with verified progress saved. Partial results are available.",
      };
    }
    return {
      status: "failed",
      reason:
        "Scan reached the time budget deadline before any verified progress could be saved.",
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

  /*
   * FAILED only for real provider/system errors with no usable progress.
   * Generic timeout/abort text is rewritten so it is not framed as unexpected.
   */
  const raw = input.errorMessage ?? "Scan failed before verified progress was saved.";
  const normalized = /\b(?:abort|timeout|timed out)\b/i.test(raw)
    ? "Scan stopped before verified progress was saved due to a provider or time-budget limit."
    : raw;
  return {
    status: "failed",
    reason: normalized,
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
  const supabase = await resolveScanWriter(input.supabase);

  const { data, error } = await supabase
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
  const supabase = await resolveScanWriter(input.supabase);

  const { data, error } = await supabase
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
