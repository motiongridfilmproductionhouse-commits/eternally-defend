/**
 * Proves Deepfake worker deferred execution, claim diagnostics, and probes.
 * HTTP 202 alone must never be treated as success.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveWorkerProgressUiState,
  workerProgressUiCopy,
} from "./worker-progress-ui";
import { hasWorkerEvent } from "./worker-events.server";

const ROOT = process.cwd();
const SCAN_HOOK = resolve(
  ROOT,
  "src/routes/api/public/hooks/deepfake-scan-execute.ts",
);
const GI_HOOK = resolve(
  ROOT,
  "src/routes/api/public/hooks/deepfake-google-images-worker.ts",
);
const NETWORK = resolve(ROOT, "src/lib/deepfake/startup-network.server.ts");
const WORKER = resolve(ROOT, "src/lib/deepfake/scan-worker.server.ts");
const FUNCTIONS = resolve(ROOT, "src/lib/deepfake-intel.functions.ts");
const WATCHDOG = resolve(ROOT, "src/lib/deepfake/worker-watchdog.server.ts");
const VALIDATE = resolve(ROOT, "scripts/validate-deepfake-startup-env.mjs");
const PREFLIGHT = resolve(
  ROOT,
  "src/lib/deepfake/worker-schema-preflight.server.ts",
);

test("direct waitUntil(executionPromise) executes without setImmediate", () => {
  const hook = readFileSync(SCAN_HOOK, "utf8");
  const network = readFileSync(NETWORK, "utf8");
  const gi = readFileSync(GI_HOOK, "utf8");

  assert.match(hook, /const executionPromise = executeDeepfakeScanById/);
  assert.match(hook, /registerWaitUntilExecution\(executionPromise\)/);
  assert.match(hook, /status: 202/);
  assert.doesNotMatch(hook, /setImmediate\s*\(/);
  assert.doesNotMatch(hook, /setTimeout\s*\(/);
  assert.doesNotMatch(hook, /runAcceptedBackgroundWork\s*\(/);

  // keepBackgroundWorkAlive must call waitUntil(work) directly.
  assert.match(network, /waitUntil\(work\)/);
  assert.doesNotMatch(network, /setImmediate\s*\(/);

  assert.match(gi, /registerWaitUntilExecution\(executionPromise\)/);
  assert.doesNotMatch(gi, /setImmediate\s*\(/);
});

test("authenticated hook persists worker lifecycle events before 202", () => {
  const hook = readFileSync(SCAN_HOOK, "utf8");
  for (const event of [
    "worker_hook_received",
    "worker_signature_validated",
    "worker_payload_validated",
    "wait_until_registered",
    "worker_execution_failed",
  ]) {
    assert.match(hook, new RegExp(`eventName: "${event}"`));
  }
  assert.match(hook, /verifyCopyrightScanWorkerRequestDetailed/);
  const waitUntilIdx = hook.indexOf("registerWaitUntilExecution(executionPromise)");
  const returnIdx = hook.lastIndexOf("status: 202");
  assert.ok(waitUntilIdx >= 0 && returnIdx > waitUntilIdx);
});

test("startup and worker use the same scan ID correlation fields", () => {
  const functions = readFileSync(FUNCTIONS, "utf8");
  const worker = readFileSync(WORKER, "utf8");
  const hook = readFileSync(SCAN_HOOK, "utf8");
  const dispatch = readFileSync(
    resolve(ROOT, "src/lib/deepfake/scan-worker-dispatch.server.ts"),
    "utf8",
  );

  assert.match(functions, /startup_correlation_id: startupCorrelationId/);
  assert.match(functions, /worker_execution_id: workerExecutionId/);
  assert.match(functions, /first_worker_expected_by: firstWorkerExpectedBy/);
  assert.match(dispatch, /scan_id: input\.scanId/);
  assert.match(dispatch, /worker_execution_id: workerExecutionId/);
  assert.match(dispatch, /startup_correlation_id: input\.startupCorrelationId/);
  assert.match(hook, /scanId: parsed\.scan_id/);
  assert.match(hook, /startupCorrelationId/);
  assert.match(worker, /scan_id_mismatch/);
  assert.match(worker, /startup scan_id/);
});

test("worker uses service-role DB client and starts with worker_execution_started", () => {
  const worker = readFileSync(WORKER, "utf8");
  const hook = readFileSync(SCAN_HOOK, "utf8");
  assert.match(worker, /database_client_type: "service_role"/);
  assert.match(worker, /eventName: "worker_execution_started"/);
  assert.match(worker, /eventName: "scan_loaded"/);
  assert.match(worker, /eventName: "query_rows_counted"/);
  assert.match(worker, /eventName: "scan_lease_claimed"/);
  assert.match(worker, /eventName: "query_claim_completed"/);
  assert.match(hook, /supabaseAdmin/);
  // First durable event in batch entry must be worker_execution_started.
  const startedIdx = worker.indexOf('eventName: "worker_execution_started"');
  const loadedIdx = worker.indexOf('eventName: "scan_loaded"');
  assert.ok(startedIdx >= 0 && loadedIdx > startedIdx);
});

test("pending queries claim diagnostics persist claimed_count and categories", () => {
  const worker = readFileSync(WORKER, "utf8");
  assert.match(worker, /pending_before: pendingBefore/);
  assert.match(worker, /claimed_count: claimedCount/);
  assert.match(worker, /claimed_query_ids/);
  assert.match(worker, /claim_model: "checkpoint_next_query_index"/);
  for (const category of [
    "query_status_mismatch",
    "lease_not_available",
    "RLS_denied",
    "claim_rpc_missing",
    "worker_started_but_query_claim_failed",
  ]) {
    assert.match(worker, new RegExp(category));
  }
  assert.match(worker, /eventName: "worker_started_but_query_claim_failed"/);
});

test("missing schema marks scan failed and does not leave RUNNING", () => {
  const worker = readFileSync(WORKER, "utf8");
  const preflight = readFileSync(PREFLIGHT, "utf8");
  assert.match(preflight, /deepfake_worker_events/);
  assert.match(preflight, /deepfake_google_images_jobs/);
  assert.match(preflight, /acquire_deepfake_scan_continuation/);
  assert.match(worker, /database_schema_incomplete/);
  assert.match(worker, /status: "failed"/);
  assert.match(worker, /required database schema is incomplete/);
});

test("first-worker watchdog redispatches once then surfaces accepted_but_not_started", () => {
  const watchdog = readFileSync(WATCHDOG, "utf8");
  assert.match(watchdog, /first_worker_expected_by/);
  assert.match(watchdog, /accepted_but_not_started/);
  assert.match(watchdog, /watchdog_redispatch_count === 1/);
  assert.match(watchdog, /dispatchNextWorker/);
  assert.match(watchdog, /watchdog_redispatch/);
  assert.match(watchdog, /worker_started_but_query_claim_failed/);

  const functions = readFileSync(FUNCTIONS, "utf8");
  assert.match(functions, /runFirstWorkerWatchdog/);
  assert.match(functions, /supabaseAdmin/);
});

test("live execution probe requires query progress, not only HTTP 202", () => {
  const validate = readFileSync(VALIDATE, "utf8");
  assert.match(validate, /DEEPFAKE_PROBE_WORKER/);
  assert.match(validate, /level2_http_202/);
  assert.match(validate, /level2_worker_execution_started/);
  assert.match(validate, /level2_query_progressed/);
  assert.match(validate, /HTTP 202 alone is NOT success/);
  assert.match(validate, /claimed_count/);
  assert.match(validate, /next_query_index/);
  // Must fail when started or claim missing.
  assert.match(validate, /Level 2 failed at/);
});

test("UI stuck at 0/N shows accepted/claim messages, not zero findings", () => {
  assert.equal(
    resolveWorkerProgressUiState({
      status: "running",
      queriesGenerated: 56,
      queriesExecuted: 0,
      discoveryMetrics: { worker_execution_status: "accepted_but_not_started" },
    }),
    "accepted_but_not_started",
  );
  assert.equal(
    resolveWorkerProgressUiState({
      status: "running",
      queriesGenerated: 56,
      queriesExecuted: 0,
      discoveryMetrics: {
        worker_execution_status: "worker_started_but_query_claim_failed",
      },
    }),
    "worker_started_but_query_claim_failed",
  );
  assert.equal(
    resolveWorkerProgressUiState({
      status: "running",
      queriesGenerated: 56,
      queriesExecuted: 1,
      discoveryMetrics: { worker_execution_status: "progressing" },
    }),
    "worker_progressing",
  );

  const accepted = workerProgressUiCopy("accepted_but_not_started");
  assert.match(accepted.title, /Accepted but not started/i);
  assert.match(accepted.body, /Automatic retry/i);
  assert.doesNotMatch(accepted.body, /zero findings/i);

  const claim = workerProgressUiCopy("worker_started_but_query_claim_failed");
  assert.match(claim.title, /cannot claim queries/i);
  assert.doesNotMatch(claim.body, /zero findings/i);

  const progressing = workerProgressUiCopy("worker_progressing");
  assert.match(progressing.title, /Worker progressing/i);
});

test("hasWorkerEvent helper detects worker_execution_started", () => {
  assert.equal(
    hasWorkerEvent(
      [{ event_name: "wait_until_registered" }, { event_name: "worker_execution_started" }],
      "worker_execution_started",
    ),
    true,
  );
  assert.equal(
    hasWorkerEvent([{ event_name: "worker_hook_received" }], "worker_execution_started"),
    false,
  );
});

test("runAcceptedBackgroundWork creates promise immediately (no setImmediate)", () => {
  const network = readFileSync(NETWORK, "utf8");
  const fnStart = network.indexOf("export function runAcceptedBackgroundWork");
  const fn = network.slice(fnStart, fnStart + 400);
  assert.match(fn, /const executionPromise = factory\(\)/);
  assert.match(fn, /registerWaitUntilExecution\(executionPromise\)/);
  assert.doesNotMatch(fn, /setImmediate/);
});
