export interface RedditDiscoveryHit {
  url: string;
  title: string;
  description: string;
  query: string;
  source: "reddit_api";
  thumbnail_url?: string;
  image_url?: string;
  is_sensitive?: boolean;
}

type RedditPost = {
  title?: unknown;
  selftext?: unknown;
  permalink?: unknown;
  url_overridden_by_dest?: unknown;
  thumbnail?: unknown;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{ data?: RedditPost }>;
  };
};

const RISK_TERMS =
  "deepfake OR fake OR morphed OR faceswap OR impersonation OR defamation OR harassment OR leaked OR nude";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isImageUrl(value: string): boolean {
  return /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(value);
}

function looksSensitive(value: string): boolean {
  return /\b(?:deepfake|deep fake|faceswap|face swap|morphed|fake nude|ai nude|nude|naked|porn|xxx|sex tape|leaked|impersonat|defam|harass)\b/i.test(
    value,
  );
}

export async function searchRecentRedditMentions(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  maxResults?: number;
}): Promise<RedditDiscoveryHit[]> {
  const identities = Array.from(
    new Set(
      [input.name, ...(input.aliases ?? []), ...(input.handles ?? [])]
        .map((value) => value.replace(/^@/, "").replaceAll('"', "").trim())
        .filter(Boolean),
    ),
  ).slice(0, 10);

  if (!identities.length) return [];

  const identityQuery = identities.map((value) => `"${value}"`).join(" OR ");
  const query = `(${identityQuery}) AND (${RISK_TERMS})`;
  const limit = Math.min(Math.max(input.maxResults ?? 50, 1), 100);
  const endpoint = new URL("https://www.reddit.com/search.json");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("sort", "new");
  endpoint.searchParams.set("t", "year");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("raw_json", "1");

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "EternaSentinel/1.0 public-reputation-monitoring",
    },
    signal: AbortSignal.timeout(15_000),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Reddit public search failed (${response.status}): ${rawBody.slice(0, 300)}`,
    );
  }

  let payload: RedditSearchResponse;
  try {
    payload = JSON.parse(rawBody) as RedditSearchResponse;
  } catch {
    throw new Error("Reddit public search returned invalid JSON");
  }

  const hits: RedditDiscoveryHit[] = [];
  for (const child of payload.data?.children ?? []) {
    const post = child.data;
    if (!post) continue;

    const permalink = text(post.permalink);
    if (!permalink) continue;

    const title = text(post.title);
    const description = text(post.selftext).slice(0, 1_500);
    const destination = text(post.url_overridden_by_dest);
    const thumbnail = text(post.thumbnail);
    const pageUrl = new URL(permalink, "https://www.reddit.com").toString();
    const imageUrl = isHttpUrl(destination) && isImageUrl(destination)
      ? destination
      : undefined;
    const thumbnailUrl = isHttpUrl(thumbnail) ? thumbnail : imageUrl;

    hits.push({
      url: pageUrl,
      title: title || "Reddit discussion",
      description,
      query,
      source: "reddit_api",
      thumbnail_url: thumbnailUrl,
      image_url: imageUrl,
      is_sensitive: looksSensitive(`${title} ${description} ${destination}`),
    });
  }

  return hits;
}