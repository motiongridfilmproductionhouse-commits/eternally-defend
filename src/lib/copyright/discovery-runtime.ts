/**
 * Copyright discovery runtime: Firecrawl batching, circuit breaker, retries,
 * early-stop, and AbortSignal/deadline awareness.
 */

import type { ProviderFailureCategory } from "./provider-failures";

export const FIRECRAWL_BATCH_SIZE = 3;
export const FIRECRAWL_MAX_CONCURRENCY = 2;
/** At most one retry after the initial attempt for transient failures. */
export const FIRECRAWL_MAX_RETRIES = 1;
export const FIRECRAWL_CIRCUIT_BREAKER_THRESHOLD = 3;
export const FIRECRAWL_BATCH_DELAY_BASE_MS = 1_200;
export const FIRECRAWL_BATCH_DELAY_JITTER_MS = 800;
/**
 * Soft ceiling only — discovery should not stop because a few matches were
 * found. Prefer exhausting the query plan or hitting the scan deadline.
 * Set extremely high so unique-page count never ends a healthy provider run.
 */
export const DISCOVERY_EARLY_STOP_UNIQUE_PAGES = Number.MAX_SAFE_INTEGER;

export type CircuitTripCategory =
  | "rate_limited"
  | "provider_unavailable"
  | "insufficient_credits";

export interface DiscoveryCircuitState {
  consecutiveTripFailures: number;
  opened: boolean;
  openedAt: string | null;
  openedReason: string | null;
  operatorAction: string | null;
}

export function emptyDiscoveryCircuit(): DiscoveryCircuitState {
  return {
    consecutiveTripFailures: 0,
    opened: false,
    openedAt: null,
    openedReason: null,
    operatorAction: null,
  };
}

export function isCircuitTripCategory(
  category: ProviderFailureCategory | null | undefined,
): category is CircuitTripCategory {
  return (
    category === "rate_limited" ||
    category === "provider_unavailable" ||
    category === "insufficient_credits"
  );
}

export function circuitOperatorAction(
  category: CircuitTripCategory | null,
): string {
  if (category === "rate_limited") {
    return "Firecrawl rate limit tripped — wait and retry the scan, or rely on SerpApi fallback / known URLs.";
  }
  if (category === "insufficient_credits") {
    return "Web search quota for this project is exhausted — top up or upgrade the discovery plan, then retry the scan.";
  }
  if (category === "provider_unavailable") {
    return "Firecrawl gateway unavailable — verify FIRECRAWL_API_KEY and LOVABLE_API_KEY (lovc_ gateway), then retry.";
  }
  return "Discovery provider circuit opened — check provider configuration and retry.";
}

export function recordCircuitFailure(
  circuit: DiscoveryCircuitState,
  category: ProviderFailureCategory | null | undefined,
  now = new Date(),
): DiscoveryCircuitState {
  if (!isCircuitTripCategory(category)) {
    return { ...circuit, consecutiveTripFailures: 0 };
  }
  const consecutiveTripFailures = circuit.consecutiveTripFailures + 1;
  if (consecutiveTripFailures < FIRECRAWL_CIRCUIT_BREAKER_THRESHOLD) {
    return { ...circuit, consecutiveTripFailures };
  }
  return {
    consecutiveTripFailures,
    opened: true,
    openedAt: now.toISOString(),
    openedReason: `Firecrawl circuit opened after ${consecutiveTripFailures} consecutive ${category} responses.`,
    operatorAction: circuitOperatorAction(category),
  };
}

export function recordCircuitSuccess(circuit: DiscoveryCircuitState): DiscoveryCircuitState {
  if (circuit.opened) return circuit;
  return { ...circuit, consecutiveTripFailures: 0 };
}

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(30_000, Math.floor(asInt * 1_000));
  }
  const when = Date.parse(header);
  if (!Number.isFinite(when)) return null;
  return Math.min(30_000, Math.max(0, when - now));
}

export function batchDelayWithJitter(
  baseMs = FIRECRAWL_BATCH_DELAY_BASE_MS,
  jitterMs = FIRECRAWL_BATCH_DELAY_JITTER_MS,
): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

export function isTransientFirecrawlFailure(status: number | null, error?: unknown): boolean {
  if (status === 408 || status === 429) return true;
  if (status !== null && status >= 500 && status <= 599) return true;
  const msg =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return /\b(?:timeout|timed out|abort|econnreset|etimedout|429|rate.?limit|502|503|504|unavailable|overloaded)\b/i.test(
    msg,
  );
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!ms) return;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isPastDiscoveryDeadline(deadlineAt?: number, now = Date.now()): boolean {
  return typeof deadlineAt === "number" && now >= deadlineAt;
}

export interface ProviderSearchAttemptLike {
  ok: boolean;
  failureCategory?: ProviderFailureCategory;
}

