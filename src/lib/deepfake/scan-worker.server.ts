/**
 * Background worker for the main Deepfake Intelligence scan pipeline.
 * Processes a bounded number of query batches per invocation, persists
 * checkpoint progress, and dispatches continuation workers when needed.
 */

import { randomUUID } from "node:crypto";
import {
  SCAN_DEADLINE_BUFFER_MS,
  ScanCheckpointPauseError,
  createScanRuntime,
  isAbortError,
  isDeadlineOrTimeoutError,
} from "./scan-runtime.server";
import {
  checkpointHasPendingWork,
  parseScanCheckpoint,
  type ScanCheckpoint,
} from "./scan-checkpoint.server";
import {
  createDiscoveryFunnelMetrics,
  type ScanOwnership,
} from "./scan-ownership.server";
import {
  executeInterleavedDeepfakePipeline,
  type PipelineResult,
} from "./scan-pipeline.server";
import { finalizeWorkerBatchContinuation } from "./scan-worker-orchestration.server";
import { logDeepfakeScanWorkerEvent } from "./scan-worker-telemetry.server";
import {
  CONTINUATION_HANDOFF_LEASE_TTL_MS,
  WORKER_LEASE_TTL_MS,
  renewScanLease,
  startWorkerHeartbeatLoop,
} from "./scan-lease.server";
import { dispatchNextWorker } from "./scan-worker-dispatch.server";
import { persistDeepfakeWorkerEvent } from "./worker-events.server";
import { runDeepfakeWorkerSchemaPreflight } from "./worker-schema-preflight.server";

export const DEEPFAKE_SCAN_WORKER_BUDGET_MS = 35_000;
export const DEEPFAKE_SCAN_WORKER_MAX_QUERY_BATCHES = 2;

export type DeepfakeScanWorkerResult = {
  scan_id: string;
  worker_execution_id: string;
  status: "running" | "completed" | "partial" | "failed";
  query_batches_processed: number;
  pending_work: boolean;
  dispatched_next: boolean;
  terminal_reason?: string | null;
};

