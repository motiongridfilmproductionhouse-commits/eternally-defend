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

type WorkerVerificationReason =
  | "ok"
  | "missing_header"
  | "invalid_timestamp"
  | "timestamp_outside_window"
  | "secret_missing"
  | "signature_mismatch";

export interface WorkerRequestVerification {
  ok: boolean;
  reason: WorkerVerificationReason;
  timestamp_age_ms: number | null;
  worker_secret_present: boolean;
  worker_secret_length: number;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < value.length; i += 2) {
    out[i / 2] = Number.parseInt(value.slice(i, i + 2), 16);
  }
  return out;
}

function constantTimeEqualHex(actualHex: string, expectedHex: string): boolean {
  const actual = hexToBytes(actualHex);
  const expected = hexToBytes(expectedHex);
  if (!actual || !expected) return false;
  let diff = actual.length ^ expected.length;
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(signature);
}

export async function signCopyrightScanWorkerRequest(
  body: string,
  timestamp = Date.now(),
): Promise<{ signature: string; timestamp: string }> {
  const signature = await hmacSha256Hex(workerSecret(), `${timestamp}.${body}`);
  return { signature, timestamp: String(timestamp) };
}

export async function verifyCopyrightScanWorkerRequest(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): Promise<boolean> {
  return (await verifyCopyrightScanWorkerRequestDetailed(rawBody, timestampHeader, signatureHeader))
    .ok;
}

export async function verifyCopyrightScanWorkerRequestDetailed(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): Promise<WorkerRequestVerification> {
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
    expected = await hmacSha256Hex(workerSecret(), `${timestamp}.${rawBody}`);
  } catch {
    return {
      ok: false,
      reason: "secret_missing",
      timestamp_age_ms: timestampAgeMs,
      ...diagnostic,
    };
  }
  const ok = constantTimeEqualHex(signatureHeader, expected);
  return {
    ok,
    reason: ok ? "ok" : "signature_mismatch",
    timestamp_age_ms: timestampAgeMs,
    ...diagnostic,
  };
}
