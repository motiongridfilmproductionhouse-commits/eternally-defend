import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  shouldShowHistoryEmpty,
  shouldShowHistoryLoading,
} from "./scan-ui-state";
import { resolveDeepfakeScanWorkerUrl } from "./scan-worker-dispatch.server";

const FUNCTIONS_PATH = resolve(
  process.cwd(),
  "src/lib/deepfake-intel.functions.ts",
);
const UI_PATH = resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx");
const WORKER_PATH = resolve(process.cwd(), "src/lib/deepfake/scan-worker.server.ts");
const ORCHESTRATION_PATH = resolve(
  process.cwd(),
  "src/lib/deepfake/scan-worker-orchestration.server.ts",
);
const HOOK_PATH = resolve(
  process.cwd(),
  "src/routes/api/public/hooks/deepfake-scan-execute.ts",
);
const OWNER_PROGRESS_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260801094500_deepfake_scan_runtime_write_allow_owner_progress.sql",
);

function functionsSource(): string {
  return readFileSync(FUNCTIONS_PATH, "utf8");
}

function uiSource(): string {
  return readFileSync(UI_PATH, "utf8");
}

test("runDeepfakeScan returns immediately after insert and dispatches worker", () => {
  const src = functionsSource();
  const runStart = src.indexOf("export const runDeepfakeScan");
  const executeStart = src.indexOf("export const executeDeepfakeScanPipeline");
  const continueStart = src.indexOf("export const continueDeepfakeScan");
  assert.ok(runStart >= 0);
  assert.ok(executeStart > runStart);
  assert.ok(continueStart > executeStart);

  const runBlock = src.slice(runStart, executeStart);
  assert.match(runBlock, /\.insert\(/);
  assert.match(runBlock, /status: "running"/);
  assert.match(runBlock, /started: true/);
  assert.match(runBlock, /dispatchDeepfakeScanExecution/);
  assert.doesNotMatch(
    runBlock,
    /executeInterleavedDeepfakePipeline/,
    "scan-start must not run the interleaved pipeline inline",
  );
  assert.doesNotMatch(runBlock, /finalizePipelineRun/);
});

test("executeDeepfakeScanPipeline delegates to executeDeepfakeScanById worker batch", () => {
  const src = functionsSource();
  const executeStart = src.indexOf("export const executeDeepfakeScanPipeline");
  const continueStart = src.indexOf("export const continueDeepfakeScan");
  const executeBlock = src.slice(executeStart, continueStart);
  assert.match(executeBlock, /executeDeepfakeScanById/);
  assert.doesNotMatch(executeBlock, /executeInterleavedDeepfakePipeline/);
});

test("continueDeepfakeScan acquires ownership, dispatches worker, and returns without awaiting pipeline", () => {
  const src = functionsSource();
  const continueStart = src.indexOf("export const continueDeepfakeScan");
  const listStart = src.indexOf("export const listDeepfakeScans");
  const continueBlock = src.slice(continueStart, listStart);
  assert.match(continueBlock, /acquire_deepfake_scan_continuation/);
  assert.match(continueBlock, /dispatchDeepfakeScanExecution/);
  assert.match(continueBlock, /started: true/);
  assert.doesNotMatch(continueBlock, /executeInterleavedDeepfakePipeline/);
});

test("main scan worker orchestration runs continuation sequence after each batch", () => {
  const orchestration = readFileSync(ORCHESTRATION_PATH, "utf8");
  const lease = readFileSync(
    resolve(process.cwd(), "src/lib/deepfake/scan-lease.server.ts"),
    "utf8",
  );
  assert.match(orchestration, /export async function persistBatchProgress/);
  assert.match(orchestration, /export async function releaseCompletedQueryLeases/);
  assert.match(orchestration, /export async function markContinuationScheduled/);
  assert.match(orchestration, /finalizeWorkerBatchContinuation/);
  assert.match(orchestration, /await persistBatchProgress/);
  assert.match(orchestration, /await releaseCompletedQueryLeases/);
  assert.match(orchestration, /await markContinuationScheduled/);
  assert.match(orchestration, /await dispatchNextWorker/);
  assert.match(orchestration, /CONTINUATION_HANDOFF_LEASE_TTL_MS/);
  assert.match(lease, /startWorkerHeartbeatLoop/);
  assert.match(lease, /isScanEligibleForStaleRecovery/);

  const worker = readFileSync(WORKER_PATH, "utf8");
  assert.match(worker, /finalizeWorkerBatchContinuation/);
  assert.match(worker, /workerLimits/);
  assert.match(worker, /startWorkerHeartbeatLoop/);
  assert.match(worker, /renewScanLease/);
  assert.match(worker, /DEEPFAKE_SCAN_WORKER_MAX_QUERY_BATCHES/);
});

test("worker hook and dispatch emit structured telemetry", () => {
  const hook = readFileSync(HOOK_PATH, "utf8");
  assert.match(hook, /deepfake_scan_worker_hook_entry/);
  assert.match(hook, /deepfake_scan_worker_execute_start/);
  assert.match(hook, /executeDeepfakeScanById/);

  const src = functionsSource();
  assert.match(src, /deepfake_scan_worker_dispatch_request/);
  assert.match(src, /deepfake_scan_worker_dispatch_response/);
  assert.match(src, /deepfake_scan_executor_start/);
});

test("worker dispatch resolves same-origin hook URL", () => {
  const url = resolveDeepfakeScanWorkerUrl({
    SITE_URL: "https://eternally-defend.vercel.app",
  });
  assert.equal(
    url,
    "https://eternally-defend.vercel.app/api/public/hooks/deepfake-scan-execute",
  );
});

test("worker dispatch normalizes bare explicit worker origins", () => {
  const url = resolveDeepfakeScanWorkerUrl({
    DEEPFAKE_SCAN_WORKER_URL: "https://eternally-defend.vercel.app/",
  });
  assert.equal(
    url,
    "https://eternally-defend.vercel.app/api/public/hooks/deepfake-scan-execute",
  );
});

test("runDeepfakeScan validates worker config before insert", () => {
  const src = functionsSource();
  const runStart = src.indexOf("export const runDeepfakeScan");
  const executeStart = src.indexOf("export const executeDeepfakeScanPipeline");
  const runBlock = src.slice(runStart, executeStart);
  assert.match(runBlock, /assertDeepfakeStartupWorkerConfig/);
  assert.match(runBlock, /formatStartupUserError/);
  assert.match(runBlock, /logStartupStage/);
});

test("listDeepfakeScans excludes failed scans from history", () => {
  const src = functionsSource();
  const listStart = src.indexOf("export const listDeepfakeScans");
  const getStart = src.indexOf("export const getDeepfakeScan");
  const listBlock = src.slice(listStart, getStart === -1 ? undefined : getStart);
  assert.match(listBlock, /\.neq\(\s*"status"\s*,\s*"failed"\s*\)/);
});

test("SCAN HISTORY UI filters failed scans client-side", () => {
  const src = uiSource();
  assert.match(src, /filterScanHistory/);
  assert.match(src, /historyScans/);
});

test("UI wires click → run.mutate and relies on backend worker dispatch", () => {
  const src = uiSource();
  assert.match(src, /onClick=\{onRun\}/);
  assert.match(src, /run\.mutate\(/);
  assert.match(src, /setSelectedScanId\(res\.scan_id\)/);
  assert.match(src, /Scanning…/);
  assert.doesNotMatch(src, /executeDeepfakeScanPipeline/);
  assert.doesNotMatch(src, /executePipeline\.mutate/);
});

test("history empty state is suppressed while loading or errored", () => {
  assert.equal(
    shouldShowHistoryLoading({ isLoading: true, isFetching: false, hasData: false }),
    true,
  );
  assert.equal(
    shouldShowHistoryLoading({
      isLoading: false,
      isFetching: true,
      hasData: false,
    }),
    true,
  );
  assert.equal(
    shouldShowHistoryEmpty({
      isLoading: false,
      isFetching: false,
      isError: false,
      count: 0,
    }),
    true,
  );
  assert.equal(
    shouldShowHistoryEmpty({
      isLoading: true,
      isFetching: false,
      isError: false,
      count: 0,
    }),
    false,
  );
  assert.equal(
    shouldShowHistoryEmpty({
      isLoading: false,
      isFetching: false,
      isError: true,
      count: 0,
    }),
    false,
  );
});

test("owner-progress migration keeps continue-only partial revive", () => {
  const sql = readFileSync(OWNER_PROGRESS_MIGRATION, "utf8");
  assert.match(sql, /deepfake_scans_protect_runtime_fields/);
  assert.match(sql, /NEW\.scan_run_token IS NOT DISTINCT FROM OLD\.scan_run_token/);
  assert.match(sql, /OLD\.lease_expires_at < NOW\(\)/);
  assert.match(sql, /runtime fields are server-managed/);
});
