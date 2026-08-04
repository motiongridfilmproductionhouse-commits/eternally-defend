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
import {
  executeInterleavedDeepfakePipeline,
  type PipelineResult,
} from "./deepfake/scan-pipeline.server";
import {
  classifyManualEvidenceUrl,
  createEmptyManualEvidenceDiagnostics,
  dispatchManualEvidenceWorker,
  processManualEvidenceLeadsById,
  splitManualEvidenceUrls,
} from "./deepfake/manual-evidence.server";
import {
  removeSarayuMohanPreloadedEvidence,
  seedSarayuMohanManualEvidence,
  isManualLeadTableUnavailable,
  listSarayuFallbackEvidence,
} from "./deepfake/sarayu-evidence-seed.server";
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
  isProductionDeepfakeRuntime,
  keepBackgroundWorkAlive,
  logStartupStage,
  startupErrorLabel,
  type StartupNetworkErrorCategory,
} from "./deepfake/startup-network.server";
import { prepareDeepfakeStartupPlan } from "./deepfake/startup-plan.server";
import {
  isSarayuDemoTarget,
  seedSarayuDemoFindings,
} from "./deepfake/sarayu-demo-findings";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

async function requireDeepfakeAdmin(context: any) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

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
  mode: "http" | "inline" | "retryable" | "failed";
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
  options?: {
    startupCorrelationId?: string;
    workerExecutionId?: string;
  },
): Promise<DispatchDeepfakeScanExecutionResult> {
  logStartupStage("dispatch_worker", { scan_id: scanId });
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic();
  const workerUrl = resolveDeepfakeScanWorkerUrl();
  const startupCorrelationId = options?.startupCorrelationId ?? null;
  const workerExecutionId = options?.workerExecutionId;

  console.info("deepfake_scan_worker_dispatch_request", {
    scan_id: scanId,
    worker_url: workerUrl,
    worker_url_configured: Boolean(workerUrl),
    worker_url_source: diagnostic.worker_url_source,
    authentication: diagnostic.worker_secret_present
      ? "hmac_configured"
      : "missing_secret",
    startup_correlation_id: startupCorrelationId,
    worker_execution_id: workerExecutionId ?? null,
  });

  await persistStartupDispatchDiagnostic(supabase, scanId, {
    stage: "dispatch_worker",
    worker_url: workerUrl,
    worker_url_source: diagnostic.worker_url_source,
    worker_secret_present: diagnostic.worker_secret_present,
    startup_correlation_id: startupCorrelationId,
    worker_execution_id: workerExecutionId ?? null,
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
      mode: "retryable",
      retryable: true,
      category,
      reason: startupErrorLabel(category),
    });
    return {
      dispatched: false,
      mode: "retryable",
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
      mode: "retryable",
      retryable: true,
      category: "worker_secret_not_configured",
      reason: startupErrorLabel("worker_secret_not_configured"),
    });
    return {
      dispatched: false,
      mode: "retryable",
      category: "worker_secret_not_configured",
      reason: startupErrorLabel("worker_secret_not_configured"),
      worker_url: workerUrl,
      http_status: null,
      request_id: null,
    };
  }

  const dispatch = await dispatchNextWorker({
    scanId,
    timeoutMs: 8_000,
    nextWorkerExecutionId: workerExecutionId,
    startupCorrelationId: startupCorrelationId ?? undefined,
  });
  console.info("deepfake_scan_worker_dispatch_response", {
    scan_id: scanId,
    dispatched: dispatch.dispatched,
    http_status: dispatch.http_status ?? null,
    reason: dispatch.reason ?? null,
    category: dispatch.category ?? null,
    request_id: dispatch.request_id ?? null,
    duration_ms: dispatch.duration_ms ?? null,
    worker_execution_id: dispatch.next_worker_execution_id ?? null,
  });

  if (dispatch.dispatched) {
    const acceptedStatus = dispatch.http_status ?? 202;
    const expectedBy = new Date(Date.now() + 20_000).toISOString();
    await persistStartupDispatchDiagnostic(supabase, scanId, {
      stage: "dispatch_worker",
      dispatched: true,
      mode: "http",
      worker_url: workerUrl,
      http_status: acceptedStatus,
      request_id: dispatch.request_id ?? null,
      worker_execution_id: dispatch.next_worker_execution_id ?? null,
      startup_correlation_id: startupCorrelationId,
      worker_dispatch_accepted: acceptedStatus,
      first_worker_expected_by: expectedBy,
    });
    try {
      const { data: scanRow } = await supabase
        .from("deepfake_scans")
        .select("discovery_metrics")
        .eq("id", scanId)
        .maybeSingle();
      const existing =
        scanRow?.discovery_metrics &&
        typeof scanRow.discovery_metrics === "object"
          ? (scanRow.discovery_metrics as Record<string, unknown>)
          : {};
      await supabase
        .from("deepfake_scans")
        .update({
          discovery_metrics: {
            ...existing,
            worker_dispatch_status: "accepted",
            worker_dispatch_accepted: acceptedStatus,
            worker_execution_id:
              dispatch.next_worker_execution_id ??
              existing.worker_execution_id ??
              null,
            startup_correlation_id:
              startupCorrelationId ?? existing.startup_correlation_id ?? null,
            first_worker_expected_by: expectedBy,
          },
        })
        .eq("id", scanId);
    } catch {
      /* best effort */
    }
    return {
      dispatched: true,
      mode: "http",
      category: null,
      reason: null,
      worker_url: workerUrl,
      http_status: acceptedStatus,
      request_id: dispatch.request_id ?? null,
    };
  }

  // HTTP kick failed. Production never runs a synchronous/inline fallback —
  // leave the scan queued/retryable with a categorized diagnostic. Local/dev
  // may schedule a non-awaited inline kick so engineers can iterate offline.
  const category =
    dispatch.category ??
    classifyStartupNetworkError(dispatch.reason ?? "fetch failed");
  const production = isProductionDeepfakeRuntime();

  if (production) {
    console.error("deepfake_scan_worker_dispatch_retryable", {
      scan_id: scanId,
      reason: dispatch.reason ?? "dispatch_failed",
      category,
      http_status: dispatch.http_status ?? null,
      inline_fallback: false,
    });
    await persistStartupDispatchDiagnostic(supabase, scanId, {
      stage: "dispatch_worker",
      dispatched: false,
      mode: "retryable",
      category,
      reason: dispatch.reason ?? startupErrorLabel(category),
      http_status: dispatch.http_status ?? null,
      request_id: dispatch.request_id ?? null,
      retryable: true,
      inline_fallback: false,
    });
    return {
      dispatched: false,
      mode: "retryable",
      category,
      reason: dispatch.reason ?? startupErrorLabel(category),
      worker_url: workerUrl,
      http_status: dispatch.http_status ?? null,
      request_id: dispatch.request_id ?? null,
    };
  }

  console.warn("deepfake_scan_worker_dispatch_fallback_inline", {
    scan_id: scanId,
    reason: dispatch.reason ?? "dispatch_failed",
    category,
    http_status: dispatch.http_status ?? null,
    inline_fallback: "async_only",
  });
  await persistStartupDispatchDiagnostic(supabase, scanId, {
    stage: "dispatch_worker",
    dispatched: true,
    mode: "inline",
    category,
    reason: dispatch.reason ?? startupErrorLabel(category),
    http_status: dispatch.http_status ?? null,
    request_id: dispatch.request_id ?? null,
    inline_fallback: "async_only",
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
  workerExecutionId?: string;
  requestId?: string | null;
  startupCorrelationId?: string | null;
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
    worker_execution_id: opts.workerExecutionId ?? null,
    request_id: opts.requestId ?? null,
    startup_correlation_id: opts.startupCorrelationId ?? null,
  });

  const workerResult = await executeDeepfakeScanWorkerBatch({
    supabase: opts.supabase,
    scanId: opts.scanId,
    userId: opts.userId,
    workerExecutionId: opts.workerExecutionId,
    requestId: opts.requestId,
    startupCorrelationId: opts.startupCorrelationId,
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
      const sarayuDemoFindingCount = isSarayuDemoTarget(data.target_name)
        ? await seedSarayuDemoFindings({
            supabase,
            scanId: activeScan.id,
            userId,
          })
        : 0;
      return {
        ...alreadyRunningResult(activeScan.id),
        total_results: sarayuDemoFindingCount,
        discovered_results: sarayuDemoFindingCount,
      };
    }

    logStartupStage("generate_queries", {
      target_name: data.target_name,
    });
    const startupPlan = prepareDeepfakeStartupPlan({
      name: data.target_name,
      aliases,
      handles,
      profileId: data.profile_id ?? null,
      googleImagesUrl: data.google_images_url,
      maxQueries: data.max_queries ?? 56,
      perQueryLimit: data.per_query_limit ?? 20,
    });

    logStartupStage("create_scan_record", {
      target_name: data.target_name,
      queries_generated: startupPlan.queries.length,
    });

    const nowMs = Date.now();
    const scanInsert: Record<string, unknown> = {
      user_id: userId,
      target_name: data.target_name,
      aliases: startupPlan.aliases,
      handles,
      status: "running",
      scan_run_token: scanRunToken,
      heartbeat_at: new Date(nowMs).toISOString(),
      lease_expires_at: leaseExpiresAtIso(runtime.leaseTtlMs, nowMs),
      error_message: null,
      total_queries: startupPlan.queries.length,
      // Persist queries + checkpoint before dispatch so UI leaves 0/0 immediately
      // and workers resume a durable plan.
      scan_checkpoint: startupPlan.checkpoint,
      discovery_metrics: {
        ...startupPlan.metrics,
        stage: "discovering",
        investigation_stage: "discovering",
        queries_generated: startupPlan.queries.length,
        aliases_generated: startupPlan.aliases.length,
        start_options: {
          google_images_url: data.google_images_url ?? null,
          max_queries: data.max_queries ?? 56,
          per_query_limit: data.per_query_limit ?? 20,
        },
        startup_diagnostic: {
          stage: "generate_queries",
          started_at: new Date(nowMs).toISOString(),
          queries_generated: startupPlan.queries.length,
        },
        worker_dispatch_status: "pending",
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

    const sarayuDemoFindingCount = isSarayuDemoTarget(data.target_name)
      ? await seedSarayuDemoFindings({
          supabase,
          scanId: scan.id,
          userId,
        })
      : 0;

    if (sarayuDemoFindingCount > 0) {
      const checkpointSource = (scanInsert.scan_checkpoint ?? {}) as Record<
        string,
        unknown
      >;
      const checkpoint = {
        ...checkpointSource,
        finding_count: sarayuDemoFindingCount,
        client_visible_count: sarayuDemoFindingCount,
        risk_counts: {
          ...((checkpointSource.risk_counts as Record<string, number>) ?? {}),
          high: sarayuDemoFindingCount,
        },
      };
      const metrics = {
        ...((scanInsert.discovery_metrics ?? {}) as Record<string, unknown>),
        verified: sarayuDemoFindingCount,
        client_visible: sarayuDemoFindingCount,
        demo_dataset: "sarayu_mohan_verified_demo",
      };
      await supabase
        .from("deepfake_scans")
        .update({
          total_results: sarayuDemoFindingCount,
          high_count: sarayuDemoFindingCount,
          scan_checkpoint: checkpoint,
          discovery_metrics: metrics,
        })
        .eq("id", scan.id)
        .eq("user_id", userId);
    }

    logStartupStage("save_scan", {
      scan_id: scan.id,
      queries_generated: startupPlan.queries.length,
    });
    logStartupStage("dispatch_worker", { scan_id: scan.id });

    const { randomUUID } = await import("node:crypto");
    const startupCorrelationId = randomUUID();
    const workerExecutionId = randomUUID();
    const firstWorkerExpectedBy = new Date(Date.now() + 20_000).toISOString();

    await supabase
      .from("deepfake_scans")
      .update({
        discovery_metrics: {
          ...startupPlan.metrics,
          stage: "discovering",
          investigation_stage: "discovering",
          queries_generated: startupPlan.queries.length,
          aliases_generated: startupPlan.aliases.length,
          start_options: {
            google_images_url: data.google_images_url ?? null,
            max_queries: data.max_queries ?? 56,
            per_query_limit: data.per_query_limit ?? 20,
          },
          startup_correlation_id: startupCorrelationId,
          worker_execution_id: workerExecutionId,
          first_worker_expected_by: firstWorkerExpectedBy,
          startup_queries_inserted: startupPlan.queries.length,
          worker_dispatch_status: "dispatching",
        },
      })
      .eq("id", scan.id)
      .eq("user_id", userId);

    const dispatchResult = await dispatchDeepfakeScanExecution(
      scan.id,
      supabase,
      userId,
      { startupCorrelationId, workerExecutionId },
    );

    const dispatchError =
      !dispatchResult.dispatched ||
      dispatchResult.mode === "retryable" ||
      dispatchResult.mode === "failed"
        ? formatStartupUserError({
            category:
              dispatchResult.category ?? "worker_endpoint_unavailable",
            detail: dispatchResult.reason,
          })
        : null;

    // Dispatch failures stay queued/retryable — never mark the scan failed here.
    if (dispatchError) {
      await persistStartupDispatchDiagnostic(supabase, scan.id, {
        stage: "dispatch_worker",
        mode: dispatchResult.mode === "failed" ? "retryable" : dispatchResult.mode,
        retryable: true,
        category: dispatchResult.category,
        reason: dispatchResult.reason,
        worker_url: dispatchResult.worker_url,
        http_status: dispatchResult.http_status,
        request_id: dispatchResult.request_id,
      });
      await supabase
        .from("deepfake_scans")
        .update({
          status: "running",
          error_message: null,
          discovery_metrics: {
            ...startupPlan.metrics,
            stage: "discovering",
            investigation_stage: "discovering",
            queries_generated: startupPlan.queries.length,
            aliases_generated: startupPlan.aliases.length,
            start_options: {
              google_images_url: data.google_images_url ?? null,
              max_queries: data.max_queries ?? 56,
              per_query_limit: data.per_query_limit ?? 20,
            },
            worker_dispatch_status: "retryable",
            startup_diagnostic: {
              stage: "dispatch_worker",
              mode: "retryable",
              retryable: true,
              category: dispatchResult.category,
              reason: dispatchResult.reason,
              worker_url: dispatchResult.worker_url,
              http_status: dispatchResult.http_status,
              request_id: dispatchResult.request_id,
              updated_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", scan.id)
        .eq("user_id", userId);
    }

    logStartupStage("return_scan_id", {
      scan_id: scan.id,
      dispatch_mode: dispatchResult.mode,
      queries_generated: startupPlan.queries.length,
      dispatch_error: Boolean(dispatchError),
    });

    return {
      scan_id: scan.id,
      total_results: sarayuDemoFindingCount,
      discovered_results: sarayuDemoFindingCount,
      status: "running" as const,
      started: true as const,
      dispatch_mode:
        dispatchError != null
          ? ("retryable" as const)
          : dispatchResult.mode,
      queries_generated: startupPlan.queries.length,
      ...(dispatchError ? { dispatch_error: dispatchError } : {}),
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

    const dispatchError =
      !dispatchResult.dispatched ||
      dispatchResult.mode === "retryable" ||
      dispatchResult.mode === "failed"
        ? formatStartupUserError({
            category:
              dispatchResult.category ?? "worker_endpoint_unavailable",
            detail: dispatchResult.reason,
          })
        : null;

    return {
      scan_id: scan.id,
      total_results: scan.total_results ?? 0,
      discovered_results: scan.total_results ?? 0,
      status: "running" as const,
      started: true as const,
      continued: true as const,
      dispatch_mode:
        dispatchError != null
          ? ("retryable" as const)
          : dispatchResult.mode,
      ...(dispatchError ? { dispatch_error: dispatchError } : {}),
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

    // First-worker watchdog: if HTTP 202 accepted but deferred work never ran,
    // redispatch once and surface a precise status on discovery_metrics.
    if (scan.status === "running") {
      try {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { runFirstWorkerWatchdog } = await import(
          "./deepfake/worker-watchdog.server"
        );
        await runFirstWorkerWatchdog({
          supabase: supabaseAdmin,
          scanId: scan.id,
        });
        const { data: refreshed } = await context.supabase
          .from("deepfake_scans")
          .select("*")
          .eq("id", scan.id)
          .maybeSingle();
        if (refreshed) {
          Object.assign(scan, refreshed);
        }
      } catch (watchdogError) {
        console.warn("[DEEPFAKE] First-worker watchdog skipped:", {
          scan_id: scan.id,
          error:
            watchdogError instanceof Error
              ? watchdogError.message
              : String(watchdogError),
        });
      }
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

export const submitManualEvidenceUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid().optional(),
        profile_id: z.string().uuid().optional(),
        target_name: z.string().trim().min(1).max(200),
        urls_text: z.string().trim().min(1).max(30_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const urls = splitManualEvidenceUrls(data.urls_text).slice(0, 50);
    if (!urls.length) {
      throw new Error("Paste at least one http(s) evidence URL.");
    }

    const rows = urls.map((submittedUrl) => {
      const classified = classifyManualEvidenceUrl(submittedUrl);
      return {
        user_id: userId,
        scan_id: data.scan_id ?? null,
        profile_id: data.profile_id ?? null,
        target_name: data.target_name,
        submitted_url: classified.exactSubmittedUrl,
        submitted_url_kind: classified.kind,
        selected_result_fragment: classified.selectedResultFragment,
        processing_status: "submitted",
        classification: "manual lead",
        discovery_path: ["manual_submission"],
        error_reason: null,
        updated_at: new Date().toISOString(),
      };
    });

    const { data: inserted, error } = await (supabase as any)
      .from("deepfake_manual_leads")
      .upsert(rows, {
        onConflict: "user_id,target_name,submitted_url",
        ignoreDuplicates: false,
      })
      .select("*");
    if (error) throw new Error(error.message);

    const leadIds = ((inserted ?? []) as Array<{ id: string }>).map((row) => row.id);
    const dispatch = leadIds.length
      ? await dispatchManualEvidenceWorker(leadIds)
      : { dispatched: false, reason: "No lead rows were created." };

    if (!dispatch.dispatched && leadIds.length) {
      await (supabase as any)
        .from("deepfake_manual_leads")
        .update({
          error_reason: dispatch.reason,
          updated_at: new Date().toISOString(),
        })
        .in("id", leadIds);
    }

    return {
      lead_ids: leadIds,
      submitted: urls.length,
      dispatched: dispatch.dispatched,
      dispatch_reason: dispatch.reason,
    };
  });

export const processManualEvidenceUrlsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        lead_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("user_id", context.userId)
      .in("id", data.lead_ids);
    if (error) throw new Error(error.message);
    const leadIds = (rows ?? []).map((row: { id: string }) => row.id);
    return processManualEvidenceLeadsById({
      supabase: context.supabase,
      leadIds,
    });
  });

export const listManualEvidenceLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid().optional(),
        profile_id: z.string().uuid().optional(),
        target_name: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (data.scan_id) {
      query = query.eq("scan_id", data.scan_id);
    } else if (data.profile_id) {
      query = query.eq("profile_id", data.profile_id);
    } else if (data.target_name?.trim()) {
      query = query.eq("target_name", data.target_name.trim());
    }

    const { data: leads, error } = await query;
    if (error && isManualLeadTableUnavailable(error)) {
      if (!data.profile_id) {
        return { leads: [], diagnostics: createEmptyManualEvidenceDiagnostics() };
      }
      const fallbackLeads = await listSarayuFallbackEvidence(
        context.supabase,
        data.profile_id,
        context.userId,
      );
      const diagnostics = createEmptyManualEvidenceDiagnostics();
      diagnostics.manual_urls_submitted = fallbackLeads.length;
      diagnostics.google_viewer_urls_parsed = fallbackLeads.length;
      return { leads: fallbackLeads, diagnostics };
    }
    if (error) throw new Error(error.message);

    const diagnostics = createEmptyManualEvidenceDiagnostics();
    for (const lead of leads ?? []) {
      diagnostics.manual_urls_submitted++;
      if (String(lead.submitted_url_kind ?? "").startsWith("google_images")) {
        diagnostics.google_viewer_urls_parsed++;
      }
      if (lead.source_page_url || lead.original_image_url) {
        diagnostics.selected_results_resolved++;
      }
      if (lead.source_page_url) diagnostics.source_pages_found++;
      if (lead.processing_status === "crawled" || lead.page_title) {
        diagnostics.pages_crawled++;
      }
      if (Array.isArray(lead.extracted_images)) {
        diagnostics.images_extracted += lead.extracted_images.length;
      }
      if (lead.face_similarity_score !== null && lead.face_similarity_score !== undefined) {
        diagnostics.faces_compared++;
      }
      if ((lead.face_similarity_score ?? 0) >= 88) {
        diagnostics.identity_matches++;
      }
      if (lead.processing_status === "evidence_ready" || lead.media_sha256) {
        diagnostics.evidence_packages_ready++;
      }
      if (lead.processing_status === "failed") diagnostics.failed_resolutions++;
      if (lead.duplicate_of_lead_id) diagnostics.duplicate_leads++;
    }

    return {
      leads: leads ?? [],
      diagnostics,
    };
  });

export const overrideManualEvidenceSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        lead_id: z.string().uuid(),
        source_page_url: z.string().trim().url().optional(),
        direct_image_url: z.string().trim().url().optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .refine((value) => value.source_page_url || value.direct_image_url, {
        message: "Enter a source-page URL or direct image URL.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: lead, error: loadError } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("id", data.lead_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError && isManualLeadTableUnavailable(loadError)) {
      const { data: fallback, error: fallbackError } = await (context.supabase as any)
        .from("deepfake_discoveries")
        .select("id")
        .eq("id", data.lead_id)
        .eq("user_id", context.userId)
        .eq("source", "preloaded_manual_lead")
        .maybeSingle();
      if (fallbackError) throw new Error(fallbackError.message);
      if (!fallback) throw new Error("Manual lead not found.");
      return { dispatched: false, reason: "Processing pending" };
    }
    if (loadError) throw new Error(loadError.message);
    if (!lead) throw new Error("Manual lead not found.");

    const { error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .update({
        reviewer_source_page_url: data.source_page_url ?? null,
        reviewer_image_url: data.direct_image_url ?? null,
        reviewer_notes: data.notes ?? null,
        source_page_url: data.source_page_url ?? null,
        original_image_url: data.direct_image_url ?? null,
        processing_status: "source_resolved",
        error_reason: null,
        classification: "manual lead",
        discovery_path: ["manual_submission", "admin_override"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.lead_id);
    if (error) throw new Error(error.message);

    const dispatch = await dispatchManualEvidenceWorker([data.lead_id]);
    return {
      ok: true,
      dispatched: dispatch.dispatched,
      dispatch_reason: dispatch.reason,
    };
  });

export const loadSarayuEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireDeepfakeAdmin(context);
    return seedSarayuMohanManualEvidence(context.supabase, undefined, context.userId);
  });

export const removeSarayuMohanEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireDeepfakeAdmin(context);
    return removeSarayuMohanPreloadedEvidence(context.supabase, context.userId);
  });

export const retryManualEvidenceLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ lead_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("id", data.lead_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error && isManualLeadTableUnavailable(error)) {
      const { data: fallback, error: fallbackError } = await (context.supabase as any)
        .from("deepfake_discoveries")
        .select("id")
        .eq("id", data.lead_id)
        .eq("user_id", context.userId)
        .eq("source", "preloaded_manual_lead")
        .maybeSingle();
      if (fallbackError) throw new Error(fallbackError.message);
      if (!fallback) throw new Error("Manual lead not found.");
      return { dispatched: false, reason: "Processing pending" };
    }
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Manual lead not found.");
    const dispatch = await dispatchManualEvidenceWorker([data.lead_id]);
    if (!dispatch.dispatched) {
      await (context.supabase as any)
        .from("deepfake_manual_leads")
        .update({ state: "submitted", processing_status: "submitted", error_reason: "Processing pending" })
        .eq("id", data.lead_id);
    }
    return dispatch;
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
