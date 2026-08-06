/**
 * UI copy for Deepfake worker startup / claim progress states.
 */

export type WorkerProgressUiState =
  | "accepted_but_not_started"
  | "worker_started_but_query_claim_failed"
  | "worker_progressing"
  | "running_unknown";

export function resolveWorkerProgressUiState(input: {
  status?: string | null;
  queriesGenerated?: number;
  queriesExecuted?: number;
  discoveryMetrics?: Record<string, unknown> | null;
}): WorkerProgressUiState {
  if (input.status !== "running") return "running_unknown";
  const metrics = input.discoveryMetrics ?? {};
  const workerStatus =
    typeof metrics.worker_execution_status === "string" ? metrics.worker_execution_status : null;
  const executed = input.queriesExecuted ?? 0;

  if (executed > 0 || workerStatus === "progressing") {
    return "worker_progressing";
  }
  if (workerStatus === "worker_started_but_query_claim_failed") {
    return "worker_started_but_query_claim_failed";
  }
  if (workerStatus === "accepted_but_not_started" || workerStatus === "watchdog_redispatched") {
    return "accepted_but_not_started";
  }

  const expectedBy =
    typeof metrics.first_worker_expected_by === "string"
      ? Date.parse(metrics.first_worker_expected_by)
      : NaN;
  if (
    Number.isFinite(expectedBy) &&
    Date.now() > expectedBy &&
    (input.queriesGenerated ?? 0) > 0 &&
    executed === 0
  ) {
    return "accepted_but_not_started";
  }

  return "running_unknown";
}

export function workerProgressUiCopy(state: WorkerProgressUiState): {
  title: string;
  body: string;
} {
  switch (state) {
    case "accepted_but_not_started":
      return {
        title: "Accepted but not started",
        body: "The worker accepted this investigation but has not begun processing. Automatic retry is in progress.",
      };
    case "worker_started_but_query_claim_failed":
      return {
        title: "Worker started but cannot claim queries",
        body: "The investigation worker started but could not access the saved query jobs. Open diagnostics for the database or migration error.",
      };
    case "worker_progressing":
      return {
        title: "Worker progressing",
        body: "Investigation started. Processing the first search batch.",
      };
    default:
      return {
        title: "Investigation running",
        body: "Waiting for the first worker progress update.",
      };
  }
}
