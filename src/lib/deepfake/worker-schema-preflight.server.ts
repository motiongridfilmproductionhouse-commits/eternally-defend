/**
 * Production schema preflight for Deepfake worker execution.
 * Missing migrations must not leave scans stuck in RUNNING.
 */

export type DeepfakeSchemaPreflightResult = {
  ok: boolean;
  missing: string[];
  details: Record<string, boolean>;
};

const REQUIRED_SCAN_COLUMNS = [
  "scan_run_token",
  "lease_expires_at",
  "heartbeat_at",
  "scan_checkpoint",
  "discovery_metrics",
  "total_queries",
  "status",
] as const;

export async function runDeepfakeWorkerSchemaPreflight(input: {
  supabase: any;
}): Promise<DeepfakeSchemaPreflightResult> {
  const details: Record<string, boolean> = {};
  const missing: string[] = [];

  // Probe deepfake_scans columns via a zero-row select.
  try {
    const { error } = await input.supabase
      .from("deepfake_scans")
      .select(REQUIRED_SCAN_COLUMNS.join(","))
      .limit(0);
    if (error) {
      details.deepfake_scans_runtime_columns = false;
      missing.push(`deepfake_scans:${error.message}`);
    } else {
      details.deepfake_scans_runtime_columns = true;
    }
  } catch (error) {
    details.deepfake_scans_runtime_columns = false;
    missing.push(
      `deepfake_scans:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const { error } = await input.supabase
      .from("deepfake_google_images_jobs")
      .select("id, scan_id, status, query")
      .limit(0);
    details.deepfake_google_images_jobs = !error;
    if (error) missing.push(`deepfake_google_images_jobs:${error.message}`);
  } catch (error) {
    details.deepfake_google_images_jobs = false;
    missing.push(
      `deepfake_google_images_jobs:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const { error } = await input.supabase
      .from("deepfake_worker_events")
      .select("id, scan_id, event_name")
      .limit(0);
    details.deepfake_worker_events = !error;
    if (error) missing.push(`deepfake_worker_events:${error.message}`);
  } catch (error) {
    details.deepfake_worker_events = false;
    missing.push(
      `deepfake_worker_events:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Continuation RPC existence — call with impossible id and accept
  // "not found"/validation errors as proof the function exists.
  try {
    const { error } = await input.supabase.rpc(
      "acquire_deepfake_scan_continuation",
      { p_scan_id: "00000000-0000-4000-8000-000000000000" },
    );
    const message = error?.message?.toLowerCase?.() ?? "";
    const missingFn =
      /could not find the function|function .* does not exist|pgrst202/i.test(
        message,
      );
    details.acquire_deepfake_scan_continuation = !missingFn;
    if (missingFn) {
      missing.push("rpc:acquire_deepfake_scan_continuation");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    const missingFn = /does not exist|could not find/i.test(message);
    details.acquire_deepfake_scan_continuation = !missingFn;
    if (missingFn) missing.push("rpc:acquire_deepfake_scan_continuation");
  }

  return { ok: missing.length === 0, missing, details };
}
