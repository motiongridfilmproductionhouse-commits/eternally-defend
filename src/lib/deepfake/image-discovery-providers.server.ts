/**
 * Multi-provider reference image discovery via SerpApi image engines.
 * Runs providers in parallel; failures never abort the scan.
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
import { isUsableSourceWebsiteUrl } from "./google-images-source.server";
import type { ReferenceImageProviderId } from "./reference-images";

export const REFERENCE_PROVIDER_TIMEOUT_MS = 15_000;
export const REFERENCE_PROVIDER_MAX_RETRIES = 1;
export const REFERENCE_IMAGES_PER_QUERY = 100;

export type SerpApiImageEngine = "google_images" | "bing_images" | "yandex_images";

export interface ReferenceImageHit {
  image_url: string;
  page_url: string;
  title: string | null;
  provider: ReferenceImageProviderId;
  query: string;
  width: number | null;
  height: number | null;
}

export interface ReferenceProviderSearchResult {
  provider: ReferenceImageProviderId;
  hits: ReferenceImageHit[];
  images_found: number;
  failure: string | null;
  skipped: boolean;
}

const ENGINE_TO_PROVIDER: Record<SerpApiImageEngine, ReferenceImageProviderId> = {
  google_images: "google_images",
  bing_images: "bing_images",
  yandex_images: "yandex_images",
};

function parseDimensions(raw: unknown): { width: number | null; height: number | null } {
  if (!raw || typeof raw !== "object") return { width: null, height: null };
  const row = raw as Record<string, unknown>;
  const w = Number(row.width ?? row.original_width);
  const h = Number(row.height ?? row.original_height);
  return {
    width: Number.isFinite(w) && w > 0 ? w : null,
    height: Number.isFinite(h) && h > 0 ? h : null,
  };
}

function extractReferenceHits(
  payload: unknown,
  query: string,
  provider: ReferenceImageProviderId,
): ReferenceImageHit[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, unknown>;
  const images = Array.isArray(row.images_results) ? row.images_results : [];
  const hits: ReferenceImageHit[] = [];
  const seen = new Set<string>();

  for (const raw of images) {
    if (hits.length >= REFERENCE_IMAGES_PER_QUERY) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    const imageUrl =
      typeof item.original === "string" && isSafePublicHttpUrl(item.original)
        ? item.original.trim()
        : typeof item.thumbnail === "string" && isSafePublicHttpUrl(item.thumbnail)
          ? item.thumbnail.trim()
          : null;
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);

    // Prefer the hosting webpage. Never use Google viewer URLs as page_url.
    const rawLink =
      typeof item.link === "string" && isSafePublicHttpUrl(item.link)
        ? item.link.trim()
        : typeof item.source === "string" && isSafePublicHttpUrl(item.source)
          ? item.source.trim()
          : null;
    const pageUrl = isUsableSourceWebsiteUrl(rawLink) ? rawLink : "";

    const dims = parseDimensions(item);
    hits.push({
      image_url: imageUrl,
      page_url: pageUrl,
      title: sanitizeProviderText(item.title),
      provider,
      query,
      width: dims.width,
      height: dims.height,
    });
  }

  return hits;
}

async function fetchSerpApiImageEngine(input: {
  engine: SerpApiImageEngine;
  query: string;
  apiKey: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  page?: number;
}): Promise<{ hits: ReferenceImageHit[]; failure: string | null }> {
  const provider = ENGINE_TO_PROVIDER[input.engine];
  const params = new URLSearchParams({
    engine: input.engine,
    q: input.query,
    api_key: input.apiKey,
    safe: "off",
  });
  if (input.page && input.page > 1) {
    params.set("ijn", String(input.page - 1));
  }

  const timeoutMs = boundTimeoutMs(
    REFERENCE_PROVIDER_TIMEOUT_MS,
    input.signal,
    input.softDeadlineMs,
  );
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = mergeAbortSignals(input.signal, timeoutController.signal);

  try {
    const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    assertNotAborted(input.signal);

    if (!isAllowedJsonMime(response.headers.get("content-type"))) {
      return { hits: [], failure: `${input.engine} returned non-JSON` };
    }

    const text = await readResponseText(response, signal);
    if (text.length > MAX_SAFE_RESPONSE_BYTES) {
      return { hits: [], failure: `${input.engine} response too large` };
    }

    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return { hits: [], failure: `${input.engine} malformed JSON` };
    }

    if (!response.ok) {
      return { hits: [], failure: `${input.engine} HTTP ${response.status}` };
    }

    return {
      hits: extractReferenceHits(payload, input.query, provider),
      failure: null,
    };
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) throw error;
    return {
      hits: [],
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isReferenceImageProviderConfigured(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY?.trim());
}

/**
 * Search one image engine for reference photos of an identity phrase.
 */
export async function searchReferenceImagesForQuery(input: {
  engine: SerpApiImageEngine;
  query: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
  pages?: number;
}): Promise<ReferenceProviderSearchResult> {
  const provider = ENGINE_TO_PROVIDER[input.engine];
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      provider,
      hits: [],
      images_found: 0,
      failure: "SERPAPI_API_KEY not configured",
      skipped: true,
    };
  }

  const pages = Math.max(1, Math.min(5, input.pages ?? 3));
  const allHits: ReferenceImageHit[] = [];
  const seen = new Set<string>();
  let lastFailure: string | null = null;

  for (let page = 1; page <= pages; page++) {
    assertNotAborted(input.signal);
    let result = await fetchSerpApiImageEngine({
      engine: input.engine,
      query: input.query,
      apiKey,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
      page,
    });

    for (let retry = 0; retry < REFERENCE_PROVIDER_MAX_RETRIES && result.failure; retry++) {
      await abortableSleep(1_500, input.signal);
      result = await fetchSerpApiImageEngine({
        engine: input.engine,
        query: input.query,
        apiKey,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
        page,
      });
    }

    if (result.failure) lastFailure = result.failure;
    for (const hit of result.hits) {
      if (seen.has(hit.image_url)) continue;
      seen.add(hit.image_url);
      allHits.push(hit);
    }
    if (!result.hits.length) break;
  }

  return {
    provider,
    hits: allHits,
    images_found: allHits.length,
    failure: allHits.length ? null : lastFailure,
    skipped: false,
  };
}

export const REFERENCE_IMAGE_ENGINES: SerpApiImageEngine[] = [
  "google_images",
  "bing_images",
  "yandex_images",
];

export function buildReferenceImageQueries(identities: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const identity of identities.slice(0, 12)) {
    const quoted = `"${identity.replaceAll('"', "").trim()}"`;
    for (const suffix of ["", " actor", " photos", " images", " portrait"]) {
      const q = `${quoted}${suffix}`.trim();
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  return out.slice(0, 36);
}
