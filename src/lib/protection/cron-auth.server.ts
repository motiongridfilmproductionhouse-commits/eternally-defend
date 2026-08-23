/**
 * Fail-closed authentication for scheduled/privileged backend hooks.
 *
 * Two accepted credentials, in this order:
 *  1. An environment worker secret (backwards compatible with the existing
 *     per-hook env secrets, e.g. SCAN_ORCHESTRATOR_SECRET).
 *  2. A managed scheduler token stored in the backend-only
 *     `internal_cron_secrets` table, keyed by job name. The database
 *     scheduler (pg_cron + pg_net) reads the token server-side and never
 *     exposes it; the hook validates it with the service-role client.
 *
 * Rules (do not relax):
 *  - No credential configured on either side => 503 configuration error,
 *    never an authenticated request.
 *  - Constant-time comparison; no secret material is ever logged or returned.
 *  - Token lookup requires the trusted admin credential, which only exists in
 *    the Lovable-managed server runtime. On a runtime without it we return an
 *    explicit 503 instead of a generic 500 (see requireTrustedRuntime).
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthOutcome =
  | { ok: true; via: "env" | "managed" }
  | { ok: false; status: 401 | 503; code: string; message: string };

const MIN_SECRET_LENGTH = 16;

function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

export function presentedCronCredential(request: Request): string {
  const bearer = request.headers.get("authorization") ?? "";
  if (bearer.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();
  return (
    request.headers.get("x-eterna-worker-secret") ??
    request.headers.get("x-eterna-cron-secret") ??
    ""
  ).trim();
}

/**
 * The privileged hooks in this project all need the service-role credential,
 * which is injected only into the Lovable-managed server runtime. Call this
 * first so a deployment without it fails loudly and honestly.
 */
export function requireTrustedRuntime(): { ok: true } | { ok: false; response: Response } {
  if (process.env["SUPABASE_SERVICE_ROLE_KEY"]) return { ok: true };
  return {
    ok: false,
    response: Response.json(
      {
        ok: false,
        error: "trusted_runtime_unavailable",
        message:
          "This privileged job must run on the Lovable-managed server runtime, where the backend admin credential is injected. It cannot run on an external deployment.",
      },
      { status: 503 },
    ),
  };
}

type CronSecretReader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { token?: string | null } | null }> };
    };
  };
};

async function managedTokenFor(jobName: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as unknown as CronSecretReader)
      .from("internal_cron_secrets")
      .select("token")
      .eq("name", jobName)
      .maybeSingle();
    const token = data?.token;
    return typeof token === "string" && token.trim().length >= MIN_SECRET_LENGTH
      ? token.trim()
      : null;
  } catch {
    return null;
  }
}

export async function authorizeCronRequest(
  request: Request,
  options: { jobName: string; envSecrets?: Array<string | undefined> },
): Promise<CronAuthOutcome> {
  const presented = presentedCronCredential(request);

  const envCandidates = (options.envSecrets ?? [])
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v) && v!.length >= MIN_SECRET_LENGTH);

  const managed = await managedTokenFor(options.jobName);

  if (envCandidates.length === 0 && !managed) {
    return {
      ok: false,
      status: 503,
      code: "cron_credential_not_configured",
      message: `No scheduler credential is configured for "${options.jobName}".`,
    };
  }

  if (!presented) {
    return { ok: false, status: 401, code: "unauthorized", message: "Unauthorized invocation." };
  }

  for (const candidate of envCandidates) {
    if (constantTimeEquals(presented, candidate)) return { ok: true, via: "env" };
  }
  if (managed && constantTimeEquals(presented, managed)) return { ok: true, via: "managed" };

  return { ok: false, status: 401, code: "unauthorized", message: "Unauthorized invocation." };
}

export function cronAuthResponse(outcome: Extract<CronAuthOutcome, { ok: false }>): Response {
  return Response.json(
    { ok: false, error: outcome.code, message: outcome.message },
    { status: outcome.status },
  );
}
