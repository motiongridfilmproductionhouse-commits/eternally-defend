/**
 * Optional SerpApi Google Images discovery provider.
 *
 * Reliability-first: missing/invalid/rate-limited keys never fail a scan.
 * Discovery-only — results are ProviderHit seeds that must still pass
 * identity, crawl, URL_VERIFIED and client-visible gates.
 */

import {
  abortableSleep,
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  mergeAbortSignals,
  readResponseText,
} from "./scan-runtime.server";
import {
  isAllowedJsonMime,
  isSafePublicHttpUrl,
  MAX_SAFE_RESPONSE_BYTES,
  normalizeHostingPageUrl,
  sanitizeProviderText,
} from "./url-safety.server";

export const SERPAPI_MAX_REQUESTS_PER_SCAN = 5;
export const SERPAPI_MAX_CANDIDATES_PER_REQUEST = 50;
export const SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN = 150;
export const SERPAPI_CONCURRENCY = 2;
export const SERPAPI_REQUEST_TIMEOUT_MS = 12_000;
export const SERPAPI_MAX_RETRIES = 1;

export type SerpApiImageHit = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source: "serpapi_google_images";
  thumbnail_url?: string;
  image_url?: string;
  media_url?: string;
  threat_signals?: string[];
};

export type SerpApiSearchResult = {
  hits: SerpApiImageHit[];
  creditsUsed: number;
  /** Actual outbound HTTP attempts for this query (includes retries). */
  httpAttempts: number;
  failure: string | null;
  skipped: boolean;
};

/** Shared scan-level budget: five means at most five outbound HTTP attempts. */
export type SerpApiHttpAttemptBudget = {
  remaining: number;
  used: number;
};

export function claimSerpApiHttpAttempt(
  budget: SerpApiHttpAttemptBudget | undefined,
): boolean {
  if (!budget) return true;
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  budget.used += 1;
  return true;
}

/** Face/identity rejection reasons that may increment serpapi_face_rejected. */
export function isSerpApiFaceIdentityRejectionReason(
  reason: string | null | undefined,
): boolean {
  return /\b(?:identity|protected identity|target|different person|face\s*mismatch|face\s*rejected)\b/i.test(
    reason ?? "",
  );
}

export function isSerpApiConfigured(): boolean {
  const key = process.env.SERPAPI_API_KEY?.trim();
  return Boolean(key);
}

/**
 * Exact full-identity / verified-alias Google Images queries only.
 * Never emits generic individual tokens.
 */
export function buildSerpApiExactIdentityQueries(input: {
  name: string;
  aliases?: string[];
  maxQueries?: number;
}): string[] {
  const max = Math.min(
    SERPAPI_MAX_REQUESTS_PER_SCAN,
    Math.max(1, input.maxQueries ?? SERPAPI_MAX_REQUESTS_PER_SCAN),
  );
  const identities = [input.name, ...(input.aliases ?? [])]
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => {
      if (!value) return false;
      // Require a multi-token full identity / alias — reject single tokens.
      return value.split(/\s+/).filter(Boolean).length >= 2;
    });

  const uniqueIdentities = [...new Set(identities)];
  const phrases = ["deepfake", "face swap", "fake nude"] as const;
  const out: string[] = [];

  for (const identity of uniqueIdentities) {
    const quoted = `"${identity.replaceAll('"', "").trim()}"`;
    for (const phrase of phrases) {
      out.push(`${quoted} ${phrase}`);
      if (out.length >= max) return out;
    }
  }

  return out.slice(0, max);
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.min(30_000, Math.floor(asInt * 1000));
  }
  const when = Date.parse(header);
  if (!Number.isFinite(when)) return null;
  return Math.min(30_000, Math.max(0, when - Date.now()));
}

function threatSignalsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const signals: string[] = [];
  for (const signal of [
    "deepfake",
    "face swap",
    "faceswap",
    "fake nude",
    "ai nude",
    "nude",
    "nsfw",
    "porn",
    "leak",
  ]) {
    if (lower.includes(signal)) signals.push(signal.replace(/\s+/g, "-"));
  }
  return signals;
}