function objectish(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function executeDeepfakeScanWorkerBatch(input: {
  supabase: any;
  scanId: string;
  userId?: string;
  workerExecutionId?: string;
  requestId?: string | null;
  startupCorrelationId?: string | null;
  budgetMs?: number;
  maxQueryBatches?: number;
  finalize?: (args: {
    supabase: any;
    ownership: ScanOwnership;
    runtime: ReturnType<typeof createScanRuntime>;
    pipelineResult: PipelineResult | null;
    pipelineError: unknown;
    fallbackCheckpoint?: ScanCheckpoint | null;
  }) => Promise<{
    terminalStatus: "completed" | "partial" | "failed";
    terminalReason: string | null;
  }>;
}): Promise<DeepfakeScanWorkerResult> {
  const workerExecutionId = input.workerExecutionId ?? randomUUID();
  const requestId = input.requestId ?? null;
  const budgetMs = input.budgetMs ?? DEEPFAKE_SCAN_WORKER_BUDGET_MS;
  const maxQueryBatches =
    input.maxQueryBatches ?? DEEPFAKE_SCAN_WORKER_MAX_QUERY_BATCHES;
  const batchStartedAt = new Date().toISOString();
  let batchNumber = 0;
  const claimedQueryIds: string[] = [];

  // First line of deferred work — proves waitUntil actually ran.
  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: input.scanId,
    workerExecutionId,
    requestId,
    eventName: "worker_execution_started",
    metadata: {
      startup_correlation_id: input.startupCorrelationId ?? null,
      database_client_type: "service_role",
      source_scan_id: input.scanId,
    },
  });
  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: input.scanId,
    workerExecutionId,
    requestId,
    eventName: "database_client_type",
    metadata: { database_client_type: "service_role" },
  });

  const schema = await runDeepfakeWorkerSchemaPreflight({
    supabase: input.supabase,
  });
  if (!schema.ok) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: input.scanId,
      workerExecutionId,
      requestId,
      eventName: "database_schema_incomplete",
      errorCategory: "database_schema_incomplete",
      errorMessage: schema.missing.join("; "),
      metadata: { details: schema.details },
    });
    try {
      await input.supabase
        .from("deepfake_scans")
        .update({
          status: "failed",
          error_message:
            "Worker cannot start — required database schema is incomplete. Open diagnostics.",
          discovery_metrics: {
            worker_execution_status: "database_schema_incomplete",
            schema_preflight: schema,
          },
        })
        .eq("id", input.scanId);
    } catch {
      /* best effort */
    }
    throw new Error(
      `database_schema_incomplete: ${schema.missing.join("; ")}`,
    );
  }

  let query = input.supabase
    .from("deepfake_scans")
    .select("*")
    .eq("id", input.scanId);
  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }
  const { data: scan, error: scanError } = await query.maybeSingle();

  if (scanError || !scan) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: input.scanId,
      workerExecutionId,
      requestId,
      eventName: "worker_execution_failed",
      errorCategory: "scan_id_mismatch",
      errorMessage: scanError?.message ?? "Scan not found for worker",
    });
    throw new Error(scanError?.message ?? "Scan not found for worker");
  }

  if (scan.id !== input.scanId) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: input.scanId,
      workerExecutionId,
      requestId,
      eventName: "scan_id_mismatch",
      errorCategory: "scan_id_mismatch",
      errorMessage: `startup scan_id ${input.scanId} != loaded ${scan.id}`,
      metadata: {
        startup_scan_id: input.scanId,
        loaded_scan_id: scan.id,
      },
    });
    throw new Error("Scan ID mismatch between dispatch and worker load");
  }

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: scan.id,
    workerExecutionId,
    requestId,
    eventName: "scan_loaded",
    metadata: {
      status: scan.status,
      startup_correlation_id: input.startupCorrelationId ?? null,
    },
  });

  if (scan.status !== "running") {
    return {
      scan_id: input.scanId,
      worker_execution_id: workerExecutionId,
      status: scan.status,
      query_batches_processed: 0,
      pending_work: false,
      dispatched_next: false,
    };
  }

  const scanRunToken = (scan as { scan_run_token?: string | null }).scan_run_token;
  if (!scanRunToken) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: scan.id,
      workerExecutionId,
      requestId,
      eventName: "worker_execution_failed",
      errorCategory: "lease_not_available",
      errorMessage:
        "Scan ownership token is missing — cannot run worker without lease.",
    });
    throw new Error(
      "Scan ownership token is missing — cannot run worker without lease.",
    );
  }

  const runtime = createScanRuntime({
    hardTimeoutMs: budgetMs + SCAN_DEADLINE_BUFFER_MS + 5_000,
    leaseTtlMs: WORKER_LEASE_TTL_MS,
  });
  const ownership: ScanOwnership = {
    scanId: scan.id,
    scanRunToken,
    runtime,
  };

  const metrics = objectish(scan.discovery_metrics);
  const startOptions = objectish(metrics?.start_options);
  const resumeCheckpoint = parseScanCheckpoint(scan.scan_checkpoint);
  const queryRowsCounted = resumeCheckpoint?.queries.length ?? 0;
  const pendingBefore = resumeCheckpoint
    ? Math.max(
        0,
        resumeCheckpoint.queries.length - resumeCheckpoint.next_query_index,
      )
    : 0;

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: scan.id,
    workerExecutionId,
    requestId,
    eventName: "query_rows_counted",
    metadata: {
      query_rows_counted: queryRowsCounted,
      pending_before: pendingBefore,
      next_query_index: resumeCheckpoint?.next_query_index ?? null,
    },
  });

  let stopHeartbeat = () => {};
  let activeLeaseExpiry =
    typeof scan.lease_expires_at === "string" ? scan.lease_expires_at : null;

  try {
    const renewed = await renewScanLease({
      supabase: input.supabase,
      ownership,
      leaseTtlMs: WORKER_LEASE_TTL_MS,
      patch: {
        discovery_metrics: {
          ...(metrics ?? {}),
          worker_execution_id: workerExecutionId,
          worker_batch_started_at: batchStartedAt,
          worker_execution_status: "started",
        },
      },
    });
    activeLeaseExpiry = renewed.lease_expires_at;
    stopHeartbeat = startWorkerHeartbeatLoop({
      supabase: input.supabase,
      ownership,
      leaseTtlMs: WORKER_LEASE_TTL_MS,
    });
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: scan.id,
      workerExecutionId,
      requestId,
      eventName: "scan_lease_claimed",
      metadata: { lease_expires_at: activeLeaseExpiry },
    });
  } catch (renewError) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: scan.id,
      workerExecutionId,
      requestId,
      eventName: "worker_execution_failed",
      errorCategory: "lease_not_available",
      errorMessage:
        renewError instanceof Error ? renewError.message : String(renewError),
    });
    console.warn("[DEEPFAKE] Worker lease renewal at start failed:", {
      scan_id: scan.id,
      worker_execution_id: workerExecutionId,
      error:
        renewError instanceof Error ? renewError.message : String(renewError),
    });
  }

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: scan.id,
    workerExecutionId,
    requestId,
    eventName: "query_claim_started",
    metadata: {
      pending_before: pendingBefore,
      requested_batch_size: 5,
    },
  });

  const existingBatchNumber =
    typeof metrics?.worker_batch_number === "number"
      ? metrics.worker_batch_number
      : 0;
  batchNumber = existingBatchNumber;

  logDeepfakeScanWorkerEvent({
    event: "deepfake_scan_worker_batch_start",
    scan_id: scan.id,
    worker_execution_id: workerExecutionId,
    batch_number: batchNumber + 1,
    query_ids_claimed: [],
    lease_owner: workerExecutionId,
    lease_acquired_at: batchStartedAt,
    lease_expiry: activeLeaseExpiry,
    batch_start_time: batchStartedAt,
    pending_query_count: resumeCheckpoint
      ? Math.max(
          0,
          resumeCheckpoint.queries.length - resumeCheckpoint.next_query_index,
        )
      : undefined,
    last_progress_timestamp:
      typeof scan.heartbeat_at === "string" ? scan.heartbeat_at : null,
  });

  let pipelineResult: PipelineResult | null = null;
  let pipelineError: unknown = null;
  let firstQueryStarted = false;

  try {
    if (pendingBefore > 0) {
      await persistDeepfakeWorkerEvent({
        supabase: input.supabase,
        scanId: scan.id,
        workerExecutionId,
        requestId,
        eventName: "first_query_started",
        metadata: {
          query:
            resumeCheckpoint?.queries[resumeCheckpoint.next_query_index] ??
            null,
          next_query_index: resumeCheckpoint?.next_query_index ?? 0,
        },
      });
      firstQueryStarted = true;
    }

    pipelineResult = await executeInterleavedDeepfakePipeline({
      supabase: input.supabase,
      userId: input.userId ?? scan.user_id,
      ownership,
      scanId: scan.id,
      target: {
        name: scan.target_name,
        aliases: scan.aliases ?? [],
        handles: scan.handles ?? [],
      },
      profileId: scan.profile_id ?? null,
      googleImagesUrl:
        typeof startOptions?.google_images_url === "string"
          ? startOptions.google_images_url
          : undefined,
      maxQueries:
        typeof startOptions?.max_queries === "number"
          ? startOptions.max_queries
          : 56,
      perQueryLimit:
        typeof startOptions?.per_query_limit === "number"
          ? startOptions.per_query_limit
          : 20,
      runtime,
      resumeCheckpoint: resumeCheckpoint ?? undefined,
      workerLimits: {
        maxQueryBatches,
        onBatchProcessed: (info) => {
          batchNumber = info.batchNumber;
          claimedQueryIds.push(...info.queryIds);
        },
      },
    });
  } catch (error) {
    pipelineError = error;
    if (!(error instanceof ScanCheckpointPauseError)) {
      console.warn("[DEEPFAKE] Scan worker batch stopped:", {
        scan_id: scan.id,
        worker_execution_id: workerExecutionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    stopHeartbeat();
  }

  const checkpoint =
    pipelineResult?.checkpoint ??
    ((pipelineError as { checkpoint?: ScanCheckpoint } | null)?.checkpoint ??
      resumeCheckpoint);

  // Checkpoint model: "claim" = advancing next_query_index / batch callbacks.
  const indexBefore = resumeCheckpoint?.next_query_index ?? 0;
  const indexAfter = checkpoint?.next_query_index ?? indexBefore;
  const checkpointClaimed = Math.max(0, indexAfter - indexBefore);
  const claimedCount = Math.max(claimedQueryIds.length, checkpointClaimed);
  const claimDiagnostics = {
    scan_id: scan.id,
    pending_before: pendingBefore,
    requested_batch_size: 5,
    claimed_count: claimedCount,
    claimed_query_ids: claimedQueryIds.slice(0, 20),
    next_query_index_before: indexBefore,
    next_query_index_after: indexAfter,
    rpc_error_code: null as string | null,
    rpc_error_message: null as string | null,
    claim_model: "checkpoint_next_query_index",
    database_client_type: "service_role",
  };

  let claimFailureCategory: string | null = null;
  if (pendingBefore > 0 && claimedCount === 0) {
    if (!resumeCheckpoint) claimFailureCategory = "query_status_mismatch";
    else if (!scanRunToken) claimFailureCategory = "lease_not_available";
    else if (pipelineError) {
      const msg =
        pipelineError instanceof Error
          ? pipelineError.message
          : String(pipelineError);
      if (/row.level.security|permission|rls|42501/i.test(msg)) {
        claimFailureCategory = "RLS_denied";
      } else if (/could not find the function|does not exist|pgrst202/i.test(msg)) {
        claimFailureCategory = "claim_rpc_missing";
      } else {
        claimFailureCategory = "worker_started_but_query_claim_failed";
      }
      claimDiagnostics.rpc_error_message = msg.slice(0, 500);
    } else {
      claimFailureCategory = "worker_started_but_query_claim_failed";
    }
  }

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: scan.id,
    workerExecutionId,
    requestId,
    eventName: "query_claim_completed",
    errorCategory: claimFailureCategory,
    errorMessage: claimFailureCategory
      ? `claimed_count=0 with pending_before=${pendingBefore}`
      : null,
    metadata: claimDiagnostics,
  });

  if (claimFailureCategory) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: scan.id,
      workerExecutionId,
      requestId,
      eventName: "worker_started_but_query_claim_failed",
      errorCategory: claimFailureCategory,
      errorMessage: `claimed_count=0 pending_before=${pendingBefore}`,
      metadata: claimDiagnostics,
    });
    try {
      const { data: latest } = await input.supabase
        .from("deepfake_scans")
        .select("discovery_metrics")
        .eq("id", scan.id)
        .maybeSingle();
      const latestMetrics =
        latest?.discovery_metrics && typeof latest.discovery_metrics === "object"
          ? (latest.discovery_metrics as Record<string, unknown>)
          : (metrics ?? {});
      await input.supabase
        .from("deepfake_scans")
        .update({
          discovery_metrics: {
            ...latestMetrics,
            worker_execution_status: "worker_started_but_query_claim_failed",
            claim_diagnostics: claimDiagnostics,
          },
        })
        .eq("id", scan.id);
    } catch {
      /* best effort */
    }
  } else if (claimedCount > 0) {
    try {
      const { data: latest } = await input.supabase
        .from("deepfake_scans")
        .select("discovery_metrics")
        .eq("id", scan.id)
        .maybeSingle();
      const latestMetrics =
        latest?.discovery_metrics && typeof latest.discovery_metrics === "object"
          ? (latest.discovery_metrics as Record<string, unknown>)
          : (metrics ?? {});
      await input.supabase
        .from("deepfake_scans")
        .update({
          discovery_metrics: {
            ...latestMetrics,
            worker_execution_status: "progressing",
            worker_execution_id: workerExecutionId,
          },
        })
        .eq("id", scan.id);
    } catch {
      /* best effort */
    }
  }

  if (firstQueryStarted && claimedCount > 0) {
    await persistDeepfakeWorkerEvent({
      supabase: input.supabase,
      scanId: scan.id,
      workerExecutionId,
      requestId,
      eventName: "first_query_completed",
      metadata: {
        claimed_count: claimedCount,
        claimed_query_ids: claimedQueryIds.slice(0, 5),
      },
    });
  }
  const pendingWork = checkpoint ? checkpointHasPendingWork(checkpoint) : false;
  const queryBatchesProcessed = pipelineResult?.queryBatchesProcessed ?? 0;

  if (
    pipelineResult?.completed &&
    !pipelineError &&
    !pendingWork
  ) {
    if (!input.finalize) {
      throw new Error("Worker finalize handler is required to complete scans.");
    }
    const finalized = await input.finalize({
      supabase: input.supabase,
      ownership,
      runtime,
      pipelineResult,
      pipelineError: null,
      fallbackCheckpoint: resumeCheckpoint,
    });
    logDeepfakeScanWorkerEvent({
      event: "deepfake_scan_worker_batch_complete_terminal",
      scan_id: scan.id,
      worker_execution_id: workerExecutionId,
      batch_number: batchNumber,
      query_ids_claimed: claimedQueryIds,
      lease_owner: workerExecutionId,
      lease_acquired_at: batchStartedAt,
      lease_expiry: null,
      batch_start_time: batchStartedAt,
      batch_completion_time: new Date().toISOString(),
      pending_query_count: 0,
      last_progress_timestamp: new Date().toISOString(),
      terminal_status: finalized.terminalStatus,
    });
    return {
      scan_id: scan.id,
      worker_execution_id: workerExecutionId,
      status: finalized.terminalStatus,
      query_batches_processed: queryBatchesProcessed,
      pending_work: false,
      dispatched_next: false,
      terminal_reason: finalized.terminalReason,
    };
  }

  if (pendingWork && checkpoint) {
    const nextWorkerExecutionId = randomUUID();
    const dispatch = await finalizeWorkerBatchContinuation({
      state: {
        scanId: scan.id,
        workerExecutionId,
        batchNumber,
        claimedQueryIds,
        leaseOwner: workerExecutionId,
        leaseAcquiredAt: batchStartedAt,
        leaseExpiry: activeLeaseExpiry,
        batchStartedAt,
        supabase: input.supabase,
        ownership,
        checkpoint,
        metrics: {
          ...createDiscoveryFunnelMetrics(),
          ...(pipelineResult?.metrics ?? checkpoint.metrics ?? {}),
        },
        clientVisibleCount:
          pipelineResult?.clientVisibleCount ??
          checkpoint.client_visible_count ??
          0,
        riskCounts:
          pipelineResult?.riskCounts ??
          checkpoint.risk_counts ?? {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
          },
      },
      nextWorkerExecutionId,
    });

    return {
      scan_id: scan.id,
      worker_execution_id: workerExecutionId,
      status: "running",
      query_batches_processed: queryBatchesProcessed,
      pending_work: true,
      dispatched_next: dispatch.dispatched,
    };
  }

  if (pipelineError && input.finalize) {
    const abortedByDeadline =
      isDeadlineOrTimeoutError(pipelineError) ||
      isAbortError(pipelineError) ||
      pipelineError instanceof ScanCheckpointPauseError;
    if (!abortedByDeadline) {
      const finalized = await input.finalize({
        supabase: input.supabase,
        ownership,
        runtime,
        pipelineResult,
        pipelineError,
        fallbackCheckpoint: checkpoint ?? resumeCheckpoint,
      });
      return {
        scan_id: scan.id,
        worker_execution_id: workerExecutionId,
        status: finalized.terminalStatus,
        query_batches_processed: queryBatchesProcessed,
        pending_work: false,
        dispatched_next: false,
        terminal_reason: finalized.terminalReason,
      };
    }
  }

  if (pendingWork) {
    const fallbackDispatch = await dispatchNextWorker({
      scanId: scan.id,
    });
    return {
      scan_id: scan.id,
      worker_execution_id: workerExecutionId,
      status: "running",
      query_batches_processed: queryBatchesProcessed,
      pending_work: true,
      dispatched_next: fallbackDispatch.dispatched,
    };
  }

  return {
    scan_id: scan.id,
    worker_execution_id: workerExecutionId,
    status: "running",
    query_batches_processed: queryBatchesProcessed,
    pending_work: false,
    dispatched_next: false,
  };
}
