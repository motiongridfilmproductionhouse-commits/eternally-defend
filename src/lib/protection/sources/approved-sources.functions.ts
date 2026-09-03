import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  resolveApprovedYoutubeInput,
  extractPlaylistId,
} from "./resolve-youtube-source.server";


export const listApprovedSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: sources } = await supabase
      .from("approved_youtube_sources")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "removed")
      .order("created_at", { ascending: false });

    const sourceIds = (sources ?? []).map((s) => s.id);
    const { data: videos } = sourceIds.length
      ? await supabase
          .from("approved_source_videos")
          .select("*")
          .in("source_id", sourceIds)
          .order("published_at", { ascending: false })
      : { data: [] };

    return {
      sources: sources ?? [],
      videos: videos ?? [],
    };
  });

export const addApprovedYoutubeSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { url: string }) => z.object({ url: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Playlist: bulk-add every video as an already-approved legitimate
    // appearance. No analysis is queued and no enforcement code is touched —
    // this is a pure "these are mine, just record them" path.
    const playlistId = extractPlaylistId(data.url);
    if (playlistId) {
      const { fetchPlaylistVideos } = await import("@/lib/channel-watch/youtube.server");
      const videos = await fetchPlaylistVideos({ playlistId, max: 200 });
      const usable = videos.filter((v) => !v.isPrivateOrDeleted);
      if (usable.length === 0) {
        throw new Error("No public videos could be read from that playlist.");
      }

      const { data: existing } = await supabase
        .from("approved_youtube_sources")
        .select("youtube_video_id")
        .eq("user_id", userId)
        .neq("status", "removed")
        .in(
          "youtube_video_id",
          usable.map((v) => v.videoId),
        );
      const already = new Set((existing ?? []).map((r) => r.youtube_video_id));
      const fresh = usable.filter((v) => !already.has(v.videoId));

      let added = 0;
      for (const video of fresh) {
        const { data: source, error } = await supabase
          .from("approved_youtube_sources")
          .insert({
            user_id: userId,
            source_kind: "video",
            input_url: data.url,
            youtube_video_id: video.videoId,
            youtube_channel_id: video.channelId || null,
            title: video.title,
            thumbnail_url: video.thumbnailUrl,
          })
          .select("id")
          .single();
        if (error || !source) continue;

        await supabase.from("approved_source_videos").insert({
          source_id: source.id,
          user_id: userId,
          youtube_video_id: video.videoId,
          title: video.title,
          thumbnail_url: video.thumbnailUrl,
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          published_at: video.publishedAt,
          analysis_status: "skipped",
          classification: "legitimate_appearance",
          review_status: "approved_legitimate",
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        });
        added += 1;
      }

      return {
        kind: "playlist" as const,
        playlistId,
        added,
        skipped: usable.length - fresh.length,
      };
    }

    const resolved = await resolveApprovedYoutubeInput(data.url);


    if (resolved.kind === "video") {
      const { data: source, error } = await supabase
        .from("approved_youtube_sources")
        .insert({
          user_id: userId,
          source_kind: "video",
          input_url: data.url,
          youtube_video_id: resolved.videoId,
          youtube_channel_id: resolved.channelId,
          title: resolved.title,
          thumbnail_url: resolved.thumbnailUrl,
        })
        .select("*")
        .single();
      if (error || !source) throw new Error(error?.message ?? "Failed to add video source.");

      const { data: videoRow, error: videoError } = await supabase
        .from("approved_source_videos")
        .insert({
          source_id: source.id,
          user_id: userId,
          youtube_video_id: resolved.videoId,
          title: resolved.title,
          thumbnail_url: resolved.thumbnailUrl,
          url: `https://www.youtube.com/watch?v=${resolved.videoId}`,
          analysis_status: "pending",
        })
        .select("id")
        .single();

      if (!videoError && videoRow) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { analyzeApprovedSourceVideo } = await import("./analyze-approved-video.server");
          await analyzeApprovedSourceVideo(supabaseAdmin, videoRow.id);
        } catch (err) {
          console.error("[approved-sources] initial analysis failed", videoRow.id, err);
          // Without this, a thrown analysis error left the row stuck at
          // analysis_status "running" forever with no visible failure.
          const { error: failUpdateError } = await supabaseAdmin
            .from("approved_source_videos")
            .update({
              analysis_status: "failed",
              analysis_error: (err as Error).message ?? String(err),
            })
            .eq("id", videoRow.id);
          if (failUpdateError) {
            console.error(
              "[approved-sources] failed to record analysis failure — video may be stuck",
              videoRow.id,
              failUpdateError.message,
            );
          }
        }
      }

      return source;
    }

    const { data: source, error } = await supabase
      .from("approved_youtube_sources")
      .insert({
        user_id: userId,
        source_kind: "channel",
        input_url: data.url,
        youtube_channel_id: resolved.channelId,
        uploads_playlist_id: resolved.uploadsPlaylistId,
        title: resolved.title,
        channel_title: resolved.channelTitle,
        thumbnail_url: resolved.thumbnailUrl,
        next_poll_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error || !source) throw new Error(error?.message ?? "Failed to add channel source.");

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { pollApprovedChannelSource } = await import("./poll-approved-source.server");
      await pollApprovedChannelSource(supabaseAdmin, source.id);
    } catch (err) {
      console.error("[approved-sources] initial poll failed", err);
    }

    return source;
  });

/**
 * Soft-deletes a source: marks it 'removed' rather than issuing a DELETE.
 * Historical approved_source_videos rows (including any tied to a
 * verified/probable deepfake finding, and the evidence/case records that
 * finding produced) must survive a customer removing the source that
 * originally surfaced them — a hard delete would cascade and destroy that
 * audit trail. listApprovedSources already filters out status='removed',
 * so a removed source simply disappears from the customer's active list
 * without erasing what was found under it.
 */
export async function removeApprovedSourceCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  id: string,
): Promise<{ ok: boolean }> {
  await supabase
    .from("approved_youtube_sources")
    .update({ status: "removed" })
    .eq("id", id)
    .eq("user_id", userId);
  return { ok: true };
}

export const removeApprovedSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    return removeApprovedSourceCore(supabase, userId, data.id);
  });

const CUSTOMER_REVIEW_STATUSES = ["approved_legitimate", "sent_for_review"] as const;
type CustomerReviewStatus = (typeof CUSTOMER_REVIEW_STATUSES)[number];

/**
 * The customer's own review decision on a discovered video. Deliberately the
 * only thing this function touches — it never imports evidence-capture or
 * enforcement code, so "approval/send-for-review can never trigger
 * enforcement" is true by construction, not just by convention. Scoped to
 * the caller's own row by both the RLS policy on approved_source_videos and
 * this explicit eq("user_id", userId) filter (defense in depth, matching
 * removeApprovedSourceCore).
 */
export async function updateSourceVideoReviewStatusCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  videoId: string,
  status: CustomerReviewStatus,
): Promise<{ ok: boolean }> {
  await supabase
    .from("approved_source_videos")
    .update({ review_status: status, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq("id", videoId)
    .eq("user_id", userId);
  return { ok: true };
}

export const approveSourceVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    return updateSourceVideoReviewStatusCore(supabase, userId, data.id, "approved_legitimate");
  });

export const sendSourceVideoForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    return updateSourceVideoReviewStatusCore(supabase, userId, data.id, "sent_for_review");
  });
