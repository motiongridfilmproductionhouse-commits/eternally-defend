import {
  abortableSleep,
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  readResponseText,
} from "./scan-runtime.server";

export type MediaDiscoveryHit = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source?: string;
  image_url?: string;
  thumbnail_url?: string;
  media_url?: string;
  media_type?: "image" | "video";
  evidence_page_url?: string;
  is_sensitive?: boolean;
  /** Extracted text from the exact crawled result page. */
  page_text?: string;
  page_type?: string;
  /** True only after a successful Firecrawl scrape of the exact page URL. */
  page_inspected?: boolean;
  /**
   * True when the crawl provider request itself failed (HTTP/API error).
   * Distinct from a successful scrape that yielded insufficient page text.
   */
  provider_scrape_failed?: boolean;
  related_links?: string[];
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    html?: string;
    rawHtml?: string;
    markdown?: string;
    content?: string;
    images?: string[];
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
};

const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

const VIDEO_EXTENSION = /\.(?:avi|mkv|mov|mp4|m4v|webm|wmv)(?:$|[?#])/i;

const EXPLICIT_TERMS =
  /\b(?:nude|nudes|naked|nudity|porn|xxx|sex(?:\s+video|\s+tape)?|adult|explicit|deepfake\s+porn|ai\s+nude|fake\s+nude|morphed|leaked\s+video)\b/i;

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function absoluteUrl(value: string, pageUrl: string): string | null {
  try {
    const resolved = new URL(value, pageUrl);

    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPageText(data: NonNullable<FirecrawlScrapeResponse["data"]>): string {
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const content = typeof data.content === "string" ? data.content : "";
  const html = data.rawHtml ?? data.html ?? "";

  const metadataDescription = metadataString(data.metadata, [
    "description",
    "ogDescription",
    "og:description",
    "twitterDescription",
    "title",
    "ogTitle",
    "og:title",
  ]);

  const combined = [metadataDescription ?? "", markdown, content, html ? stripHtmlToText(html) : ""]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return combined.slice(0, 12_000);
}

function extractAttributeMedia(
  html: string,
  pageUrl: string,
): Array<{
  media_url: string;
  media_type: "image" | "video";
}> {
  const output: Array<{
    media_url: string;
    media_type: "image" | "video";
  }> = [];

  const add = (rawValue: string | undefined, type: "image" | "video") => {
    if (!rawValue) return;

    const firstCandidate = rawValue.split(",")[0]?.trim().split(/\s+/)[0];

    if (!firstCandidate || firstCandidate.startsWith("data:")) {
      return;
    }

    const resolved = absoluteUrl(firstCandidate, pageUrl);
    if (!resolved) return;

    output.push({
      media_url: resolved,
      media_type: type,
    });
  };

  const patterns: Array<{
    regex: RegExp;
    type: "image" | "video";
  }> = [
    {
      regex:
        /<meta[^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      type: "image",
    },
    {
      regex:
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]*>/gi,
      type: "image",
    },
    {
      regex:
        /<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      type: "video",
    },
    {
      regex: /<img[^>]+(?:src|data-src|data-lazy-src|srcset)=["']([^"']+)["'][^>]*>/gi,
      type: "image",
    },
    {
      regex: /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi,
      type: "video",
    },
    {
      regex: /<video[^>]+poster=["']([^"']+)["'][^>]*>/gi,
      type: "image",
    },
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern.regex)) {
      add(match[1], pattern.type);
    }
  }

  return output;
}

function extractHrefLinks(html: string, pageUrl: string): string[] {
  const links: string[] = [];

  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    const resolved = absoluteUrl(match[1], pageUrl);
    if (resolved) {
      links.push(resolved);
    }
  }

  return links;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function sameHostRelatedLinks(input: {
  pageUrl: string;
  links?: string[];
  html?: string;
}): string[] {
  const pageHost = hostOf(input.pageUrl);
  if (!pageHost) return [];

  const candidates = [
    ...(input.links ?? []).flatMap((link) => {
      const resolved = absoluteUrl(link, input.pageUrl);
      return resolved ? [resolved] : [];
    }),
    ...extractHrefLinks(input.html ?? "", input.pageUrl),
  ];

  const seen = new Set<string>();
  const output: string[] = [];

  for (const link of candidates) {
    if (hostOf(link) !== pageHost) continue;
    if (link === input.pageUrl) continue;
    if (seen.has(link)) continue;

    seen.add(link);
    output.push(link);
  }

  return output.slice(0, 20);
}

function isTransientFirecrawlStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isTransientFirecrawlError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /\b(?:timeout|timed out|abort|econnreset|etimedout)\b/i.test(error.message)
  );
}

