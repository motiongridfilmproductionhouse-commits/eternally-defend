/**
 * Startup network instrumentation and error classification for Deepfake Intelligence.
 * Never surfaces raw "TypeError: fetch failed" to operators or end users.
 */

import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";

export type StartupNetworkErrorCategory =
  | "worker_endpoint_unavailable"
  | "worker_authentication_failed"
  | "worker_url_not_configured"
  | "worker_secret_not_configured"
  | "worker_url_invalid"
  | "backend_unavailable"
  | "database_unavailable"
  | "timeout"
  | "dns_resolution_failed"
  | "tls_failure"
  | "connection_refused"
  | "network_failed";

export type StartupStage =
  | "validate_config"
  | "create_scan_record"
  | "generate_queries"
  | "save_scan"
  | "dispatch_worker"
  | "google_images_queue"
  | "return_scan_id";

export interface InstrumentedFetchResult {
  request_id: string;
  url: string;
  method: string;
  body_size: number;
  timeout_ms: number;
  duration_ms: number;
  ok: boolean;
  status: number | null;
  response_preview: string | null;
  network_error: string | null;
  category: StartupNetworkErrorCategory | null;
}

const SECRET_HEADER_KEYS = new Set(["authorization", "cookie", "x-eterna-signature", "x-api-key"]);

export function redactHeaders(
  headers: Record<string, string> | Headers | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries =
    headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    out[key] = SECRET_HEADER_KEYS.has(lower) ? "[redacted]" : value;
  }
  return out;
}

export function classifyStartupNetworkError(error: unknown): StartupNetworkErrorCategory {
  if (error && typeof error === "object") {
    const tagged = (error as { startupCategory?: StartupNetworkErrorCategory }).startupCategory;
    if (tagged) return tagged;
  }

  const message =
    error instanceof Error
      ? `${error.name} ${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}`
      : String(error);
  const lower = message.toLowerCase();

  if (/worker_url_not_configured|worker url not configured/i.test(lower)) {
    return "worker_url_not_configured";
  }
  if (/worker_secret_not_configured|copyright_scan_worker_secret/i.test(lower)) {
    return "worker_secret_not_configured";
  }
  if (/worker_url_invalid|invalid worker url/i.test(lower)) {
    return "worker_url_invalid";
  }
  if (/worker_http_401|worker_http_403|invalid signature|authentication/i.test(lower)) {
    return "worker_authentication_failed";
  }
  if (/enotfound|eai_again|getaddrinfo|dns resolution/i.test(lower)) {
    return "dns_resolution_failed";
  }
  if (/econnrefused|connection refused/i.test(lower)) {
    return "connection_refused";
  }
  if (/cert|ssl|tls|err_tls|unable to verify|altname|handshake/i.test(lower)) {
    return "tls_failure";
  }
  if (/timeout|timed out|etimedout|aborted|abort.*timeout/i.test(lower)) {
    return "timeout";
  }
  if (/supabase|postgrest|database|pgrst/i.test(lower)) {
    return "database_unavailable";
  }
  if (/econnreset|fetch failed|network|undici|socket/i.test(lower)) {
    return "worker_endpoint_unavailable";
  }
  return "network_failed";
}

export function startupErrorLabel(category: StartupNetworkErrorCategory): string {
  switch (category) {
    case "worker_endpoint_unavailable":
      return "Worker endpoint unavailable";
    case "worker_authentication_failed":
      return "Worker authentication failed";
    case "worker_url_not_configured":
      return "Worker URL is not configured";
    case "worker_secret_not_configured":
      return "Worker authentication secret is not configured";
    case "worker_url_invalid":
      return "Worker URL is invalid";
    case "backend_unavailable":
      return "Backend unavailable";
    case "database_unavailable":
      return "Database unavailable";
    case "timeout":
      return "Timeout";
    case "dns_resolution_failed":
      return "DNS resolution failed";
    case "tls_failure":
      return "TLS failure";
    case "connection_refused":
      return "Connection refused";
    default:
      return "Network failed";
  }
}

export function formatStartupUserError(input: {
  category: StartupNetworkErrorCategory;
  detail?: string | null;
}): string {
  const label = startupErrorLabel(input.category);
  const detail = input.detail?.trim();
  return [
    "Unable to start investigation.",
    "",
    "The Deepfake Intelligence worker could not be reached.",
    "",
    "Error:",
    label + (detail && detail !== label ? ` (${detail})` : ""),
  ].join("\n");
}

