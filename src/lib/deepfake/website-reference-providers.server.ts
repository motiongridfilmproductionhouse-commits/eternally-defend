/**
 * Website-based reference image discovery: public, news, official, and social sources.
 * Uses SerpApi Google web search to find pages with portrait imagery.
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
import type { ReferenceImageProviderId } from "./reference-images";

export type WebsiteReferenceCategory =
  "public_website" | "news_website" | "official_website" | "social_public";

const CATEGORY_SITE_HINTS: Record<WebsiteReferenceCategory, string[]> = {
  public_website: ["imdb.com", "wikipedia.org", "wikidata.org", "filmibeat.com"],
  news_website: [
    "thehindu.com",
    "indianexpress.com",
    "timesofindia.indiatimes.com",
    "bbc.com",
    "ndtv.com",
    "manoramaonline.com",
  ],
  official_website: [],
  social_public: ["instagram.com", "twitter.com", "x.com", "facebook.com"],
};

function categoryForUrl(url: string): WebsiteReferenceCategory {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (CATEGORY_SITE_HINTS.news_website.some((d) => host.includes(d))) {
      return "news_website";
    }
    if (CATEGORY_SITE_HINTS.social_public.some((d) => host.includes(d))) {
      return "social_public";
    }
    if (CATEGORY_SITE_HINTS.public_website.some((d) => host.includes(d))) {
      return "public_website";
    }
    return "public_website";
  } catch {
    return "public_website";
  }
}

function extractImageFromResult(item: Record<string, unknown>): string | null {
  const thumbnail =
    typeof item.thumbnail === "string" && isSafePublicHttpUrl(item.thumbnail)
      ? item.thumbnail.trim()
      : null;
  if (thumbnail) return thumbnail;

  const richSnippet = item.rich_snippet;
  if (richSnippet && typeof richSnippet === "object") {
    const top = (richSnippet as Record<string, unknown>).top;
    if (top && typeof top === "object") {
      const detected = (top as Record<string, unknown>).detected_extensions;
      if (detected && typeof detected === "object") {
        const image = (detected as Record<string, unknown>).image;
        if (typeof image === "string" && isSafePublicHttpUrl(image)) {
          return image.trim();
        }
      }
    }
  }

  return null;
}

async function searchWebForImages(input: {
  query: string;
  site?: string;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{ hits: ReferenceImageHit[]; failure: string | null }> {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return { hits: [], failure: "SERPAPI_API_KEY not configured" };
  }

  const q = input.site ? `${input.query} site:${input.site}` : input.query;
  const params = new URLSearchParams({
    engine: "google",
    q,
    api_key: apiKey,
    num: "20",
  });

  const timeoutMs = boundTimeoutMs(12_000, input.signal, input.softDeadlineMs);
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
      return { hits: [], failure: "Web search returned non-JSON" };
    }

    const text = await readResponseText(response, signal);
    if (text.length > MAX_SAFE_RESPONSE_BYTES) {
      return { hits: [], failure: "Web search response too large" };
    }

    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return { hits: [], failure: `Web search HTTP ${response.status}` };
    }

    const organic = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
    const hits: ReferenceImageHit[] = [];
    const seen = new Set<string>();

    for (const raw of organic) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const pageUrl =
        typeof item.link === "string" && isSafePublicHttpUrl(item.link) ? item.link.trim() : null;
      const imageUrl = extractImageFromResult(item);
      if (!pageUrl || !imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);

      const provider = input.site ? categoryForSite(input.site) : categoryForUrl(pageUrl);

      hits.push({
        image_url: imageUrl,
        page_url: pageUrl,
        title: sanitizeProviderText(item.title),
        provider,
        query: q,
        width: null,
        height: null,
      });
    }

    return { hits, failure: null };
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

function categoryForSite(site: string): ReferenceImageProviderId {
  const normalized = site.replace(/^www\./, "").toLowerCase();
  if (CATEGORY_SITE_HINTS.news_website.some((d) => normalized.includes(d))) {
    return "news_website";
  }
  if (CATEGORY_SITE_HINTS.social_public.some((d) => normalized.includes(d))) {
    return "social_public";
  }
  return "public_website";
}

export async function collectWebsiteReferenceImages(input: {
  identities: string[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  hits: ReferenceImageHit[];
  images_found: number;
  failures: number;
}> {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    return { hits: [], images_found: 0, failures: 0 };
  }

  const identity = input.identities[0] ?? "";
  if (!identity) return { hits: [], images_found: 0, failures: 0 };

  const quoted = `"${identity.replaceAll('"', "").trim()}"`;
  const queries = [`${quoted} photos`, `${quoted} portrait`, `${quoted} actor`];

  const siteTargets = [
    ...CATEGORY_SITE_HINTS.public_website.slice(0, 2),
    ...CATEGORY_SITE_HINTS.news_website.slice(0, 2),
    ...CATEGORY_SITE_HINTS.social_public.slice(0, 1),
  ];

  const tasks: Array<Promise<{ hits: ReferenceImageHit[]; failure: string | null }>> = [];

  for (const query of queries.slice(0, 2)) {
    tasks.push(
      searchWebForImages({
        query,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      }),
    );
  }

  for (const site of siteTargets) {
    tasks.push(
      searchWebForImages({
        query: `${quoted} photos`,
        site,
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      }),
    );
  }

  const results = await Promise.allSettled(tasks);
  const allHits: ReferenceImageHit[] = [];
  const seen = new Set<string>();
  let failures = 0;

  for (const settled of results) {
    if (settled.status !== "fulfilled") {
      failures += 1;
      continue;
    }
    if (settled.value.failure) failures += 1;
    for (const hit of settled.value.hits) {
      if (seen.has(hit.image_url)) continue;
      seen.add(hit.image_url);
      allHits.push(hit);
    }
  }

  return {
    hits: allHits,
    images_found: allHits.length,
    failures,
  };
}