export function hasExplicitPageRisk(hit: {
  url?: string;
  title?: string;
  description?: string;
}): boolean {
  return EXPLICIT_TERMS.test(`${hit.title ?? ""} ${hit.description ?? ""} ${hit.url ?? ""}`);
}

export async function scrapeMediaFromPage(
  hit: MediaDiscoveryHit,
  options?: {
    signal?: AbortSignal;
    softDeadlineMs?: number;
  },
): Promise<MediaDiscoveryHit[]> {
  assertNotAborted(options?.signal);

  const existingDirectMedia = hit.image_url ?? hit.media_url ?? hit.thumbnail_url;

  const urlIsDirectMedia = IMAGE_EXTENSION.test(hit.url) || VIDEO_EXTENSION.test(hit.url);

  /*
   * Direct media URLs have no HTML body to inspect. Keep the media for
   * optional hashing, but mark the page as not inspected so classification
   * fails closed to UNVERIFIED_LEAD.
   */
  if (urlIsDirectMedia) {
    return [
      {
        ...hit,
        evidence_page_url: hit.evidence_page_url ?? hit.url,
        media_url: hit.url,
        media_type: VIDEO_EXTENSION.test(hit.url) ? "video" : "image",
        page_inspected: false,
        page_text: hit.page_text,
        is_sensitive: hit.is_sensitive ?? hasExplicitPageRisk(hit),
      },
    ];
  }

  /*
   * Always crawl the exact result page for text evidence — even when an
   * image-search thumbnail is already available. Thumbnails alone must
   * not produce client-visible deepfake findings.
   */
  try {
    const { firecrawlFetch } = await import("@/lib/firecrawl-client.server");

    let response: Response | null = null;
    let rawBody = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      assertNotAborted(options?.signal);
      let requestError: unknown = null;
      const requestTimeoutMs = boundTimeoutMs(20_000, options?.signal, options?.softDeadlineMs);

      try {
        response = await firecrawlFetch(
          "/scrape",
          {
            url: hit.url,
            formats: ["html", "rawHtml", "markdown"],
            onlyMainContent: false,
            removeBase64Images: true,
            blockAds: true,
            timeout: requestTimeoutMs,
            waitFor: Math.min(1_000, requestTimeoutMs),
          },
          { signal: options?.signal },
        );

        rawBody = await readResponseText(response, options?.signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        requestError = error;
        response = null;
        rawBody = error instanceof Error ? error.message : String(error);
      }

      /*
       * Abort must never soft-continue into a "failed scrape" return — that
       * would let the pipeline start more batches after cancellation.
       */
      assertNotAborted(options?.signal);

      if (
        response?.ok ||
        (response
          ? !isTransientFirecrawlStatus(response.status)
          : !isTransientFirecrawlError(requestError)) ||
        attempt === 2
      ) {
        break;
      }

      await abortableSleep(
        boundTimeoutMs((attempt + 1) * 2_000, options?.signal, options?.softDeadlineMs),
        options?.signal,
      );
    }

    assertNotAborted(options?.signal);

    /*
     * The provider can refuse a page (quota exhausted, provider error, host
     * blocked). Fall back to a direct HTML fetch of the exact final URL so
     * client-supplied evidence is still inspected from the real page.
     */
    const providerFailedRecord = (): MediaDiscoveryHit[] => [
      {
        ...hit,
        evidence_page_url: hit.evidence_page_url ?? hit.url,
        media_url:
          existingDirectMedia && validHttpUrl(existingDirectMedia)
            ? existingDirectMedia
            : hit.media_url,
        image_url:
          existingDirectMedia && validHttpUrl(existingDirectMedia)
            ? existingDirectMedia
            : hit.image_url,
        page_inspected: false,
        provider_scrape_failed: true,
        page_text: "",
        is_sensitive: hit.is_sensitive ?? hasExplicitPageRisk(hit),
      },
    ];

    const directFallback = async (): Promise<
      NonNullable<FirecrawlScrapeResponse["data"]> | null
    > => {
      const { fetchPageDirect } = await import("./direct-page-fetch.server");
      return fetchPageDirect(hit.url, {
        ...(options?.signal ? { signal: options.signal } : {}),
        timeoutMs: boundTimeoutMs(20_000, options?.signal, options?.softDeadlineMs),
      });
    };

    let data: NonNullable<FirecrawlScrapeResponse["data"]> | null = null;

    if (!response?.ok) {
      console.warn("[DEEPFAKE:MEDIA] Page scrape failed, trying direct fetch:", {
        url: hit.url,
        status: response?.status ?? "unknown",
        error: rawBody.slice(0, 300),
      });
      data = await directFallback();
    } else {
      let payload: FirecrawlScrapeResponse | null = null;
      try {
        payload = JSON.parse(rawBody) as FirecrawlScrapeResponse;
      } catch {
        payload = null;
      }

      data = payload?.success && payload.data ? payload.data : await directFallback();
    }

    assertNotAborted(options?.signal);

    if (!data) {
      return providerFailedRecord();
    }

    const html = data.rawHtml ?? data.html ?? "";
    const pageText = extractPageText(data);

    const pageInspected = pageText.trim().length >= 80;
    const relatedLinks = sameHostRelatedLinks({
      pageUrl: hit.url,
      links: data.links,
      html,
    });

    const metadataTitle = metadataString(data.metadata, [
      "title",
      "ogTitle",
      "og:title",
      "twitterTitle",
    ]);

    const metadataDescription = metadataString(data.metadata, [
      "description",
      "ogDescription",
      "og:description",
      "twitterDescription",
    ]);

    const inspectedHit: MediaDiscoveryHit = {
      ...hit,
      title: metadataTitle ?? hit.title,
      description: metadataDescription ?? hit.description,
      page_text: pageText,
      page_inspected: pageInspected,
      evidence_page_url: hit.evidence_page_url ?? hit.url,
      related_links: relatedLinks,
      is_sensitive: hit.is_sensitive ?? hasExplicitPageRisk(hit),
    };

    if (existingDirectMedia && validHttpUrl(existingDirectMedia) && !inspectedHit.media_url) {
      inspectedHit.media_url = existingDirectMedia;
      inspectedHit.image_url = existingDirectMedia;
      inspectedHit.media_type = VIDEO_EXTENSION.test(existingDirectMedia) ? "video" : "image";
    }

    const metadataImage = metadataString(data.metadata, [
      "ogImage",
      "og:image",
      "twitterImage",
      "twitter:image",
      "image",
    ]);

    const metadataVideo = metadataString(data.metadata, ["ogVideo", "og:video", "video"]);

    const candidates: Array<{
      media_url: string;
      media_type: "image" | "video";
    }> = [];

    if (metadataImage) {
      const resolved = absoluteUrl(metadataImage, hit.url);
      if (resolved) {
        candidates.push({
          media_url: resolved,
          media_type: "image",
        });
      }
    }

    if (metadataVideo) {
      const resolved = absoluteUrl(metadataVideo, hit.url);
      if (resolved) {
        candidates.push({
          media_url: resolved,
          media_type: "video",
        });
      }
    }

    for (const image of data.images ?? []) {
      const resolved = absoluteUrl(image, hit.url);

      if (resolved) {
        candidates.push({
          media_url: resolved,
          media_type: "image",
        });
      }
    }

    candidates.push(...extractAttributeMedia(html, hit.url));

    const unique = new Map<
      string,
      {
        media_url: string;
        media_type: "image" | "video";
      }
    >();

    for (const candidate of candidates) {
      if (!validHttpUrl(candidate.media_url)) continue;

      /*
       * Reject common tracking pixels and tiny inline assets by URL hints.
       */
      if (/(?:pixel|spacer|tracking|favicon|logo|avatar|sprite)/i.test(candidate.media_url)) {
        continue;
      }

      unique.set(candidate.media_url, candidate);
    }

    const mediaHits = Array.from(unique.values())
      .slice(0, 8)
      .map((candidate) => ({
        ...inspectedHit,
        url: candidate.media_url,
        media_url: candidate.media_url,
        image_url: candidate.media_type === "image" ? candidate.media_url : undefined,
        media_type: candidate.media_type,
        evidence_page_url: hit.url,
        page_text: inspectedHit.page_text,
        page_inspected: inspectedHit.page_inspected,
        is_sensitive: hit.is_sensitive ?? hasExplicitPageRisk(inspectedHit),
      }));

    /*
     * Always retain the inspected page record so classification can use
     * exact-page evidence even when no media URL is extractable.
     */
    if (!mediaHits.length) {
      return [inspectedHit];
    }

    return mediaHits;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    console.warn("[DEEPFAKE:MEDIA] Extraction error:", {
      url: hit.url,
      error: error instanceof Error ? error.message : String(error),
    });

    return [
      {
        ...hit,
        evidence_page_url: hit.evidence_page_url ?? hit.url,
        page_inspected: false,
        provider_scrape_failed: true,
        page_text: "",
        is_sensitive: hit.is_sensitive ?? hasExplicitPageRisk(hit),
      },
    ];
  }
}

