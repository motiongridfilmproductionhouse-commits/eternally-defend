/**
 * Firecrawl-only reference image discovery.
 * Google Images, Brave and SerpApi image engines are intentionally NOT used.
 */

import { firecrawlSearch } from "./firecrawl.server";
import { isAbortError } from "./scan-runtime.server";
import { isSafePublicHttpUrl } from "./url-safety.server";
import type { ReferenceImageHit } from "./image-discovery-providers.server";

export function isFirecrawlImageSearchConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export async function searchFirecrawlImagesBatch(input: {
  queries: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
  maxImages?: number;
}): Promise<{
  hits: ReferenceImageHit[];
  images_found: number;
  failures: number;
  skipped: boolean;
}> {
  if (!isFirecrawlImageSearchConfigured()) {
    return { hits: [], images_found: 0, failures: 0, skipped: true };
  }

  const maxImages = input.maxImages ?? 400;
  const hits: ReferenceImageHit[] = [];
  const seen = new Set<string>();
  let failures = 0;

  for (const query of input.queries) {
    if (hits.length >= maxImages) break;

    try {
      const results = await firecrawlSearch(query, 20, {
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      });

      for (const result of results) {
        if (hits.length >= maxImages) break;
        const imageUrl = result.image_url ?? result.thumbnail_url;
        if (!imageUrl || !isSafePublicHttpUrl(imageUrl)) continue;
        if (seen.has(imageUrl)) continue;
        seen.add(imageUrl);

        hits.push({
          image_url: imageUrl,
          page_url: isSafePublicHttpUrl(result.url) ? result.url : "",
          title: result.title || query,
          provider: "firecrawl_images",
          query,
          width: null,
          height: null,
        });
      }
    } catch (error) {
      if (input.signal?.aborted || isAbortError(error)) throw error;
      failures += 1;
    }
  }

  return { hits, images_found: hits.length, failures, skipped: false };
}
