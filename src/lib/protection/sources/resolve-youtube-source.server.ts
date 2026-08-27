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
export async function resolveApprovedYoutubeInput(input: string): Promise<ResolvedApprovedSource> {
  const videoId = extractVideoId(input);
  if (videoId) {
    const [video] = await fetchVideoDetails([videoId]);
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

  const channel = await resolveChannel(input);
  return {
    kind: "channel",
    channelId: channel.channelId,
    channelTitle: channel.title,
    thumbnailUrl: channel.avatarUrl ?? null,
    uploadsPlaylistId: channel.uploadsPlaylistId ?? null,
    title: channel.title,
  };
}

async function resolveChannel(input: string): Promise<ResolvedChannel> {
  const trimmed = input.trim();
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    const byId = await hydrateChannelById(trimmed);
    if (byId) return byId;
  }
  const [candidate] = await resolveChannelCandidates(trimmed);
  if (!candidate) {
    throw new Error("That YouTube channel could not be found.");
  }
  return candidate;
}

export type { YoutubeVideoRow };
