import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  filterClientDiscoveries,
  filterClientFindings,
} from "./deepfake/client-results.server";
import {
  WORKER_LEASE_TTL_MS,
} from "./deepfake/scan-lease.server";
import {
  createScanRuntime,
  isAbortError,
  isDeadlineOrTimeoutError,
  leaseExpiresAtIso,
  ScanCheckpointPauseError,
  ScanDeadlineError,
} from "./deepfake/scan-runtime.server";
import {
  checkpointHasPendingWork,
  parseScanCheckpoint,
  type ScanCheckpoint,
} from "./deepfake/scan-checkpoint.server";
import {
  createDiscoveryFunnelMetrics,
  createScanRunToken,
  decideTerminalStatus,
  finalizeScanStatus,
  hasValidScanProgress,
  recoverExpiredScanLease,
  recoverExpiredScansForUser,
  type DiscoveryFunnelMetrics,
  type ScanOwnership,
  type TerminalScanStatus,
} from "./deepfake/scan-ownership.server";
import {
  findActiveScanForIdentity,
  isUniqueViolation,
} from "./deepfake/scan-concurrency.server";
import type { PipelineResult } from "./deepfake/scan-pipeline.server";
import {
  assertDeepfakeStartupWorkerConfig,
  deepfakeScanWorkerDispatchDiagnostic,
  dispatchNextWorker,
  resolveDeepfakeScanWorkerUrl,
} from "./deepfake/scan-worker-dispatch.server";
import { executeDeepfakeScanWorkerBatch } from "./deepfake/scan-worker.server";
import {
  classifyStartupNetworkError,
  formatStartupUserError,
  keepBackgroundWorkAlive,
  logStartupStage,
  startupErrorLabel,
  type StartupNetworkErrorCategory,
} from "./deepfake/startup-network.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

function alreadyRunningResult(scanId: string) {
  return {
    scan_id: scanId,
    total_results: 0,
    discovered_results: 0,
    status: "running" as const,
    already_running: true as const,
  };
}

function isDeadlineAbort(error: unknown, signal: AbortSignal): boolean {
  if (isDeadlineOrTimeoutError(error)) return true;
  if (error instanceof ScanDeadlineError) return true;
  if (signal.reason instanceof ScanDeadlineError) return true;
  return (
    isAbortError(error) &&
    signal.aborted &&
    (signal.reason instanceof ScanDeadlineError ||
      isDeadlineOrTimeoutError(signal.reason))
  );
}

function checkpointFromError(error: unknown): ScanCheckpoint | null {
  const value = (error as { checkpoint?: unknown } | null)?.checkpoint;
  return parseScanCheckpoint(value);
}

function finalCounts(input: {
  pipelineResult: PipelineResult | null;
  checkpoint: ScanCheckpoint | null;
}) {
  const { pipelineResult, checkpoint } = input;
  return {
    planQueryCount:
      pipelineResult?.planQueryCount ?? checkpoint?.queries.length ?? 0,
    discoveryCount:
      pipelineResult?.discoveryCount ?? checkpoint?.discovery_count ?? 0,
    findingCount:
      pipelineResult?.findingCount ?? checkpoint?.finding_count ?? 0,
    clientVisibleCount:
      pipelineResult?.clientVisibleCount ??
      checkpoint?.client_visible_count ??
      0,
    riskCounts: pipelineResult?.riskCounts ??
      checkpoint?.risk_counts ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
    metrics: {
      ...createDiscoveryFunnelMetrics(),
      ...(pipelineResult?.metrics ?? checkpoint?.metrics ?? {}),
    },
  };
}