function extractHitsFromPayload(
  payload: unknown,
  query: string,
): SerpApiImageHit[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const row = payload as Record<string, unknown>;
  const images = Array.isArray(row.images_results) ? row.images_results : [];
  const hits: SerpApiImageHit[] = [];
  const seen = new Set<string>();

  for (const raw of images) {
    if (hits.length >= SERPAPI_MAX_CANDIDATES_PER_REQUEST) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;

    const hosting =
      normalizeHostingPageUrl(
        typeof item.link === "string"
          ? item.link
          : typeof item.source === "string"
            ? item.source
            : "",
      ) ??
      normalizeHostingPageUrl(
        typeof item.source === "string" ? item.source : "",
      );

    if (!hosting) continue;
    if (seen.has(hosting)) continue;
    seen.add(hosting);

    const imageUrl =
      typeof item.original === "string" && isSafePublicHttpUrl(item.original)
        ? item.original.trim()
        : typeof item.thumbnail === "string" &&
            isSafePublicHttpUrl(item.thumbnail)
          ? item.thumbnail.trim()
          : undefined;

    const title = sanitizeProviderText(item.title);
    const description = sanitizeProviderText(
      item.snippet ?? item.source ?? item.title,
    );

    hits.push({
      url: hosting,
      title: title || undefined,
      description: description || undefined,
      query,
      source: "serpapi_google_images",
      thumbnail_url:
        typeof item.thumbnail === "string" &&
        isSafePublicHttpUrl(item.thumbnail)
          ? item.thumbnail.trim()
          : undefined,
      image_url: imageUrl,
      media_url: imageUrl,
      threat_signals: threatSignalsFromText(`${title} ${description} ${query}`),
    });
  }

  return hits;
}

