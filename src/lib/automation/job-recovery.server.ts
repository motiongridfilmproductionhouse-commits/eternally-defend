/**
 * Idempotent stale-job recovery for `automation_jobs` rows stuck in
 * "running" beyond a documented TTL — e.g. the enforcement-worker process
 * crashed, was restarted, or lost network access mid-job and never posted a
 * terminal callback to `/api/public/hooks/automation-status`.
 *
 * Mirrors the grace-period + compare-and-swap stale-recovery pattern in
 * src/lib/deepfake/scan-lease.server.ts / scan-ownership.server.ts
 * (`isScanEligibleForStaleRecovery`, `recoverExpiredScansForUser`), adapted
 * to `automation_jobs`' schema: unlike `deepfake_scans`, it has no
 * `lease_expires_at` / `heartbeat_at` columns, so staleness is derived from
 * `started_at` + `status` with a fixed TTL instead of a renewable lease.
 *
 * Wired into the existing `eterna-enforcement-worker` pg_cron path
 * (`/api/public/hooks/enforcement-worker`) rather than a new cron job.
 */

/**
 * automation_jobs has no lease/heartbeat columns, so this TTL must comfortably
 * cover a legitimate end-to-end run. It is set above the worker's own
 * `TIMEOUTS.totalJobMs` budget (10 minutes, services/enforcement-worker/src/config.ts)
 * plus slack for enqueue dispatch latency and cron cadence, so a job that is
 * still genuinely in flight is never recovered out from under it.
 */
export const AUTOMATION_JOB_STALE_TTL_MS = 15 * 60_000; // 15 minutes

const RECOVERABLE_STATUS = "running" as const;
const STALE_RECOVERY_ERROR_MESSAGE =
  "Automation job exceeded the running TTL without a terminal callback. Marked failed by stale-job recovery.";

export function staleAutomationJobCutoffIso(
  nowMs = Date.now(),
  ttlMs = AUTOMATION_JOB_STALE_TTL_MS,
): string {
  return new Date(nowMs - ttlMs).toISOString();
}

type StaleJobCandidateRow = {
  id: string;
  user_id: string;
  enforcement_request_id: string;
  platform: string | null;
  started_at: string | null;
  status: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Recovers every `automation_jobs` row stuck "running" past the TTL, across
 * all users. Safe to call repeatedly and concurrently (from overlapping cron
 * ticks): the recovery UPDATE's own WHERE clause
 * (`status = running AND started_at < cutoff`) is the compare-and-swap
 * guard, so a job already recovered — or completed/cancelled via a normal
 * callback — by a prior or concurrent sweep simply matches zero rows on a
 * repeat call. No error, no duplicate `automation_events` row, no duplicate
 * `enforcement_requests` mirror write.
 */
export async function recoverStaleAutomationJobs(input: {
  supabase: any;
  nowMs?: number;
  ttlMs?: number;
}): Promise<number> {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? AUTOMATION_JOB_STALE_TTL_MS;
  const cutoffIso = staleAutomationJobCutoffIso(nowMs, ttlMs);

  const { data: candidates, error: readError } = await input.supabase
    .from("automation_jobs")
    .select("id,user_id,enforcement_request_id,platform,started_at,status")
    .eq("status", RECOVERABLE_STATUS)
    .lt("started_at", cutoffIso);
  if (readError) throw new Error(readError.message);

  const candidateRows = (candidates ?? []) as StaleJobCandidateRow[];
  if (candidateRows.length === 0) return 0;

  const candidateIds = candidateRows.map((row) => row.id);
  const nowIso = new Date(nowMs).toISOString();

  const { data: updated, error: updateError } = await input.supabase
    .from("automation_jobs")
    .update({
      status: "failed",
      completed_at: nowIso,
      error_json: { code: "stale_recovery", message: STALE_RECOVERY_ERROR_MESSAGE },
    })
    .in("id", candidateIds)
    .eq("status", RECOVERABLE_STATUS)
    .lt("started_at", cutoffIso)
    .select("id");
  if (updateError) throw new Error(updateError.message);

  const recoveredIds = new Set(((updated ?? []) as Array<{ id: string }>).map((row) => row.id));
  if (recoveredIds.size === 0) return 0;

  for (const row of candidateRows) {
    if (!recoveredIds.has(row.id)) continue;

    await input.supabase
      .from("enforcement_requests")
      .update({ automation_status: "failed" })
      .eq("id", row.enforcement_request_id)
      .eq("automation_status", "running");

    await input.supabase.from("automation_events").insert({
      user_id: row.user_id,
      job_id: row.id,
      event: "stale_job_recovered",
      platform: row.platform,
      result: "ok",
      payload_json: { ttl_ms: ttlMs, started_at: row.started_at, recovered_at: nowIso },
    });
  }

  return recoveredIds.size;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
