/**
 * Dispatch background Google Images investigation workers.
 */

import {
  classifyStartupNetworkError,
  instrumentedWorkerFetch,
  type StartupNetworkErrorCategory,
} from "./startup-network.server";

const HOOK_PATH = "/api/public/hooks/deepfake-google-images-worker";

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
    if (url.pathname === "/" || url.pathname === "") {
      return `${url.origin}${HOOK_PATH}`;
    }
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function resolveGoogleImagesWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.DEEPFAKE_GOOGLE_IMAGES_WORKER_URL?.trim();
  if (explicit) {
    return normalizeExplicitWorkerUrl(explicit);
  }

  const candidates = [
    env.DEEPFAKE_SCAN_WORKER_BASE_URL,
    env.SITE_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.VITE_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    const origin = candidate ? normalizeOrigin(candidate) : null;
    if (origin) return `${origin}${HOOK_PATH}`;
  }

  return null;
}

export function isGoogleImagesWorkerDispatchConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    resolveGoogleImagesWorkerUrl(env) &&
      env.COPYRIGHT_SCAN_WORKER_SECRET?.trim(),
  );
}

export async function dispatchGoogleImagesWorker(input: {
  scanId: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{
  dispatched: boolean;
  reason?: string;
  category?: StartupNetworkErrorCategory | null;
  http_status?: number | null;
  worker_url?: string | null;
  request_id?: string | null;
}> {
  const env = input.env ?? process.env;
  const workerUrl = resolveGoogleImagesWorkerUrl(env);

  console.info("deepfake_google_images_worker_dispatch_config", {
    scan_id: input.scanId,
    worker_url: workerUrl,
    worker_secret_present: Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()),
    authentication: env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()
      ? "hmac_configured"
      : "missing_secret",
  });

  if (!workerUrl) {
    return {
      dispatched: false,
      reason: "worker_url_not_configured",
      category: "worker_url_not_configured",
      worker_url: null,
    };
  }

  const body = JSON.stringify({ scan_id: input.scanId });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  try {
    const { signCopyrightScanWorkerRequest } = await import(
      "@/lib/copyright/worker-auth.server"
    );
    const signed = await signCopyrightScanWorkerRequest(body);
    headers["x-eterna-timestamp"] = signed.timestamp;
    headers["x-eterna-signature"] = signed.signature;
  } catch (error) {
    return {
      dispatched: false,
      reason: "worker_secret_not_configured",
      category: classifyStartupNetworkError(error),
      worker_url: workerUrl,
    };
  }

  const fetchResult = await instrumentedWorkerFetch({
    url: workerUrl,
    headers,
    body,
    timeoutMs: input.timeoutMs ?? 8_000,
    purpose: "deepfake_google_images_worker_dispatch",
    scanId: input.scanId,
  });

  if (!fetchResult.ok) {
    return {
      dispatched: false,
      reason: fetchResult.network_error ?? "worker_endpoint_unavailable",
      category: fetchResult.category ?? "worker_endpoint_unavailable",
      http_status: fetchResult.status,
      worker_url: workerUrl,
      request_id: fetchResult.request_id,
    };
  }

  return {
    dispatched: true,
    worker_url: workerUrl,
    http_status: fetchResult.status,
    request_id: fetchResult.request_id,
    category: null,
  };
}
