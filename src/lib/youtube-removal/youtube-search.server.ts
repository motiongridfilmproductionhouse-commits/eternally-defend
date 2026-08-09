/**
 * YouTube discovery for the targeted removal scan.
 *
 * Uses the official YouTube Data API (search.list + videos.list +
 * channels.list). Provider failures are surfaced as errors — a failed
 * discovery must never be reported as "no results".
 */

const YT = "https://www.googleapis.com/youtube/v3";

function apiKey(): string {
  const k = process.env["YOUTUBE_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  if (!k) throw new Error("YOUTUBE_API_KEY_MISSING");
  return k;
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
  url.searchParams.set("key", apiKey());
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(
      `YouTube ${path} [${res.status}]: ${text.slice(0, 240)}`,
    );
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`YouTube ${path} returned non-JSON`);
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
 * Run one query with pagination. Returns raw search hits (deduplication is the
 * caller's responsibility so query provenance can be merged).
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
    const seen = new Set<string>();
    for (const item of j.items ?? []) {
      const id = String(item.id);
      seen.add(id);
      const sn = item.snippet ?? {};
      const cd = item.contentDetails ?? {};
      const st = item.statistics ?? {};
      const thumbs = sn.thumbnails ?? {};
      out.push({
        videoId: id,
        title: sn.title ?? "Untitled",
        description: sn.description ?? "",
        channelId: sn.channelId ?? "",
        channelTitle: sn.channelTitle ?? "Unknown channel",
        publishedAt: sn.publishedAt ?? "",
        thumbnailUrl:
          thumbs.maxres?.url ??
          thumbs.high?.url ??
          thumbs.medium?.url ??
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        durationSeconds: parseIsoDuration(cd.duration),
        viewCount: st.viewCount != null ? Number(st.viewCount) : null,
        likeCount: st.likeCount != null ? Number(st.likeCount) : null,
        commentCount: st.commentCount != null ? Number(st.commentCount) : null,
        isUnavailable: false,
        tags: Array.isArray(sn.tags) ? (sn.tags as string[]).slice(0, 25) : [],
        defaultLanguage: sn.defaultAudioLanguage ?? sn.defaultLanguage ?? null,
      });
    }
    // Preserve evidence for videos that became private/removed since discovery.
    for (const missing of batch.filter((v) => !seen.has(v))) {
      out.push({
        videoId: missing,
        title: "Unavailable video (private, deleted or region-blocked)",
        description: "",
        channelId: "",
        channelTitle: "Unknown channel",
        publishedAt: "",
        thumbnailUrl: `https://i.ytimg.com/vi/${missing}/hqdefault.jpg`,
        durationSeconds: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        isUnavailable: true,
        tags: [],
        defaultLanguage: null,
      });
    }
  }
  return out;
}

/** Hydrate channel identity for news-organisation detection. */
export async function fetchChannelDetails(channelIds: string[]): Promise<Map<string, ChannelDetail>> {
  const map = new Map<string, ChannelDetail>();
  const ids = Array.from(new Set(channelIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const j = await ytGet<{ items?: Array<Record<string, any>> }>("/channels", {
      part: "snippet,statistics",
      id: batch.join(","),
    });
    for (const item of j.items ?? []) {
      const sn = item.snippet ?? {};
      const st = item.statistics ?? {};
      const customUrl = typeof sn.customUrl === "string" ? sn.customUrl : null;
      map.set(String(item.id), {
        channelId: String(item.id),
        title: sn.title ?? "Unknown channel",
        handle: customUrl ? (customUrl.startsWith("@") ? customUrl : `@${customUrl}`) : null,
        description: sn.description ?? "",
        subscriberCount: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0) || null,
        videoCount: Number(st.videoCount ?? 0) || null,
      });
    }
  }
  return map;
}
