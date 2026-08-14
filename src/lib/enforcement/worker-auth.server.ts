/**
 * Fail-closed authentication for the enforcement worker/cron endpoint.
 *
 * Rules (deliberately strict — do not relax):
 *  - ENFORCEMENT_WORKER_SECRET MUST be configured. A missing secret is a
 *    configuration error (503), never an authenticated request.
 *  - The presented credential is compared in constant time.
 *  - No secret material is ever logged or returned in a response body.
 */

import { createHash, timingSafeEqual } from "crypto";

export type WorkerAuthOutcome =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: string; message: string };

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides first so lengths always match and no length leaks.
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verifies an enforcement worker invocation.
 * Accepts `Authorization: Bearer <secret>` or `x-eterna-worker-secret: <secret>`.
 */
export function verifyEnforcementWorkerRequest(request: Request): WorkerAuthOutcome {
  const configured = process.env.ENFORCEMENT_WORKER_SECRET;

  if (!configured || configured.trim().length < 16) {
    return {
      ok: false,
      status: 503,
      code: "worker_secret_not_configured",
      message:
        "Enforcement worker is not configured. A dedicated worker secret must be set before the queue can be driven.",
    };
  }

  const expected = configured.trim();
  const bearer = request.headers.get("authorization") ?? "";
  const headerSecret =
    request.headers.get("x-eterna-worker-secret") ??
    request.headers.get("x-eterna-cron-secret") ??
    "";

  const presented = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : headerSecret.trim();

  if (!presented || !constantTimeEquals(presented, expected)) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Unauthorized enforcement worker invocation.",
    };
  }

  return { ok: true };
}
