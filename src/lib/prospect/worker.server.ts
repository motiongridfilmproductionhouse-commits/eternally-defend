/**
 * Pre-Enrollment Intelligence — server-side scan worker.
 *
 * Runs bounded, lease-protected scan steps without any browser involvement.
 * Invoked by the start/rescan request, by itself (chaining) and by pg_cron.
 * Authentication for the hook uses the project's existing scheduler scheme
 * (cron-auth.server.ts): env secret PROSPECT_SCAN_WORKER_SECRET / CRON_SECRET,
 * or the managed token `prospect_scan_worker` in internal_cron_secrets.
 */

import { planWorkerTick, shouldChain, type WorkerScanRow } from "./worker";

export const WORKER_HOOK_PATH = "/api/public/hooks/prospect-scan-worker";
export const WORKER_JOB_NAME = "prospect_scan_worker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function adminDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

export interface WorkerTickResult {
  advanced: Array<{ scanId: string; status: string; unitsRun: number; leased: boolean }>;
  expired: string[];
  remaining: number;
  unitsRun: number;
}

/**
 * One worker tick: expire scans that exceeded the maximum run time, then
 * advance runnable scans one bounded step each until the budget is spent.
 */
export async function runProspectWorkerTick(opts: {
  budgetMs: number;
  scanId?: string;
}): Promise<WorkerTickResult> {
  const started = Date.now();
  const db = await adminDb();
  const { advanceProspectScan } = await import("./runner-wiring.server");

  let query = db
    .from("prospect_scans")
    .select("id, status, created_at, started_at, worker_lease_until")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(25);
  if (opts.scanId) query = query.eq("id", opts.scanId);
  const { data: rows, error } = await query;
  if (error) throw new Error(`prospect worker: ${error.message}`);

  const plan = planWorkerTick((rows ?? []) as WorkerScanRow[], Date.now());
  const result: WorkerTickResult = { advanced: [], expired: [], remaining: 0, unitsRun: 0 };

  for (const id of plan.toExpire) {
    const message =
      "Scan did not finish within the maximum run time. Results stored up to this point are kept.";
    const { data: updated } = await db
      .from("prospect_scans")
      .update({ status: "failed", error_message: message, finished_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["queued", "running"])
      .or(`worker_lease_until.is.null,worker_lease_until.lt.${new Date().toISOString()}`)
      .select("id");
    if (updated?.length) {
      await db.from("prospect_scan_events").insert({
        scan_id: id,
        level: "error",
        message: `Scan failed: ${message}`,
        detail: { type: "SCAN_FAILED", reason: "MAX_RUN_TIME" },
      });
      result.expired.push(id);
    }
  }

  for (const id of plan.toAdvance) {
    const left = opts.budgetMs - (Date.now() - started);
    if (left < 4_000) break;
    try {
      const r = await advanceProspectScan(id, Math.min(left - 2_000, 20_000));
      result.advanced.push({
        scanId: id,
        status: r.status,
        unitsRun: r.unitsRun,
        leased: r.leased,
      });
      result.unitsRun += r.unitsRun;
    } catch (err) {
      console.error("[prospect-worker] step failed", id, err instanceof Error ? err.message : err);
    }
  }

  let remainingQuery = db
    .from("prospect_scans")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "running"]);
  if (opts.scanId) remainingQuery = remainingQuery.eq("id", opts.scanId);
  const { count } = await remainingQuery;
  result.remaining = count ?? 0;
  return result;
}

function normalizeOrigin(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Where the worker hook lives: explicit env first, then the current request's origin. */
export function resolveWorkerOrigin(
  requestUrl?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const candidate of [
    env.PROSPECT_SCAN_WORKER_BASE_URL,
    env.SITE_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.VITE_SITE_URL,
  ]) {
    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }
  return normalizeOrigin(requestUrl ?? null);
}

async function workerCredential(): Promise<string | null> {
  const env = process.env.PROSPECT_SCAN_WORKER_SECRET?.trim();
  if (env && env.length >= 16) return env;
  try {
    const db = await adminDb();
    const { data } = await db
      .from("internal_cron_secrets")
      .select("token")
      .eq("name", WORKER_JOB_NAME)
      .maybeSingle();
    const token = typeof data?.token === "string" ? data.token.trim() : "";
    return token.length >= 16 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Fire the worker hook (server → server). Never throws: if no origin or
 * credential is available, pg_cron still picks the scan up within a minute.
 */
export async function dispatchProspectWorker(input: {
  origin: string | null;
  scanId?: string;
  hop: number;
}): Promise<{ dispatched: boolean; reason?: string }> {
  if (!input.origin) return { dispatched: false, reason: "no_origin" };
  const credential = await workerCredential();
  if (!credential) return { dispatched: false, reason: "no_credential" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${input.origin}${WORKER_HOOK_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
      body: JSON.stringify({ scan_id: input.scanId ?? null, hop: input.hop }),
      signal: controller.signal,
    });
    return { dispatched: res.ok || res.status === 202 };
  } catch (err) {
    // Not confirmed — pg_cron will still pick the scan up within a minute.
    return { dispatched: false, reason: err instanceof Error ? err.message : "dispatch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export { shouldChain };

/**
 * Keep background work alive after the response: Nitro attaches Cloudflare's
 * request-lifetime hook to the request; Vercel uses the existing helper.
 */
export async function keepAlive(work: Promise<unknown>): Promise<void> {
  const { getRequest } = await import("@tanstack/react-start/server");
  let request: (Request & { waitUntil?: (p: Promise<unknown>) => void }) | null = null;
  try {
    request = getRequest() as Request & { waitUntil?: (p: Promise<unknown>) => void };
  } catch {
    request = null;
  }
  if (request?.waitUntil) request.waitUntil(work);
  else {
    const { registerWaitUntilExecution } = await import("@/lib/deepfake/startup-network.server");
    registerWaitUntilExecution(work);
  }
}
