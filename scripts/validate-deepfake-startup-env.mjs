#!/usr/bin/env node
/**
 * Deepfake Intelligence startup validation.
 *
 * Level 1 (default):
 *   node scripts/validate-deepfake-startup-env.mjs
 *   - URL valid, secret present, hook responds, schema tables exist
 *
 * Level 2 (real execution):
 *   DEEPFAKE_PROBE_WORKER=1 node scripts/validate-deepfake-startup-env.mjs
 *   - create disposable scan + 1 query checkpoint
 *   - signed dispatch → expect HTTP 202
 *   - poll worker events until worker_execution_started
 *   - confirm checkpoint next_query_index advanced OR claim event claimed_count > 0
 *   - clean up
 *
 * HTTP 202 alone is NOT success for Level 2.
 */

import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

function signBody(body, secret) {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { timestamp, signature };
}

function adminClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const checks = [];
const workerUrl = resolveScanWorkerUrl();
const secretPresent = present("COPYRIGHT_SCAN_WORKER_SECRET");
const admin = adminClient();

checks.push({
  name: "worker_url_valid",
  ok: Boolean(workerUrl),
  detail: workerUrl || "missing",
});
checks.push({
  name: "worker_secret_present",
  ok: secretPresent,
  detail: secretPresent ? "present" : "missing",
});
checks.push({
  name: "supabase_service_role_present",
  ok: Boolean(admin),
  detail: admin ? "present" : "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
});

if (admin) {
  for (const table of ["deepfake_scans", "deepfake_google_images_jobs", "deepfake_worker_events"]) {
    const { error } = await admin.from(table).select("id").limit(0);
    checks.push({
      name: `schema_${table}`,
      ok: !error,
      detail: error ? error.message : "ok",
    });
  }
}

