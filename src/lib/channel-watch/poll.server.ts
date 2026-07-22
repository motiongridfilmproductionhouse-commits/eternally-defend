/**
 * Poll worker for one channel watch. Fetches new uploads via the uploads
 * playlist, dedupes by (watch_id, video_id), inserts rows for new videos as
 * non-baseline, updates schedule, and runs a lightweight analysis pass. Never
 * silently converts a provider failure into "no findings" — errors bubble up
 * so the caller can persist status='error' with the message.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { fetchUploadsSince, priorityToIntervalMinutes } from "./youtube.server";
import { analyzeWatchVideo } from "./analysis.server";

type Supa = SupabaseClient<Database>;

interface WatchRow {
  id: string;
  user_id: string;
  channel_id: string;
  channel_title: string | null;
  uploads_playlist_id: string | null;
  priority: "critical" | "high" | "standard" | "low";
  last_video_published_at: string | null;
  status: "active" | "paused" | "error";
}

export async function pollOneWatch(supabase: Supa, watchId: string, opts: { baseline?: boolean; baselineCount?: number } = {}) {
  const { data: w, error: e1 } = await supabase
    .from("channel_watches").select("*").eq("id", watchId).maybeSingle();
  if (e1 || !w) throw new Error(`watch not found: ${watchId}`);
  const watch = w as WatchRow;

  if (watch.status === "paused") return { skipped: true, reason: "paused" };
  if (!watch.uploads_playlist_id) throw new Error("watch missing uploads_playlist_id");

  const isBaseline = opts.baseline === true;
  const since = isBaseline ? undefined : watch.last_video_published_at ?? undefined;
  const max = isBaseline ? Math.max(1, Math.min(200, opts.baselineCount ?? 25)) : 50;

  let videos;
  try {
    videos = await fetchUploadsSince({ uploadsPlaylistId: watch.uploads_playlist_id, sinceIso: since ?? undefined, max });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await supabase.from("channel_watches").update({
      status: "error", last_error: msg, last_checked_at: new Date().toISOString(),
    }).eq("id", watch.id);
    await supabase.from("channel_watch_events").insert({
      user_id: watch.user_id, watch_id: watch.id, event_type: "poll_failed", payload: { error: msg },
    });
    throw err;
  }

  const nowIso = new Date().toISOString();
  let inserted = 0;
  let latestPublished = watch.last_video_published_at ?? null;

  for (const v of videos) {
    if (v.publishedAt && (!latestPublished || v.publishedAt > latestPublished)) {
      latestPublished = v.publishedAt;
    }
    const { data: existing } = await supabase
      .from("channel_watch_videos")
      .select("id")
      .eq("watch_id", watch.id)
      .eq("video_id", v.videoId)
      .maybeSingle();
    if (existing) {
      // A historical/current-channel analysis intentionally re-runs analysis
      // so updated protected names, aliases and evidence rules are applied.
      if (isBaseline) {
        try {
          await analyzeWatchVideo(supabase, existing.id);
        } catch (err) {
          await supabase.from("channel_watch_videos").update({
            analysis_status: "failed",
            analysis_error: (err as Error).message ?? String(err),
          }).eq("id", existing.id);
        }
      }
      continue;
    }

    const { data: ins, error: eIns } = await supabase.from("channel_watch_videos").insert({
      user_id: watch.user_id,
      watch_id: watch.id,
      video_id: v.videoId,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnailUrl,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      published_at: v.publishedAt,
      detected_at: nowIso,
      is_baseline: isBaseline,
      duration_seconds: v.durationSeconds,
      view_count: v.viewCount,
      like_count: v.likeCount,
      comment_count: v.commentCount,
      analysis_status: v.isPrivateOrDeleted ? "skipped" : "pending",
      analysis_error: v.isPrivateOrDeleted ? "Video is private, deleted or unavailable." : null,
    }).select("id").single();
    if (eIns || !ins) continue;
    inserted += 1;

    await supabase.from("channel_watch_events").insert({
      user_id: watch.user_id, watch_id: watch.id, video_id: ins.id,
      event_type: isBaseline ? "baseline_video_fetched" : "new_video_detected",
      payload: { video_id: v.videoId, title: v.title, published_at: v.publishedAt },
    });

    if (!v.isPrivateOrDeleted) {
      // Best-effort inline analysis; failures are recorded per-row, never silent.
      try {
        await analyzeWatchVideo(supabase, ins.id);
      } catch (err) {
        await supabase.from("channel_watch_videos").update({
          analysis_status: "failed", analysis_error: (err as Error).message ?? String(err),
        }).eq("id", ins.id);
      }
    }
  }

  const nextMs = Date.now() + priorityToIntervalMinutes(watch.priority) * 60_000;
  await supabase.from("channel_watches").update({
    status: "active",
    last_error: null,
    last_checked_at: nowIso,
    next_check_at: new Date(nextMs).toISOString(),
    last_video_published_at: latestPublished,
  }).eq("id", watch.id);

  return { inserted, checked: videos.length };
}
