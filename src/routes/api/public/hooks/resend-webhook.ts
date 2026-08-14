/**
 * Resend event webhook (delivered / bounced / complained / failed / delayed).
 *
 * Security:
 *  - Signature verification is MANDATORY. A missing RESEND_WEBHOOK_SECRET is a
 *    configuration error (503) — never an accepted request.
 *  - Verification follows Resend's Svix scheme: HMAC-SHA256 over
 *    `${svix-id}.${svix-timestamp}.${rawBody}` with the base64 secret after the
 *    `whsec_` prefix, compared in constant time against any provided v1 signature.
 *  - Replay window: 5 minutes on svix-timestamp.
 *  - No secret material is logged or returned.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const REPLAY_WINDOW_SECONDS = 300;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function verifySvixSignature(opts: {
  secret: string;
  id: string;
  timestamp: string;
  rawBody: string;
  signatureHeader: string;
}): boolean {
  const key = opts.secret.startsWith("whsec_") ? opts.secret.slice(6) : opts.secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(key, "base64");
    if (keyBytes.length === 0) keyBytes = Buffer.from(key, "utf8");
  } catch {
    keyBytes = Buffer.from(key, "utf8");
  }

  const signedPayload = `${opts.id}.${opts.timestamp}.${opts.rawBody}`;
  const expected = createHmac("sha256", keyBytes).update(signedPayload, "utf8").digest("base64");

  // Header format: "v1,<sig> v1,<sig2>"
  const provided = opts.signatureHeader
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  return provided.some((sig) => safeEqual(sig, expected));
}

export const Route = createFileRoute("/api/public/hooks/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret || secret.trim().length < 16) {
          return new Response(
            JSON.stringify({
              error: "webhook_secret_not_configured",
              message: "Resend webhook signing secret is not configured; rejecting event.",
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          );
        }

        const svixId = request.headers.get("svix-id") ?? "";
        const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
        const svixSignature = request.headers.get("svix-signature") ?? "";
        const rawBody = await request.text();

        if (!svixId || !svixTimestamp || !svixSignature) {
          return new Response(JSON.stringify({ error: "missing_signature_headers" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const ts = Number(svixTimestamp);
        if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_SECONDS) {
          return new Response(JSON.stringify({ error: "timestamp_out_of_window" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const valid = verifySvixSignature({
          secret: secret.trim(),
          id: svixId,
          timestamp: svixTimestamp,
          rawBody,
          signatureHeader: svixSignature,
        });

        if (!valid) {
          return new Response(JSON.stringify({ error: "invalid_signature" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return new Response(JSON.stringify({ error: "invalid_json" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const eventType = String(payload["type"] ?? "");
        if (!eventType) {
          return new Response(JSON.stringify({ error: "missing_event_type" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const { ingestResendEvent } = await import("@/lib/enforcement/provider-events.server");
          const result = await ingestResendEvent({
            eventType,
            payload,
            occurredAt:
              typeof payload["created_at"] === "string"
                ? new Date(payload["created_at"] as string).toISOString()
                : undefined,
          });

          return new Response(
            JSON.stringify({
              ok: true,
              normalized: result.normalized,
              suppressed: result.suppressed,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        } catch (err: unknown) {
          console.error(
            "[enforcement/resend-webhook] ingestion failed",
            err instanceof Error ? err.message : String(err),
          );
          // 500 so Resend retries; the event is not silently dropped.
          return new Response(JSON.stringify({ error: "ingestion_failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