if (workerUrl) {
  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scan_id: randomUUID() }),
    });
    checks.push({
      name: "hook_responds_auth_enforced",
      ok: response.status === 401,
      detail: `status=${response.status}`,
    });
  } catch (error) {
    checks.push({
      name: "hook_responds_auth_enforced",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

let level2 = null;
if (process.env.DEEPFAKE_PROBE_WORKER === "1") {
  if (!workerUrl || !secretPresent || !admin) {
    checks.push({
      name: "level2_prerequisites",
      ok: false,
      detail: "Need worker URL, secret, and service-role Supabase client",
    });
  } else {
    const scanId = randomUUID();
    const workerExecutionId = randomUUID();
    const startupCorrelationId = randomUUID();
    const userId = process.env.DEEPFAKE_PROBE_USER_ID?.trim() || null;
    let stage = "create_disposable_scan";
    try {
      if (!userId) {
        throw new Error(
          "DEEPFAKE_PROBE_USER_ID is required for Level 2 (must be a valid auth.users id)",
        );
      }

      const checkpoint = {
        version: 1,
        stage: "discovering",
        queries: ['"startup probe" deepfake'],
        next_query_index: 0,
        completed_query_ids: [],
        pending_candidate_urls: [],
        verified_canonical_urls: [],
        youtube_done: true,
        reddit_done: true,
        related_done: true,
        serpapi_queries: [],
        serpapi_next_query_index: 0,
        serpapi_completed_query_ids: [],
        serpapi_seen_page_urls: [],
        planned_query_count: 1,
        initial_wave_count: 1,
        average_provider_latency_ms: 0,
        provider_latencies_ms: {},
        risk_counts: { critical: 0, high: 0, medium: 0, low: 0 },
        discovery_count: 0,
        finding_count: 0,
        client_visible_count: 0,
        metrics: { queries_generated: 1 },
        pending_work: true,
        last_checkpoint_at: new Date().toISOString(),
        target_name: "Startup Probe",
        profile_id: null,
        aliases: [],
        handles: [],
        per_query_limit: 10,
        max_queries: 1,
      };

      const { error: insertError } = await admin.from("deepfake_scans").insert({
        id: scanId,
        user_id: userId,
        target_name: "Startup Probe",
        aliases: [],
        handles: [],
        status: "running",
        scan_run_token: randomUUID(),
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 180_000).toISOString(),
        total_queries: 1,
        scan_checkpoint: checkpoint,
        discovery_metrics: {
          queries_generated: 1,
          startup_correlation_id: startupCorrelationId,
          worker_execution_id: workerExecutionId,
          first_worker_expected_by: new Date(Date.now() + 20_000).toISOString(),
          probe: true,
        },
      });
      if (insertError) throw new Error(insertError.message);

      stage = "signed_dispatch";
      const body = JSON.stringify({
        scan_id: scanId,
        worker_execution_id: workerExecutionId,
        startup_correlation_id: startupCorrelationId,
      });
      const signed = signBody(body, process.env.COPYRIGHT_SCAN_WORKER_SECRET);
      const started = Date.now();
      const response = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eterna-timestamp": signed.timestamp,
          "x-eterna-signature": signed.signature,
        },
        body,
      });
      const text = await response.text();
      const durationMs = Date.now() - started;
      checks.push({
        name: "level2_http_202",
        ok: response.status === 202,
        detail: `status=${response.status} duration_ms=${durationMs} body=${text.slice(0, 160)}`,
      });
      if (response.status !== 202) {
        throw new Error(`Expected HTTP 202, got ${response.status}`);
      }

      stage = "poll_worker_execution_started";
      let sawStarted = false;
      let sawClaim = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        const { data: events } = await admin
          .from("deepfake_worker_events")
          .select("event_name, metadata")
          .eq("scan_id", scanId)
          .order("created_at", { ascending: true });
        const names = (events ?? []).map((e) => e.event_name);
        if (names.includes("worker_execution_started")) sawStarted = true;
        const claim = (events ?? []).find((e) => e.event_name === "query_claim_completed");
        if (claim && Number(claim.metadata?.claimed_count) > 0) sawClaim = true;
        const { data: scanRow } = await admin
          .from("deepfake_scans")
          .select("scan_checkpoint, discovery_metrics")
          .eq("id", scanId)
          .maybeSingle();
        const nextIndex = Number(scanRow?.scan_checkpoint?.next_query_index ?? 0);
        if (nextIndex > 0) sawClaim = true;
        if (sawStarted && sawClaim) break;
      }

      checks.push({
        name: "level2_worker_execution_started",
        ok: sawStarted,
        detail: sawStarted ? "observed" : "missing after 60s",
      });
      checks.push({
        name: "level2_query_progressed",
        ok: sawClaim,
        detail: sawClaim
          ? "claimed_count>0 or next_query_index advanced"
          : "no query progress after worker accept",
      });

      level2 = { scanId, sawStarted, sawClaim, stage: "complete" };
      if (!sawStarted || !sawClaim) {
        throw new Error(
          `Level 2 failed at ${!sawStarted ? "worker_execution_started" : "query_progress"}`,
        );
      }
    } catch (error) {
      level2 = {
        scanId,
        stage,
        error: error instanceof Error ? error.message : String(error),
      };
      checks.push({
        name: "level2_execution_probe",
        ok: false,
        detail: `${stage}: ${level2.error}`,
      });
    } finally {
      if (admin && scanId) {
        await admin.from("deepfake_worker_events").delete().eq("scan_id", scanId);
        await admin.from("deepfake_scans").delete().eq("id", scanId);
      }
    }
  }
}

const failed = checks.filter((c) => !c.ok);
const probeEnabled = process.env.DEEPFAKE_PROBE_WORKER === "1";
console.log(
  probeEnabled
    ? "Deepfake startup validation — Level 2 (real execution probe)"
    : "Deepfake startup validation — Level 1 (configuration probe)",
);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
}
if (level2) console.log("LEVEL2", JSON.stringify(level2));

if (failed.length) {
  console.error(`\n${failed.length} Deepfake startup validation check(s) failed.`);
  if (probeEnabled) {
    console.error(
      "Level 2 requires worker_execution_started + query progress. HTTP 202 alone is not success.",
    );
  }
  process.exit(1);
}
console.log(
  probeEnabled
    ? "\nDeepfake Level 2 execution probe passed (worker started and query progressed)."
    : "\nDeepfake Level 1 configuration probe passed.",
);
