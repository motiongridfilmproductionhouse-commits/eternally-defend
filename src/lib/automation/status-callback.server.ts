/**
 * Core logic for the `/api/public/hooks/automation-status` callback that the
 * external enforcement-worker service uses to report job status, audit
 * events, and (optionally) screenshot/review artifacts.
 *
 * Extracted from the route handler so the compare-and-swap terminal-state
 * guard below can be exercised directly in tests without going through
 * HTTP/HMAC verification or a live Supabase instance.
 *
 * Terminal-state protection: a late or out-of-order callback (the worker
 * retried a request, two callbacks raced, or the worker kept running after
 * the job was already cancelled/recovered) must never resurrect or mutate a
 * job that has already reached a terminal status. This mirrors the
 * compare-and-swap filter `cancelAutomationJob` already uses
 * (`.in("status", ["queued","running","review_ready"])` in
 * src/lib/automation/jobs.functions.ts) — the UPDATE's own WHERE clause is
 * the guard, so it is race-safe against concurrent callbacks. The event is
 * still always recorded in `automation_events` for audit purposes, tagged as
 * a late callback when it was rejected.
 */

export const AUTOMATION_JOB_TERMINAL_STATUSES = ["cancelled", "failed", "submitted"] as const;
export const AUTOMATION_JOB_NON_TERMINAL_STATUSES = ["queued", "running", "review_ready"] as const;

export type AutomationCallbackEvent = {
  job_id: string;
  event: string;
  status?: "queued" | "running" | "review_ready" | "submitted" | "failed" | "cancelled";
  result?: string;
  duration_ms?: number;
  payload?: Record<string, unknown>;
  screenshot_path?: string;
  review_summary?: Record<string, unknown>;
  review_bundle_path?: string;
  cdp_ws_url?: string;
  cdp_expires_at?: string;
  error?: Record<string, unknown>;
  worker_id?: string;
};

export type AutomationCallbackResult =
  { ok: true } | { ok: false; status: number; message: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function applyAutomationStatusCallback(
  supabase: any,
  parsed: AutomationCallbackEvent,
): Promise<AutomationCallbackResult> {
  const { data: job, error: jobErr } = await supabase
    .from("automation_jobs")
    .select("id,user_id,platform,enforcement_request_id,status")
    .eq("id", parsed.job_id)
    .maybeSingle();
  if (jobErr) return { ok: false, status: 500, message: jobErr.message };
  if (!job) return { ok: false, status: 404, message: "Job not found" };

  const patch: Record<string, unknown> = {};
  if (parsed.status) patch.status = parsed.status;
  if (parsed.status === "running" && parsed.event === "browser_started")
    patch.started_at = new Date().toISOString();
  if (
    parsed.status === "review_ready" ||
    parsed.status === "submitted" ||
    parsed.status === "failed" ||
    parsed.status === "cancelled"
  ) {
    patch.completed_at = new Date().toISOString();
  }
  if (parsed.review_summary) patch.review_summary_json = parsed.review_summary;
  if (parsed.review_bundle_path) patch.review_bundle_path = parsed.review_bundle_path;
  if (parsed.cdp_ws_url) patch.cdp_ws_url = parsed.cdp_ws_url;
  if (parsed.cdp_expires_at) patch.cdp_expires_at = parsed.cdp_expires_at;
  if (parsed.error) patch.error_json = parsed.error;
  if (parsed.screenshot_path) patch.last_screenshot_path = parsed.screenshot_path;
  if (parsed.worker_id) patch.worker_id = parsed.worker_id;

  const hasPatch = Object.keys(patch).length > 0;
  let jobRowUpdated = false;

  if (hasPatch) {
    const { data: updated, error: updateErr } = await supabase
      .from("automation_jobs")
      .update(patch)
      .eq("id", job.id)
      .in("status", AUTOMATION_JOB_NON_TERMINAL_STATUSES)
      .select("id");
    if (updateErr) return { ok: false, status: 500, message: updateErr.message };
    jobRowUpdated = Array.isArray(updated) && updated.length > 0;

    if (jobRowUpdated && parsed.status) {
      await supabase
        .from("enforcement_requests")
        .update({ automation_status: parsed.status })
        .eq("id", job.enforcement_request_id);
    }
  }

  // A callback carrying no patchable fields at all (e.g. a bare audit ping)
  // is not "late" — there was nothing to apply either way.
  const isLateCallback = hasPatch && !jobRowUpdated;

  await supabase.from("automation_events").insert({
    user_id: job.user_id,
    job_id: job.id,
    event: parsed.event,
    platform: job.platform,
    duration_ms: parsed.duration_ms ?? null,
    result: parsed.result ?? null,
    payload_json: {
      ...(parsed.payload ?? {}),
      ...(isLateCallback
        ? {
            late_callback: true,
            job_status_at_receipt: job.status,
            attempted_status: parsed.status ?? null,
          }
        : {}),
    },
    screenshot_path: parsed.screenshot_path ?? null,
  });

  return { ok: true };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
