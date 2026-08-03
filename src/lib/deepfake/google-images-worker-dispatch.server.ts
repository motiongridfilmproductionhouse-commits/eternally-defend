/**
 * Dispatch background Google Images investigation workers.
 */

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

export function resolveGoogleImagesWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.DEEPFAKE_GOOGLE_IMAGES_WORKER_URL?.trim();
  if (explicit) return explicit;

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
  return Boolean(resolveGoogleImagesWorkerUrl(env));
}

export async function dispatchGoogleImagesWorker(input: {
  scanId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ dispatched: boolean; reason?: string }> {
  const env = input.env ?? process.env;
  const workerUrl = resolveGoogleImagesWorkerUrl(env);
  if (!workerUrl) {
    return { dispatched: false, reason: "worker_url_not_configured" };
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
    const signed = signCopyrightScanWorkerRequest(body);
    headers["x-eterna-timestamp"] = signed.timestamp;
    headers["x-eterna-signature"] = signed.signature;
  } catch {
    return { dispatched: false, reason: "worker_secret_not_configured" };
  }

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      return {
        dispatched: false,
        reason: `worker_http_${response.status}`,
      };
    }
    return { dispatched: true };
  } catch (error) {
    return {
      dispatched: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
