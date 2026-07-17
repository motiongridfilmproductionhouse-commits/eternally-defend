import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { randomBytes } from "crypto";

function genCode(): string {
  const bytes = randomBytes(4).toString("hex").toUpperCase();
  return `ETERNA-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`;
}

async function fetchChannelMeta(channelIdOrHandle: string, apiKey: string) {
  const isId = channelIdOrHandle.startsWith("UC");
  const url = isId
    ? `https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&id=${encodeURIComponent(channelIdOrHandle)}&key=${apiKey}`
    : `https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&forHandle=${encodeURIComponent(channelIdOrHandle.replace(/^@/, ""))}&key=${apiKey}`;
  const r = await fetch(url); if (!r.ok) return null;
  const j = await r.json() as { items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string; description?: string }; brandingSettings?: { channel?: { description?: string } } }> };
  return j.items?.[0] ?? null;
}

export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    return (await supabase.from("digital_assets").select("*").eq("user_id", userId).order("created_at")).data ?? [];
  });

export const addYouTubeAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { channel_url: string }) => z.object({ channel_url: z.string().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.YOUTUBE_API_KEY!;
    // Extract handle or id
    const url = data.channel_url.trim();
    const idMatch = url.match(/(UC[\w-]{20,})/);
    const handleMatch = url.match(/@([A-Za-z0-9._-]+)/);
    const key = idMatch?.[1] ?? handleMatch?.[1] ?? url.replace(/^https?:\/\/[^/]+\//, "");
    const meta = await fetchChannelMeta(key, apiKey);
    if (!meta) throw new Error("Could not resolve YouTube channel");
    const { data: row, error } = await supabase.from("digital_assets").insert({
      user_id: userId,
      kind: "youtube",
      channel_id: meta.id,
      channel_url: `https://www.youtube.com/channel/${meta.id}`,
      handle: meta.snippet?.customUrl ?? null,
      name: meta.snippet?.title ?? null,
      metadata: { snippet: meta.snippet },
      verification_status: "UNVERIFIED",
    }).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const removeAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("digital_assets").delete().eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

export const generateChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { asset_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const code = genCode();
    const expires_at = new Date(Date.now() + 24 * 3600_000).toISOString();
    const { data: row, error } = await supabase.from("youtube_verification_challenges").insert({
      user_id: userId, asset_id: data.asset_id, code, expires_at,
    }).select().single();
    if (error) throw new Error(error.message);
    await supabase.from("digital_assets").update({ verification_status: "CODE_GENERATED" }).eq("id", data.asset_id).eq("user_id", userId);
    return row;
  });

export const verifyChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { asset_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.YOUTUBE_API_KEY!;
    const { data: asset } = await supabase.from("digital_assets").select("*").eq("id", data.asset_id).eq("user_id", userId).maybeSingle();
    if (!asset?.channel_id) throw new Error("Asset missing channel");
    const { data: chal } = await supabase.from("youtube_verification_challenges").select("*").eq("asset_id", data.asset_id).eq("user_id", userId).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!chal) throw new Error("No active challenge");
    if (new Date(chal.expires_at).getTime() < Date.now()) throw new Error("Challenge expired");

    const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&id=${asset.channel_id}&key=${apiKey}`);
    const chJ = await chRes.json() as { items?: Array<{ snippet?: { description?: string }; brandingSettings?: { channel?: { description?: string } } }> };
    const chDesc = (chJ.items?.[0]?.snippet?.description ?? "") + "\n" + (chJ.items?.[0]?.brandingSettings?.channel?.description ?? "");

    let found = chDesc.includes(chal.code);
    let evidence: { source: string; matched: boolean; video_id?: string } = { source: "channel_description", matched: found };

    if (!found) {
      const sr = await fetch(`https://www.googleapis.com/youtube/v3/search?part=id&channelId=${asset.channel_id}&order=date&maxResults=5&type=video&key=${apiKey}`);
      const sj = await sr.json() as { items?: Array<{ id?: { videoId?: string } }> };
      const ids = (sj.items ?? []).map((i) => i.id?.videoId).filter(Boolean).join(",");
      if (ids) {
        const vr = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${apiKey}`);
        const vj = await vr.json() as { items?: Array<{ id: string; snippet?: { description?: string } }> };
        for (const v of vj.items ?? []) {
          if ((v.snippet?.description ?? "").includes(chal.code)) {
            found = true;
            evidence = { source: "video_description", video_id: v.id, matched: true };
            break;
          }
        }
      }
    }

    if (!found) {
      await supabase.from("asset_verification_events").insert({ user_id: userId, asset_id: data.asset_id, event: "verify_failed", payload: evidence as never });
      throw new Error("Verification code not found on channel. Ensure you posted it and try again.");
    }

    await supabase.from("youtube_verification_challenges").update({ used_at: new Date().toISOString(), evidence: evidence as never }).eq("id", chal.id);
    await supabase.from("digital_assets").update({ verification_status: "VERIFIED", verification_method: "code_challenge", verified_at: new Date().toISOString() }).eq("id", data.asset_id);
    await supabase.from("asset_verification_events").insert({ user_id: userId, asset_id: data.asset_id, event: "verified", payload: evidence as never });

    const { data: progress } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    const states = {
      ...(progress?.step_states as Record<string, string> ?? {}),
      "4": "COMPLETED"
    };
    await supabase.from("onboarding_progress").upsert({
      user_id: userId,
      current_step: Math.max(progress?.current_step ?? 1, 5),
      step_states: states,
      overall_status: "IN_PROGRESS"
    }, { onConflict: "user_id" });

    return { ok: true, evidence };
  });
