import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyStartupNetworkError,
  formatStartupUserError,
  redactHeaders,
  startupErrorLabel,
} from "./startup-network.server";
import {
  assertDeepfakeStartupWorkerConfig,
  deepfakeScanWorkerDispatchDiagnostic,
  resolveDeepfakeScanWorkerUrl,
} from "./scan-worker-dispatch.server";
import { resolveGoogleImagesWorkerUrl } from "./google-images-worker-dispatch.server";

test("classifyStartupNetworkError maps fetch failed to worker endpoint unavailable", () => {
  assert.equal(
    classifyStartupNetworkError(new TypeError("fetch failed")),
    "worker_endpoint_unavailable",
  );
  assert.equal(
    classifyStartupNetworkError(new Error("getaddrinfo ENOTFOUND example.invalid")),
    "dns_resolution_failed",
  );
  assert.equal(
    classifyStartupNetworkError(new Error("connect ECONNREFUSED 127.0.0.1:443")),
    "connection_refused",
  );
  assert.equal(
    classifyStartupNetworkError(new Error("certificate has expired")),
    "tls_failure",
  );
  assert.equal(
    classifyStartupNetworkError(new Error("The operation was aborted due to timeout")),
    "timeout",
  );
  assert.equal(
    classifyStartupNetworkError(new Error("worker_http_401")),
    "worker_authentication_failed",
  );
});

test("formatStartupUserError never includes TypeError: fetch failed", () => {
  const message = formatStartupUserError({
    category: "worker_endpoint_unavailable",
    detail: "fetch failed",
  });
  assert.match(message, /Unable to start investigation/);
  assert.match(message, /Worker endpoint unavailable/);
  assert.doesNotMatch(message, /TypeError/);
});

test("redactHeaders hides signatures and cookies", () => {
  const redacted = redactHeaders({
    "content-type": "application/json",
    "x-eterna-signature": "abc123",
    cookie: "session=1",
  });
  assert.equal(redacted["content-type"], "application/json");
  assert.equal(redacted["x-eterna-signature"], "[redacted]");
  assert.equal(redacted.cookie, "[redacted]");
});

test("resolveDeepfakeScanWorkerUrl appends hook path to bare origins", () => {
  const url = resolveDeepfakeScanWorkerUrl({
    DEEPFAKE_SCAN_WORKER_URL: "https://example.com",
    COPYRIGHT_SCAN_WORKER_SECRET: "secret",
  } as NodeJS.ProcessEnv);
  assert.equal(
    url,
    "https://example.com/api/public/hooks/deepfake-scan-execute",
  );
});

test("resolveDeepfakeScanWorkerUrl rejects invalid explicit URLs", () => {
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic({
    DEEPFAKE_SCAN_WORKER_URL: "ftp://example.com/worker",
  } as NodeJS.ProcessEnv);
  assert.equal(diagnostic.worker_url_valid, false);
  assert.equal(diagnostic.failure_category, "worker_url_invalid");
});

test("assertDeepfakeStartupWorkerConfig requires URL and secret", () => {
  assert.throws(
    () => assertDeepfakeStartupWorkerConfig({} as NodeJS.ProcessEnv),
    /Worker URL is not configured/,
  );
  assert.throws(
    () =>
      assertDeepfakeStartupWorkerConfig({
        SITE_URL: "https://example.com",
      } as NodeJS.ProcessEnv),
    /Worker authentication secret is not configured/,
  );
  const ok = assertDeepfakeStartupWorkerConfig({
    SITE_URL: "https://example.com",
    COPYRIGHT_SCAN_WORKER_SECRET: "test-secret",
  } as NodeJS.ProcessEnv);
  assert.equal(ok.worker_url_valid, true);
  assert.equal(ok.worker_secret_present, true);
});

test("resolveGoogleImagesWorkerUrl appends hook for bare origin", () => {
  const url = resolveGoogleImagesWorkerUrl({
    DEEPFAKE_GOOGLE_IMAGES_WORKER_URL: "https://example.com",
  } as NodeJS.ProcessEnv);
  assert.equal(
    url,
    "https://example.com/api/public/hooks/deepfake-google-images-worker",
  );
});

test("startupErrorLabel covers required categories", () => {
  assert.equal(
    startupErrorLabel("worker_endpoint_unavailable"),
    "Worker endpoint unavailable",
  );
  assert.equal(startupErrorLabel("timeout"), "Timeout");
  assert.equal(
    startupErrorLabel("database_unavailable"),
    "Database unavailable",
  );
});

test("worker hooks acknowledge with 202 and do not await full batch inline", () => {
  const scanHook = readFileSync(
    resolve(process.cwd(), "src/routes/api/public/hooks/deepfake-scan-execute.ts"),
    "utf8",
  );
  const giHook = readFileSync(
    resolve(
      process.cwd(),
      "src/routes/api/public/hooks/deepfake-google-images-worker.ts",
    ),
    "utf8",
  );
  assert.match(scanHook, /status: 202/);
  assert.match(scanHook, /runAcceptedBackgroundWork\(async/);
  assert.match(scanHook, /deepfake_scan_worker_accepted/);
  // Batch may be awaited inside the deferred factory, but the 202 response
  // must not wait on executeDeepfakeScanById at the handler level.
  assert.match(
    scanHook,
    /runAcceptedBackgroundWork\(async \(\) => \{[\s\S]*await executeDeepfakeScanById/,
  );
  assert.doesNotMatch(
    scanHook,
    /await executeDeepfakeScanById[\s\S]*runAcceptedBackgroundWork/,
  );
  assert.match(giHook, /status: 202/);
  assert.match(giHook, /runAcceptedBackgroundWork\(async/);
});

test("dispatchDeepfakeScanExecution never awaits inline pipeline batch", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/deepfake-intel.functions.ts"),
    "utf8",
  );
  const scheduleStart = src.indexOf("function scheduleInlineWorkerExecution");
  const dispatchStart = src.indexOf(
    "export async function dispatchDeepfakeScanExecution",
  );
  const end = src.indexOf("export async function executeDeepfakeScanById");
  assert.ok(scheduleStart >= 0 && dispatchStart > scheduleStart);
  const scheduleBlock = src.slice(scheduleStart, dispatchStart);
  const dispatchBlock = src.slice(dispatchStart, end);
  assert.match(scheduleBlock, /keepBackgroundWorkAlive/);
  assert.match(scheduleBlock, /executeDeepfakeScanById/);
  assert.doesNotMatch(scheduleBlock, /await executeDeepfakeScanById/);
  assert.match(dispatchBlock, /scheduleInlineWorkerExecution/);
  assert.doesNotMatch(dispatchBlock, /await scheduleInlineWorkerExecution/);
  assert.doesNotMatch(dispatchBlock, /await executeDeepfakeScanById/);
});
