/**
 * YouTube Data API v3 metadata fetch — uses GOOGLE_API_KEY.
 * Falls back to oEmbed if the key is missing or the call fails.
 */
import { ok, failed, unavailable, type ProviderResult } from "./providers.server";

export function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split(/[/?#]/)[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch { return null; }
}

export interface YoutubeMetadata {
  video_id: string;
  title: string;
  channel: string | null;
  channel_id: string | null;
  description: string;
  thumbnail: string;
  thumbnail_maxres: string | null;
  duration_seconds: number | null;
  published_at: string | null;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  captions_available: boolean | null;
  embeddable: boolean | null;
  privacy_status: string | null;
  tags: string[];
  source: "youtube_data_api" | "oembed";
}

function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+((m[1] ?? 0)) * 3600) + (+((m[2] ?? 0)) * 60) + +((m[3] ?? 0));
}

export async function fetchYoutubeMetadata(videoId: string): Promise<ProviderResult<YoutubeMetadata>> {
  const key = process.env.GOOGLE_API_KEY;
  if (key) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("id", videoId);
    url.searchParams.set("part", "snippet,contentDetails,statistics,status");
    url.searchParams.set("key", key);
    try {
      const res = await fetch(url.toString());
      if (!res.ok) return failed(`YouTube Data API [${res.status}]`);
      const j = (await res.json()) as { items?: Array<any> };
      const item = j.items?.[0];
      if (!item) {
        // fall through to oembed for basic display
      } else {
        const sn = item.snippet ?? {};
        const cd = item.contentDetails ?? {};
        const st = item.statistics ?? {};
        const status = item.status ?? {};
        const thumbs = sn.thumbnails ?? {};
        return ok({
          video_id: videoId,
          title: sn.title ?? "Untitled",
          channel: sn.channelTitle ?? null,
          channel_id: sn.channelId ?? null,
          description: sn.description ?? "",
          thumbnail: thumbs.maxres?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          thumbnail_maxres: thumbs.maxres?.url ?? null,
          duration_seconds: parseIsoDuration(cd.duration ?? ""),
          published_at: sn.publishedAt ?? null,
          view_count: st.viewCount ? Number(st.viewCount) : null,
          like_count: st.likeCount ? Number(st.likeCount) : null,
          comment_count: st.commentCount ? Number(st.commentCount) : null,
          captions_available: cd.caption === "true",
          embeddable: status.embeddable ?? null,
          privacy_status: status.privacyStatus ?? null,
          tags: Array.isArray(sn.tags) ? sn.tags.slice(0, 25) : [],
          source: "youtube_data_api",
        });
      }
    } catch (e) {
      // fall through
    }
  }
  // oEmbed fallback (no key needed, no stats)
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`);
    if (!r.ok) return unavailable(`YouTube oEmbed [${r.status}]`);
    const j = await r.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    return ok({
      video_id: videoId,
      title: j.title ?? "YouTube video",
      channel: j.author_name ?? null,
      channel_id: null,
      description: "",
      thumbnail: j.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      thumbnail_maxres: null,
      duration_seconds: null,
      published_at: null,
      view_count: null, like_count: null, comment_count: null,
      captions_available: null, embeddable: null, privacy_status: null,
      tags: [],
      source: "oembed",
    });
  } catch (e) {
    return failed(`YouTube oEmbed network: ${e instanceof Error ? e.message : String(e)}`);
  }
}
