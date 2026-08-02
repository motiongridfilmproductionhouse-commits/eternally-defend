import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("resolveCopyrightScanWorkerUrl derives same-origin hook from SITE_URL", () => {
  const url = resolveCopyrightScanWorkerUrl({
    SITE_URL: "https://eternasentinel.com",
  } as NodeJS.ProcessEnv);
  assert.equal(
    url,
    "https://eternasentinel.com/api/public/hooks/copyright-scan-execute",
  );
});

test("resolveCopyrightScanWorkerUrl derives hook from VERCEL_URL", () => {
  const url = resolveCopyrightScanWorkerUrl({
    VERCEL_URL: "eternally-defend.vercel.app",
  } as NodeJS.ProcessEnv);
  assert.equal(
    url,
    "https://eternally-defend.vercel.app/api/public/hooks/copyright-scan-execute",
  );
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
