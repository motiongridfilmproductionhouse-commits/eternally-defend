import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveChannelCandidates, hydrateChannelById, priorityToIntervalMinutes } from "./youtube.server";
import { pollOneWatch } from "./poll.server";

const prioritySchema = z.enum(["critical", "high", "standard", "low"]);

export const listChannelWatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("channel_watches").select("*").eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getVerifiedUserSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [profileRes, watchesRes, videosRes, matchesRes] = await Promise.all([
      context.supabase.from("client_profiles").select("display_name, full_name, company_name, verification_status, avatar_url").eq("user_id", context.userId).maybeSingle(),
      context.supabase.from("channel_watches").select("id, status", { count: "exact", head: false }).eq("user_id", context.userId),
      context.supabase.from("channel_watch_videos").select("id", { count: "exact", head: true }).eq("user_id", context.userId).eq("analysis_status", "completed"),
      context.supabase.from("channel_watch_videos").select("id, risk_score", { count: "exact", head: false }).eq("user_id", context.userId).eq("review_status", "pending"),
    ]);
    const profile = profileRes.data as (Record<string, unknown> | null);
    const watches = watchesRes.data ?? [];
    const pending = matchesRes.data ?? [];
    const exposure = pending.reduce((acc, r) => acc + ((r as { risk_score: number | null }).risk_score ?? 0), 0);
    return {
      displayName: (profile?.display_name as string | undefined) ?? (profile?.full_name as string | undefined) ?? "Verified user",
      avatarUrl: (profile?.avatar_url as string | undefined) ?? null,
      verified: profile?.verification_status === "active" || profile?.verification_status === "verified",
      monitoredChannels: watches.length,
      activeChannels: watches.filter((w) => (w as { status?: string }).status === "active").length,
      videosAnalyzed: videosRes.count ?? 0,
      newMatches: pending.length,
      exposureScore: Math.min(100, Math.round(exposure / Math.max(1, watches.length || 1))),
    };
  });

export const resolveChannelSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ query: z.string().min(1).max(200) }).parse(raw))
  .handler(async ({ data }) => resolveChannelCandidates(data.query));

export const addChannelWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    channelId: z.string().regex(/^UC[A-Za-z0-9_-]{20,}$/, "Invalid channel id"),
    reason: z.string().min(2).max(500),
    priority: prioritySchema,
    notes: z.string().max(2000).optional(),
    analyzeExisting: z.boolean(),
    existingCount: z.number().int().min(0).max(200).optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("channel_watches").select("id").eq("user_id", context.userId).eq("channel_id", data.channelId).maybeSingle();
    if (existing) throw new Error("You are already monitoring this channel.");

    const c = await hydrateChannelById(data.channelId);
    if (!c) throw new Error("Could not resolve channel from YouTube.");

    const nextMinutes = priorityToIntervalMinutes(data.priority);
    const { data: inserted, error } = await context.supabase.from("channel_watches").insert({
      user_id: context.userId,
      channel_id: c.channelId,
      channel_title: c.title,
      handle: c.handle,
      avatar_url: c.avatarUrl,
      channel_url: c.channelUrl,
      description: c.description,
      subscriber_count: c.subscriberCount ?? null,
      video_count: c.videoCount ?? null,
      uploads_playlist_id: c.uploadsPlaylistId,
      reason: data.reason,
      priority: data.priority,
      notes: data.notes ?? null,
      status: "active",
      next_check_at: new Date(Date.now() + nextMinutes * 60_000).toISOString(),
    }).select("id").single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create watch");

    await context.supabase.from("channel_watch_events").insert({
      user_id: context.userId, watch_id: inserted.id,
      event_type: "channel_added", payload: { channel_id: c.channelId, title: c.title, priority: data.priority },
    });

    if (data.analyzeExisting) {
      try {
        await pollOneWatch(context.supabase, inserted.id, { baseline: true, baselineCount: data.existingCount ?? 25 });
      } catch (err) {
        console.warn("[channel-watch] baseline fetch failed", (err as Error).message);
      }
    }
    return { id: inserted.id, channelId: c.channelId };
  });

export const scanChannelNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ watchId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    // RLS + explicit user_id check
    const { data: w } = await context.supabase
      .from("channel_watches").select("id, user_id").eq("id", data.watchId).maybeSingle();
    if (!w || w.user_id !== context.userId) throw new Error("Not found");
    return pollOneWatch(context.supabase, data.watchId);
  });

export const setWatchStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    watchId: z.string().uuid(),
    status: z.enum(["active", "paused"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("channel_watches")
      .update({ status: data.status, last_error: null })
      .eq("id", data.watchId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await context.supabase.from("channel_watch_events").insert({
      user_id: context.userId, watch_id: data.watchId,
      event_type: data.status === "paused" ? "watch_paused" : "watch_resumed", payload: {},
    });
    return { ok: true };
  });

export const removeChannelWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ watchId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("channel_watches")
      .delete().eq("id", data.watchId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWatchVideos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    watchId: z.string().uuid().optional(),
    onlyRelevant: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("channel_watch_videos").select("*")
      .eq("user_id", context.userId)
      .order("detected_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.watchId) q = q.eq("watch_id", data.watchId);
    if (data.onlyRelevant) q = q.neq("classification", "not_relevant");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const submitReviewDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    videoRowId: z.string().uuid(),
    decision: z.enum(["approved", "dismissed", "escalated"]),
    note: z.string().max(2000).optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("channel_watch_videos")
      .update({ review_status: data.decision, review_note: data.note ?? null })
      .eq("id", data.videoRowId).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    await context.supabase.from("channel_watch_events").insert({
      user_id: context.userId, video_id: data.videoRowId,
      event_type: `review_${data.decision}`, payload: { note: data.note ?? null },
    });
    return { ok: true };
  });

export const listRecentEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("channel_watch_events").select("*").eq("user_id", context.userId)
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
