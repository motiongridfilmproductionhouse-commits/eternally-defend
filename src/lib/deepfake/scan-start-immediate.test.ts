import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  shouldShowHistoryEmpty,
  shouldShowHistoryLoading,
} from "./scan-ui-state";

const FUNCTIONS_PATH = resolve(
  process.cwd(),
  "src/lib/deepfake-intel.functions.ts",
);
const UI_PATH = resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx");
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

test("runDeepfakeScan returns immediately after insert and does not await the pipeline", () => {
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
  assert.doesNotMatch(
    runBlock,
    /executeInterleavedDeepfakePipeline/,
    "scan-start must not run the interleaved pipeline inline",
  );
  assert.doesNotMatch(runBlock, /finalizePipelineRun/);
});

test("executeDeepfakeScanPipeline owns the long-running pipeline work", () => {
  const src = functionsSource();
  const executeStart = src.indexOf("export const executeDeepfakeScanPipeline");
  const continueStart = src.indexOf("export const continueDeepfakeScan");
  const executeBlock = src.slice(executeStart, continueStart);
  assert.match(executeBlock, /executeInterleavedDeepfakePipeline/);
  assert.match(executeBlock, /finalizePipelineRun/);
  assert.match(executeBlock, /scan_run_token/);
});

test("continueDeepfakeScan acquires ownership then returns without awaiting pipeline", () => {
  const src = functionsSource();
  const continueStart = src.indexOf("export const continueDeepfakeScan");
  const listStart = src.indexOf("export const listDeepfakeScans");
  const continueBlock = src.slice(continueStart, listStart);
  assert.match(continueBlock, /acquire_deepfake_scan_continuation/);
  assert.match(continueBlock, /started: true/);
  assert.doesNotMatch(continueBlock, /executeInterleavedDeepfakePipeline/);
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

test("UI wires click → run.mutate → executePipeline.mutate with scan_id", () => {
  const src = uiSource();
  assert.match(src, /onClick=\{onRun\}/);
  assert.match(src, /run\.mutate\(/);
  assert.match(src, /executePipeline\.mutate\(\{\s*scan_id: res\.scan_id/);
  assert.match(src, /setSelectedScanId\(res\.scan_id\)/);
  assert.match(src, /Scanning…/);
  assert.match(src, /scans\.isError/);
  assert.match(src, /Unable to load scan history/);
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
