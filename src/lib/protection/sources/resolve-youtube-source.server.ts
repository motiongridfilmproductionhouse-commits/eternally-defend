/**
 * Resolves a customer-pasted YouTube URL (channel or single video) into
 * display metadata for the Approved YouTube Sources list. Reuses the
 * existing YouTube Data API helpers in channel-watch/youtube.server.ts —
 * only the video-vs-channel URL detection and the video-id extraction are
 * new, since that file only exposes channel resolution today.
 */
import {
  hydrateChannelById,
  resolveChannelCandidates,
  fetchVideoDetails,
  type ResolvedChannel,
  type YoutubeVideoRow,
} from "@/lib/channel-watch/youtube.server";

export interface ResolveYoutubeSourceDeps {
  fetchVideoDetails?: typeof fetchVideoDetails;
  hydrateChannelById?: typeof hydrateChannelById;
  resolveChannelCandidates?: typeof resolveChannelCandidates;
}

export interface ResolvedApprovedChannel {
  kind: "channel";
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  uploadsPlaylistId: string | null;
  title: string;
}

export interface ResolvedApprovedVideo {
  kind: "video";
  videoId: string;
  channelId: string | null;
  title: string;
  thumbnailUrl: string | null;
}

export type ResolvedApprovedSource = ResolvedApprovedChannel | ResolvedApprovedVideo;

export function extractVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  // Bare video id (11 chars, YouTube's id alphabet).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    const shortMatch = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "");
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    const embedMatch = u.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
  } catch {
    // Not a URL — fall through to "not a video".
  }
  return null;
}

/** Resolves a pasted URL into either a channel or a single-video source. */
export async function resolveApprovedYoutubeInput(
  input: string,
  deps: ResolveYoutubeSourceDeps = {},
): Promise<ResolvedApprovedSource> {
  const videoId = extractVideoId(input);
  if (videoId) {
    const fetchDetails = deps.fetchVideoDetails ?? fetchVideoDetails;
    const [video] = await fetchDetails([videoId]);
    if (!video || video.isPrivateOrDeleted) {
      throw new Error("That YouTube video could not be found or is unavailable.");
    }
    return {
      kind: "video",
      videoId: video.videoId,
      channelId: video.channelId || null,
      title: video.title,
      thumbnailUrl: video.thumbnailUrl || null,
    };
  }

  const channel = await resolveChannel(input, deps);
  return {
    kind: "channel",
    channelId: channel.channelId,
    channelTitle: channel.title,
    thumbnailUrl: channel.avatarUrl ?? null,
    uploadsPlaylistId: channel.uploadsPlaylistId ?? null,
    title: channel.title,
  };
}

async function resolveChannel(
  input: string,
  deps: ResolveYoutubeSourceDeps,
): Promise<ResolvedChannel> {
  const trimmed = input.trim();
  const hydrateById = deps.hydrateChannelById ?? hydrateChannelById;
  const resolveCandidates = deps.resolveChannelCandidates ?? resolveChannelCandidates;
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    const byId = await hydrateById(trimmed);
    if (byId) return byId;
  }
  const [candidate] = await resolveCandidates(trimmed);
  if (!candidate) {
    throw new Error("That YouTube channel could not be found.");
  }
  return candidate;
}

export type { YoutubeVideoRow };

/**
 * Playlist id for a /playlist?list=... URL (or a bare PL... id). Deliberately
 * ignores the `list` param on a watch?v=...&list=... URL — that is a single
 * video the customer pasted while a playlist happened to be open.
 */
export function extractPlaylistId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^(PL|OL|UU|FL|LL)[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!/\/playlist\/?$/.test(u.pathname)) return null;
    const list = u.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]{12,}$/.test(list)) return list;
  } catch {
    return null;
  }
  return null;
}
