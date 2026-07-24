/**
 * HMAC helpers for authenticating the external enforcement-worker service.
 * Both sides sign `${timestamp}.${rawBody}` with SHA-256 using
 * AUTOMATION_WORKER_SECRET. Timestamps outside a 5-minute window are rejected.
 *
 * Server-only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTOMATION_WORKER_SECRET;
  if (!s) throw new Error("AUTOMATION_WORKER_SECRET is not set");
  return s;
}

export function signAutomationRequest(body: string, ts: number = Date.now()): { signature: string; timestamp: string } {
  const signature = createHmac("sha256", secret()).update(`${ts}.${body}`).digest("hex");
  return { signature, timestamp: String(ts) };
}

export function verifyAutomationRequest(rawBody: string, timestampHeader: string | null, signatureHeader: string | null): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > WINDOW_MS) return false;
  const expected = createHmac("sha256", secret()).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
