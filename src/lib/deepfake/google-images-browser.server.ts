/**
 * Browser-based Google Images collection client.
 * Calls crawler-service /google-images when configured; falls back to SerpApi.
 */

import { crawl4aiRenderPage, isCrawl4AiConfigured } from "@/lib/copyright/crawl4ai-render.server";
import { isSafePublicHttpUrl } from "./url-safety.server";
import {
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  readResponseText,
} from "./scan-runtime.server";
import {
  REFERENCE_IMAGES_PER_QUERY,
  searchReferenceImagesForQuery,
} from "./image-discovery-providers.server";
import { GOOGLE_IMAGES_TARGET_MAX } from "./google-images-queries.server";

export const GOOGLE_BROWSER_MAX_IMAGES_PER_QUERY = 120;
export const GOOGLE_BROWSER_MAX_QUERIES = 12;

export interface GoogleImagesBrowserHit {
  image_url: string;
  thumbnail_url: string | null;
  source_website_url: string | null;
  google_result_url: string;
  query: string;
  title: string | null;
  width: number | null;
  height: number | null;
}

export interface GoogleImagesBrowserResult {
  hits: GoogleImagesBrowserHit[];
  images_discovered: number;
  queries_executed: number;
  pages_loaded: number;
  used_browser: boolean;
  browser_available: boolean;
  failure: string | null;
  provider_status: "success" | "degraded" | "unavailable";
  failures: string[];
}

const IMAGE_URL_PATTERN =
  /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;

function crawlerServiceBase(): string | null {
  const raw =
    process.env.CRAWLER_SERVICE_URL?.trim() ||
    process.env.CRAWL4AI_SERVICE_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

export function isGoogleImagesBrowserConfigured(): boolean {
  return Boolean(crawlerServiceBase() || isCrawl4AiConfigured());
}

function buildGoogleImagesSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query, tbm: "isch", hl: "en" });
  return `https://www.google.com/search?${params.toString()}`;
}

