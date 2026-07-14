import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const YT = "https://www.googleapis.com/youtube/v3";

export type YTChannel = {
  channel_id: string;
  channel_title: string;
  channel_handle: string | null;
  channel_url: string;
  profile_image_url: string | null;
  banner_image_url: string | null;
  description: string | null;
  country: string | null;
  published_at: string | null;
  subscriber_count: number | null;
  hidden_subscriber_count: boolean;
  total_view_count: number | null;
  video_count: number | null;
  related_links: { title: string; url: string }[];
  match_confidence: number; // 0..1
};

type SearchResult = {
  channels: YTChannel[];
  query: string;
  strategy: "id" | "handle" | "search";
};

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YouTube verification is temporarily unavailable. Save as pending or try again later.");
  return k;
}

/** Normalize any YouTube channel input into { channelId?, handle?, name? }. */
export function parseYouTubeInput(raw: string): { channelId?: string; handle?: string; name?: string } {
  const s = (raw || "").trim();
  if (!s) return {};
  // Try URL
  let u: URL | null = null;
  try {
    u = new URL(s.startsWith("http") ? s : `https://${s}`);
  } catch { /* not a url */ }

  if (u && /(^|\.)youtube\.com$/i.test(u.hostname)) {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]?.startsWith("UC")) return { channelId: parts[1] };
    if (parts[0]?.startsWith("@")) return { handle: parts[0].slice(1) };
    if (parts[0] === "c" && parts[1]) return { name: decodeURIComponent(parts[1]) };
    if (parts[0] === "user" && parts[1]) return { name: decodeURIComponent(parts[1]) };
    if (parts[0]) return { name: decodeURIComponent(parts[0]) };
  }
  if (s.startsWith("@")) return { handle: s.slice(1) };
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(s)) return { channelId: s };
  return { name: s };
}

async function ytFetch(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${YT}/${path}`);
  Object.entries({ ...params, key: apiKey() }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (/quota/i.test(body)) throw new Error("YouTube verification is temporarily unavailable. Save as pending or try again later.");
    throw new Error(`YouTube API blocked: ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API error (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

function toChannel(item: any, confidence = 1): YTChannel {
  const stats = item.statistics ?? {};
  const snip = item.snippet ?? {};
  const brand = item.brandingSettings ?? {};
  const handle: string | null = snip.customUrl?.startsWith("@") ? snip.customUrl : snip.customUrl ? `@${snip.customUrl}` : null;
  const channel_url = handle
    ? `https://www.youtube.com/${handle}`
    : `https://www.youtube.com/channel/${item.id}`;
  const thumbs = snip.thumbnails ?? {};
  const profile = thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;
  return {
    channel_id: item.id,
    channel_title: snip.title ?? "",
    channel_handle: handle,
    channel_url,
    profile_image_url: profile,
    banner_image_url: brand.image?.bannerExternalUrl ?? null,
    description: snip.description ?? null,
    country: snip.country ?? null,
    published_at: snip.publishedAt ?? null,
    subscriber_count: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount ?? 0),
    hidden_subscriber_count: !!stats.hiddenSubscriberCount,
    total_view_count: stats.viewCount != null ? Number(stats.viewCount) : null,
    video_count: stats.videoCount != null ? Number(stats.videoCount) : null,
    related_links: [],
    match_confidence: confidence,
  };
}

async function fetchChannelsByIds(ids: string[], confidenceById?: Map<string, number>): Promise<YTChannel[]> {
  if (ids.length === 0) return [];
  const data = await ytFetch("channels", {
    part: "snippet,statistics,brandingSettings",
    id: ids.join(","),
    maxResults: String(ids.length),
  });
  const items: any[] = data.items ?? [];
  return items.map((it) => toChannel(it, confidenceById?.get(it.id) ?? 1));
}

/** Resolve YouTube input to candidate channels. */
export const searchYouTubeChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input: string; max?: number }) => data)
  .handler(async ({ data }): Promise<SearchResult> => {
    const parsed = parseYouTubeInput(data.input);
    const max = Math.min(Math.max(data.max ?? 5, 1), 10);

    if (parsed.channelId) {
      const channels = await fetchChannelsByIds([parsed.channelId]);
      return { channels, query: data.input, strategy: "id" };
    }
    if (parsed.handle) {
      // channels.list supports forHandle
      const direct = await ytFetch("channels", {
        part: "snippet,statistics,brandingSettings",
        forHandle: `@${parsed.handle}`,
        maxResults: "1",
      });
      const items: any[] = direct.items ?? [];
      if (items.length) {
        return { channels: items.map((i) => toChannel(i, 1)), query: data.input, strategy: "handle" };
      }
      // Fallback: search
      parsed.name = parsed.handle;
    }

    // Name search
    const searchRes = await ytFetch("search", {
      part: "snippet",
      q: parsed.name ?? data.input,
      type: "channel",
      maxResults: String(max),
    });
    const items: any[] = searchRes.items ?? [];
    const ids = items.map((i) => i.snippet?.channelId ?? i.id?.channelId).filter(Boolean) as string[];
    // Confidence: linearly decreasing with rank
    const confMap = new Map<string, number>();
    ids.forEach((id, idx) => confMap.set(id, Math.max(0.5, 1 - idx * 0.1)));
    const channels = await fetchChannelsByIds(ids, confMap);
    return { channels, query: data.input, strategy: "search" };
  });

/** Fetch a single channel by ID for refresh operations. */
export const refreshYouTubeChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { channel_id: string }) => data)
  .handler(async ({ data }): Promise<YTChannel> => {
    const [c] = await fetchChannelsByIds([data.channel_id]);
    if (!c) throw new Error("No matching YouTube channel was found. Check the channel URL, handle or spelling.");
    return c;
  });

/** Refresh metadata for a saved onboarding asset. */
export const refreshOnboardingYouTubeAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { asset_id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: asset, error } = await supabase
      .from("onboarding_assets")
      .select("*")
      .eq("id", data.asset_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !asset) throw new Error("Asset not found.");
    const meta = (asset.metadata ?? {}) as Record<string, any>;
    const channelId: string | undefined = meta.channel_id;
    if (!channelId) throw new Error("Asset is not linked to a YouTube channel.");
    const [fresh] = await fetchChannelsByIds([channelId]);
    if (!fresh) throw new Error("No matching YouTube channel was found. Check the channel URL, handle or spelling.");
    // Preserve confirmation/verification/authorization; refresh fetched fields.
    const preserved = {
      confirmation_status: meta.confirmation_status ?? "user_confirmed",
      verification_status: meta.verification_status ?? "pending",
      authorization_links: meta.authorization_links ?? [],
    };
    const newMeta = {
      ...meta,
      ...fresh,
      ...preserved,
      last_synced_at: new Date().toISOString(),
      raw_provider_metadata: fresh,
    };
    const { data: updated, error: uerr } = await supabase
      .from("onboarding_assets")
      .update({
        label: fresh.channel_title || asset.label,
        value: fresh.channel_handle ?? channelId,
        url: fresh.channel_url,
        metadata: newMeta as never,
      })
      .eq("id", data.asset_id)
      .eq("user_id", userId)
      .select()
      .single();
    if (uerr) throw new Error(uerr.message);
    return updated;
  });
