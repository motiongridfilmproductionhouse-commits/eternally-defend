/**
 * Worker-safe entry point for executing an existing deepfake scan row.
 * Delegates to the batch worker so hook + inline callers share one path.
 */

import { executeDeepfakeScanWorkerBatch } from "./scan-worker.server";

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
  });

  const workerResult = await executeDeepfakeScanWorkerBatch({
    supabase: opts.supabase,
    scanId: opts.scanId,
    userId: opts.userId,
    workerExecutionId: opts.workerExecutionId,
    requestId: opts.requestId ?? null,
    startupCorrelationId: opts.startupCorrelationId ?? null,
  });

  let query = opts.supabase
    .from("deepfake_scans")
    .select("total_results, status")
    .eq("id", opts.scanId);
  if (opts.userId) query = query.eq("user_id", opts.userId);
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
