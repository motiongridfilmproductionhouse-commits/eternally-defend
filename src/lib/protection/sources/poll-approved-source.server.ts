/**
 * Poll worker for one approved YouTube channel source. Fetches new uploads
 * via the uploads playlist (reusing channel-watch's YouTube fetch helper),
 * inserts a row per new video, and runs the classification pipeline inline
 * for each — mirrors channel-watch/poll.server.ts's inline-analyze-on-insert
 * shape, but targets approved_source_videos instead of channel_watch_videos.
 */
import { fetchUploadsSince } from "@/lib/channel-watch/youtube.server";
import { analyzeApprovedSourceVideo } from "./analyze-approved-video.server";

const POLL_INTERVAL_MINUTES = 60;

interface ApprovedSourceRow {
  id: string;
  user_id: string;
  source_kind: string;
  status: string;
  uploads_playlist_id: string | null;
  last_polled_at: string | null;
}

export async function pollApprovedChannelSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  sourceId: string,
): Promise<{ inserted: number; checked: number }> {
  const { data: s, error } = await supabaseAdmin
    .from("approved_youtube_sources")
    .select("id, user_id, source_kind, status, uploads_playlist_id, last_polled_at")
    .eq("id", sourceId)
    .maybeSingle();
  if (error || !s) throw new Error(`approved source not found: ${sourceId}`);
  const source = s as ApprovedSourceRow;

  if (source.source_kind !== "channel") return { inserted: 0, checked: 0 };
  if (source.status !== "active") return { inserted: 0, checked: 0 };
  if (!source.uploads_playlist_id) {
    await supabaseAdmin
      .from("approved_youtube_sources")
      .update({ last_error: "Missing uploads playlist id." })
      .eq("id", source.id);
    return { inserted: 0, checked: 0 };
  }

  const nowIso = new Date().toISOString();
  let videos;
  try {
    videos = await fetchUploadsSince({
      uploadsPlaylistId: source.uploads_playlist_id,
      sinceIso: source.last_polled_at ?? undefined,
      max: 25,
    });
  } catch (err) {
    await supabaseAdmin
      .from("approved_youtube_sources")
      .update({ last_error: (err as Error).message ?? String(err), last_polled_at: nowIso })
      .eq("id", source.id);
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
    if (insError || !ins) continue;
    inserted += 1;

    try {
      await analyzeApprovedSourceVideo(supabaseAdmin, ins.id);
    } catch (err) {
      await supabaseAdmin
        .from("approved_source_videos")
        .update({
          analysis_status: "failed",
          analysis_error: (err as Error).message ?? String(err),
        })
        .eq("id", ins.id);
    }
  }

  await supabaseAdmin
    .from("approved_youtube_sources")
    .update({
      last_polled_at: nowIso,
      next_poll_at: new Date(Date.now() + POLL_INTERVAL_MINUTES * 60_000).toISOString(),
      last_error: null,
    })
    .eq("id", source.id);

  return { inserted, checked: videos.length };
}
