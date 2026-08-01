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
  failure: string | null;
  skipped: boolean;
};

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
}): Promise<{ status: number; payload: unknown; retryAfterMs: number | null }> {
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
   */
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    timeoutController.abort(
      new Error(`SerpApi request timed out after ${timeoutMs}ms`),
    );
  }, timeoutMs);
  const signal = mergeAbortSignals(input.signal, timeoutController.signal);

  let response: Response;
  try {
    response = await fetch(
      `https://serpapi.com/search.json?${params.toString()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      },
    );
  } finally {
    clearTimeout(timeoutTimer);
  }

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
  if (text.length > MAX_SAFE_RESPONSE_BYTES) {
    throw new Error("SerpApi response exceeded size limit");
  }

  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("SerpApi returned malformed JSON");
  }

  return {
    status: response.status,
    payload,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  };
}

/**
 * Execute one Google Images search. Never throws for provider/config errors —
 * returns failure text so the scan can continue with Firecrawl.
 * Abort/deadline errors still propagate.
 */
export async function searchSerpApiGoogleImages(input: {
  query: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<SerpApiSearchResult> {
  assertNotAborted(input.signal);

  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      hits: [],
      creditsUsed: 0,
      failure: "SERPAPI_API_KEY is not configured",
      skipped: true,
    };
  }

  let lastFailure: string | null = null;

  for (let attempt = 0; attempt <= SERPAPI_MAX_RETRIES; attempt++) {
    assertNotAborted(input.signal);
    try {
      const { status, payload, retryAfterMs } = await fetchSerpApiOnce({
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
          failure: errorMessage || `SerpApi authentication failed (${status})`,
          skipped: true,
        };
      }

      if (status === 429 || status >= 500) {
        lastFailure =
          errorMessage || `SerpApi temporary failure (${status})`;
        if (attempt < SERPAPI_MAX_RETRIES) {
          const waitMs = retryAfterMs ?? 1_000 * (attempt + 1);
          await abortableSleep(waitMs, input.signal);
          continue;
        }
        return {
          hits: [],
          creditsUsed: 0,
          failure: lastFailure,
          skipped: false,
        };
      }

      if (!status || status >= 400 || errorMessage) {
        return {
          hits: [],
          creditsUsed: 1,
          failure: errorMessage || `SerpApi request failed (${status})`,
          skipped: false,
        };
      }

      return {
        hits: extractHitsFromPayload(payload, input.query),
        creditsUsed: 1,
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
          failure: lastFailure,
          skipped: false,
        };
      }

      lastFailure = message || "SerpApi request failed";
      // Cap retries for transient network errors.
      if (
        attempt < SERPAPI_MAX_RETRIES &&
        /network/i.test(lastFailure)
      ) {
        await abortableSleep(500 * (attempt + 1), input.signal);
        continue;
      }
      return {
        hits: [],
        creditsUsed: 0,
        failure: lastFailure,
        skipped: false,
      };
    }
  }

  return {
    hits: [],
    creditsUsed: 0,
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
  maxRequests?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  onQueryComplete?: (info: {
    query: string;
    hits: SerpApiImageHit[];
    creditsUsed: number;
    failure: string | null;
  }) => Promise<void> | void;
}): Promise<{
  hits: SerpApiImageHit[];
  requests: number;
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
  let requests = 0;
  let failures = 0;
  let creditsUsed = 0;

  if (!isSerpApiConfigured()) {
    return {
      hits: [],
      requests: 0,
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

  for (let i = 0; i < pending.length && requests < maxRequests; ) {
    assertNotAborted(input.signal);
    if (seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) {
      stoppedEarly = true;
      break;
    }

    const batch = pending.slice(
      i,
      i + Math.min(SERPAPI_CONCURRENCY, maxRequests - requests),
    );
    if (!batch.length) break;

    const settled = await Promise.allSettled(
      batch.map((query) =>
        searchSerpApiGoogleImages({
          query,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
        }),
      ),
    );

    for (let index = 0; index < settled.length; index++) {
      const query = batch[index]!;
      const result = settled[index]!;
      const queryId = query.trim().toLowerCase();

      if (result.status === "rejected") {
        if (isAbortError(result.reason)) throw result.reason;
        failures++;
        failureMessages.push(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
        completed.add(queryId);
        completedQueryIds.push(queryId);
        if (input.onQueryComplete) {
          await input.onQueryComplete({
            query,
            hits: [],
            creditsUsed: 0,
            failure:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
        continue;
      }

      const value = result.value;
      if (!value.skipped) {
        requests++;
        creditsUsed += value.creditsUsed;
      }
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

      if (input.onQueryComplete) {
        await input.onQueryComplete({
          query,
          hits: accepted,
          creditsUsed: value.creditsUsed,
          failure: value.failure,
        });
      }

      if (seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) {
        stoppedEarly = true;
        break;
      }
      if (requests >= maxRequests) {
        stoppedEarly = true;
        break;
      }
    }

    if (stoppedEarly) break;
    i += batch.length;
  }

  /*
   * If we hit the unique-page or request cap mid-plan, mark every remaining
   * planned query complete so checkpoints cannot stall forever as "pending".
   */
  if (stoppedEarly || requests >= maxRequests || seenPages.size >= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN) {
    for (const query of pending) {
      const queryId = query.trim().toLowerCase();
      if (completed.has(queryId)) continue;
      completed.add(queryId);
      completedQueryIds.push(queryId);
    }
  }

  return {
    hits,
    requests,
    failures,
    creditsUsed,
    uniquePages: seenPages.size,
    completedQueryIds,
    seenPageUrls: Array.from(seenPages).slice(
      0,
      SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN,
    ),
    failureMessages: failureMessages.slice(0, 20),
    drained: stoppedEarly || completedQueryIds.length >= pending.length,
  };
}
