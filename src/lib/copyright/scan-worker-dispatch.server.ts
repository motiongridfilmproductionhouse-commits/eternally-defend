/**
 * Resolve where queued copyright scans dispatch their executor.
 * Prefers COPYRIGHT_SCAN_WORKER_URL; otherwise derives the same-origin hook URL.
 */

const HOOK_PATH = "/api/public/hooks/copyright-scan-execute";
type WorkerUrlSource =
  | "COPYRIGHT_SCAN_WORKER_URL"
  | "COPYRIGHT_SCAN_WORKER_BASE_URL"
  | "SITE_URL"
  | "APP_URL"
  | "PUBLIC_APP_URL"
  | "VITE_SITE_URL"
  | "VERCEL_PROJECT_PRODUCTION_URL"
  | "VERCEL_URL"
  | "missing";

export interface CopyrightScanWorkerDispatchDiagnostic {
  worker_url_configured: boolean;
  worker_url_source: WorkerUrlSource;
  worker_url_origin: string | null;
  worker_url_path: string | null;
  worker_secret_present: boolean;
  worker_secret_length: number;
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

/** Public for tests — returns explicit worker URL or derived same-origin hook URL. */
export function resolveCopyrightScanWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const diagnostic = copyrightScanWorkerDispatchDiagnostic(env);
  if (diagnostic.worker_url_configured && diagnostic.worker_url_origin && diagnostic.worker_url_path) {
    return `${diagnostic.worker_url_origin}${diagnostic.worker_url_path}`;
  }
  return null;
}

export function copyrightScanWorkerDispatchDiagnostic(
  env: NodeJS.ProcessEnv = process.env,
): CopyrightScanWorkerDispatchDiagnostic {
  const explicit = env.COPYRIGHT_SCAN_WORKER_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      return {
        worker_url_configured: true,
        worker_url_source: "COPYRIGHT_SCAN_WORKER_URL",
        worker_url_origin: url.origin,
        worker_url_path: `${url.pathname}${url.search}`,
        worker_secret_present: Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()),
        worker_secret_length: env.COPYRIGHT_SCAN_WORKER_SECRET?.trim().length ?? 0,
      };
    } catch {
      return {
        worker_url_configured: false,
        worker_url_source: "COPYRIGHT_SCAN_WORKER_URL",
        worker_url_origin: null,
        worker_url_path: null,
        worker_secret_present: Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()),
        worker_secret_length: env.COPYRIGHT_SCAN_WORKER_SECRET?.trim().length ?? 0,
      };
    }
  }

  const candidates: Array<[WorkerUrlSource, string | undefined]> = [
    ["COPYRIGHT_SCAN_WORKER_BASE_URL", env.COPYRIGHT_SCAN_WORKER_BASE_URL],
    ["SITE_URL", env.SITE_URL],
    ["APP_URL", env.APP_URL],
    ["PUBLIC_APP_URL", env.PUBLIC_APP_URL],
    ["VITE_SITE_URL", env.VITE_SITE_URL],
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? ["VERCEL_PROJECT_PRODUCTION_URL", `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : ["VERCEL_PROJECT_PRODUCTION_URL", undefined],
    env.VERCEL_URL ? ["VERCEL_URL", `https://${env.VERCEL_URL}`] : ["VERCEL_URL", undefined],
  ];

  for (const [source, candidate] of candidates) {
    const origin = candidate ? normalizeOrigin(candidate) : null;
    if (origin) {
      return {
        worker_url_configured: true,
        worker_url_source: source,
        worker_url_origin: origin,
        worker_url_path: HOOK_PATH,
        worker_secret_present: Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()),
        worker_secret_length: env.COPYRIGHT_SCAN_WORKER_SECRET?.trim().length ?? 0,
      };
    }
  }

  return {
    worker_url_configured: false,
    worker_url_source: "missing",
    worker_url_origin: null,
    worker_url_path: null,
    worker_secret_present: Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim()),
    worker_secret_length: env.COPYRIGHT_SCAN_WORKER_SECRET?.trim().length ?? 0,
  };
}

export function isCopyrightScanWorkerSecretConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.COPYRIGHT_SCAN_WORKER_SECRET?.trim());
}
