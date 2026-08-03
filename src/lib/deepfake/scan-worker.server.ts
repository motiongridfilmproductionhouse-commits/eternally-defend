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
import { dispatchNextWorker } from "./scan-worker-dispatch.server";

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
  const budgetMs = input.budgetMs ?? DEEPFAKE_SCAN_WORKER_BUDGET_MS;
  const maxQueryBatches =
    input.maxQueryBatches ?? DEEPFAKE_SCAN_WORKER_MAX_QUERY_BATCHES;
  const batchStartedAt = new Date().toISOString();
  let batchNumber = 0;
  const claimedQueryIds: string[] = [];

  let query = input.supabase
    .from("deepfake_scans")
    .select("*")
    .eq("id", input.scanId);
  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }
  const { data: scan, error: scanError } = await query.maybeSingle();

  if (scanError || !scan) {
    throw new Error(scanError?.message ?? "Scan not found for worker");
  }

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
    throw new Error(
      "Scan ownership token is missing — cannot run worker without lease.",
    );
  }

  const runtime = createScanRuntime({
    hardTimeoutMs: budgetMs + SCAN_DEADLINE_BUFFER_MS + 5_000,
  });
  const ownership: ScanOwnership = {
    scanId: scan.id,
    scanRunToken,
    runtime,
  };

  const metrics = objectish(scan.discovery_metrics);
  const startOptions = objectish(metrics?.start_options);
  const resumeCheckpoint = parseScanCheckpoint(scan.scan_checkpoint);
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
    lease_expiry:
      typeof scan.lease_expires_at === "string" ? scan.lease_expires_at : null,
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

  try {
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
  }

  const checkpoint =
    pipelineResult?.checkpoint ??
    ((pipelineError as { checkpoint?: ScanCheckpoint } | null)?.checkpoint ??
      resumeCheckpoint);
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
        leaseExpiry:
          typeof scan.lease_expires_at === "string"
            ? scan.lease_expires_at
            : null,
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
