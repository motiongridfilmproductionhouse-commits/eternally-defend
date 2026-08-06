/**
 * Structured telemetry for Deepfake Intelligence main-scan worker batches.
 */

export type DeepfakeScanWorkerTelemetry = {
  scan_id: string;
  worker_execution_id: string;
  batch_number: number;
  query_ids_claimed: string[];
  lease_owner: string;
  lease_acquired_at: string;
  lease_expiry: string | null;
  batch_start_time: string;
  batch_completion_time?: string;
  continuation_dispatch_attempt?: boolean;
  continuation_dispatch_http_status?: number | null;
  continuation_dispatch_response_body?: string | null;
  next_worker_execution_id?: string | null;
  pending_query_count?: number;
  last_progress_timestamp?: string | null;
  event: string;
  [key: string]: unknown;
};

export function logDeepfakeScanWorkerEvent(payload: DeepfakeScanWorkerTelemetry): void {
  console.info(payload.event, payload);
}
