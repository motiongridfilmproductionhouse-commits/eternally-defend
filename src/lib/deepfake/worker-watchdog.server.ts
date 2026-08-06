/**
 * First-worker watchdog: if a scan was accepted but never started, redispatch once.
 */

import { randomUUID } from "node:crypto";
import {
  hasWorkerEvent,
  listDeepfakeWorkerEvents,
  persistDeepfakeWorkerEvent,
} from "./worker-events.server";
import { dispatchNextWorker } from "./scan-worker-dispatch.server";

export async function runFirstWorkerWatchdog(input: { supabase: any; scanId: string }): Promise<{
  action:
    | "ok_started"
    | "ok_progressing"
    | "redispatched"
    | "accepted_but_not_started"
    | "worker_started_but_query_claim_failed"
    | "skipped";
  events: string[];
}> {
  const { data: scan } = await input.supabase
    .from("deepfake_scans")
    .select("id, status, discovery_metrics")
    .eq("id", input.scanId)
    .maybeSingle();

  if (!scan || scan.status !== "running") {
    return { action: "skipped", events: [] };
  }

  const metrics =
    scan.discovery_metrics && typeof scan.discovery_metrics === "object"
      ? (scan.discovery_metrics as Record<string, unknown>)
      : {};
  const expectedBy =
    typeof metrics.first_worker_expected_by === "string"
      ? Date.parse(metrics.first_worker_expected_by)
      : NaN;
  if (!Number.isFinite(expectedBy) || Date.now() < expectedBy) {
    return { action: "skipped", events: [] };
  }

  let events: Awaited<ReturnType<typeof listDeepfakeWorkerEvents>> = [];
  try {
    events = await listDeepfakeWorkerEvents({
      supabase: input.supabase,
      scanId: input.scanId,
      limit: 100,
    });
  } catch {
    // Table may not exist yet — treat as not started.
    events = [];
  }

  const eventNames = events.map((e) => e.event_name);
  const started = hasWorkerEvent(events, "worker_execution_started");
  const claimFailed = hasWorkerEvent(events, "worker_started_but_query_claim_failed");
  const claimCompleted = hasWorkerEvent(events, "query_claim_completed");
  const claimed =
    claimCompleted &&
    events.some((e) => {
      if (e.event_name !== "query_claim_completed") return false;
      const count = Number((e.metadata as { claimed_count?: unknown })?.claimed_count);
      return Number.isFinite(count) && count > 0;
    });

  if (claimed || hasWorkerEvent(events, "first_query_started")) {
    return { action: "ok_progressing", events: eventNames };
  }

  if (started && claimFailed) {
    await input.supabase
      .from("deepfake_scans")
      .update({
        discovery_metrics: {
          ...metrics,
          worker_execution_status: "worker_started_but_query_claim_failed",
        },
      })
      .eq("id", input.scanId);
    return {
      action: "worker_started_but_query_claim_failed",
      events: eventNames,
    };
  }

  if (started) {
    return { action: "ok_started", events: eventNames };
  }

  const alreadyRedispatched = metrics.watchdog_redispatch_count === 1;
  const workerExecutionId = randomUUID();

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: input.scanId,
    workerExecutionId,
    eventName: "accepted_but_not_started",
    errorCategory: "accepted_but_not_started",
    errorMessage:
      "Worker hook accepted the scan but worker_execution_started was not observed in time.",
    metadata: {
      first_worker_expected_by: metrics.first_worker_expected_by ?? null,
      already_redispatched: alreadyRedispatched,
    },
  });

  if (alreadyRedispatched) {
    await input.supabase
      .from("deepfake_scans")
      .update({
        discovery_metrics: {
          ...metrics,
          worker_execution_status: "accepted_but_not_started",
        },
      })
      .eq("id", input.scanId);
    return { action: "accepted_but_not_started", events: eventNames };
  }

  await persistDeepfakeWorkerEvent({
    supabase: input.supabase,
    scanId: input.scanId,
    workerExecutionId,
    eventName: "watchdog_redispatch",
    metadata: { attempt: 1 },
  });

  const dispatch = await dispatchNextWorker({
    scanId: input.scanId,
    nextWorkerExecutionId: workerExecutionId,
    startupCorrelationId:
      typeof metrics.startup_correlation_id === "string"
        ? metrics.startup_correlation_id
        : undefined,
    timeoutMs: 8_000,
  });

  await input.supabase
    .from("deepfake_scans")
    .update({
      discovery_metrics: {
        ...metrics,
        watchdog_redispatch_count: 1,
        watchdog_redispatch_at: new Date().toISOString(),
        worker_execution_status: dispatch.dispatched
          ? "watchdog_redispatched"
          : "accepted_but_not_started",
        first_worker_expected_by: new Date(Date.now() + 20_000).toISOString(),
      },
    })
    .eq("id", input.scanId);

  return {
    action: dispatch.dispatched ? "redispatched" : "accepted_but_not_started",
    events: eventNames,
  };
}