export function logStartupStage(stage: StartupStage, fields: Record<string, unknown>): void {
  console.info("deepfake_startup_stage", { stage, ...fields });
}

/**
 * Instrumented POST used for worker dispatch. Always logs request metadata
 * (secrets redacted). Does not throw — returns structured failure info.
 */
export async function instrumentedWorkerFetch(input: {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  purpose: string;
  scanId?: string;
}): Promise<InstrumentedFetchResult> {
  const requestId = randomUUID();
  const method = input.method ?? "POST";
  const timeoutMs = input.timeoutMs ?? 8_000;
  const started = Date.now();

  console.info("deepfake_startup_fetch_request", {
    request_id: requestId,
    purpose: input.purpose,
    scan_id: input.scanId ?? null,
    url: input.url,
    method,
    headers: redactHeaders(input.headers),
    body_size: input.body.length,
    timeout_ms: timeoutMs,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.url, {
      method,
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    const preview = text.slice(0, 500);
    const durationMs = Date.now() - started;

    console.info("deepfake_startup_fetch_response", {
      request_id: requestId,
      purpose: input.purpose,
      scan_id: input.scanId ?? null,
      url: input.url,
      method,
      status: response.status,
      duration_ms: durationMs,
      response_preview: preview,
      ok: response.ok,
    });

    return {
      request_id: requestId,
      url: input.url,
      method,
      body_size: input.body.length,
      timeout_ms: timeoutMs,
      duration_ms: durationMs,
      ok: response.ok,
      status: response.status,
      response_preview: preview,
      network_error: response.ok ? null : `worker_http_${response.status}`,
      category: response.ok
        ? null
        : response.status === 401 || response.status === 403
          ? "worker_authentication_failed"
          : "worker_endpoint_unavailable",
    };
  } catch (error) {
    const category = classifyStartupNetworkError(error);
    const networkError = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - started;

    console.error("deepfake_startup_fetch_failed", {
      request_id: requestId,
      purpose: input.purpose,
      scan_id: input.scanId ?? null,
      url: input.url,
      method,
      duration_ms: durationMs,
      network_error: networkError,
      category,
      cause: error instanceof Error && error.cause ? String(error.cause) : null,
    });

    return {
      request_id: requestId,
      url: input.url,
      method,
      body_size: input.body.length,
      timeout_ms: timeoutMs,
      duration_ms: durationMs,
      ok: false,
      status: null,
      response_preview: null,
      network_error: networkError,
      category,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isVercelWaitUntilRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1" || env.VERCEL_ENV != null;
}

export function isProductionDeepfakeRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === "1" || env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * Keep background work alive after returning an HTTP 202.
 * Uses Vercel waitUntil when the runtime supports it.
 *
 * IMPORTANT: pass the execution Promise directly — never wrap in
 * setImmediate / setTimeout / Promise.resolve before waitUntil.
 */
export function keepBackgroundWorkAlive(work: Promise<unknown>): {
  wait_until_used: boolean;
} {
  try {
    waitUntil(work);
    return { wait_until_used: true };
  } catch {
    // Outside Vercel request context waitUntil may throw — still schedule.
    void work;
    return { wait_until_used: false };
  }
}

/**
 * Register an already-created execution promise with waitUntil during the
 * request lifecycle. The promise must already be running (not deferred via
 * setImmediate) so Vercel can retain it.
 */
export function registerWaitUntilExecution(executionPromise: Promise<unknown>): {
  wait_until_used: boolean;
} {
  const kept = keepBackgroundWorkAlive(executionPromise);
  console.info("deepfake_worker_wait_until_registered", {
    wait_until_used: kept.wait_until_used,
    vercel_runtime: isVercelWaitUntilRuntime(),
  });
  return kept;
}

/**
 * @deprecated Prefer registerWaitUntilExecution(executionPromise) with a
 * promise created in the same tick as waitUntil — no setImmediate.
 */
export function runAcceptedBackgroundWork(factory: () => Promise<unknown>): {
  wait_until_used: boolean;
  deferred: true;
} {
  const executionPromise = factory();
  const kept = registerWaitUntilExecution(executionPromise);
  return { wait_until_used: kept.wait_until_used, deferred: true };
}
