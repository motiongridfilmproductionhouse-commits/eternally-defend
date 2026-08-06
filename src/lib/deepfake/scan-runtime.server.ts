/**
 * Scan-level deadline + AbortController helpers for Deepfake Intelligence.
 *
 * The scan must finish (or mark partial/failed) before the platform hard
 * timeout. We reserve a fixed buffer so terminal persistence always has room.
 */

export const SCAN_DEADLINE_BUFFER_MS = 60_000;

/** Default platform hard timeout (Vercel Pro serverless = 300s). */
export const DEFAULT_SCAN_HARD_TIMEOUT_MS = 300_000;

export const DEFAULT_LEASE_TTL_MS = 90_000;

export class ScanDeadlineError extends Error {
  readonly code = "SCAN_DEADLINE" as const;

  constructor(message = "Scan reached its internal execution deadline.") {
    super(message);
    this.name = "ScanDeadlineError";
  }
}

export class ScanOwnershipLostError extends Error {
  readonly code = "SCAN_OWNERSHIP_LOST" as const;

  constructor(message = "Scan ownership was lost; this invocation must abort.") {
    super(message);
    this.name = "ScanOwnershipLostError";
  }
}

export class ScanAbortedError extends Error {
  readonly code = "SCAN_ABORTED" as const;

  constructor(message = "Scan was aborted.") {
    super(message);
    this.name = "ScanAbortedError";
  }
}

export type ScanRuntime = {
  controller: AbortController;
  signal: AbortSignal;
  startedAtMs: number;
  hardDeadlineMs: number;
  softDeadlineMs: number;
  leaseTtlMs: number;
};

export function resolveHardTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const explicit = Number(env.DEEPFAKE_SCAN_HARD_TIMEOUT_MS);
  if (Number.isFinite(explicit) && explicit > SCAN_DEADLINE_BUFFER_MS + 5_000) {
    return Math.floor(explicit);
  }

  const vercelSeconds = Number(env.VERCEL_FUNCTION_MAX_DURATION);
  if (Number.isFinite(vercelSeconds) && vercelSeconds * 1_000 > SCAN_DEADLINE_BUFFER_MS + 5_000) {
    return Math.floor(vercelSeconds * 1_000);
  }

  return DEFAULT_SCAN_HARD_TIMEOUT_MS;
}

export function createScanRuntime(options?: {
  hardTimeoutMs?: number;
  leaseTtlMs?: number;
  nowMs?: number;
}): ScanRuntime {
  const startedAtMs = options?.nowMs ?? Date.now();
  const hardTimeoutMs = options?.hardTimeoutMs ?? resolveHardTimeoutMs();
  const leaseTtlMs = options?.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const hardDeadlineMs = startedAtMs + hardTimeoutMs;
  const softDeadlineMs = hardDeadlineMs - SCAN_DEADLINE_BUFFER_MS;
  const controller = new AbortController();

  const remainingToSoft = Math.max(softDeadlineMs - startedAtMs, 1_000);
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new ScanDeadlineError("Scan reached its internal execution deadline."));
    }
  }, remainingToSoft);

  /*
   * Avoid keeping the isolate alive solely for the deadline timer once
   * the scan finishes early.
   */
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  const runtime: ScanRuntime = {
    controller,
    signal: controller.signal,
    startedAtMs,
    hardDeadlineMs,
    softDeadlineMs,
    leaseTtlMs,
  };

  const clear = () => clearTimeout(timer);
  controller.signal.addEventListener("abort", clear, { once: true });

  return runtime;
}

export function remainingMs(
  runtime: Pick<ScanRuntime, "softDeadlineMs">,
  nowMs = Date.now(),
): number {
  return Math.max(0, runtime.softDeadlineMs - nowMs);
}

export function assertNotAborted(signal?: AbortSignal | null): void {
  if (!signal?.aborted) return;

  const reason = signal.reason;
  if (reason instanceof ScanDeadlineError) throw reason;
  if (reason instanceof ScanOwnershipLostError) throw reason;
  if (reason instanceof Error) {
    throw new ScanAbortedError(reason.message);
  }
  throw new ScanAbortedError();
}

export function isAbortError(error: unknown): boolean {
  if (
    error instanceof ScanDeadlineError ||
    error instanceof ScanOwnershipLostError ||
    error instanceof ScanAbortedError
  ) {
    return true;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (
    error instanceof Error &&
    (/abort/i.test(error.name) ||
      /\babort(?:ed|ion)?\b/i.test(error.message) ||
      /\b(?:timeout|timed out)\b/i.test(error.message))
  ) {
    return true;
  }

  return false;
}

export function isDeadlineOrTimeoutError(error: unknown): boolean {
  if (error instanceof ScanDeadlineError) return true;
  if (
    error instanceof Error &&
    /\b(?:timeout|timed out|deadline|aborted due to timeout)\b/i.test(error.message)
  ) {
    return true;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  return false;
}

/** Soft pause used when the scan intentionally checkpoints with pending work. */
export class ScanCheckpointPauseError extends Error {
  readonly code = "SCAN_CHECKPOINT_PAUSE" as const;

  constructor(message = "Scan paused at the time budget with a resumable checkpoint.") {
    super(message);
    this.name = "ScanCheckpointPauseError";
  }
}

/** Bound a nested timeout by the remaining scan soft deadline. */
export function boundTimeoutMs(
  requestedMs: number,
  signal?: AbortSignal | null,
  softDeadlineMs?: number,
  nowMs = Date.now(),
): number {
  assertNotAborted(signal);
  const remaining =
    typeof softDeadlineMs === "number" ? Math.max(0, softDeadlineMs - nowMs) : requestedMs;
  return Math.max(1, Math.min(requestedMs, remaining));
}

export function mergeAbortSignals(...signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 0) {
    return new AbortController().signal;
  }
  if (active.length === 1) {
    return active[0];
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }

  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) {
          controller.abort(signal.reason);
        }
      },
      { once: true },
    );
  }
  return controller.signal;
}

export async function abortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  assertNotAborted(signal);
  if (ms <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      const reason = signal?.reason;
      if (reason instanceof Error) {
        reject(reason);
      } else {
        reject(new ScanAbortedError());
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function readResponseText(
  response: Response,
  signal?: AbortSignal | null,
): Promise<string> {
  assertNotAborted(signal);
  /*
   * Always drain the body before callers clean up request controllers so
   * stalls surface as abortable promise rejections rather than hangs.
   */
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  const onAbort = () => {
    try {
      void reader.cancel(signal?.reason ?? new ScanAbortedError());
    } catch {
      // ignore
    }
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      assertNotAborted(signal);
      const { done, value } = await reader.read();
      /*
       * Cancelled streams often resolve read() with done=true instead of
       * rejecting. Treat parent abort as failure even after a clean done.
       */
      assertNotAborted(signal);
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      assertNotAborted(signal);
      throw error;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  assertNotAborted(signal);

  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoder.decode(merged);
}

export function leaseExpiresAtIso(leaseTtlMs: number, nowMs = Date.now()): string {
  return new Date(nowMs + leaseTtlMs).toISOString();
}

export function createScanRunToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
