#!/usr/bin/env node
/**
 * Deployment validation for Deepfake Intelligence startup.
 * Checks worker URL/secret configuration and optionally probes the worker hook.
 *
 * Usage:
 *   node scripts/validate-deepfake-startup-env.mjs
 *   DEEPFAKE_PROBE_WORKER=1 node scripts/validate-deepfake-startup-env.mjs
 */

import { createHmac } from "node:crypto";

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function normalizeOrigin(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveScanWorkerUrl() {
  const explicit = process.env.DEEPFAKE_SCAN_WORKER_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit.includes("://") ? explicit : `https://${explicit}`);
      if (url.pathname === "/" || url.pathname === "") {
        return `${url.origin}/api/public/hooks/deepfake-scan-execute`;
      }
      return `${url.origin}${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  for (const key of [
    "DEEPFAKE_SCAN_WORKER_BASE_URL",
    "COPYRIGHT_SCAN_WORKER_BASE_URL",
    "SITE_URL",
    "APP_URL",
    "PUBLIC_APP_URL",
    "VITE_SITE_URL",
  ]) {
    const origin = normalizeOrigin(process.env[key]);
    if (origin) return `${origin}/api/public/hooks/deepfake-scan-execute`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/public/hooks/deepfake-scan-execute`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/public/hooks/deepfake-scan-execute`;
  }
  return null;
}

const checks = [];
const workerUrl = resolveScanWorkerUrl();
const secretPresent = present("COPYRIGHT_SCAN_WORKER_SECRET");
const giUrl =
  process.env.DEEPFAKE_GOOGLE_IMAGES_WORKER_URL?.trim() ||
  (normalizeOrigin(process.env.SITE_URL || process.env.PUBLIC_APP_URL)
    ? `${normalizeOrigin(process.env.SITE_URL || process.env.PUBLIC_APP_URL)}/api/public/hooks/deepfake-google-images-worker`
    : null);

checks.push({
  name: "DEEPFAKE_SCAN_WORKER_URL / SITE_URL resolvable",
  ok: Boolean(workerUrl),
  detail: workerUrl || "missing",
});
checks.push({
  name: "COPYRIGHT_SCAN_WORKER_SECRET present",
  ok: secretPresent,
  detail: secretPresent ? "present" : "missing",
});
checks.push({
  name: "Google Images worker URL resolvable",
  ok: Boolean(giUrl),
  detail: giUrl || "missing",
});
checks.push({
  name: "Vercel waitUntil runtime hint",
  ok: process.env.VERCEL === "1" || process.env.VERCEL_ENV != null || process.env.NODE_ENV !== "production",
  detail:
    process.env.VERCEL === "1"
      ? "VERCEL=1 (waitUntil supported)"
      : process.env.VERCEL_ENV
        ? `VERCEL_ENV=${process.env.VERCEL_ENV}`
        : "Not on Vercel in this process — ensure production deploy uses Vercel Functions",
});

let probe = null;
if (process.env.DEEPFAKE_PROBE_WORKER === "1" && workerUrl && secretPresent) {
  const body = JSON.stringify({
    scan_id: "00000000-0000-4000-8000-000000000000",
  });
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", process.env.COPYRIGHT_SCAN_WORKER_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const started = Date.now();
  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eterna-timestamp": timestamp,
        "x-eterna-signature": signature,
      },
      body,
    });
    const text = await response.text();
    probe = {
      status: response.status,
      duration_ms: Date.now() - started,
      body_preview: text.slice(0, 300),
      ok: response.status === 202,
    };
    checks.push({
      name: "Worker hook probe returns HTTP 202 quickly",
      ok: response.status === 202 && Date.now() - started < 8_000,
      detail: `status=${response.status} duration_ms=${Date.now() - started}`,
    });
  } catch (error) {
    probe = {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - started,
    };
    checks.push({
      name: "Worker hook probe returns HTTP 202 quickly",
      ok: false,
      detail: probe.error,
    });
  }
}

const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
}
if (probe) {
  console.log("PROBE", JSON.stringify(probe));
}

if (failed.length) {
  console.error(`\n${failed.length} deployment validation check(s) failed.`);
  process.exit(1);
}

console.log("\nAll available Deepfake startup deployment checks passed.");
