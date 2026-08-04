/**
 * Acceptance checks for Deepfake Intelligence startup reliability.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prepareDeepfakeStartupPlan } from "./startup-plan.server";
import {
  classifyStartupNetworkError,
  formatStartupUserError,
  isProductionDeepfakeRuntime,
} from "./startup-network.server";
import {
  deepfakeScanWorkerDispatchDiagnostic,
  resolveDeepfakeScanWorkerUrl,
} from "./scan-worker-dispatch.server";
import { resolveGoogleImagesWorkerUrl } from "./google-images-worker-dispatch.server";

const FUNCTIONS = resolve(process.cwd(), "src/lib/deepfake-intel.functions.ts");
const PIPELINE = resolve(process.cwd(), "src/lib/deepfake/scan-pipeline.server.ts");
const UI = resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx");
const SCAN_HOOK = resolve(
  process.cwd(),
  "src/routes/api/public/hooks/deepfake-scan-execute.ts",
);

test("Sarayu Mohan startup plan persists non-zero queries before dispatch", () => {
  const plan = prepareDeepfakeStartupPlan({
    name: "Sarayu Mohan",
    aliases: ["Sarayu"],
    maxQueries: 56,
  });
  assert.ok(plan.queries.length >= 12, "expected investigation queries");
  assert.equal(plan.metrics.queries_generated, plan.queries.length);
  assert.equal(plan.checkpoint.queries.length, plan.queries.length);
  assert.match(plan.queries.join("\n").toLowerCase(), /sarayu/);
});

test("runDeepfakeScan persists queries and returns scan id even when dispatch is retryable", () => {
  const src = readFileSync(FUNCTIONS, "utf8");
  const runStart = src.indexOf("export const runDeepfakeScan");
  const executeStart = src.indexOf("export const executeDeepfakeScanPipeline");
  const block = src.slice(runStart, executeStart);
  assert.match(block, /prepareDeepfakeStartupPlan/);
  assert.match(block, /scan_checkpoint: startupPlan\.checkpoint/);
  assert.match(block, /total_queries: startupPlan\.queries\.length/);
  assert.match(block, /dispatch_error/);
  assert.match(block, /worker_dispatch_status: "retryable"/);
  assert.doesNotMatch(block, /status: "failed"/);
});

test("production dispatch path never schedules inline fallback", () => {
  const src = readFileSync(FUNCTIONS, "utf8");
  const start = src.indexOf("export async function dispatchDeepfakeScanExecution");
  const end = src.indexOf("export async function executeDeepfakeScanById");
  const block = src.slice(start, end);
  assert.match(block, /isProductionDeepfakeRuntime/);
  assert.match(block, /mode: "retryable"/);
  assert.match(block, /inline_fallback: false/);
  // Inline only in the non-production branch after production early-return.
  const prodIdx = block.indexOf("if (production)");
  const inlineIdx = block.indexOf("scheduleInlineWorkerExecution");
  assert.ok(prodIdx >= 0 && inlineIdx > prodIdx);
});

test("Google Images workers are dispatched after reference readiness in pipeline", () => {
  const src = readFileSync(PIPELINE, "utf8");
  const refIdx = src.indexOf("collectReferenceImages");
  const giDispatchIdx = src.indexOf("dispatchGoogleImagesWorker({");
  assert.ok(refIdx >= 0 && giDispatchIdx > refIdx);
  assert.match(src, /stage: "google_images_queue"/);
});

test("UI selects scan id immediately and surfaces dispatch_error with Retry", () => {
  const src = readFileSync(UI, "utf8");
  assert.match(src, /setSelectedScanId\(res\.scan_id\)/);
  assert.match(src, /dispatch_error/);
  assert.match(src, /setStartupDispatchError/);
  assert.match(src, /data-testid="deepfake-startup-error"/);
  assert.match(src, />\s*Retry\s*</);
  assert.match(src, /View diagnostics/);
  assert.match(src, /scanPollInterval/);
});

test("worker hook returns 202 before background batch factory runs", () => {
  const src = readFileSync(SCAN_HOOK, "utf8");
  const network = readFileSync(
    resolve(process.cwd(), "src/lib/deepfake/startup-network.server.ts"),
    "utf8",
  );
  const acceptedIdx = src.indexOf("deepfake_scan_worker_accepted");
  const scheduleIdx = src.indexOf(
    "runAcceptedBackgroundWork(async",
    acceptedIdx,
  );
  const executeIdx = src.indexOf(
    "deepfake_scan_worker_execute_start",
    scheduleIdx,
  );
  const returnIdx = src.lastIndexOf("status: 202");
  assert.ok(acceptedIdx >= 0);
  assert.ok(scheduleIdx > acceptedIdx);
  assert.ok(executeIdx > scheduleIdx);
  assert.ok(returnIdx > scheduleIdx);
  assert.match(src, /wait_until_used: scheduled\.wait_until_used/);
  assert.match(network, /setImmediate/);
  assert.match(network, /waitUntil\(work\)/);
});

test("invalid worker URL failure is categorized for the user", () => {
  const category = classifyStartupNetworkError(new TypeError("fetch failed"));
  const message = formatStartupUserError({
    category,
    detail: "fetch failed",
  });
  assert.equal(category, "worker_endpoint_unavailable");
  assert.match(message, /Unable to start investigation/);
  assert.match(message, /Worker endpoint unavailable/);
  assert.doesNotMatch(message, /TypeError/);
});

test("deployment worker URL resolution prefers exact hook or appends it", () => {
  assert.equal(
    resolveDeepfakeScanWorkerUrl({
      DEEPFAKE_SCAN_WORKER_URL:
        "https://app.example.com/api/public/hooks/deepfake-scan-execute",
      COPYRIGHT_SCAN_WORKER_SECRET: "x",
    } as NodeJS.ProcessEnv),
    "https://app.example.com/api/public/hooks/deepfake-scan-execute",
  );
  assert.equal(
    resolveDeepfakeScanWorkerUrl({
      DEEPFAKE_SCAN_WORKER_URL: "https://app.example.com",
      COPYRIGHT_SCAN_WORKER_SECRET: "x",
    } as NodeJS.ProcessEnv),
    "https://app.example.com/api/public/hooks/deepfake-scan-execute",
  );
  assert.equal(
    resolveGoogleImagesWorkerUrl({
      DEEPFAKE_GOOGLE_IMAGES_WORKER_URL: "https://app.example.com",
    } as NodeJS.ProcessEnv),
    "https://app.example.com/api/public/hooks/deepfake-google-images-worker",
  );
});

test("isProductionDeepfakeRuntime gates inline fallback", () => {
  assert.equal(
    isProductionDeepfakeRuntime({ VERCEL: "1" } as NodeJS.ProcessEnv),
    true,
  );
  assert.equal(
    isProductionDeepfakeRuntime({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    false,
  );
});

test("worker secret presence is required in dispatch diagnostic", () => {
  const missing = deepfakeScanWorkerDispatchDiagnostic({
    SITE_URL: "https://app.example.com",
  } as NodeJS.ProcessEnv);
  assert.equal(missing.worker_secret_present, false);
  assert.equal(missing.failure_category, "worker_secret_not_configured");

  const ok = deepfakeScanWorkerDispatchDiagnostic({
    SITE_URL: "https://app.example.com",
    COPYRIGHT_SCAN_WORKER_SECRET: "secret",
  } as NodeJS.ProcessEnv);
  assert.equal(ok.worker_secret_present, true);
  assert.equal(ok.failure_category, null);
});
