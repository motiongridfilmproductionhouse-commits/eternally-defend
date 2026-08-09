/**
 * YouTube discovery for the targeted removal scan.
 *
 * Uses the official YouTube Data API (search.list + videos.list +
 * channels.list). Provider failures are surfaced with precise error codes —
 * a failed discovery must never be reported as "no results".
 */

const YT = "https://www.googleapis.com/youtube/v3";

function apiKey(): string {
  const ytKey = process.env["YOUTUBE_API_KEY"];
  const googleKey = process.env["GOOGLE_API_KEY"];

  // Prefer valid Google API Key format (AIza...)
  if (ytKey && ytKey.startsWith("AIza")) return ytKey;
  if (googleKey && googleKey.startsWith("AIza")) return googleKey;
  if (ytKey) return ytKey;
  if (googleKey) return googleKey;

  const err: Error & { code?: string } = new Error("YouTube API is not configured.");
  err.code = "YOUTUBE_API_KEY_MISSING";
  throw err;
}

export interface DiscoveredVideo {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  queries: string[];
}

export interface VideoDetail {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isUnavailable: boolean;
  tags: string[];
  defaultLanguage: string | null;
}

export interface ChannelDetail {
  channelId: string;
  title: string;
  handle: string | null;
  description: string;
  subscriberCount: number | null;
  videoCount: number | null;
}

async function ytGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${YT}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let key: string;
  try {
    key = apiKey();
  } catch (e) {
    throw e;
  }

  url.searchParams.set("key", key);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  } catch (netErr: any) {
    const err: Error & { code?: string } = new Error(`YouTube API network error: ${netErr?.message || "fetch failed"}`);
    err.code = "YOUTUBE_NETWORK_ERROR";
    throw err;
  }

  const text = await res.text();
  if (!res.ok) {
    let failureCode = "YOUTUBE_SEARCH_FAILED";
    if (path.includes("/videos")) failureCode = "YOUTUBE_VIDEO_DETAILS_FAILED";

    if (
      res.status === 400 &&
      (text.includes("API_KEY_INVALID") || text.includes("keyInvalid") || text.includes("API key not valid"))
    ) {
      failureCode = "YOUTUBE_AUTH_ERROR";
    } else if (res.status === 401) {
      failureCode = "YOUTUBE_AUTH_ERROR";
    } else if (res.status === 403) {
      if (text.includes("quotaExceeded") || text.includes("dailyLimitExceeded") || text.includes("quota")) {
        failureCode = "YOUTUBE_QUOTA_EXCEEDED";
      } else if (
        text.includes("accessNotConfigured") ||
        text.includes("API not enabled") ||
        text.includes("serviceNotEnabled") ||
        text.includes("forbidden")
      ) {
        failureCode = "YOUTUBE_API_NOT_ENABLED";
      } else {
        failureCode = "YOUTUBE_AUTH_ERROR";
      }
    } else if (res.status === 429) {
      failureCode = "YOUTUBE_RATE_LIMIT";
    }

    const err: Error & { status?: number; code?: string; apiErrorText?: string } = new Error(
      `YouTube ${path} [${res.status}]: ${text.slice(0, 300)}`,
    );
    err.status = res.status;
    err.code = failureCode;
    err.apiErrorText = text;
    throw err;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const err: Error & { code?: string } = new Error(`YouTube ${path} returned non-JSON`);
    err.code = "YOUTUBE_SEARCH_FAILED";
    throw err;
  }
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
}

interface SearchResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
  }>;
}

/**
 * Run one query with pagination. Returns raw search hits.
 */
export async function searchVideos(
  query: string,
  opts: { pages?: number; order?: "relevance" | "date" | "viewCount"; regionCode?: string } = {},
): Promise<DiscoveredVideo[]> {
  const pages = Math.max(1, Math.min(opts.pages ?? 2, 5));
  const out: DiscoveredVideo[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < pages; page++) {
    const params: Record<string, string> = {
      part: "snippet",
      type: "video",
      maxResults: "50",
      order: opts.order ?? "relevance",
      q: query,
      safeSearch: "none",
    };
    if (opts.regionCode) params.regionCode = opts.regionCode;
    if (pageToken) params.pageToken = pageToken;

    const j = await ytGet<SearchResponse>("/search", params);
    for (const item of j.items ?? []) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;
      const sn = item.snippet ?? {};
      const thumbs = sn.thumbnails ?? {};
      out.push({
        videoId,
        title: sn.title ?? "Untitled",
        description: sn.description ?? "",
        channelId: sn.channelId ?? "",
        channelTitle: sn.channelTitle ?? "Unknown channel",
        publishedAt: sn.publishedAt ?? "",
        thumbnailUrl:
          thumbs.high?.url ?? thumbs.medium?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        queries: [query],
      });
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

/** Hydrate full video metadata (stats, duration, availability). */
export async function fetchVideoDetails(videoIds: string[]): Promise<VideoDetail[]> {
  const out: VideoDetail[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const j = await ytGet<{ items?: Array<Record<string, any>> }>("/videos", {
      part: "snippet,contentDetails,statistics,status",
      id: batch.join(","),
    });

    for (const item of j.items ?? []) {
      const videoId = item.id;
      if (!videoId) continue;
      const sn = item.snippet ?? {};
      const cd = item.contentDetails ?? {};
      const st = item.statistics ?? {};
      const status = item.status ?? {};

      out.push({
        videoId,
        title: sn.title ?? "Untitled",
        description: sn.description ?? "",
        channelId: sn.channelId ?? "",
        channelTitle: sn.channelTitle ?? "Unknown channel",
        publishedAt: sn.publishedAt ?? "",
        thumbnailUrl:
          sn.thumbnails?.high?.url ??
          sn.thumbnails?.medium?.url ??
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        durationSeconds: parseIsoDuration(cd.duration),
        viewCount: st.viewCount ? Number(st.viewCount) : null,
        likeCount: st.likeCount ? Number(st.likeCount) : null,
        commentCount: st.commentCount ? Number(st.commentCount) : null,
        isUnavailable: status.uploadStatus === "rejected" || status.privacyStatus === "private",
        tags: Array.isArray(sn.tags) ? sn.tags : [],
        defaultLanguage: sn.defaultAudioLanguage ?? sn.defaultLanguage ?? null,
      });
    }
  }
  return out;
}

/** Fetch channel metadata to categorize broadcasters vs independent creators. */
export async function fetchChannelDetails(channelIds: string[]): Promise<Map<string, ChannelDetail>> {
  const map = new Map<string, ChannelDetail>();
  const unique = Array.from(new Set(channelIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const j = await ytGet<{ items?: Array<Record<string, any>> }>("/channels", {
      part: "snippet,statistics",
      id: batch.join(","),
    });

    for (const item of j.items ?? []) {
      const channelId = item.id;
      if (!channelId) continue;
      const sn = item.snippet ?? {};
      const st = item.statistics ?? {};
      map.set(channelId, {
        channelId,
        title: sn.title ?? "",
        handle: sn.customUrl ?? null,
        description: sn.description ?? "",
        subscriberCount: st.subscriberCount ? Number(st.subscriberCount) : null,
        videoCount: st.videoCount ? Number(st.videoCount) : null,
      });
    }
  }
  return map;
}
