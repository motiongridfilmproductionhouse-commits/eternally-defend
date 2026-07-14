/**
 * Full YouTube channel enrichment via Data API v3 (channels endpoint).
 * All numeric fields are optional — YouTube may hide subscriber counts or
 * omit country. Never fabricate missing values.
 */

export interface YoutubeChannelInfo {
  channelId: string;
  channelUrl: string;
  channelName?: string;
  handle?: string;
  customUrl?: string;
  profileImageUrl?: string;
  description?: string;
  country?: string;
  channelCreatedAt?: string;
  subscriberCount?: number;
  totalViewCount?: number;
  videoCount?: number;
  raw?: Record<string, unknown>;
}

export async function fetchYoutubeChannel(channelId: string): Promise<YoutubeChannelInfo | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key || !channelId) return null;
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "snippet,statistics,brandingSettings");
    url.searchParams.set("id", channelId);
    url.searchParams.set("key", key);
    const r = await fetch(url.toString());
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: Array<Record<string, unknown>> };
    const item = j.items?.[0];
    if (!item) return null;
    const sn = (item.snippet ?? {}) as Record<string, unknown>;
    const st = (item.statistics ?? {}) as Record<string, unknown>;
    const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
    const customUrl = typeof sn.customUrl === "string" ? sn.customUrl : undefined;
    return {
      channelId,
      channelUrl: `https://www.youtube.com/channel/${channelId}`,
      channelName: typeof sn.title === "string" ? sn.title : undefined,
      handle: customUrl?.startsWith("@") ? customUrl : undefined,
      customUrl,
      profileImageUrl: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url,
      description: typeof sn.description === "string" ? sn.description : undefined,
      country: typeof sn.country === "string" ? sn.country : undefined,
      channelCreatedAt: typeof sn.publishedAt === "string" ? sn.publishedAt : undefined,
      subscriberCount: st.hiddenSubscriberCount ? undefined : Number(st.subscriberCount ?? 0) || undefined,
      totalViewCount: Number(st.viewCount ?? 0) || undefined,
      videoCount: Number(st.videoCount ?? 0) || undefined,
      raw: item,
    };
  } catch {
    return null;
  }
}

/**
 * Derives lightweight intelligence scores from raw channel + finding stats.
 * These are heuristics — never present them as ground truth.
 */
export function computeCreatorIntelligence(input: {
  subscriberCount?: number;
  totalViewCount?: number;
  videoCount?: number;
  findingsCount: number;
  criticalFindingsCount: number;
  estimatedTotalReach?: number;
}): { influenceScore: number; credibilityScore: number; threatAmplificationScore: number } {
  const subs = input.subscriberCount ?? 0;
  const totalViews = input.totalViewCount ?? 0;
  // Influence: log-scaled reach.
  const influenceRaw = Math.log10(Math.max(1, subs)) * 10 + Math.log10(Math.max(1, totalViews)) * 5;
  const influenceScore = Math.min(100, Math.round(influenceRaw));
  // Credibility drops as ratio of critical findings rises.
  const critRatio = input.findingsCount > 0 ? input.criticalFindingsCount / input.findingsCount : 0;
  const credibilityScore = Math.max(0, Math.round(80 - critRatio * 80));
  // Threat amplification = influence × severity weight.
  const threatAmplificationScore = Math.min(
    100,
    Math.round(influenceScore * (0.4 + critRatio * 0.6)),
  );
  return { influenceScore, credibilityScore, threatAmplificationScore };
}
