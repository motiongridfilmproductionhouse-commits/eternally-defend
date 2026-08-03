/**
 * Per-batch orchestration for Deepfake Intelligence main-scan workers.
 */

import { checkpointHasPendingWork, type ScanCheckpoint } from "./scan-checkpoint.server";
import {
  touchScanProgress,
  type DiscoveryFunnelMetrics,
  type ScanOwnership,
} from "./scan-ownership.server";
import {
  dispatchNextWorker,
  type DeepfakeScanWorkerDispatchResult,
} from "./scan-worker-dispatch.server";
import {
  logDeepfakeScanWorkerEvent,
  type DeepfakeScanWorkerTelemetry,
} from "./scan-worker-telemetry.server";

export type WorkerBatchState = {
  scanId: string;
  workerExecutionId: string;
  batchNumber: number;
  claimedQueryIds: string[];
  leaseOwner: string;
  leaseAcquiredAt: string;
  leaseExpiry: string | null;
  batchStartedAt: string;
  supabase: any;
  ownership: ScanOwnership;
  checkpoint: ScanCheckpoint;
  metrics: DiscoveryFunnelMetrics;
  clientVisibleCount: number;
  riskCounts: ScanCheckpoint["risk_counts"];
};

function pendingQueryCount(checkpoint: ScanCheckpoint): number {
  return Math.max(0, checkpoint.queries.length - checkpoint.next_query_index);
}

export async function persistBatchProgress(
  state: WorkerBatchState,
): Promise<{ lastProgressTimestamp: string }> {
  state.checkpoint.pending_work = checkpointHasPendingWork(state.checkpoint);
  state.checkpoint.last_checkpoint_at = new Date().toISOString();

  await touchScanProgress({
    supabase: state.supabase,
    ownership: state.ownership,
    patch: {
      scan_checkpoint: state.checkpoint,
      discovery_metrics: {
        ...state.metrics,
        worker_execution_id: state.workerExecutionId,
        worker_batch_number: state.batchNumber,
        worker_last_batch_at: state.checkpoint.last_checkpoint_at,
      },
      total_queries: state.checkpoint.queries.length,
      total_results: state.clientVisibleCount,
      critical_count: state.riskCounts.critical,
      high_count: state.riskCounts.high,
      medium_count: state.riskCounts.medium,
      low_count: state.riskCounts.low,
    },
  });

  const lastProgressTimestamp = new Date().toISOString();
  logDeepfakeScanWorkerEvent({
    event: "deepfake_scan_worker_batch_progress_persisted",
    scan_id: state.scanId,
    worker_execution_id: state.workerExecutionId,
    batch_number: state.batchNumber,
    query_ids_claimed: state.claimedQueryIds,
    lease_owner: state.leaseOwner,
    lease_acquired_at: state.leaseAcquiredAt,
    lease_expiry: state.leaseExpiry,
    batch_start_time: state.batchStartedAt,
    pending_query_count: pendingQueryCount(state.checkpoint),
    last_progress_timestamp: lastProgressTimestamp,
  });

  return { lastProgressTimestamp };
}

export async function releaseCompletedQueryLeases(
  state: WorkerBatchState,
): Promise<void> {
  for (const queryId of state.claimedQueryIds) {
    const normalized = queryId.trim().toLowerCase();
    if (!state.checkpoint.completed_query_ids.includes(normalized)) {
      state.checkpoint.completed_query_ids.push(normalized);
    }
  }

  logDeepfakeScanWorkerEvent({
    event: "deepfake_scan_worker_query_leases_released",
    scan_id: state.scanId,
    worker_execution_id: state.workerExecutionId,
    batch_number: state.batchNumber,
    query_ids_claimed: state.claimedQueryIds,
    lease_owner: state.leaseOwner,
    lease_acquired_at: state.leaseAcquiredAt,
    lease_expiry: state.leaseExpiry,
    batch_start_time: state.batchStartedAt,
    pending_query_count: pendingQueryCount(state.checkpoint),
    last_progress_timestamp: state.checkpoint.last_checkpoint_at,
  });
}

export async function markContinuationScheduled(
  state: WorkerBatchState,
  nextWorkerExecutionId: string,
): Promise<void> {
  const scheduledAt = new Date().toISOString();
  await touchScanProgress({
    supabase: state.supabase,
    ownership: state.ownership,
    patch: {
      discovery_metrics: {
        ...state.metrics,
        continuation_scheduled_at: scheduledAt,
        continuation_worker_execution_id: nextWorkerExecutionId,
        worker_execution_id: state.workerExecutionId,
        worker_batch_number: state.batchNumber,
      },
    },
  });

  logDeepfakeScanWorkerEvent({
    event: "deepfake_scan_worker_continuation_scheduled",
    scan_id: state.scanId,
    worker_execution_id: state.workerExecutionId,
    batch_number: state.batchNumber,
    query_ids_claimed: state.claimedQueryIds,
    lease_owner: state.leaseOwner,
    lease_acquired_at: state.leaseAcquiredAt,
    lease_expiry: state.leaseExpiry,
    batch_start_time: state.batchStartedAt,
    next_worker_execution_id: nextWorkerExecutionId,
    pending_query_count: pendingQueryCount(state.checkpoint),
    last_progress_timestamp: scheduledAt,
  });
}

export async function finalizeWorkerBatchContinuation(input: {
  state: WorkerBatchState;
  nextWorkerExecutionId: string;
}): Promise<DeepfakeScanWorkerDispatchResult> {
  const batchCompletionTime = new Date().toISOString();

  await persistBatchProgress(input.state);
  await releaseCompletedQueryLeases(input.state);
  await markContinuationScheduled(input.state, input.nextWorkerExecutionId);

  const dispatch = await dispatchNextWorker({
    scanId: input.state.scanId,
    nextWorkerExecutionId: input.nextWorkerExecutionId,
  });

  const telemetry: DeepfakeScanWorkerTelemetry = {
    event: "deepfake_scan_worker_continuation_dispatch",
    scan_id: input.state.scanId,
    worker_execution_id: input.state.workerExecutionId,
    batch_number: input.state.batchNumber,
    query_ids_claimed: input.state.claimedQueryIds,
    lease_owner: input.state.leaseOwner,
    lease_acquired_at: input.state.leaseAcquiredAt,
    lease_expiry: input.state.leaseExpiry,
    batch_start_time: input.state.batchStartedAt,
    batch_completion_time: batchCompletionTime,
    continuation_dispatch_attempt: true,
    continuation_dispatch_http_status: dispatch.http_status ?? null,
    continuation_dispatch_response_body: dispatch.response_body ?? null,
    next_worker_execution_id: input.nextWorkerExecutionId,
    pending_query_count: pendingQueryCount(input.state.checkpoint),
    last_progress_timestamp: input.state.checkpoint.last_checkpoint_at,
    dispatched: dispatch.dispatched,
    dispatch_reason: dispatch.reason ?? null,
  };
  logDeepfakeScanWorkerEvent(telemetry);

  return dispatch;
}
