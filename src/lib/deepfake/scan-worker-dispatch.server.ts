/**
 * Dispatch background Deepfake Intelligence main-scan workers.
 */

import { randomUUID } from "node:crypto";
import {
  classifyStartupNetworkError,
  instrumentedWorkerFetch,
  startupErrorLabel,
  type StartupNetworkErrorCategory,
} from "./startup-network.server";

const HOOK_PATH = "/api/public/hooks/deepfake-scan-execute";

function cryptoRandomId(): string {
  return randomUUID();
}

type WorkerUrlSource =
  | "DEEPFAKE_SCAN_WORKER_URL"
  | "DEEPFAKE_SCAN_WORKER_BASE_URL"
  | "COPYRIGHT_SCAN_WORKER_BASE_URL"
  | "SITE_URL"
  | "APP_URL"
  | "PUBLIC_APP_URL"
  | "VITE_SITE_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "VERCEL_URL"
  | "missing"
  | "invalid";

export interface DeepfakeScanWorkerDispatchDiagnostic {
  worker_url_configured: boolean;
  worker_url_valid: boolean;
  worker_url_source: WorkerUrlSource;
  worker_url: string | null;
  worker_url_origin: string | null;
  worker_url_path: string | null;
  worker_secret_present: boolean;
  failure_category: StartupNetworkErrorCategory | null;
  failure_label: string | null;
}

function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeExplicitWorkerUrl(raw: string): string | null {
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Bare origin / missing hook path → append canonical hook.
    if (url.pathname === "/" || url.pathname === "") {
      return `${url.origin}${HOOK_PATH}`;
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function deepfakeScanWorkerDispatchDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
): DeepfakeScanWorkerDispatchDiagnostic {
  const secretPresent = Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim());
  const explicit = env.DEEPFAKE_SCAN_WORKER_URL?.trim();

  if (explicit) {
    const normalized = normalizeExplicitWorkerUrl(explicit);
    if (!normalized) {
      return {
        worker_url_configured: true,
        worker_url_valid: false,
        worker_url_source: "invalid",
        worker_url: null,
        worker_url_origin: null,
        worker_url_path: null,
        worker_secret_present: secretPresent,
        failure_category: "worker_url_invalid",
        failure_label: startupErrorLabel("worker_url_invalid"),
      };
    }
    const parsed = new URL(normalized);
    return {
      worker_url_configured: true,
      worker_url_valid: true,
      worker_url_source: "DEEPFAKE_SCAN_WORKER_URL",
      worker_url: normalized,
      worker_url_origin: parsed.origin,
      worker_url_path: `${parsed.pathname}${parsed.search}`,
      worker_secret_present: secretPresent,
      failure_category: secretPresent ? null : "worker_secret_not_configured",
      failure_label: secretPresent
        ? null
        : startupErrorLabel("worker_secret_not_configured"),
    };
  }

  const candidates: Array<[WorkerUrlSource, string | undefined]> = [
    ["DEEPFAKE_SCAN_WORKER_BASE_URL", env.DEEPFAKE_SCAN_WORKER_BASE_URL],
    ["COPYRIGHT_SCAN_WORKER_BASE_URL", env.COPYRIGHT_SCAN_WORKER_BASE_URL],
    ["SITE_URL", env.SITE_URL],
    ["APP_URL", env.APP_URL],
    ["PUBLIC_APP_URL", env.PUBLIC_APP_URL],
    ["VITE_SITE_URL", env.VITE_SITE_URL],
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? [
          "VERCEL_PROJECT_PRODUCTION_URL",
          `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
        ]
      : ["VERCEL_PROJECT_PRODUCTION_URL", undefined],
    env.VERCEL_URL
      ? ["VERCEL_URL", `https://${env.VERCEL_URL}`]
      : ["VERCEL_URL", undefined],
  ];

  for (const [source, candidate] of candidates) {
    const origin = candidate ? normalizeOrigin(candidate) : null;
    if (!origin) continue;
    const workerUrl = `${origin}${HOOK_PATH}`;
    return {
      worker_url_configured: true,
      worker_url_valid: true,
      worker_url_source: source,
      worker_url: workerUrl,
      worker_url_origin: origin,
      worker_url_path: HOOK_PATH,
      worker_secret_present: secretPresent,
      failure_category: secretPresent ? null : "worker_secret_not_configured",
      failure_label: secretPresent
        ? null
        : startupErrorLabel("worker_secret_not_configured"),
    };
  }

  return {
    worker_url_configured: false,
    worker_url_valid: false,
    worker_url_source: "missing",
    worker_url: null,
    worker_url_origin: null,
    worker_url_path: null,
    worker_secret_present: secretPresent,
    failure_category: "worker_url_not_configured",
    failure_label: startupErrorLabel("worker_url_not_configured"),
  };
}

export type DeepfakeScanWorkerDispatchResult = {
  dispatched: boolean;
  reason?: string;
  category?: StartupNetworkErrorCategory | null;
  http_status?: number | null;
  response_body?: string | null;
  next_worker_execution_id?: string | null;
  worker_url?: string | null;
  request_id?: string | null;
  duration_ms?: number | null;
};

export function resolveDeepfakeScanWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic(env);
  if (diagnostic.worker_url_valid && diagnostic.worker_url) {
    return diagnostic.worker_url;
  }
  return null;
}

export function isDeepfakeScanWorkerDispatchConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic(env);
  return diagnostic.worker_url_valid && diagnostic.worker_secret_present;
}

/**
 * Validate required startup configuration. Throws a categorized Error when
 * the worker cannot be dispatched (invalid/missing URL or secret).
 */
export function assertDeepfakeStartupWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): DeepfakeScanWorkerDispatchDiagnostic {
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic(env);
  if (!diagnostic.worker_url_valid || !diagnostic.worker_url) {
    const category =
      diagnostic.failure_category ?? "worker_url_not_configured";
    const error = new Error(startupErrorLabel(category));
    (error as Error & { startupCategory?: StartupNetworkErrorCategory }).startupCategory =
      category;
    throw error;
  }
  if (!diagnostic.worker_secret_present) {
    const error = new Error(
      startupErrorLabel("worker_secret_not_configured"),
    );
    (error as Error & { startupCategory?: StartupNetworkErrorCategory }).startupCategory =
      "worker_secret_not_configured";
    throw error;
  }
  return diagnostic;
}

export async function dispatchNextWorker(input: {
  scanId: string;
  env?: NodeJS.ProcessEnv;
  nextWorkerExecutionId?: string;
  startupCorrelationId?: string;
  /** Keep dispatch short so scan-start never blocks on a full worker batch. */
  timeoutMs?: number;
}): Promise<DeepfakeScanWorkerDispatchResult> {
  const env = input.env ?? process.env;
  const diagnostic = deepfakeScanWorkerDispatchDiagnostic(env);
  const workerUrl = diagnostic.worker_url;
  const workerExecutionId = input.nextWorkerExecutionId ?? cryptoRandomId();

  console.info("deepfake_scan_worker_dispatch_config", {
    scan_id: input.scanId,
    worker_url: workerUrl,
    worker_url_source: diagnostic.worker_url_source,
    worker_secret_present: diagnostic.worker_secret_present,
    authentication: diagnostic.worker_secret_present
      ? "hmac_configured"
      : "missing_secret",
    worker_execution_id: workerExecutionId,
    startup_correlation_id: input.startupCorrelationId ?? null,
  });

  if (!workerUrl || !diagnostic.worker_url_valid) {
    return {
      dispatched: false,
      reason: diagnostic.failure_category ?? "worker_url_not_configured",
      category: diagnostic.failure_category ?? "worker_url_not_configured",
      worker_url: null,
      next_worker_execution_id: workerExecutionId,
    };
  }

  if (!diagnostic.worker_secret_present) {
    return {
      dispatched: false,
      reason: "worker_secret_not_configured",
      category: "worker_secret_not_configured",
      worker_url: workerUrl,
      next_worker_execution_id: workerExecutionId,
    };
  }

  const body = JSON.stringify({
    scan_id: input.scanId,
    worker_execution_id: workerExecutionId,
    startup_correlation_id: input.startupCorrelationId ?? null,
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  try {
    const { signCopyrightScanWorkerRequest } = await import(
      "@/lib/copyright/worker-auth.server"
    );
    const signed = signCopyrightScanWorkerRequest(body);
    headers["x-eterna-timestamp"] = signed.timestamp;
    headers["x-eterna-signature"] = signed.signature;
  } catch (error) {
    const category = classifyStartupNetworkError(error);
    return {
      dispatched: false,
      reason: "worker_secret_not_configured",
      category:
        category === "network_failed"
          ? "worker_secret_not_configured"
          : category,
      worker_url: workerUrl,
    };
  }

  // Short timeout: hooks acknowledge with 202 immediately. Never wait for a
  // full 35s worker batch from the start/dispatch path.
  const fetchResult = await instrumentedWorkerFetch({
    url: workerUrl,
    headers,
    body,
    timeoutMs: input.timeoutMs ?? 8_000,
    purpose: "deepfake_scan_worker_dispatch",
    scanId: input.scanId,
  });

  if (!fetchResult.ok) {
    return {
      dispatched: false,
      reason: fetchResult.network_error ?? "worker_endpoint_unavailable",
      category: fetchResult.category ?? "worker_endpoint_unavailable",
      http_status: fetchResult.status,
      response_body: fetchResult.response_preview,
      next_worker_execution_id: workerExecutionId,
      worker_url: workerUrl,
      request_id: fetchResult.request_id,
      duration_ms: fetchResult.duration_ms,
    };
  }

  return {
    dispatched: true,
    http_status: fetchResult.status,
    response_body: fetchResult.response_preview,
    next_worker_execution_id: workerExecutionId,
    worker_url: workerUrl,
    request_id: fetchResult.request_id,
    duration_ms: fetchResult.duration_ms,
    category: null,
  };
}
