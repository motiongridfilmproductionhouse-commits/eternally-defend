/**
 * Server adapters for the EIP worker: engine HTTP client (bearer service token,
 * timeouts) and database/storage access via the managed eip_worker token.
 * All env reads happen inside functions (per-request env on Workers).
 */
import { createClient } from "@supabase/supabase-js";
import { EngineError, type DbPort, type EnginePort, type WorkerConfig } from "./worker-core";

export const EIP_WORKER_HEADER = "x-eip-worker-token";

export function readWorkerConfig(): WorkerConfig & {
  baseUrl: string | null;
  token: string | null;
  timeoutMs: number;
} {
  const env = process.env;
  const baseUrl = env["EIP_ENGINE_BASE_URL"]?.trim().replace(/\/+$/, "") || null;
  const token = env["EIP_ENGINE_SERVICE_TOKEN"]?.trim() || null;
  const prod = !!baseUrl && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl);
  // Production requires HTTPS; plain http is allowed only for a local development engine.
  const urlOk = !!baseUrl && (!prod || baseUrl.startsWith("https://"));
  return {
    enabled: env["EIP_ENGINE_ENABLED"] === "true" && urlOk && !!token,
    baseUrl,
    token,
    timeoutMs: 20_000,
    jobTimeoutSeconds: Number(env["EIP_ENGINE_TIMEOUT_SECONDS"] ?? 3600) || 3600,
    expected: {
      engineVersion: env["EIP_ENGINE_VERSION_EXPECTED"]?.trim() || undefined,
      configSha256: env["EIP_ENGINE_CONFIG_SHA256_EXPECTED"]?.trim().toLowerCase() || undefined,
    },
    evaluationVersion: env["EIP_EVALUATION_VERSION"]?.trim() || undefined,
    batch: 3,
  };
}

export function httpEngine(baseUrl: string, token: string, timeoutMs: number): EnginePort {
  const call = async (method: string, path: string, body?: unknown, idem?: string) => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(idem ? { "Idempotency-Key": idem } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new EngineError(
        e instanceof Error && e.name === "TimeoutError" ? "ENGINE_TIMEOUT" : "ENGINE_UNAVAILABLE",
        `${method} ${path}`,
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new EngineError("ENGINE_AUTH_REJECTED", `${res.status}`);
    // 409 on submit = already exists (idempotent); engine returns the existing job body.
    if (!res.ok && res.status !== 409)
      throw new EngineError(
        res.status >= 500 ? "ENGINE_UNAVAILABLE" : "ENGINE_RESPONSE_INVALID",
        `${method} ${path} ${res.status}`,
      );
    try {
      return await res.json();
    } catch {
      throw new EngineError("ENGINE_RESPONSE_INVALID", "non-json");
    }
  };
  return {
    health: () => call("GET", "/health"),
    submitJob: (b, k) => call("POST", "/v1/jobs", b, k),
    getJob: (id) => call("GET", `/v1/jobs/${encodeURIComponent(id)}`),
    submitEvaluation: (b, k) => call("POST", "/v1/evaluations", b, k),
    getEvaluation: (id) => call("GET", `/v1/evaluations/${encodeURIComponent(id)}`),
    download: async (url) => {
      const r = await fetch(url, {
        headers: url.startsWith(baseUrl) ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`download ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

function supabaseFor(workerToken: string) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        h.set(EIP_WORKER_HEADER, workerToken);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export async function verifyEipWorkerToken(token: string): Promise<boolean> {
  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_PUBLISHABLE_KEY"] || token.length < 32)
    return false;
  const { data, error } = await supabaseFor(token).rpc("eip_worker_token_valid", { _token: token });
  return !error && data === true;
}

export function dbPort(
  workerToken: string,
  workerId: string,
  staleSeconds = 600,
  maxAttempts = 3,
): DbPort {
  const sb = supabaseFor(workerToken);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn as never, args as never);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as unknown;
  };
  const t = { _token: workerToken };
  return {
    claimJobs: async (limit) =>
      (await rpc("eip_worker_claim", {
        ...t,
        _worker: workerId,
        _limit: limit,
        _stale_seconds: staleSeconds,
        _max_attempts: maxAttempts,
      })) as never,
    updateJob: async (id, patch, evaluation) =>
      void (await rpc("eip_worker_update", {
        ...t,
        _worker: workerId,
        _job: id,
        _patch: patch,
        _evaluation: evaluation ?? null,
      })),
    claimReevals: async (limit) =>
      (await rpc("eip_worker_claim_reevals", {
        ...t,
        _worker: workerId,
        _limit: limit,
        _stale_seconds: staleSeconds,
        _max_attempts: maxAttempts,
      })) as never,
    updateReeval: async (id, status, evalId, code, evaluation) =>
      void (await rpc("eip_worker_update_reeval", {
        ...t,
        _worker: workerId,
        _id: id,
        _status: status,
        _engine_evaluation_id: evalId,
        _error_code: code,
        _evaluation: evaluation ?? null,
      })),
    report: async (status, log) =>
      void (await rpc("eip_worker_report", { ...t, _status: status, _log: log })),
    idle: async (force) => (await rpc("eip_worker_idle", { ...t, _force: force })) === true,
    signInputUrl: async (path, seconds) => {
      const { data, error } = await sb.storage.from("eip-uploads").createSignedUrl(path, seconds);
      if (error || !data) throw new EngineError("INPUT_DOWNLOAD_FAILED", "sign input");
      return data.signedUrl;
    },
    uploadProtected: async (userId, jobId, bytes) => {
      const path = `${userId}/protected/${jobId}.png`;
      const { error } = await sb.storage
        .from("eip-uploads")
        .upload(path, bytes, { contentType: "image/png", upsert: false });
      if (error && !/exists/i.test(error.message)) throw new Error(error.message);
      return path;
    },
  };
}
