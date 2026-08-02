import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 5 * 60 * 1000;

function workerSecret(): string {
  const value = process.env.COPYRIGHT_SCAN_WORKER_SECRET?.trim();
  if (!value) throw new Error("COPYRIGHT_SCAN_WORKER_SECRET is not configured.");
  return value;
}

export function copyrightScanWorkerSecretDiagnostic(env: NodeJS.ProcessEnv = process.env): {
  worker_secret_present: boolean;
  worker_secret_length: number;
} {
  const value = env.COPYRIGHT_SCAN_WORKER_SECRET?.trim();
  return {
    worker_secret_present: Boolean(value),
    worker_secret_length: value?.length ?? 0,
  };
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
  return verifyCopyrightScanWorkerRequestDetailed(
    rawBody,
    timestampHeader,
    signatureHeader,
  ).ok;
}

export function verifyCopyrightScanWorkerRequestDetailed(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): {
  ok: boolean;
  reason: "ok" | "missing_header" | "invalid_timestamp" | "timestamp_outside_window" | "secret_missing" | "signature_mismatch";
  timestamp_age_ms: number | null;
  worker_secret_present: boolean;
  worker_secret_length: number;
} {
  const diagnostic = copyrightScanWorkerSecretDiagnostic();
  if (!timestampHeader || !signatureHeader) {
    return {
      ok: false,
      reason: "missing_header",
      timestamp_age_ms: null,
      ...diagnostic,
    };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      reason: "invalid_timestamp",
      timestamp_age_ms: null,
      ...diagnostic,
    };
  }
  const timestampAgeMs = Date.now() - timestamp;
  if (Math.abs(timestampAgeMs) > WINDOW_MS) {
    return {
      ok: false,
      reason: "timestamp_outside_window",
      timestamp_age_ms: timestampAgeMs,
      ...diagnostic,
    };
  }

  let expected: string;
  try {
    expected = createHmac("sha256", workerSecret())
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
  } catch {
    return {
      ok: false,
      reason: "secret_missing",
      timestamp_age_ms: timestampAgeMs,
      ...diagnostic,
    };
  }
  const actual = Buffer.from(signatureHeader);
  const wanted = Buffer.from(expected);
  const ok = actual.length === wanted.length && timingSafeEqual(actual, wanted);
  return {
    ok,
    reason: ok ? "ok" : "signature_mismatch",
    timestamp_age_ms: timestampAgeMs,
    ...diagnostic,
  };
}
