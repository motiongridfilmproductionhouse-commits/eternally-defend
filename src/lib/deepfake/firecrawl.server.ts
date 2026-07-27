import { firecrawlFetch } from "@/lib/firecrawl-client.server";

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

function looksSensitive(text: string): boolean {
  return /\b(nude|nudes|naked|porn|xxx|sex tape|deepfake|fake nude|ai nude|morphed|leak)\b/i.test(
    text,
  );
}

export async function firecrawlSearch(
  query: string,
  maxResults = 20,
): Promise<FirecrawlSearchHit[]> {
  if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error("FIRECRAWL_API_KEY is missing");
  }

  let response: Response | null = null;
  let rawBody = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    response = await firecrawlFetch("/search", {
      query,
      limit: Math.min(Math.max(maxResults, 1), 10),
      sources: ["web", "images"],
      tbs: "qdr:m",
    });


    rawBody = await response.text();

    if (response.ok) {
      break;
    }

    if (response.status !== 429 || attempt === 2) {
      throw new Error(
        `Firecrawl search failed (${response.status}): ` +
          rawBody.slice(0, 500),
      );
    }

    const retryAfterHeader =
      response.headers.get("retry-after");

    const retrySeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : 4 * (attempt + 1);

    const safeDelayMs =
      Number.isFinite(retrySeconds)
        ? Math.min(
            Math.max(retrySeconds, 2),
            12,
          ) * 1_000
        : 4_000;

    console.warn("[DEEPFAKE:FIRECRAWL] Rate limited", {
      query,
      attempt: attempt + 1,
      retryInMs: safeDelayMs,
    });

    await new Promise((resolve) =>
      setTimeout(resolve, safeDelayMs),
    );
  }

  if (!response?.ok) {
    throw new Error(
      `Firecrawl search failed (${response?.status ?? "unknown"}): ` +
        rawBody.slice(0, 500),
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
    .filter(
      (result): result is FirecrawlWebResult & { url: string } =>
        Boolean(result.url),
    )
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
      const imageUrl =
        result.imageUrl ??
        result.url ??
        result.thumbnailUrl ??
        "";

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

  return Array.from(deduped.values()).slice(0, maxResults * 2);
}
