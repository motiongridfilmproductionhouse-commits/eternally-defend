import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolveApprovedYoutubeInput } from "./resolve-youtube-source.server";

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
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { analyzeApprovedSourceVideo } = await import("./analyze-approved-video.server");
          await analyzeApprovedSourceVideo(supabaseAdmin, videoRow.id);
        } catch (err) {
          console.error("[approved-sources] initial analysis failed", err);
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
