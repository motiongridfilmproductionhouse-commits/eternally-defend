/**
 * YouTube helpers scoped to the Channel Watch feature: resolve a channel from
 * arbitrary user input (URL / @handle / channel id / freeform), fetch the
 * uploads playlist, and paginate playlistItems newer than a cursor. Never
 * silently converts provider failures into "no findings".
 */

const YT = "https://www.googleapis.com/youtube/v3";

function key(): string {
  const k = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!k) {
    throw new Error(
      "YouTube API key is not configured. Set YOUTUBE_API_KEY or GOOGLE_API_KEY.",
    );
  }
  return k;
}

export interface ResolvedChannel {
  channelId: string;
  title: string;
  handle?: string;
  description?: string;
  avatarUrl?: string;
  subscriberCount?: number;
  videoCount?: number;
  uploadsPlaylistId?: string;
  hiddenSubscriberCount?: boolean;
  publishedAt?: string;
  country?: string;
  channelUrl: string;
  recentThumbnails: string[];
}

export interface YoutubeVideoRow {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isPrivateOrDeleted: boolean;
}

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return +((m[1] ?? 0)) * 3600 + +((m[2] ?? 0)) * 60 + +((m[3] ?? 0));
}

async function ytGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${YT}${path}`);
  for (const [k2, v] of Object.entries(params)) url.searchParams.set(k2, v);
  url.searchParams.set("key", key());
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Preserve provider status for callers to distinguish quotaExceeded/403 from 404 etc.
    const err: Error & { status?: number; body?: string } = new Error(
      `YouTube ${path} [${res.status}]: ${text.slice(0, 300)}`,
    );
    err.status = res.status;
    err.body = text;
    throw err;
  }
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`YouTube ${path} returned non-JSON`); }
}

function extractIdOrHandle(input: string): { channelId?: string; handle?: string; freeform?: string } {
  const raw = input.trim();
  if (!raw) return {};
  // Direct channel ID (UC...)
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(raw)) return { channelId: raw };
  // URL forms
  try {
    const u = new URL(raw);
    // /channel/UC...
    const chMatch = u.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{20,})/);
    if (chMatch) return { channelId: chMatch[1] };
    // /@handle
    const handleMatch = u.pathname.match(/\/@([A-Za-z0-9._-]+)/);
    if (handleMatch) return { handle: `@${handleMatch[1]}` };
    // /c/name or /user/name — treat as freeform search term
    const cMatch = u.pathname.match(/\/(?:c|user)\/([^/]+)/);
    if (cMatch) return { freeform: decodeURIComponent(cMatch[1]) };
    return { freeform: u.pathname.replace(/^\//, "") || raw };
  } catch {
    // Not a URL; @handle or freeform
    if (raw.startsWith("@")) return { handle: raw };
    return { freeform: raw };
  }
}

async function fetchRecentThumbnails(uploadsPlaylistId: string | undefined, count = 4): Promise<string[]> {
  if (!uploadsPlaylistId) return [];
  try {
    const j = await ytGet<{ items?: Array<{ snippet?: { thumbnails?: Record<string, { url?: string }> } }> }>(
      "/playlistItems",
      { part: "snippet", playlistId: uploadsPlaylistId, maxResults: String(count) },
    );
    return (j.items ?? [])
      .map((it) => it.snippet?.thumbnails?.medium?.url ?? it.snippet?.thumbnails?.default?.url)
      .filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

async function hydrateChannels(ids: string[]): Promise<ResolvedChannel[]> {
  if (ids.length === 0) return [];
  const j = await ytGet<{ items?: Array<any> }>("/channels", {
    part: "snippet,statistics,contentDetails,brandingSettings",
    id: ids.join(","),
  });
  const out: ResolvedChannel[] = [];
  for (const item of j.items ?? []) {
    const sn = item.snippet ?? {};
    const st = item.statistics ?? {};
    const cd = item.contentDetails ?? {};
    const uploads = cd.relatedPlaylists?.uploads as string | undefined;
    const thumbs = sn.thumbnails ?? {};
    const customUrl = typeof sn.customUrl === "string" ? sn.customUrl : undefined;
    const rc: ResolvedChannel = {
      channelId: item.id,
      title: sn.title ?? "Untitled channel",
      handle: customUrl?.startsWith("@") ? customUrl : undefined,
      description: sn.description ?? undefined,
      avatarUrl: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url,
      subscriberCount: st.hiddenSubscriberCount ? undefined : Number(st.subscriberCount ?? 0) || undefined,
      videoCount: Number(st.videoCount ?? 0) || undefined,
      uploadsPlaylistId: uploads,
      hiddenSubscriberCount: !!st.hiddenSubscriberCount,
      publishedAt: sn.publishedAt,
      country: sn.country,
      channelUrl: `https://www.youtube.com/channel/${item.id}`,
      recentThumbnails: [],
    };
    rc.recentThumbnails = await fetchRecentThumbnails(uploads, 4);
    out.push(rc);
  }
  return out;
}

