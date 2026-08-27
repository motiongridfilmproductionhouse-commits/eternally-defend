/**
 * Poll worker for one approved YouTube channel source. Fetches new uploads
 * via the uploads playlist (reusing channel-watch's YouTube fetch helper),
 * inserts a row per new video, and runs the classification pipeline inline
 * for each — mirrors channel-watch/poll.server.ts's inline-analyze-on-insert
 * shape, but targets approved_source_videos instead of channel_watch_videos.
 *
 * Every write that finalizes a row's state checks the returned Supabase
 * error and logs it loudly rather than assuming success — a silently failed
 * write here previously could have left a video stuck at analysis_status
 * "running" forever, or a source's last_polled_at/next_poll_at never
 * advancing, with no visible sign anything went wrong.
 */
import { fetchUploadsSince } from "@/lib/channel-watch/youtube.server";
import { analyzeApprovedSourceVideo } from "./analyze-approved-video.server";

const POLL_INTERVAL_MINUTES = 60;
const MAX_VIDEOS_PER_POLL = 25;

interface ApprovedSourceRow {
  id: string;
  user_id: string;
  source_kind: string;
  status: string;
  uploads_playlist_id: string | null;
  last_polled_at: string | null;
}

export interface PollApprovedSourceDeps {
  fetchUploadsSince?: typeof fetchUploadsSince;
  analyzeApprovedSourceVideo?: typeof analyzeApprovedSourceVideo;
}

export async function pollApprovedChannelSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  sourceId: string,
  deps: PollApprovedSourceDeps = {},
): Promise<{ inserted: number; checked: number }> {
  const fetchUploads = deps.fetchUploadsSince ?? fetchUploadsSince;
  const analyzeVideo = deps.analyzeApprovedSourceVideo ?? analyzeApprovedSourceVideo;

  const { data: s, error } = await supabaseAdmin
    .from("approved_youtube_sources")
    .select("id, user_id, source_kind, status, uploads_playlist_id, last_polled_at")
    .eq("id", sourceId)
    .maybeSingle();
  if (error || !s) throw new Error(`approved source not found: ${sourceId}`);
  const source = s as ApprovedSourceRow;

  // Only active channel sources are ever polled — a video-kind source, a
  // paused source, or a soft-deleted ("removed") source is left completely
  // untouched, never ingesting new videos.
  if (source.source_kind !== "channel") return { inserted: 0, checked: 0 };
  if (source.status !== "active") return { inserted: 0, checked: 0 };
  if (!source.uploads_playlist_id) {
    const { error: missingPlaylistError } = await supabaseAdmin
      .from("approved_youtube_sources")
      .update({ last_error: "Missing uploads playlist id." })
      .eq("id", source.id);
    if (missingPlaylistError) {
      console.error(
        "[approved-sources] failed to record missing-playlist error",
        source.id,
        missingPlaylistError.message,
      );
    }
    return { inserted: 0, checked: 0 };
  }

  const nowIso = new Date().toISOString();
  let videos;
  try {
    videos = await fetchUploads({
      uploadsPlaylistId: source.uploads_playlist_id,
      sinceIso: source.last_polled_at ?? undefined,
      max: MAX_VIDEOS_PER_POLL,
    });
  } catch (err) {
    // A YouTube API failure must stay visible on the source, not be
    // swallowed — last_error surfaces in the UI, and the poll is retried on
    // the next scheduled run rather than silently treated as "up to date".
    const { error: recordError } = await supabaseAdmin
      .from("approved_youtube_sources")
      .update({ last_error: (err as Error).message ?? String(err), last_polled_at: nowIso })
      .eq("id", source.id);
    if (recordError) {
      console.error(
        "[approved-sources] failed to record YouTube API failure",
        source.id,
        recordError.message,
      );
    }
    throw err;
  }

  let inserted = 0;
  for (const video of videos) {
    if (video.isPrivateOrDeleted) continue;
    const { data: existing } = await supabaseAdmin
      .from("approved_source_videos")
      .select("id")
      .eq("source_id", source.id)
      .eq("youtube_video_id", video.videoId)
      .maybeSingle();
    if (existing) continue;

    const { data: ins, error: insError } = await supabaseAdmin
      .from("approved_source_videos")
      .insert({
        source_id: source.id,
        user_id: source.user_id,
        youtube_video_id: video.videoId,
        title: video.title,
        description: video.description,
        thumbnail_url: video.thumbnailUrl,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        published_at: video.publishedAt,
        analysis_status: "pending",
      })
      .select("id")
      .single();
    if (insError || !ins) {
      // Not the expected duplicate case (already excluded above by the
      // existence check) — a genuine insert failure. Log it so it's
      // discoverable rather than silently dropping a discovered video.
      console.error(
        "[approved-sources] failed to insert discovered video",
        source.id,
        video.videoId,
        insError?.message,
      );
      continue;
    }
    inserted += 1;

    try {
      await analyzeVideo(supabaseAdmin, ins.id);
    } catch (err) {
      const { error: failUpdateError } = await supabaseAdmin
        .from("approved_source_videos")
        .update({
          analysis_status: "failed",
          analysis_error: (err as Error).message ?? String(err),
        })
        .eq("id", ins.id);
      if (failUpdateError) {
        console.error(
          "[approved-sources] failed to record analysis failure — video may be stuck",
          ins.id,
          failUpdateError.message,
        );
      }
    }
  }

  const { error: bookkeepingError } = await supabaseAdmin
    .from("approved_youtube_sources")
    .update({
      last_polled_at: nowIso,
      next_poll_at: new Date(Date.now() + POLL_INTERVAL_MINUTES * 60_000).toISOString(),
      last_error: null,
    })
    .eq("id", source.id);
  if (bookkeepingError) {
    console.error(
      "[approved-sources] failed to update poll bookkeeping",
      source.id,
      bookkeepingError.message,
    );
  }

  return { inserted, checked: videos.length };
}
