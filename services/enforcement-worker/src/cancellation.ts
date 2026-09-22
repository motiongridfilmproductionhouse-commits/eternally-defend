/**
 * Cancellation checks for in-flight enforcement-worker jobs.
 *
 * The worker has no direct DB access — it talks to the main app only over
 * HMAC-signed HTTP (see eterna.ts) — so cancellation is detected by polling
 * the job's current status via the automation-status-check hook at each
 * checkpoint in runner.ts.
 *
 * A check failure (network blip, transient 5xx, main app briefly
 * unreachable) fails OPEN: it never aborts a legitimate in-flight job, since
 * the worker cannot distinguish "cancelled" from "temporarily unreachable"
 * from a thrown error alone. Only a confirmed `status: "cancelled"` response
 * fails CLOSED.
 */

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled`);
    this.name = "JobCancelledError";
  }
}

export type CancellationChecker = (jobId: string) => Promise<boolean>;

/**
 * Throws JobCancelledError when the job has been confirmed cancelled.
 * Resolves normally (does not throw) when the job is still active or when
 * the check itself failed.
 */
export async function assertJobNotCancelled(
  jobId: string,
  isCancelled: CancellationChecker,
): Promise<void> {
  let cancelled: boolean;
  try {
    cancelled = await isCancelled(jobId);
  } catch {
    // Fail open — see module docstring.
    return;
  }
  if (cancelled) throw new JobCancelledError(jobId);
}
