/**
 * Pre-Enrollment Intelligence — database access for the background worker
 * WITHOUT the service-role credential.
 *
 * The worker uses the same public configuration as every user session
 * (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY) and presents the managed
 * `prospect_scan_worker` token (internal_cron_secrets) in a request header.
 * RLS policies on the prospect scan tables admit that header only; the token
 * comparison runs inside the database (public.is_prospect_worker()), so the
 * token is never readable by any client role and never reaches a browser.
 */
import { createClient } from "@supabase/supabase-js";

export const WORKER_TOKEN_HEADER = "x-prospect-worker-token";
const MIN_TOKEN_LENGTH = 32;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkerDb = any;

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** Same fetch wrapper as the project's generated clients (new opaque API keys). */
function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function publicConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function workerConfigAvailable(): boolean {
  return publicConfig() !== null;
}

/** Bearer token from the Authorization header (server-to-server only). */
export function presentedWorkerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
}

/** Anonymous client (publishable key) — used only to ask the DB to check a token. */
function anonClient(): WorkerDb {
  const cfg = publicConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not configured");
  return createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createSupabaseFetch(cfg.key) },
  });
}

/** Ask the database whether this is the managed worker token. */
export async function verifyWorkerToken(token: string | null): Promise<boolean> {
  if (!token || token.length < MIN_TOKEN_LENGTH) return false;
  try {
    const { data, error } = await anonClient().rpc("prospect_worker_token_valid", {
      _token: token,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Publishable-key client that carries the worker token for RLS. */
export function createWorkerDb(token: string): WorkerDb {
  const cfg = publicConfig();
  if (!cfg) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not configured");
  return createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: createSupabaseFetch(cfg.key),
      headers: { [WORKER_TOKEN_HEADER]: token },
    },
  });
}