async function fetchSerpApiOnce(input: {
  query: string;
  apiKey: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  status: number;
  payload: unknown;
  retryAfterMs: number | null;
  hits: SerpApiImageHit[];
}> {
  assertNotAborted(input.signal);

  const params = new URLSearchParams({
    engine: "google_images",
    q: input.query,
    api_key: input.apiKey,
    // Keep adult results available for threat discovery; never surface raw payload.
    safe: "off",
    ijn: "0",
  });

  const timeoutMs = boundTimeoutMs(
    SERPAPI_REQUEST_TIMEOUT_MS,
    input.signal,
    input.softDeadlineMs,
  );
  /*
   * Keep provider timeout distinct from the scan AbortSignal so a 12s
   * SerpApi stall soft-fails instead of aborting the whole scan.
   * Timer stays active through headers, body drain, JSON parse, and
   * candidate extraction. Scan AbortSignal still takes priority.
   */
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(
      new Error(`SerpApi request timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);
  const signal = mergeAbortSignals(input.signal, timeoutController.signal);

  try {
    const response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      },
    );

    // Prefer scan-level abort over provider timeout when both fired.
    assertNotAborted(input.signal);

    const contentType = response.headers.get("content-type");
    if (!isAllowedJsonMime(contentType)) {
      throw new Error("SerpApi returned a non-JSON content type");
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_SAFE_RESPONSE_BYTES) {
      throw new Error("SerpApi response exceeded size limit");
    }

    const text = await readResponseText(response, signal);
    assertNotAborted(input.signal);
    if (text.length > MAX_SAFE_RESPONSE_BYTES) {
      throw new Error("SerpApi response exceeded size limit");
    }

    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("SerpApi returned malformed JSON");
    }

    const hits = extractHitsFromPayload(payload, input.query);
    assertNotAborted(input.signal);

    return {
      status: response.status,
      payload,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
      hits,
    };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (timedOut) {
      throw new Error(`SerpApi request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Execute one Google Images search. Never throws for provider/config errors —
 * returns failure text so the scan can continue with Firecrawl.
 * Abort/deadline errors still propagate.
 *
 * Each outbound HTTP call claims one unit from `httpAttemptBudget` when provided
 * (including retries). Retries are skipped when the shared budget is exhausted.
 */
export async function searchSerpApiGoogleImages(input: {
  query: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  httpAttemptBudget?: SerpApiHttpAttemptBudget;
}): Promise<SerpApiSearchResult> {
  assertNotAborted(input.signal);

  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      hits: [],
      creditsUsed: 0,
      httpAttempts: 0,
      failure: "SERPAPI_API_KEY is not configured",
      skipped: true,
    };
  }

  let lastFailure: string | null = null;
  let httpAttempts = 0;

  for (let attempt = 0; attempt <= SERPAPI_MAX_RETRIES; attempt++) {
    assertNotAborted(input.signal);

    if (!claimSerpApiHttpAttempt(input.httpAttemptBudget)) {
      return {
        hits: [],
        creditsUsed: 0,
        httpAttempts,
        failure: lastFailure ?? "SerpApi HTTP attempt budget exhausted",
        skipped: false,
      };
    }
    httpAttempts += 1;

    try {
      const { status, payload, retryAfterMs, hits } = await fetchSerpApiOnce({
        query: input.query,
        apiKey,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      });

      const errorMessage =
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        typeof (payload as { error?: unknown }).error === "string"
          ? sanitizeProviderText((payload as { error: string }).error, 240)
          : null;

      if (status === 401 || status === 403) {
        return {
          hits: [],
          creditsUsed: 0,
          httpAttempts,
          failure: errorMessage || `SerpApi authentication failed (${status})`,
          skipped: true,
        };
      }

      if (status === 429 || status >= 500) {
        lastFailure =
          errorMessage || `SerpApi temporary failure (${status})`;
        const canRetry =
          attempt < SERPAPI_MAX_RETRIES &&
          (!input.httpAttemptBudget || input.httpAttemptBudget.remaining > 0);
        if (canRetry) {
          const waitMs = retryAfterMs ?? 1_000 * (attempt + 1);
          await abortableSleep(waitMs, input.signal);
          continue;
        }
        return {
          hits: [],
          creditsUsed: 0,
          httpAttempts,
          failure: lastFailure,
          skipped: false,
        };
      }

      if (!status || status >= 400 || errorMessage) {
        return {
          hits: [],
          creditsUsed: 1,
          httpAttempts,
          failure: errorMessage || `SerpApi request failed (${status})`,
          skipped: false,
        };
      }

      return {
        hits,
        creditsUsed: 1,
        httpAttempts,
        failure: null,
        skipped: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const providerTimeout = /timed out|timeout/i.test(message);

      // Scan-level abort/deadline must propagate. Provider timeouts soft-fail.
      if (input.signal?.aborted) {
        throw error;
      }
      if (providerTimeout || (isAbortError(error) && !input.signal?.aborted)) {
        lastFailure = providerTimeout
          ? message
          : message || "SerpApi request aborted";
        return {
          hits: [],
          creditsUsed: 0,
          httpAttempts,
          failure: lastFailure,
          skipped: false,
        };
      }

      lastFailure = message || "SerpApi request failed";
      // Cap retries for transient network errors when budget remains.
      const canRetry =
        attempt < SERPAPI_MAX_RETRIES &&
        /network/i.test(lastFailure) &&
        (!input.httpAttemptBudget || input.httpAttemptBudget.remaining > 0);
      if (canRetry) {
        await abortableSleep(500 * (attempt + 1), input.signal);
        continue;
      }
      return {
        hits: [],
        creditsUsed: 0,
        httpAttempts,
        failure: lastFailure,
        skipped: false,
      };
    }
  }

  return {
    hits: [],
    creditsUsed: 0,
    httpAttempts,
    failure: lastFailure ?? "SerpApi request failed",
    skipped: false,
  };
}

/**
 * Run SerpApi queries with concurrency 1–2, respecting unique-page and request caps.
 * Propagates abort; isolates all other failures into metrics/failures.
 */
export async function searchSerpApiQueriesBounded(input: {
  queries: string[];
  alreadyCompletedIds?: string[];
  alreadySeenPages?: Iterable<string>;
  /** Max outbound HTTP attempts (including retries), not logical queries. */
  maxRequests?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  /**
   * Synchronous metering/checkpoint callback. Invoked for every settled query
   * in a batch before any awaitable onQueryComplete work, so abort during
   * verification cannot drop already-consumed HTTP attempts from resume state.
   */
  onQueryMetered?: (info: {
    query: string;
    hits: SerpApiImageHit[];
    creditsUsed: number;
    httpAttempts: number;
    failure: string | null;
  }) => void;
  onQueryComplete?: (info: {
    query: string;
    hits: SerpApiImageHit[];
    creditsUsed: number;
    httpAttempts: number;
    failure: string | null;
  }) => Promise<void> | void;
}): Promise<{
  hits: SerpApiImageHit[];
  /** Actual outbound HTTP attempts (includes retries). */
  requests: number;
  httpAttempts: number;
  failures: number;
  creditsUsed: number;
  uniquePages: number;
  completedQueryIds: string[];
  seenPageUrls: string[];
  failureMessages: string[];
  drained: boolean;
}> {
  const maxRequests = Math.min(
    SERPAPI_MAX_REQUESTS_PER_SCAN,
    Math.max(0, input.maxRequests ?? SERPAPI_MAX_REQUESTS_PER_SCAN),
  );
  const httpAttemptBudget: SerpApiHttpAttemptBudget = {
    remaining: maxRequests,
    used: 0,
  };
  const completed = new Set(
    (input.alreadyCompletedIds ?? []).map((id) => id.trim().toLowerCase()),
  );
  const seenPages = new Set<string>();
  for (const page of input.alreadySeenPages ?? []) {
    const normalized = normalizeHostingPageUrl(page);
    if (normalized) seenPages.add(normalized);
  }

  const pending = input.queries.filter(
    (query) => !completed.has(query.trim().toLowerCase()),
  );
  const hits: SerpApiImageHit[] = [];
  const failureMessages: string[] = [];
  const completedQueryIds: string[] = [];
  let failures = 0;
  let creditsUsed = 0;

  if (!isSerpApiConfigured()) {
    return {
      hits: [],
      requests: 0,
      httpAttempts: 0,
      failures: 0,
      creditsUsed: 0,
      uniquePages: seenPages.size,
      completedQueryIds: [],
      seenPageUrls: Array.from(seenPages),
      failureMessages: ["SERPAPI_API_KEY is not configured"],
      drained: true,
    };
  }

  let stoppedEarly = false;

  for (let i = 0; i < pending.length && httpAttemptBudget.remaining > 0; ) {
    assertNotAborted(input.signal);
    if (seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) {
      stoppedEarly = true;
      break;
    }

    const parallel = Math.min(
      SERPAPI_CONCURRENCY,
      httpAttemptBudget.remaining,
      pending.length - i,
    );
    const batch = pending.slice(i, i + parallel);
    if (!batch.length) break;

    const settled = await Promise.allSettled(
      batch.map((query) =>
        searchSerpApiGoogleImages({
          query,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
          httpAttemptBudget,
        }),
      ),
    );

    type SettledQuery = {
      query: string;
      queryId: string;
      hits: SerpApiImageHit[];
      creditsUsed: number;
      httpAttempts: number;
      failure: string | null;
      rejectedReason?: unknown;
    };
    const settledQueries: SettledQuery[] = [];

    for (let index = 0; index < settled.length; index++) {
      const query = batch[index]!;
      const result = settled[index]!;
      const queryId = query.trim().toLowerCase();

      if (result.status === "rejected") {
        if (isAbortError(result.reason)) throw result.reason;
        failures++;
        const failure =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        failureMessages.push(failure);
        completed.add(queryId);
        completedQueryIds.push(queryId);
        settledQueries.push({
          query,
          queryId,
          hits: [],
          creditsUsed: 0,
          httpAttempts: 0,
          failure,
          rejectedReason: result.reason,
        });
        continue;
      }

      const value = result.value;
      creditsUsed += value.creditsUsed;
      if (value.failure) {
        failures++;
        failureMessages.push(value.failure);
      }

      const accepted: SerpApiImageHit[] = [];
      for (const hit of value.hits) {
        if (seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) break;
        const page = normalizeHostingPageUrl(hit.url);
        if (!page || seenPages.has(page)) continue;
        seenPages.add(page);
        accepted.push({ ...hit, url: page });
      }
      hits.push(...accepted);
      completed.add(queryId);
      completedQueryIds.push(queryId);
      settledQueries.push({
        query,
        queryId,
        hits: accepted,
        creditsUsed: value.creditsUsed,
        httpAttempts: value.httpAttempts,
        failure: value.failure,
      });
    }

    // Meter every settled query before any awaitable follow-up work.
    for (const item of settledQueries) {
      input.onQueryMetered?.({
        query: item.query,
        hits: item.hits,
        creditsUsed: item.creditsUsed,
        httpAttempts: item.httpAttempts,
        failure: item.failure,
      });
    }

    for (const item of settledQueries) {
      if (input.onQueryComplete) {
        await input.onQueryComplete({
          query: item.query,
          hits: item.hits,
          creditsUsed: item.creditsUsed,
          httpAttempts: item.httpAttempts,
          failure: item.failure,
        });
      }
    }

    // Always fully account for every settled query in this batch before
    // deciding whether another parallel wave can start. Breaking mid-batch
    // would drop already-billed hits and undercount httpAttempts in metrics.
    if (seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) {
      stoppedEarly = true;
      break;
    }
    if (httpAttemptBudget.remaining <= 0) {
      break;
    }
    i += batch.length;
  }

  /*
   * Unique-page cap: mark every remaining planned query complete so checkpoints
   * cannot stall forever as "pending". Do NOT drain on a partial HTTP-attempt
   * wave budget — Continue / later waves must still consume remaining attempts.
   */
  const uniqueCapHit = seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN;
  if (uniqueCapHit) {
    for (const query of pending) {
      const queryId = query.trim().toLowerCase();
      if (completed.has(queryId)) continue;
      completed.add(queryId);
      completedQueryIds.push(queryId);
    }
  }

  const allPendingCompleted = pending.every((query) =>
    completed.has(query.trim().toLowerCase()),
  );

  return {
    hits,
    requests: httpAttemptBudget.used,
    httpAttempts: httpAttemptBudget.used,
    failures,
    creditsUsed,
    uniquePages: seenPages.size,
    completedQueryIds,
    seenPageUrls: Array.from(seenPages).slice(
      -SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN,
    ),
    failureMessages: failureMessages.slice(0, 20),
    drained: uniqueCapHit || allPendingCompleted,
  };
}