async function finalizePipelineRun(input: {
  supabase: any;
  ownership: ScanOwnership;
  runtime: ReturnType<typeof createScanRuntime>;
  pipelineResult: PipelineResult | null;
  pipelineError: unknown;
  fallbackCheckpoint?: ScanCheckpoint | null;
}): Promise<{
  terminalStatus: TerminalScanStatus;
  terminalReason: string | null;
  counts: ReturnType<typeof finalCounts>;
  checkpoint: ScanCheckpoint | null;
}> {
  const checkpoint =
    input.pipelineResult?.checkpoint ??
    checkpointFromError(input.pipelineError) ??
    input.fallbackCheckpoint ??
    null;
  const counts = finalCounts({
    pipelineResult: input.pipelineResult,
    checkpoint,
  });
  const errorMessage =
    input.pipelineError instanceof Error
      ? input.pipelineError.message
      : input.pipelineError
        ? String(input.pipelineError)
        : null;
  const checkpointPause = input.pipelineError instanceof ScanCheckpointPauseError;
  const deadlineAbort =
    isDeadlineAbort(input.pipelineError, input.runtime.signal) ||
    isDeadlineOrTimeoutError(input.pipelineError) ||
    checkpointPause;
  const validProgress = hasValidScanProgress({
    metrics: counts.metrics,
    discoveryCount: counts.discoveryCount,
    findingCount: counts.findingCount,
    clientVisibleCount: counts.clientVisibleCount,
  });
  const pendingWork = checkpoint ? checkpointHasPendingWork(checkpoint) : false;
  const decision =
    input.pipelineResult?.completed && !input.pipelineError
      ? { status: "completed" as TerminalScanStatus, reason: null }
      : decideTerminalStatus({
          abortedByDeadline: deadlineAbort,
          hasValidProgress: validProgress,
          pendingWork,
          checkpointPause,
          errorMessage: checkpointPause
            ? null
            : (errorMessage ??
              (input.runtime.signal.aborted
                ? "Scan was aborted before completion."
                : null)),
        });

  await finalizeScanStatus({
    supabase: input.supabase,
    ownership: input.ownership,
    status: decision.status,
    patch: {
      total_queries: counts.planQueryCount,
      total_results: counts.clientVisibleCount,
      critical_count: counts.riskCounts.critical,
      high_count: counts.riskCounts.high,
      medium_count: counts.riskCounts.medium,
      low_count: counts.riskCounts.low,
      discovery_metrics: counts.metrics,
      scan_checkpoint: checkpoint,
    },
    errorMessage: decision.reason,
  });

  return {
    terminalStatus: decision.status,
    terminalReason: decision.reason,
    counts,
    checkpoint,
  };
}

