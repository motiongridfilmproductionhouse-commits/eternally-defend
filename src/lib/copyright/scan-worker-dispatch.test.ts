import assert from "node:assert/strict";
import test from "node:test";
import {
  copyrightScanWorkerDispatchDiagnostic,
  isCopyrightScanWorkerSecretConfigured,
  resolveCopyrightScanWorkerUrl,
} from "./scan-worker-dispatch.server";

test("resolveCopyrightScanWorkerUrl prefers explicit COPYRIGHT_SCAN_WORKER_URL", () => {
  const url = resolveCopyrightScanWorkerUrl({
    COPYRIGHT_SCAN_WORKER_URL: "https://worker.example/run",
    SITE_URL: "https://eternasentinel.com",
  } as NodeJS.ProcessEnv);
  assert.equal(url, "https://worker.example/run");
});

test("worker dispatch diagnostic reports URL source and secret length only", () => {
  const diagnostic = copyrightScanWorkerDispatchDiagnostic({
    COPYRIGHT_SCAN_WORKER_URL: "https://eternasentinel.com/api/public/hooks/copyright-scan-execute",
    COPYRIGHT_SCAN_WORKER_SECRET: "super-secret-value",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(diagnostic, {
    worker_url_configured: true,
    worker_url_source: "COPYRIGHT_SCAN_WORKER_URL",
    worker_url_origin: "https://eternasentinel.com",
    worker_url_path: "/api/public/hooks/copyright-scan-execute",
    worker_secret_present: true,
    worker_secret_length: "super-secret-value".length,
  });
  assert.equal(JSON.stringify(diagnostic).includes("super-secret-value"), false);
});

test("resolveCopyrightScanWorkerUrl derives same-origin hook from SITE_URL", () => {
  const url = resolveCopyrightScanWorkerUrl({
    SITE_URL: "https://eternasentinel.com",
  } as NodeJS.ProcessEnv);
  assert.equal(url, "https://eternasentinel.com/api/public/hooks/copyright-scan-execute");
});

test("resolveCopyrightScanWorkerUrl derives hook from VERCEL_URL", () => {
  const url = resolveCopyrightScanWorkerUrl({
    VERCEL_URL: "eternally-defend.vercel.app",
  } as NodeJS.ProcessEnv);
  assert.equal(url, "https://eternally-defend.vercel.app/api/public/hooks/copyright-scan-execute");
});

test("resolveCopyrightScanWorkerUrl returns null when no base URL is known", () => {
  assert.equal(resolveCopyrightScanWorkerUrl({} as NodeJS.ProcessEnv), null);
});

test("isCopyrightScanWorkerSecretConfigured detects secret presence", () => {
  assert.equal(
    isCopyrightScanWorkerSecretConfigured({
      COPYRIGHT_SCAN_WORKER_SECRET: "secret",
    } as NodeJS.ProcessEnv),
    true,
  );
  assert.equal(isCopyrightScanWorkerSecretConfigured({} as NodeJS.ProcessEnv), false);
});