function extractImageUrlsFromContent(
  content: string,
  query: string,
  searchUrl: string,
): GoogleImagesBrowserHit[] {
  const matches = content.match(IMAGE_URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const out: GoogleImagesBrowserHit[] = [];

  for (const raw of matches) {
    const imageUrl = raw.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    if (!isSafePublicHttpUrl(imageUrl)) continue;
    if (/googleusercontent\.com\/(?:imgres|gen_204|logos)/i.test(imageUrl)) continue;
    if (/\.gif(?:$|[?#])/i.test(imageUrl)) continue;
    if (seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    out.push({
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      source_website_url: null,
      google_result_url: searchUrl,
      query,
      title: query,
      width: null,
      height: null,
    });
  }

  return out;
}

async function collectViaCrawlerService(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  maxImagesPerQuery?: number;
}): Promise<GoogleImagesBrowserResult | null> {
  const base = crawlerServiceBase();
  if (!base) return null;

  const timeoutMs = boundTimeoutMs(120_000, input.signal, input.softDeadlineMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(`${base}/google-images`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        queries: input.queries.slice(0, GOOGLE_BROWSER_MAX_QUERIES),
        max_images_per_query:
          input.maxImagesPerQuery ?? GOOGLE_BROWSER_MAX_IMAGES_PER_QUERY,
        max_queries: GOOGLE_BROWSER_MAX_QUERIES,
      }),
      signal,
    });

    const text = await readResponseText(response, signal);
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return {
        hits: [],
        images_discovered: 0,
        queries_executed: 0,
        pages_loaded: 0,
        used_browser: true,
        browser_available: true,
        failure: `Google Images browser HTTP ${response.status}`,
        provider_status: "degraded",
        failures: [text.slice(0, 240)],
      };
    }

    const images = Array.isArray(payload?.images) ? payload.images : [];
    const hits: GoogleImagesBrowserHit[] = [];
    for (const raw of images) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const imageUrl =
        typeof row.image_url === "string" && isSafePublicHttpUrl(row.image_url)
          ? row.image_url
          : null;
      if (!imageUrl) continue;
      hits.push({
        image_url: imageUrl,
        thumbnail_url:
          typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
        source_website_url:
          typeof row.source_website_url === "string" &&
          isSafePublicHttpUrl(row.source_website_url)
            ? row.source_website_url
            : null,
        google_result_url:
          typeof row.google_result_url === "string"
            ? row.google_result_url
            : buildGoogleImagesSearchUrl(
                typeof row.query === "string" ? row.query : "",
              ),
        query: typeof row.query === "string" ? row.query : "",
        title: typeof row.title === "string" ? row.title : null,
        width: typeof row.width === "number" ? row.width : null,
        height: typeof row.height === "number" ? row.height : null,
      });
    }

    return {
      hits,
      images_discovered: hits.length,
      queries_executed: Number(payload?.queries_executed) || input.queries.length,
      pages_loaded: Number(payload?.pages_loaded) || 0,
      used_browser: payload?.used_browser === true,
      browser_available: true,
      failure: hits.length ? null : "Google Images browser returned no images",
      provider_status: hits.length ? "success" : "degraded",
      failures: Array.isArray(payload?.failures)
        ? payload.failures.map(String)
        : [],
    };
  } catch (error) {
    if (input.signal?.aborted || isAbortError(error)) throw error;
    return {
      hits: [],
      images_discovered: 0,
      queries_executed: 0,
      pages_loaded: 0,
      used_browser: true,
      browser_available: true,
      failure: error instanceof Error ? error.message : String(error),
      provider_status: "degraded",
      failures: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function collectViaLocalBrowserFallback(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<GoogleImagesBrowserResult> {
  const allHits: GoogleImagesBrowserHit[] = [];
  const seen = new Set<string>();
  let pagesLoaded = 0;
  let lastFailure: string | null = null;

  if (isCrawl4AiConfigured()) {
    for (const query of input.queries.slice(0, 6)) {
      assertNotAborted(input.signal);
      const searchUrl = buildGoogleImagesSearchUrl(query);
      const rendered = await crawl4aiRenderPage(searchUrl, input.signal);
      pagesLoaded += 1;
      if (!rendered.ok) {
        lastFailure = rendered.failureReason ?? "Google Images render failed";
        continue;
      }
      const extracted = extractImageUrlsFromContent(
        `${rendered.markdown}\n${rendered.html}`,
        query,
        searchUrl,
      );
      for (const hit of extracted) {
        if (seen.has(hit.image_url)) continue;
        seen.add(hit.image_url);
        allHits.push(hit);
      }
    }
  }

  return {
    hits: allHits,
    images_discovered: allHits.length,
    queries_executed: Math.min(input.queries.length, 6),
    pages_loaded: pagesLoaded,
    used_browser: allHits.length > 0,
    browser_available: isCrawl4AiConfigured(),
    failure: allHits.length ? null : lastFailure,
    provider_status: allHits.length ? "success" : "degraded",
    failures: lastFailure ? [lastFailure] : [],
  };
}

async function collectViaSerpApiFallback(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<GoogleImagesBrowserHit[]> {
  const allHits: GoogleImagesBrowserHit[] = [];
  const seen = new Set<string>();

  const results = await Promise.allSettled(
    input.queries.slice(0, 8).map((query) =>
      searchReferenceImagesForQuery({
        engine: "google_images",
        query,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
        pages: 5,
      }),
    ),
  );

  for (const settled of results) {
    if (settled.status !== "fulfilled") continue;
    for (const hit of settled.value.hits) {
      if (seen.has(hit.image_url)) continue;
      seen.add(hit.image_url);
      allHits.push({
        image_url: hit.image_url,
        thumbnail_url: hit.image_url,
        source_website_url: hit.page_url,
        google_result_url: buildGoogleImagesSearchUrl(hit.query),
        query: hit.query,
        title: hit.title,
        width: hit.width,
        height: hit.height,
      });
      if (allHits.length >= GOOGLE_IMAGES_TARGET_MAX) break;
    }
  }

  return allHits;
}

/**
 * Mandatory browser-based Google Images collection.
 * Never relies on simple HTML scraping alone — uses crawler-service Playwright first.
 */
export async function collectGoogleImagesMandatory(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  maxImages?: number;
}): Promise<GoogleImagesBrowserResult> {
  const maxImages = input.maxImages ?? GOOGLE_IMAGES_TARGET_MAX;

  let result =
    (await collectViaCrawlerService({
      queries: input.queries,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
    })) ??
    (await collectViaLocalBrowserFallback({
      queries: input.queries,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
    }));

  if (result.hits.length < Math.min(80, maxImages)) {
    const serpHits = await collectViaSerpApiFallback({
      queries: input.queries,
      signal: input.signal,
      softDeadlineMs: input.softDeadlineMs,
    });
    const seen = new Set(result.hits.map((h) => h.image_url));
    for (const hit of serpHits) {
      if (seen.has(hit.image_url)) continue;
      seen.add(hit.image_url);
      result.hits.push(hit);
    }
    result.images_discovered = result.hits.length;
    if (result.hits.length && result.provider_status === "unavailable") {
      result.provider_status = "degraded";
    }
  }

  result.hits = result.hits.slice(0, Math.min(maxImages, REFERENCE_IMAGES_PER_QUERY * 8));
  result.images_discovered = result.hits.length;

  if (!result.hits.length && !result.failure) {
    result.failure = "Google Images returned no discoverable image results";
    result.provider_status = "unavailable";
  }

  return result;
}