export async function resolveChannelCandidates(query: string): Promise<ResolvedChannel[]> {
  const { channelId, handle, freeform } = extractIdOrHandle(query);
  const ids = new Set<string>();

  if (channelId) ids.add(channelId);
  if (handle) {
    // channels.list forHandle is the canonical resolver
    try {
      const j = await ytGet<{ items?: Array<{ id?: string }> }>("/channels", {
        part: "id",
        forHandle: handle.replace(/^@/, ""),
      });
      for (const it of j.items ?? []) if (it.id) ids.add(it.id);
    } catch {
      // fall through to freeform search
    }
  }

  if (ids.size === 0 && (freeform || handle)) {
    // Bounded search.list fallback — only for freeform text; user must confirm.
    const j = await ytGet<{ items?: Array<{ snippet?: { channelId?: string } }> }>("/search", {
      part: "snippet",
      type: "channel",
      maxResults: "5",
      q: (freeform ?? handle ?? "").replace(/^@/, ""),
    });
    for (const it of j.items ?? []) if (it.snippet?.channelId) ids.add(it.snippet.channelId);
  }

  return hydrateChannels(Array.from(ids).slice(0, 5));
}

export async function hydrateChannelById(channelId: string): Promise<ResolvedChannel | null> {
  const [c] = await hydrateChannels([channelId]);
  return c ?? null;
}

export async function fetchUploadsSince(opts: {
  uploadsPlaylistId: string;
  sinceIso?: string;
  max?: number;
}): Promise<YoutubeVideoRow[]> {
  const max = opts.max ?? 50;
  const videoIds: string[] = [];
  let pageToken: string | undefined;
  outer: while (videoIds.length < max) {
    const params: Record<string, string> = {
      part: "snippet,contentDetails",
      playlistId: opts.uploadsPlaylistId,
      maxResults: "50",
    };
    if (pageToken) params.pageToken = pageToken;
    const j = await ytGet<{
      nextPageToken?: string;
      items?: Array<{ snippet?: { publishedAt?: string; resourceId?: { videoId?: string } } }>;
    }>("/playlistItems", params);
    for (const it of j.items ?? []) {
      const vid = it.snippet?.resourceId?.videoId;
      if (!vid) continue;
      const pub = it.snippet?.publishedAt ?? "";
      if (opts.sinceIso && pub && pub <= opts.sinceIso) break outer;
      videoIds.push(vid);
      if (videoIds.length >= max) break outer;
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  if (videoIds.length === 0) return [];
  return fetchVideoDetails(videoIds);
}

export async function fetchVideoDetails(videoIds: string[]): Promise<YoutubeVideoRow[]> {
  const rows: YoutubeVideoRow[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const j = await ytGet<{ items?: Array<any> }>("/videos", {
      part: "snippet,contentDetails,statistics,status",
      id: batch.join(","),
    });
    const seen = new Set<string>();
    for (const item of j.items ?? []) {
      const id: string = item.id;
      seen.add(id);
      const sn = item.snippet ?? {};
      const cd = item.contentDetails ?? {};
      const st = item.statistics ?? {};
      const status = item.status ?? {};
      const thumbs = sn.thumbnails ?? {};
      rows.push({
        videoId: id,
        title: sn.title ?? "Untitled",
        description: sn.description ?? "",
        thumbnailUrl: thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        publishedAt: sn.publishedAt ?? new Date().toISOString(),
        durationSeconds: parseIsoDuration(cd.duration),
        viewCount: st.viewCount ? Number(st.viewCount) : null,
        likeCount: st.likeCount ? Number(st.likeCount) : null,
        commentCount: st.commentCount ? Number(st.commentCount) : null,
        isPrivateOrDeleted: status.privacyStatus === "private",
      });
    }
    // Anything missing from batch is private/deleted/unavailable
    for (const missingId of batch.filter((v) => !seen.has(v))) {
      rows.push({
        videoId: missingId,
        title: "Unavailable video",
        description: "",
        thumbnailUrl: `https://i.ytimg.com/vi/${missingId}/hqdefault.jpg`,
        publishedAt: new Date().toISOString(),
        durationSeconds: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        isPrivateOrDeleted: true,
      });
    }
  }
  return rows;
}

export function priorityToIntervalMinutes(p: "critical" | "high" | "standard" | "low"): number {
  // Conservative defaults to protect YouTube quota; user can Scan Now for immediate polls.
  switch (p) {
    case "critical": return 30;
    case "high": return 60;
    case "standard": return 240;
    case "low": return 720;
  }
}
