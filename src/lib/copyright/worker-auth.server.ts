import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 5 * 60 * 1000;

function workerSecret(): string {
  const value = process.env.COPYRIGHT_SCAN_WORKER_SECRET?.trim();
  if (!value) throw new Error("COPYRIGHT_SCAN_WORKER_SECRET is not configured.");
  return value;
}

export function signCopyrightScanWorkerRequest(
  body: string,
  timestamp = Date.now(),
): { signature: string; timestamp: string } {
  const signature = createHmac("sha256", workerSecret())
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return { signature, timestamp: String(timestamp) };
}

export function verifyCopyrightScanWorkerRequest(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() - timestamp) > WINDOW_MS) return false;

  const expected = createHmac("sha256", workerSecret())
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const actual = Buffer.from(signatureHeader);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