async function persistStartupDispatchDiagnostic(
  supabase: any,
  scanId: string,
  patch: Record<string, unknown>,
) {
  try {
    const { data: scan } = await supabase
      .from("deepfake_scans")
      .select("discovery_metrics")
      .eq("id", scanId)
      .maybeSingle();
    const existing =
      scan?.discovery_metrics && typeof scan.discovery_metrics === "object"
        ? (scan.discovery_metrics as Record<string, unknown>)
        : {};
    await supabase
      .from("deepfake_scans")
      .update({
        discovery_metrics: {
          ...existing,
          startup_diagnostic: {
            ...((existing.startup_diagnostic as Record<string, unknown>) ?? {}),
            ...patch,
            updated_at: new Date().toISOString(),
          },
        },
      })
      .eq("id", scanId);
  } catch (error) {
    console.warn("[DEEPFAKE] Failed to persist startup diagnostic:", {
      scan_id: scanId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleInlineWorkerExecution(
  scanId: string,
  supabase: any,
  userId?: string,
) {
  const work = executeDeepfakeScanById({
    supabase,
    scanId,
    userId,
    source: "worker",
  }).catch((error) => {
    console.error("deepfake_scan_inline_executor_failed", {
      scan_id: scanId,
      error: error instanceof Error ? error.message : String(error),
      category: classifyStartupNetworkError(error),
    });
  });
  keepBackgroundWorkAlive(work);
}

export type DispatchDeepfakeScanExecutionResult = {
  dispatched: boolean;
  mode: "http" | "inline" | "failed";
  category: StartupNetworkErrorCategory | null;
  reason: string | null;
  worker_url: string | null;
  http_status: number | null;
  request_id: string | null;
};

/**
 * Kick the background worker without awaiting a full scan batch.
 * Never blocks scan-start on inline pipeline execution.
 */
export async function dispatchDeepfakeScanExecution(
  scanId: string,
  supabase: any,
  userId?: string,
): Promise<DispatchDeepfakeScanExecutionResult> {
  logStartupStage("dispatch_worker", { scan_id: scanId });
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic();
  const workerUrl = resolveDeepfakeScanWorkerUrl();

  console.info("deepfake_scan_worker_dispatch_request", {
    scan_id: scanId,
    worker_url: workerUrl,
    worker_url_configured: Boolean(workerUrl),
    worker_url_source: diagnostic.worker_url_source,
    authentication: diagnostic.worker_secret_present
      ? "hmac_configured"
      : "missing_secret",
  });

  await persistStartupDispatchDiagnostic(supabase, scanId, {
    stage: "dispatch_worker",
    worker_url: workerUrl,
    worker_url_source: diagnostic.worker_url_source,
    worker_secret_present: diagnostic.worker_secret_present,
  });

  if (!workerUrl || !diagnostic.worker_url_valid) {
    const category =
      diagnostic.failure_category ?? "worker_url_not_configured";
    console.error("deepfake_scan_worker_dispatch_config_invalid", {
      scan_id: scanId,
      category,
    });
    await persistStartupDispatchDiagnostic(supabase, scanId, {
      stage: "dispatch_worker",
      dispatched: false,
      mode: "failed",
      category,
      reason: startupErrorLabel(category),
    });
    return {
      dispatched: false,
      mode: "failed",
      category,
      reason: startupErrorLabel(category),
      worker_url: null,
      http_status: null,
      request_id: null,
    };
  }

  if (!diagnostic.worker_secret_present) {
    console.error("deepfake_scan_worker_dispatch_missing_secret", {
      scan_id: scanId,
    });
    await persistStartupDispatchDiagnostic(supabase, scanId, {
      stage: "dispatch_worker",
      dispatched: false,
      mode: "failed",
      category: "worker_secret_not_configured",
      reason: startupErrorLabel("worker_secret_not_configured"),
    });
    return {
      dispatched: false,
      mode: "failed",
      category: "worker_secret_not_configured",
      reason: startupErrorLabel("worker_secret_not_configured"),
      worker_url: workerUrl,
      http_status: null,
      request_id: null,
    };
  }

  const dispatch = await dispatchNextWorker({ scanId, timeoutMs: 8_000 });
  console.info("deepfake_scan_worker_dispatch_response", {
    scan_id: scanId,
    dispatched: dispatch.dispatched,
    http_status: dispatch.http_status ?? null,
    reason: dispatch.reason ?? null,
    category: dispatch.category ?? null,
    request_id: dispatch.request_id ?? null,
    duration_ms: dispatch.duration_ms ?? null,
  });

  if (dispatch.dispatched) {
    await persistStartupDispatchDiagnostic(supabase, scanId, {
      stage: "dispatch_worker",
      dispatched: true,
      mode: "http",
      worker_url: workerUrl,
      http_status: dispatch.http_status ?? null,
      request_id: dispatch.request_id ?? null,
    });
    return {
      dispatched: true,
      mode: "http",
      category: null,
      reason: null,
      worker_url: workerUrl,
      http_status: dispatch.http_status ?? null,
      request_id: dispatch.request_id ?? null,
    };
  }

  // HTTP kick failed — schedule inline without awaiting the batch so the
  // client's start request cannot time out as TypeError: fetch failed.
  const category =
    dispatch.category ??
    classifyStartupNetworkError(dispatch.reason ?? "fetch failed");
  console.warn("deepfake_scan_worker_dispatch_fallback_inline", {
    scan_id: scanId,
    reason: dispatch.reason ?? "dispatch_failed",
    category,
    http_status: dispatch.http_status ?? null,
  });
  await persistStartupDispatchDiagnostic(supabase, scanId, {
    stage: "dispatch_worker",
    dispatched: true,
    mode: "inline",
    category,
    reason: dispatch.reason ?? startupErrorLabel(category),
    http_status: dispatch.http_status ?? null,
    request_id: dispatch.request_id ?? null,
  });
  scheduleInlineWorkerExecution(scanId, supabase, userId);
  return {
    dispatched: true,
    mode: "inline",
    category,
    reason: dispatch.reason ?? startupErrorLabel(category),
    worker_url: workerUrl,
    http_status: dispatch.http_status ?? null,
    request_id: dispatch.request_id ?? null,
  };
}

export async function executeDeepfakeScanById(opts: {
  supabase: any;
  scanId: string;
  userId?: string;
  source?: "worker" | "user";
}): Promise<{
  scan_id: string;
  status: string;
  total_results: number;
  discovered_results: number;
  dispatched_next: boolean;
  pending_work: boolean;
}> {
  console.info("deepfake_scan_executor_start", {
    scan_id: opts.scanId,
    source: opts.source ?? "user",
    user_scoped: Boolean(opts.userId),
  });

  const workerResult = await executeDeepfakeScanWorkerBatch({
    supabase: opts.supabase,
    scanId: opts.scanId,
    userId: opts.userId,
    finalize: finalizePipelineRun,
  });

  let query = opts.supabase
    .from("deepfake_scans")
    .select("total_results, status")
    .eq("id", opts.scanId);
  if (opts.userId) {
    query = query.eq("user_id", opts.userId);
  }
  const { data: scan } = await query.maybeSingle();

  console.info("deepfake_scan_executor_complete", {
    scan_id: opts.scanId,
    source: opts.source ?? "user",
    status: workerResult.status,
    dispatched_next: workerResult.dispatched_next,
    pending_work: workerResult.pending_work,
  });

  return {
    scan_id: opts.scanId,
    status: workerResult.status,
    total_results: scan?.total_results ?? 0,
    discovered_results: scan?.total_results ?? 0,
    dispatched_next: workerResult.dispatched_next,
    pending_work: workerResult.pending_work,
  };
}

/**
 * Create/acquire a RUNNING scan row and return immediately.
 * Dispatches the background worker — the client polls for progress.
 */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target_name: z.string().trim().min(1).max(200),
        profile_id: z.string().uuid().optional(),
        aliases: z
          .array(z.string().trim().min(1).max(200))
          .max(20)
          .optional()
          .default([]),
        handles: z
          .array(z.string().trim().min(1).max(200))
          .max(20)
          .optional()
          .default([]),
        google_images_url: z.string().trim().max(5000).optional(),
        max_queries: z.number().int().min(40).max(60).optional(),
        per_query_limit: z.number().int().min(10).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const runtime = createScanRuntime({ leaseTtlMs: WORKER_LEASE_TTL_MS });
    const scanRunToken = createScanRunToken();
    const aliases = data.aliases ?? [];
    const handles = data.handles ?? [];

    logStartupStage("validate_config", {
      target_name: data.target_name,
      profile_id: data.profile_id ?? null,
    });
    try {
      assertDeepfakeStartupWorkerConfig();
    } catch (configError) {
      const category = classifyStartupNetworkError(configError);
      throw new Error(
        formatStartupUserError({
          category,
          detail:
            configError instanceof Error ? configError.message : String(configError),
        }),
      );
    }

    try {
      await recoverExpiredScansForUser({ supabase, userId });
    } catch (recoverError) {
      const category = classifyStartupNetworkError(recoverError);
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during scan start:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
        { category },
      );
    }

    const activeScan = await findActiveScanForIdentity({
      supabase,
      userId,
      profileId: data.profile_id ?? null,
      targetName: data.target_name,
    });

    if (activeScan) {
      return alreadyRunningResult(activeScan.id);
    }

    logStartupStage("create_scan_record", {
      target_name: data.target_name,
    });

    const nowMs = Date.now();
    const scanInsert: Record<string, unknown> = {
      user_id: userId,
      target_name: data.target_name,
      aliases,
      handles,
      status: "running",
      scan_run_token: scanRunToken,
      heartbeat_at: new Date(nowMs).toISOString(),
      lease_expires_at: leaseExpiresAtIso(runtime.leaseTtlMs, nowMs),
      error_message: null,
      // Persist start options so execute can resume without trusting the client
      // for identity fields (google URL / limits only).
      discovery_metrics: {
        stage: "discovering",
        investigation_stage: "discovering",
        start_options: {
          google_images_url: data.google_images_url ?? null,
          max_queries: data.max_queries ?? 56,
          per_query_limit: data.per_query_limit ?? 20,
        },
        startup_diagnostic: {
          stage: "create_scan_record",
          started_at: new Date(nowMs).toISOString(),
        },
      },
    };

    if (data.profile_id) {
      scanInsert.profile_id = data.profile_id;
    }

    let scan: { id: string; status: string } | null = null;
    try {
      const inserted = await supabase
        .from("deepfake_scans")
        .insert(scanInsert as any)
        .select("id, status")
        .single();
      if (inserted.error || !inserted.data) {
        if (inserted.error && isUniqueViolation(inserted.error)) {
          const concurrent = await findActiveScanForIdentity({
            supabase,
            userId,
            profileId: data.profile_id ?? null,
            targetName: data.target_name,
          });
          if (concurrent) {
            return alreadyRunningResult(concurrent.id);
          }
        }
        const category = classifyStartupNetworkError(
          inserted.error?.message ?? "failed to create scan",
        );
        throw new Error(
          formatStartupUserError({
            category:
              category === "network_failed" ||
              category === "worker_endpoint_unavailable"
                ? "database_unavailable"
                : category,
            detail: inserted.error?.message ?? "failed to create scan",
          }),
        );
      }
      scan = inserted.data;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Unable to start investigation.")
      ) {
        throw error;
      }
      const category = classifyStartupNetworkError(error);
      throw new Error(
        formatStartupUserError({
          category:
            category === "network_failed" ||
            category === "worker_endpoint_unavailable"
              ? "database_unavailable"
              : category,
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    logStartupStage("save_scan", { scan_id: scan.id });
    logStartupStage("dispatch_worker", { scan_id: scan.id });

    const dispatchResult = await dispatchDeepfakeScanExecution(
      scan.id,
      supabase,
      userId,
    );

    if (!dispatchResult.dispatched || dispatchResult.mode === "failed") {
      const category =
        dispatchResult.category ?? "worker_endpoint_unavailable";
      await supabase
        .from("deepfake_scans")
        .update({
          status: "failed",
          error_message: formatStartupUserError({
            category,
            detail: dispatchResult.reason,
          }),
        })
        .eq("id", scan.id)
        .eq("user_id", userId);
      throw new Error(
        formatStartupUserError({
          category,
          detail: dispatchResult.reason,
        }),
      );
    }

    logStartupStage("return_scan_id", {
      scan_id: scan.id,
      dispatch_mode: dispatchResult.mode,
    });

    return {
      scan_id: scan.id,
      total_results: 0,
      discovered_results: 0,
      status: "running" as const,
      started: true as const,
      dispatch_mode: dispatchResult.mode,
    };
  });

/**
 * Run one worker batch for an already-created RUNNING scan.
 * Prefer dispatchDeepfakeScanExecution from scan-start; this remains for
 * manual retries and authenticated continuation kicks.
 */
export const executeDeepfakeScanPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid(),
        google_images_url: z.string().trim().max(5000).optional(),
        max_queries: z.number().int().min(40).max(60).optional(),
        per_query_limit: z.number().int().min(10).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await executeDeepfakeScanById({
      supabase: context.supabase,
      scanId: data.scan_id,
      userId: context.userId,
      source: "user",
    });

    return {
      scan_id: result.scan_id,
      total_results: result.total_results,
      discovered_results: result.discovered_results,
      status: result.status,
    };
  });

/**
 * Acquire PARTIAL → RUNNING and dispatch the background worker.
 */
export const continueDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      await recoverExpiredScanLease({ supabase, scanId: data.scan_id });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during continue:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const { data: scan, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("id", data.scan_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!scan) throw new Error("Scan not found.");
    if (scan.status !== "partial") {
      throw new Error("Only partial scans can be continued.");
    }

    const resumeCheckpoint = parseScanCheckpoint(scan.scan_checkpoint);
    if (!resumeCheckpoint) {
      throw new Error("This partial scan does not have a resumable checkpoint.");
    }

    const activeScan = await findActiveScanForIdentity({
      supabase,
      userId,
      profileId: scan.profile_id ?? null,
      targetName: scan.target_name,
    });

    if (activeScan && activeScan.id !== scan.id) {
      return alreadyRunningResult(activeScan.id);
    }

    /*
     * Atomic PARTIAL → RUNNING via SECURITY DEFINER RPC. The DB trigger only
     * allows this transition when the continue GUC is set inside the RPC, so
     * unrestricted client UPDATEs cannot revive partial scans.
     */
    const { data: acquiredRows, error: acquireError } = await supabase.rpc(
      "acquire_deepfake_scan_continuation" as any,
      { p_scan_id: scan.id },
    );

    if (acquireError) {
      throw new Error(
        acquireError.message || "Unable to acquire the scan continuation lease.",
      );
    }

    const acquired = Array.isArray(acquiredRows) ? acquiredRows[0] : acquiredRows;
    const scanRunToken =
      acquired && typeof acquired === "object"
        ? String((acquired as { scan_run_token?: string }).scan_run_token ?? "")
        : "";

    if (!scanRunToken) {
      throw new Error("Unable to acquire the scan continuation lease.");
    }

    const dispatchResult = await dispatchDeepfakeScanExecution(
      scan.id,
      supabase,
      userId,
    );

    if (!dispatchResult.dispatched || dispatchResult.mode === "failed") {
      const category =
        dispatchResult.category ?? "worker_endpoint_unavailable";
      throw new Error(
        formatStartupUserError({
          category,
          detail: dispatchResult.reason,
        }),
      );
    }

    return {
      scan_id: scan.id,
      total_results: scan.total_results ?? 0,
      discovered_results: scan.total_results ?? 0,
      status: "running" as const,
      started: true as const,
      continued: true as const,
      dispatch_mode: dispatchResult.mode,
    };
  });

export const listDeepfakeScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      await recoverExpiredScansForUser({ supabase, userId });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during history load:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const { data, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as ScanRow[];
  });

