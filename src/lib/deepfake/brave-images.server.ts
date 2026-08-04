/**
 * Brave Image Search provider for reference image collection.
 * Uses the Brave Search API images endpoint; failures never abort the scan.
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
  sanitizeProviderText,
} from "./url-safety.server";
import type { ReferenceImageHit } from "./image-discovery-providers.server";

export const BRAVE_IMAGES_TIMEOUT_MS = 15_000;
export const BRAVE_IMAGES_MAX_RETRIES = 1;
export const BRAVE_IMAGES_PER_QUERY = 80;

const BRAVE_IMAGES_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";

function parseBraveImageHits(
  payload: unknown,
  query: string,
): ReferenceImageHit[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, unknown>;
  const results = Array.isArray(row.results) ? row.results : [];
  const hits: ReferenceImageHit[] = [];
  const seen = new Set<string>();

  for (const raw of results) {
    if (hits.length >= BRAVE_IMAGES_PER_QUERY) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const properties =
      item.properties && typeof item.properties === "object"
        ? (item.properties as Record<string, unknown>)
        : null;

    const thumbnail =
      item.thumbnail && typeof item.thumbnail === "object"
        ? (item.thumbnail as Record<string, unknown>)
        : null;
    const thumbnailSrc =
      typeof thumbnail?.src === "string" && isSafePublicHttpUrl(thumbnail.src)
        ? thumbnail.src.trim()
        : null;

    const imageUrl =
      (typeof properties?.url === "string" && isSafePublicHttpUrl(properties.url)
        ? properties.url.trim()
        : null) ??
      (typeof item.url === "string" && isSafePublicHttpUrl(item.url)
        ? item.url.trim()
        : null) ??
      thumbnailSrc;

    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);

    const pageUrl =
      (typeof item.url === "string" && isSafePublicHttpUrl(item.url)
        ? item.url.trim()
        : null) ?? imageUrl;

    const width = Number(properties?.width ?? item.width);
    const height = Number(properties?.height ?? item.height);

    hits.push({
      image_url: imageUrl,
      page_url: pageUrl,
      title: sanitizeProviderText(item.title ?? properties?.title),
      provider: "brave_images",
      query,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
    });
  }

  return hits;
}

export function isBraveImageSearchConfigured(): boolean {
  return Boolean(process.env.BRAVE_API_KEY?.trim());
}

export async function searchBraveImagesForQuery(input: {
  query: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  offset?: number;
}): Promise<{
  hits: ReferenceImageHit[];
  images_found: number;
  failure: string | null;
  skipped: boolean;
}> {
  const apiKey = process.env.BRAVE_API_KEY?.trim();
  if (!apiKey) {
    return {
      hits: [],
      images_found: 0,
      failure: "BRAVE_API_KEY not configured",
      skipped: true,
    };
  }

  const params = new URLSearchParams({
    q: input.query,
    count: "50",
    safesearch: "off",
  });
  if (input.offset && input.offset > 0) {
    params.set("offset", String(input.offset));
  }

  const timeoutMs = boundTimeoutMs(
    BRAVE_IMAGES_TIMEOUT_MS,
    input.signal,
    input.softDeadlineMs,
  );
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = mergeAbortSignals(input.signal, timeoutController.signal);

  try {
    const response = await fetch(`${BRAVE_IMAGES_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal,
    });
    assertNotAborted(input.signal);

    if (!isAllowedJsonMime(response.headers.get("content-type"))) {
      return { hits: [], images_found: 0, failure: "Brave Images returned non-JSON", skipped: false };
    }

    const text = await readResponseText(response, signal);
    if (text.length > MAX_SAFE_RESPONSE_BYTES) {
      return { hits: [], images_found: 0, failure: "Brave Images response too large", skipped: false };
    }

    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return { hits: [], images_found: 0, failure: "Brave Images malformed JSON", skipped: false };
    }

    if (!response.ok) {
      return {
        hits: [],
        images_found: 0,
        failure: `Brave Images HTTP ${response.status}`,
        skipped: false,
      };
    }

    const hits = parseBraveImageHits(payload, input.query);
    return { hits, images_found: hits.length, failure: null, skipped: false };
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) throw error;
    return {
      hits: [],
      images_found: 0,
      failure: error instanceof Error ? error.message : String(error),
      skipped: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchBraveImagesBatch(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  hits: ReferenceImageHit[];
  images_found: number;
  failures: number;
  skipped: boolean;
}> {
  const allHits: ReferenceImageHit[] = [];
  const seen = new Set<string>();
  let failures = 0;
  let skipped = true;

  for (const query of input.queries) {
    assertNotAborted(input.signal);
    let result = await searchBraveImagesForQuery({
      query,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
    });

    for (let retry = 0; retry < BRAVE_IMAGES_MAX_RETRIES && result.failure; retry++) {
      await abortableSleep(1_500, input.signal);
      result = await searchBraveImagesForQuery({
        query,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      });
    }

    if (result.skipped) return { hits: [], images_found: 0, failures: 0, skipped: true };
    skipped = false;
    if (result.failure) failures += 1;

    for (const hit of result.hits) {
      if (seen.has(hit.image_url)) continue;
      seen.add(hit.image_url);
      allHits.push(hit);
    }
  }

  return {
    hits: allHits,
    images_found: allHits.length,
    failures,
    skipped,
  };
}
