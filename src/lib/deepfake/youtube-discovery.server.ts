import type { FirecrawlSearchHit } from "./firecrawl.server";
import {
  assertNotAborted,
  boundTimeoutMs,
  mergeAbortSignals,
  readResponseText,
} from "./scan-runtime.server";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

type YouTubeSearchResponse = {
  nextPageToken?: string;
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
  }>;
  error?: { message?: string };
};

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export async function searchRecentYouTubeMentions(input: {
  name: string;
  aliases?: string[];
  handles?: string[];
  maxResults?: number;
  pages?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<FirecrawlSearchHit[]> {
  const apiKey = (
    process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY
  )?.trim();

  if (!apiKey) {
    console.warn("[DEEPFAKE:YOUTUBE] API key is not configured");
    return [];
  }

  const identities = [
    input.name,
    ...(input.aliases ?? []),
    ...(input.handles ?? []).map((handle) => handle.replace(/^@/, "")),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!identities.length) return [];

  const query = identities.map((identity) => `"${identity}"`).join("|");
  const maxResults = Math.min(Math.max(input.maxResults ?? 25, 1), 100);
  const pages = Math.min(Math.max(input.pages ?? 2, 1), 5);
  const hits: FirecrawlSearchHit[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < pages && hits.length < maxResults; page++) {
    assertNotAborted(input.signal);
    const remaining = maxResults - hits.length;
    const url = new URL(`${YOUTUBE_API}/search`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", String(Math.min(remaining, 50)));
    url.searchParams.set("q", query);
    url.searchParams.set("key", apiKey);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const timeoutMs = boundTimeoutMs(
      15_000,
      input.signal,
      input.softDeadlineMs,
    );
    const signal = mergeAbortSignals(
      input.signal,
      AbortSignal.timeout(timeoutMs),
    );
    const response = await fetch(url, { signal });
    const text = await readResponseText(response, signal);

    let payload: YouTubeSearchResponse = {};
    try {
      payload = JSON.parse(text) as YouTubeSearchResponse;
    } catch {
      throw new Error("YouTube search returned invalid JSON");
    }

    if (!response.ok) {
      throw new Error(
        `YouTube search failed [${response.status}]: ${payload.error?.message ?? text.slice(0, 300)}`,
      );
    }

    hits.push(...(payload.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId;
    if (!videoId) return [];

    const snippet = item.snippet ?? {};
    const thumbnail =
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url;
    const published = snippet.publishedAt
      ? `Published ${snippet.publishedAt.slice(0, 10)}. `
      : "";
    const channel = snippet.channelTitle
      ? `Channel: ${decodeHtml(snippet.channelTitle)}. `
      : "";

    return [{
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      title: decodeHtml(snippet.title ?? "YouTube video mention"),
      description: `${published}${channel}${decodeHtml(snippet.description ?? "")}`.trim(),
      query,
      source: "youtube_api" as const,
      thumbnail_url: thumbnail,
      image_url: thumbnail,
      is_sensitive: /\b(?:deepfake|fake|morph|nude|explicit|defam|harass|impersonat)\w*\b/i.test(
        `${snippet.title ?? ""} ${snippet.description ?? ""}`,
      ),
    }];
    }));

    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return hits.slice(0, maxResults);
}
