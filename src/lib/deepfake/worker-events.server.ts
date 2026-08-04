/**
 * Durable Deepfake worker execution events.
 * Used to distinguish hook-accepted-but-never-ran from claim/schema failures.
 */

export type DeepfakeWorkerEventName =
  | "worker_hook_received"
  | "worker_signature_validated"
  | "worker_payload_validated"
  | "wait_until_registered"
  | "worker_execution_started"
  | "scan_loaded"
  | "query_rows_counted"
  | "scan_lease_claimed"
  | "query_claim_started"
  | "query_claim_completed"
  | "first_query_started"
  | "first_query_completed"
  | "worker_execution_failed"
  | "database_schema_incomplete"
  | "scan_id_mismatch"
  | "accepted_but_not_started"
  | "worker_started_but_query_claim_failed"
  | "watchdog_redispatch"
  | "database_client_type";

export type DeepfakeWorkerEventInput = {
  supabase: any;
  scanId: string;
  workerExecutionId: string;
  requestId?: string | null;
  eventName: DeepfakeWorkerEventName;
  metadata?: Record<string, unknown>;
  errorCategory?: string | null;
  errorMessage?: string | null;
};

export async function persistDeepfakeWorkerEvent(
  input: DeepfakeWorkerEventInput,
): Promise<void> {
  const row = {
    scan_id: input.scanId,
    worker_execution_id: input.workerExecutionId,
    request_id: input.requestId ?? null,
    event_name: input.eventName,
    metadata: input.metadata ?? {},
    error_category: input.errorCategory ?? null,
    error_message: input.errorMessage
      ? String(input.errorMessage).slice(0, 2_000)
      : null,
  };

  console.info("deepfake_worker_event", {
    ...row,
    timestamp: new Date().toISOString(),
  });

  try {
    const { error } = await input.supabase
      .from("deepfake_worker_events")
      .insert(row);
    if (error) {
      console.error("deepfake_worker_event_persist_failed", {
        scan_id: input.scanId,
        event_name: input.eventName,
        error: error.message,
        code: error.code ?? null,
      });
    }
  } catch (error) {
    console.error("deepfake_worker_event_persist_threw", {
      scan_id: input.scanId,
      event_name: input.eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listDeepfakeWorkerEvents(input: {
  supabase: any;
  scanId: string;
  limit?: number;
}): Promise<
  Array<{
    event_name: string;
    worker_execution_id: string;
    request_id: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
    error_category: string | null;
    error_message: string | null;
  }>
> {
  const { data, error } = await input.supabase
    .from("deepfake_worker_events")
    .select(
      "event_name, worker_execution_id, request_id, created_at, metadata, error_category, error_message",
    )
    .eq("scan_id", input.scanId)
    .order("created_at", { ascending: true })
    .limit(Math.min(200, Math.max(1, input.limit ?? 100)));

  if (error) {
    throw new Error(`Failed to list worker events: ${error.message}`);
  }
  return (data ?? []) as Array<{
    event_name: string;
    worker_execution_id: string;
    request_id: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
    error_category: string | null;
    error_message: string | null;
  }>;
}

export function hasWorkerEvent(
  events: Array<{ event_name: string }>,
  name: DeepfakeWorkerEventName,
): boolean {
  return events.some((event) => event.event_name === name);
}
