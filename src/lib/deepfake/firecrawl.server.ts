import { firecrawlFetch } from "@/lib/firecrawl-client.server";
import {
  abortableSleep,
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  readResponseText,
} from "./scan-runtime.server";

export interface FirecrawlSearchHit {
  url: string;
  title: string;
  description: string;
  query: string;
  source: "firecrawl_web" | "firecrawl_image" | "youtube_api";
  thumbnail_url?: string;
  image_url?: string;
  is_sensitive?: boolean;
}

interface FirecrawlWebResult {
  url?: string;
  title?: string;
  description?: string;
}

interface FirecrawlImageResult {
  url?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  sourceUrl?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: {
    web?: FirecrawlWebResult[];
    images?: FirecrawlImageResult[];
  };
  error?: string;
}

export interface ProviderQueryFailure {
  query: string;
  provider: string;
  error: string;
}

export async function searchQueriesWithBoundedConcurrency<T>(
  queries: string[],
  options: {
    concurrency: number;
    provider: string;
    search: (query: string) => Promise<T[]>;
    signal?: AbortSignal;
    onBatchComplete?: (info: {
      batchIndex: number;
      queriesExecuted: number;
      hitsSoFar: number;
    }) => Promise<void> | void;
  },
): Promise<{
  hits: T[];
  queriesExecuted: number;
  failures: ProviderQueryFailure[];
}> {
  const concurrency = Math.max(1, options.concurrency);
  const hits: T[] = [];
  const failures: ProviderQueryFailure[] = [];
  let queriesExecuted = 0;

  for (let i = 0; i < queries.length; i += concurrency) {
    assertNotAborted(options.signal);

    const batch = queries.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((query) => options.search(query)));

    for (let index = 0; index < results.length; index++) {
      const query = batch[index] ?? "";
      const result = results[index];
      queriesExecuted++;

      if (result.status === "fulfilled") {
        hits.push(...result.value);
      } else if (isAbortError(result.reason)) {
        throw result.reason;
      } else {
        failures.push({
          query,
          provider: options.provider,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    if (options.onBatchComplete) {
      await options.onBatchComplete({
        batchIndex: Math.floor(i / concurrency),
        queriesExecuted,
        hitsSoFar: hits.length,
      });
    }
  }

  return {
    hits,
    queriesExecuted,
    failures,
  };
}

function looksSensitive(text: string): boolean {
  return /\b(nude|nudes|naked|porn|xxx|sex tape|deepfake|fake nude|ai nude|morphed|leak)\b/i.test(
    text,
  );
}

function isTransientFirecrawlFailure(response: Response | null, error?: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }

  if (
    error instanceof Error &&
    /\b(?:timeout|timed out|abort|econnreset|etimedout)\b/i.test(error.message)
  ) {
    return true;
  }

  const status = response?.status ?? 0;
  return status === 429 || (status >= 500 && status < 600);
}

export async function firecrawlSearch(
  query: string,
  maxResults = 20,
  options?: {
    signal?: AbortSignal;
    softDeadlineMs?: number;
  },
): Promise<FirecrawlSearchHit[]> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is missing");
  }

  let response: Response | null = null;
  let rawBody = "";
  const limit = Math.min(Math.max(maxResults, 1), 20);

  for (let attempt = 0; attempt < 3; attempt++) {
    assertNotAborted(options?.signal);
    let requestError: unknown = null;

    const requestTimeoutMs = boundTimeoutMs(20_000, options?.signal, options?.softDeadlineMs);

    try {
      response = await firecrawlFetch(
        "/search",
        {
          query,
          limit,
          sources: ["web", "images"],
          tbs: "qdr:m",
          timeout: requestTimeoutMs,
        },
        { signal: options?.signal },
      );
      /*
       * Drain the body before deciding on retries / cleanup so a stalled
       * response cannot outlive the scan abort controller.
       */
      rawBody = await readResponseText(response, options?.signal);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      requestError = error;
      response = null;
      rawBody = "";
    }

    if (response?.ok) {
      break;
    }

    if (
      options?.signal?.aborted ||
      !isTransientFirecrawlFailure(response, requestError) ||
      attempt === 2
    ) {
      if (isAbortError(requestError)) {
        throw requestError;
      }
      throw new Error(
        requestError instanceof Error
          ? requestError.message
          : `Firecrawl search failed (${response?.status ?? "unknown"}): ` + rawBody.slice(0, 500),
      );
    }

    const retryAfterHeader = response?.headers.get("retry-after");

    const retrySeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : 4 * (attempt + 1);

    const safeDelayMs = boundTimeoutMs(
      Number.isFinite(retrySeconds) ? Math.min(Math.max(retrySeconds, 2), 12) * 1_000 : 4_000,
      options?.signal,
      options?.softDeadlineMs,
    );

    console.warn("[DEEPFAKE:FIRECRAWL] Rate limited", {
      query,
      attempt: attempt + 1,
      retryInMs: safeDelayMs,
    });

    await abortableSleep(safeDelayMs, options?.signal);
  }

  if (!response?.ok) {
    throw new Error(
      `Firecrawl search failed (${response?.status ?? "unknown"}): ` + rawBody.slice(0, 500),
    );
  }

  let data: FirecrawlSearchResponse;

  try {
    data = JSON.parse(rawBody) as FirecrawlSearchResponse;
  } catch {
    throw new Error("Firecrawl returned invalid JSON");
  }

  if (!data.success) {
    throw new Error(data.error || "Firecrawl search was unsuccessful");
  }

  const webHits: FirecrawlSearchHit[] = (data.data?.web ?? [])
    .filter((result): result is FirecrawlWebResult & { url: string } => Boolean(result.url))
    .map((result) => ({
      url: result.url,
      title: result.title ?? "",
      description: result.description ?? "",
      query,
      source: "firecrawl_web",

      is_sensitive: looksSensitive(
        `${result.title ?? ""} ${result.description ?? ""} ${result.url}`,
      ),
    }));

  const imageHits: FirecrawlSearchHit[] = (data.data?.images ?? [])
    .map((result) => {
      const pageUrl = result.sourceUrl ?? result.url ?? "";
      const imageUrl = result.imageUrl ?? result.url ?? result.thumbnailUrl ?? "";

      return {
        url: pageUrl || imageUrl,
        title: result.title ?? "Image search result",
        description: result.description ?? "",
        query,
        source: "firecrawl_image" as const,

        thumbnail_url: result.thumbnailUrl ?? result.imageUrl ?? result.url,
        image_url: imageUrl,
        is_sensitive: looksSensitive(
          `${result.title ?? ""} ${result.description ?? ""} ${pageUrl} ${imageUrl}`,
        ),
      };
    })
    .filter((result) => Boolean(result.url));

  const deduped = new Map<string, FirecrawlSearchHit>();

  for (const hit of [...webHits, ...imageHits]) {
    const key = hit.image_url || hit.url;

    if (!deduped.has(key)) {
      deduped.set(key, hit);
    }
  }

  return Array.from(deduped.values()).slice(0, limit * 2);
}
