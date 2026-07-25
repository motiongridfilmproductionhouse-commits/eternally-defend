export interface FirecrawlSearchHit {
  url: string;
  title: string;
  description: string;
  source: "firecrawl_web" | "firecrawl_image";
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
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is missing");
  }

  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query,
      limit: Math.min(Math.max(maxResults, 1),3),
      sources: ["web", "images"],
    }),
  });

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Firecrawl search failed (${response.status}): ${rawBody.slice(0, 500)}`,
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