export interface RunBatchedDiscoveryOptions<TPlan, TAttempt extends ProviderSearchAttemptLike> {
  plans: TPlan[];
  execute: (plan: TPlan, signal?: AbortSignal) => Promise<TAttempt>;
  signal?: AbortSignal;
  deadlineAt?: number;
  earlyStopUniquePages?: number;
  uniquePageCount: (attempts: TAttempt[]) => number;
  /**
   * Called after every completed search attempt so telemetry streams per query.
   */
  onAttempt?: (
    attempt: TAttempt,
    totals: {
      requests: number;
      successes: number;
      failures: number;
      uniquePages: number;
    },
  ) => void | Promise<void>;
  /**
   * Stop issuing further plans when unique candidate pages reach this count.
   * Used for adaptive stage coverage — not for verified-threat early stop.
   */
  stopWhenUniquePagesAtLeast?: number;
  /**
   * Called after every completed concurrency wave so callers can stream live
   * discovery telemetry (queries done, leads found) while the scan is running.
   */
  onWave?: (
    waveAttempts: TAttempt[],
    totals: {
      requests: number;
      successes: number;
      failures: number;
      uniquePages: number;
    },
  ) => void | Promise<void>;
}

export interface RunBatchedDiscoveryResult<TAttempt extends ProviderSearchAttemptLike> {
  attempts: TAttempt[];
  circuit: DiscoveryCircuitState;
  stoppedEarly: boolean;
  stoppedEarlyReason: string | null;
  requests: number;
  successes: number;
  failures: number;
}

/**
 * Execute discovery plans in focused batches with bounded concurrency, jitter,
 * circuit breaker, early-stop, and deadline/AbortSignal awareness.
 */
export async function runBatchedDiscovery<TPlan, TAttempt extends ProviderSearchAttemptLike>(
  options: RunBatchedDiscoveryOptions<TPlan, TAttempt>,
): Promise<RunBatchedDiscoveryResult<TAttempt>> {
  const attempts: TAttempt[] = [];
  let circuit = emptyDiscoveryCircuit();
  let stoppedEarly = false;
  let stoppedEarlyReason: string | null = null;
  let successes = 0;
  let failures = 0;

  const earlyStopAt = options.earlyStopUniquePages ?? DISCOVERY_EARLY_STOP_UNIQUE_PAGES;

  for (let offset = 0; offset < options.plans.length; ) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (isPastDiscoveryDeadline(options.deadlineAt)) {
      stoppedEarly = true;
      stoppedEarlyReason = "Discovery deadline reached before all queries completed.";
      break;
    }
    if (circuit.opened) break;

    const batchPlans = options.plans.slice(offset, offset + FIRECRAWL_BATCH_SIZE);
    offset += batchPlans.length;

    for (let i = 0; i < batchPlans.length; i += FIRECRAWL_MAX_CONCURRENCY) {
      if (circuit.opened) break;
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      if (isPastDiscoveryDeadline(options.deadlineAt)) {
        stoppedEarly = true;
        stoppedEarlyReason = "Discovery deadline reached before all queries completed.";
        break;
      }

      const wave = batchPlans.slice(i, i + FIRECRAWL_MAX_CONCURRENCY);
      const waveResults = await Promise.all(
        wave.map((plan) => options.execute(plan, options.signal)),
      );
      attempts.push(...waveResults);

      for (const attempt of waveResults) {
        if (attempt.ok) {
          successes += 1;
          circuit = recordCircuitSuccess(circuit);
        } else {
          failures += 1;
          circuit = recordCircuitFailure(circuit, attempt.failureCategory);
        }
        if (options.onAttempt) {
          await options.onAttempt(attempt, {
            requests: attempts.length,
            successes,
            failures,
            uniquePages: options.uniquePageCount(attempts),
          });
        }
      }

      const uniqueSoFar = options.uniquePageCount(attempts);
      if (options.onWave) {
        await options.onWave(waveResults, {
          requests: attempts.length,
          successes,
          failures,
          uniquePages: uniqueSoFar,
        });
      }

      // Never stop solely because N verified threats were found. Adaptive coverage
      // may stop when enough unique candidate URLs are collected.
      if (
        typeof options.stopWhenUniquePagesAtLeast === "number" &&
        uniqueSoFar >= options.stopWhenUniquePagesAtLeast
      ) {
        stoppedEarly = true;
        stoppedEarlyReason = `Adequate candidate coverage: ${uniqueSoFar} unique pages (target ${options.stopWhenUniquePagesAtLeast}).`;
        break;
      }
      if (
        Number.isFinite(earlyStopAt) &&
        earlyStopAt < Number.MAX_SAFE_INTEGER &&
        uniqueSoFar >= earlyStopAt
      ) {
        stoppedEarly = true;
        stoppedEarlyReason = `Early stop: ${earlyStopAt} unique candidate pages collected.`;
        break;
      }
    }

    if (stoppedEarly || circuit.opened) break;
    if (
      typeof options.stopWhenUniquePagesAtLeast === "number" &&
      options.uniquePageCount(attempts) >= options.stopWhenUniquePagesAtLeast
    ) {
      break;
    }
    if (offset < options.plans.length) {
      await sleepWithAbort(batchDelayWithJitter(), options.signal);
    }
  }

  return {
    attempts,
    circuit,
    stoppedEarly,
    stoppedEarlyReason,
    requests: attempts.length,
    successes,
    failures,
  };
}
