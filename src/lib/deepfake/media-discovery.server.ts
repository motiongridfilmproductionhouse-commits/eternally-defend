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
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    html?: string;
    rawHtml?: string;
    images?: string[];
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
};

const IMAGE_EXTENSION =
  /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;

const VIDEO_EXTENSION =
  /\.(?:avi|mkv|mov|mp4|m4v|webm|wmv)(?:$|[?#])/i;

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

function absoluteUrl(
  value: string,
  pageUrl: string,
): string | null {
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

  const add = (
    rawValue: string | undefined,
    type: "image" | "video",
  ) => {
    if (!rawValue) return;

    const firstCandidate = rawValue
      .split(",")[0]
      ?.trim()
      .split(/\s+/)[0];

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
      regex:
        /<img[^>]+(?:src|data-src|data-lazy-src|srcset)=["']([^"']+)["'][^>]*>/gi,
      type: "image",
    },
    {
      regex:
        /<(?:video|source)[^>]+src=["']([^"']+)["'][^>]*>/gi,
      type: "video",
    },
    {
      regex:
        /<video[^>]+poster=["']([^"']+)["'][^>]*>/gi,
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

export function hasExplicitPageRisk(hit: {
  url?: string;
  title?: string;
  description?: string;
}): boolean {
  return EXPLICIT_TERMS.test(
    `${hit.title ?? ""} ${hit.description ?? ""} ${hit.url ?? ""}`,
  );
}

export async function scrapeMediaFromPage(
  hit: MediaDiscoveryHit,
): Promise<MediaDiscoveryHit[]> {
  /*
   * Image-search results can already include a direct image URL.
   * Preserve those without paying for another scrape.
   */
  const existingDirectMedia =
    hit.image_url ??
    hit.media_url ??
    hit.thumbnail_url;

  if (existingDirectMedia && validHttpUrl(existingDirectMedia)) {
    return [
      {
        ...hit,
        evidence_page_url: hit.evidence_page_url ?? hit.url,
        media_url: existingDirectMedia,
        image_url: existingDirectMedia,
        media_type: VIDEO_EXTENSION.test(existingDirectMedia)
          ? "video"
          : "image",
        is_sensitive:
          hit.is_sensitive ?? hasExplicitPageRisk(hit),
      },
    ];
  }

  /*
   * Do not scrape an already-direct media URL.
   */
  if (
    IMAGE_EXTENSION.test(hit.url) ||
    VIDEO_EXTENSION.test(hit.url)
  ) {
    return [
      {
        ...hit,
        evidence_page_url: hit.evidence_page_url ?? hit.url,
        media_url: hit.url,
        media_type: VIDEO_EXTENSION.test(hit.url)
          ? "video"
          : "image",
        is_sensitive:
          hit.is_sensitive ?? hasExplicitPageRisk(hit),
      },
    ];
  }

  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();

  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      "https://api.firecrawl.dev/v2/scrape",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          url: hit.url,
          formats: ["images", "html", "rawHtml"],
          onlyMainContent: false,
          removeBase64Images: true,
          blockAds: true,
          timeout: 20_000,
          waitFor: 1_000,
        }),
      },
    );

    const rawBody = await response.text();

    if (!response.ok) {
      console.warn("[DEEPFAKE:MEDIA] Page scrape failed:", {
        url: hit.url,
        status: response.status,
        error: rawBody.slice(0, 300),
      });

      return [];
    }

    const payload =
      JSON.parse(rawBody) as FirecrawlScrapeResponse;

    if (!payload.success || !payload.data) {
      return [];
    }

    const data = payload.data;
    const html = data.rawHtml ?? data.html ?? "";

    const metadataImage = metadataString(data.metadata, [
      "ogImage",
      "og:image",
      "twitterImage",
      "twitter:image",
      "image",
    ]);

    const metadataVideo = metadataString(data.metadata, [
      "ogVideo",
      "og:video",
      "video",
    ]);

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
      if (
        /(?:pixel|spacer|tracking|favicon|logo|avatar|sprite)/i.test(
          candidate.media_url,
        )
      ) {
        continue;
      }

      unique.set(candidate.media_url, candidate);
    }

    return Array.from(unique.values())
      .slice(0, 8)
      .map((candidate) => ({
        ...hit,
        url: candidate.media_url,
        media_url: candidate.media_url,
        image_url:
          candidate.media_type === "image"
            ? candidate.media_url
            : undefined,
        media_type: candidate.media_type,
        evidence_page_url: hit.url,
        is_sensitive:
          hit.is_sensitive ?? hasExplicitPageRisk(hit),
      }));
  } catch (error) {
    console.warn("[DEEPFAKE:MEDIA] Extraction error:", {
      url: hit.url,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });

    return [];
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
    (a, b) =>
      Number(hasExplicitPageRisk(b)) -
      Number(hasExplicitPageRisk(a)),
  );

  const pages = ordered.slice(0, maxPages);
  const output: MediaDiscoveryHit[] = [];
  const batchSize = 3;

  for (let start = 0; start < pages.length; start += batchSize) {
    const batch = pages.slice(start, start + batchSize);

    const results = await Promise.all(
      batch.map((hit) => scrapeMediaFromPage(hit)),
    );

    for (let index = 0; index < results.length; index++) {
      const original = batch[index];
      const mediaResults = results[index];

      if (mediaResults.length) {
        output.push(...mediaResults);
      } else {
        /*
         * Keep the page as a discovery lead even when its media is blocked.
         */
        output.push({
          ...original,
          evidence_page_url: original.url,
          is_sensitive:
            original.is_sensitive ??
            hasExplicitPageRisk(original),
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
    directMedia: Array.from(deduped.values()).filter(
      (item) => Boolean(item.media_url || item.image_url),
    ).length,
    explicitRiskPages: pages.filter(hasExplicitPageRisk).length,
  });

  return Array.from(deduped.values());
}