function objectish(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const getDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await recoverExpiredScanLease({
        supabase: context.supabase,
        scanId: data.scan_id,
      });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during scan load:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const [scanRes, findingsRes, discoveriesRes] = await Promise.all([
      context.supabase
        .from("deepfake_scans")
        .select("*")
        .eq("id", data.scan_id)
        .maybeSingle(),

      context.supabase
        .from("deepfake_findings")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("risk_level", { ascending: true })
        .order("confidence", { ascending: false }),

      (context.supabase as any)
        .from("deepfake_discoveries")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("discovered_at", {
          ascending: false,
        })
        .limit(500),
    ]);

    if (scanRes.error) throw new Error(scanRes.error.message);
    if (findingsRes.error) throw new Error(findingsRes.error.message);
    if (discoveriesRes.error) {
      console.warn(
        "[DEEPFAKE] Unable to load discoveries:",
        discoveriesRes.error.message,
      );
    }

    const scan = scanRes.data as
      | (ScanRow & { profile_id?: string | null })
      | null;

    if (!scan) {
      return {
        scan: null,
        findings: [],
        discoveries: [],
      };
    }

    const target = {
      name: scan.target_name,
      aliases: scan.aliases ?? [],
      handles: scan.handles ?? [],
    };

    const riskRank: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    const allFindings = (findingsRes.data ?? []) as Array<
      FindingRow & {
        finding_classification?: string | null;
        url_verification_status?: string | null;
        final_url?: string | null;
        canonical_url?: string | null;
        discovered_url?: string | null;
        verified_domain?: string | null;
      }
    >;

    const findings = filterClientFindings(
      allFindings,
      target,
      data.scan_id,
    ).sort(
      (a, b) =>
        (riskRank[b.risk_level] ?? 0) - (riskRank[a.risk_level] ?? 0) ||
        b.confidence - a.confidence,
    );

    const discoveries = filterClientDiscoveries(
      (discoveriesRes.data ?? []) as Array<{
        id: string;
        scan_id?: string;
        page_url: string;
        page_title: string | null;
        snippet: string | null;
        source: string;
        source_host: string | null;
        analysis_status?: string | null;
        canonical_url?: string | null;
        image_url?: string | null;
        thumbnail_url?: string | null;
      }>,
      target,
      data.scan_id,
    );

    return {
      scan,
      findings,
      discoveries,
    };
  });

export const updateDeepfakeFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        finding_id: z.string().uuid(),
        review_status: z.enum([
          "new",
          "reviewed",
          "dismissed",
          "queued_takedown",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("deepfake_findings")
      .update({ review_status: data.review_status })
      .eq("id", data.finding_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Prefills target from client_profiles for the signed-in user. */
export const getDeepfakeTargetSuggestion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("client_profiles")
      .select("full_name, display_name, company_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      target_name: (data?.full_name ??
        data?.display_name ??
        data?.company_name ??
        "") as string,
      aliases: [] as string[],
      handles: [] as string[],
    };
  });