export async function enrichHitsWithMedia(
  hits: MediaDiscoveryHit[],
  maxPages = 20,
): Promise<MediaDiscoveryHit[]> {
  /*
   * Prioritise explicit/deepfake-risk pages to control Firecrawl costs.
   */
  const ordered = [...hits].sort(
    (a, b) => Number(hasExplicitPageRisk(b)) - Number(hasExplicitPageRisk(a)),
  );

  const pages = ordered.slice(0, maxPages);
  const output: MediaDiscoveryHit[] = [];
  const batchSize = 3;

  for (let start = 0; start < pages.length; start += batchSize) {
    const batch = pages.slice(start, start + batchSize);

    const results = await Promise.all(batch.map((hit) => scrapeMediaFromPage(hit)));

    for (let index = 0; index < results.length; index++) {
      const original = batch[index];
      const mediaResults = results[index];

      if (mediaResults.length) {
        output.push(...mediaResults);
      } else {
        /*
         * Keep the page as an unverified lead when crawl/media extraction
         * produced nothing. Classification must fail closed.
         */
        output.push({
          ...original,
          evidence_page_url: original.url,
          page_inspected: false,
          page_text: "",
          is_sensitive: original.is_sensitive ?? hasExplicitPageRisk(original),
        });
      }
    }
  }

  const deduped = new Map<string, MediaDiscoveryHit>();

  for (const hit of output) {
    const key = hit.media_url ?? hit.image_url ?? hit.url;

    if (!deduped.has(key)) {
      deduped.set(key, hit);
    }
  }

  console.log("[DEEPFAKE:MEDIA] Enrichment summary:", {
    pagesAttempted: pages.length,
    enrichedResults: deduped.size,
    directMedia: Array.from(deduped.values()).filter((item) =>
      Boolean(item.media_url || item.image_url),
    ).length,
    explicitRiskPages: pages.filter(hasExplicitPageRisk).length,
  });

  return Array.from(deduped.values());
}
