/**
 * Browser-grade Google Images collector.
 * Uses crawler-service rendered crawl when available; supplements with SerpApi pagination.
 */

import { crawl4aiRenderPage, isCrawl4AiConfigured } from "@/lib/copyright/crawl4ai-render.server";
import { isSafePublicHttpUrl } from "./url-safety.server";
import { assertNotAborted, boundTimeoutMs, isAbortError } from "./scan-runtime.server";
import type { ReferenceImageHit } from "./image-discovery-providers.server";
import {
  REFERENCE_IMAGES_PER_QUERY,
  searchReferenceImagesForQuery,
} from "./image-discovery-providers.server";
import {
  extractGoogleImagesMetaFromHtml,
  isUsableSourceWebsiteUrl,
} from "./google-images-source.server";

export const GOOGLE_BROWSER_MAX_IMAGES = 400;
const IMAGE_URL_PATTERN = /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/gi;

function buildGoogleImagesSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    tbm: "isch",
    hl: "en",
  });
  return `https://www.google.com/search?${params.toString()}`;
}

function extractImageUrlsFromContent(content: string): string[] {
  const matches = content.match(IMAGE_URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of matches) {
    const url = raw.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
    if (!isSafePublicHttpUrl(url)) continue;
    if (/googleusercontent\.com\/(?:imgres|gen_204|logos)/i.test(url)) continue;
    if (/\.gif(?:$|[?#])/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }

  return out;
}

export async function collectGoogleImagesViaBrowser(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  maxImages?: number;
}): Promise<{
  hits: ReferenceImageHit[];
  images_found: number;
  failure: string | null;
  used_browser: boolean;
}> {
  const maxImages = input.maxImages ?? GOOGLE_BROWSER_MAX_IMAGES;
  const allHits: ReferenceImageHit[] = [];
  const seen = new Set<string>();
  let usedBrowser = false;
  let lastFailure: string | null = null;

  if (isCrawl4AiConfigured()) {
    for (const query of input.queries.slice(0, 4)) {
      assertNotAborted(input.signal);
      const searchUrl = buildGoogleImagesSearchUrl(query);
      const timeoutMs = boundTimeoutMs(25_000, input.signal, input.softDeadlineMs);

      try {
        const rendered = await crawl4aiRenderPage(searchUrl, input.signal);
        if (!rendered.ok) {
          lastFailure = rendered.failureReason ?? "Google Images browser render failed";
          continue;
        }

        usedBrowser = true;
        const blob = `${rendered.markdown}\n${rendered.html}`;
        // Prefer ou/ru pairs so page_url is the original webpage, never the Google viewer.
        const meta = extractGoogleImagesMetaFromHtml(blob);
        for (const row of meta) {
          if (allHits.length >= maxImages) break;
          if (seen.has(row.image_url)) continue;
          seen.add(row.image_url);
          allHits.push({
            image_url: row.image_url,
            page_url: isUsableSourceWebsiteUrl(row.source_website_url)
              ? row.source_website_url
              : "",
            title: row.title ?? query,
            provider: "google_images",
            query,
            width: null,
            height: null,
          });
        }
        const urls = extractImageUrlsFromContent(blob);
        for (const imageUrl of urls) {
          if (allHits.length >= maxImages) break;
          if (seen.has(imageUrl)) continue;
          seen.add(imageUrl);
          allHits.push({
            image_url: imageUrl,
            // Never store the Google Images viewer/SERP URL as the page.
            page_url: "",
            title: query,
            provider: "google_images",
            query,
            width: null,
            height: null,
          });
        }
      } catch (error) {
        if (input.signal?.aborted || isAbortError(error)) throw error;
        lastFailure = error instanceof Error ? error.message : String(error);
      }

      if (allHits.length >= maxImages) break;
      void timeoutMs;
    }
  }

  if (allHits.length < Math.min(80, maxImages)) {
    const serpResults = await Promise.allSettled(
      input.queries.slice(0, 6).map((query) =>
        searchReferenceImagesForQuery({
          engine: "google_images",
          query,
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
          pages: 5,
        }),
      ),
    );

    for (const settled of serpResults) {
      if (settled.status !== "fulfilled") {
        lastFailure =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        continue;
      }
      for (const hit of settled.value.hits) {
        if (allHits.length >= maxImages) break;
        if (seen.has(hit.image_url)) continue;
        seen.add(hit.image_url);
        allHits.push(hit);
      }
    }
  }

  return {
    hits: allHits.slice(0, Math.min(maxImages, REFERENCE_IMAGES_PER_QUERY * 4)),
    images_found: allHits.length,
    failure: allHits.length ? null : lastFailure,
    used_browser: usedBrowser,
  };
}
