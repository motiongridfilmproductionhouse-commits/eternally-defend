/**
 * Resolve where queued copyright scans dispatch their executor.
 * Prefers COPYRIGHT_SCAN_WORKER_URL; otherwise derives the same-origin hook URL.
 */

const HOOK_PATH = "/api/public/hooks/copyright-scan-execute";

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

/** Public for tests — returns explicit worker URL or derived same-origin hook URL. */
export function resolveCopyrightScanWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.COPYRIGHT_SCAN_WORKER_URL?.trim();
  if (explicit) return explicit;

  const candidates = [
    env.COPYRIGHT_SCAN_WORKER_BASE_URL,
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

export function isCopyrightScanWorkerSecretConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim());
}
