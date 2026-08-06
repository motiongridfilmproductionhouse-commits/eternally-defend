/**
 * YouTube Copyright & Reputation Monitoring for Copyright Intelligence.
 *
 * Public YouTube Data API is used to discover videos around a protected work
 * (title, alternative titles, actors, director, studio, release-date window and
 * review/reaction keywords). Each video is then analysed for:
 *   - copyright usage of the protected material (thumbnail vs. reference frames,
 *     corroborated with AWS Rekognition when configured)
 *   - sentiment / reputation risk from title + description
 * Evidence collection only — nothing is reported or removed automatically.
 */
import {
  buildMovieFingerprint,
  matchCandidateAgainstFingerprint,
  type MovieFingerprint,
} from "@/lib/copyright/fingerprint.server";

const YT = "https://www.googleapis.com/youtube/v3";

export interface YtVideo {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  channelId: string | null;
  channelTitle: string | null;
  channelUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number | null;
  matchedQuery: string;
}

export type CopyrightUsage =
  "none" | "poster_or_screenshot" | "trailer_footage" | "movie_footage" | "promotional_material";
export type Sentiment = "positive" | "neutral" | "negative";

export interface VideoIntel {
  contentCategory: string;
  copyrightUsage: CopyrightUsage;
  copyrightSignals: string[];
  sentiment: Sentiment;
  sentimentScore: number;
  summary: string;
  reputationRisk: string[];
}

const KEYWORDS = [
  "review",
  "reaction",
  "first review",
  "first reaction",
  "movie review",
  "movie explained",
  "ending explained",
];

function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!k) throw new Error("YouTube monitoring is unavailable: YOUTUBE_API_KEY is not configured.");
  return k;
}

function parseIsoDuration(iso?: string): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  return +(m[1] ?? 0) * 86400 + +(m[2] ?? 0) * 3600 + +(m[3] ?? 0) * 60 + +(m[4] ?? 0);
}

async function ytFetch(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${YT}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: apiKey() })) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`YouTube API ${res.status}: ${body}`);
  }
  return res.json();
}

/** Build the discovery query plan from the work's fingerprint metadata. */
export function buildYoutubeQueries(meta: {
  title: string;
  altTitles?: string[];
  actors?: string[];
  director?: string | null;
  studio?: string | null;
  language?: string | null;
}): string[] {
  const names = [
    ...new Set(
      [meta.title, ...(meta.altTitles ?? [])].map((t) => (t ?? "").trim()).filter(Boolean),
    ),
  ].slice(0, 3);
  const queries: string[] = [];
  const push = (q: string) => {
    if (q.trim() && !queries.includes(q)) queries.push(q);
  };

  for (const name of names) {
    push(`"${name}"`);
    for (const kw of KEYWORDS) push(`"${name}" ${kw}`);
    if (meta.language) push(`"${name}" ${meta.language} review`);
    push(`"${name}" full movie`);
    push(`"${name}" leaked scene`);
  }
  for (const actor of (meta.actors ?? []).slice(0, 3)) push(`"${names[0] ?? meta.title}" ${actor}`);
  if (meta.director) push(`"${names[0] ?? meta.title}" ${meta.director}`);
  if (meta.studio) push(`"${names[0] ?? meta.title}" ${meta.studio}`);

  return queries.slice(0, 18);
}

/** Search YouTube for every query and hydrate statistics for the unique videos. */
export async function discoverYoutubeVideos(
  queries: string[],
  opts: {
    publishedAfter?: string | null;
    perQuery?: number;
    /** Called after each search batch with newly hydrated videos (streaming telemetry). */
    onBatch?: (videos: YtVideo[]) => void | Promise<void>;
  } = {},
): Promise<YtVideo[]> {
  const found = new Map<string, { snippet: any; query: string }>();
  const videos: YtVideo[] = [];
  const hydrated = new Set<string>();

  const hydrateIds = async (ids: string[]) => {
    const pending = ids.filter((id) => !hydrated.has(id));
    if (!pending.length) return;
    for (let i = 0; i < pending.length; i += 50) {
      const chunk = pending.slice(i, i + 50);
      const json = await ytFetch("videos", {
        part: "snippet,statistics,contentDetails",
        id: chunk.join(","),
      }).catch(() => ({ items: [] }));

      const batchOut: YtVideo[] = [];
      for (const v of (json.items ?? []) as any[]) {
        hydrated.add(v.id);
        const sn = v.snippet ?? {};
        const st = v.statistics ?? {};
        const thumbs = sn.thumbnails ?? {};
        const row: YtVideo = {
          videoId: v.id,
          videoUrl: `https://www.youtube.com/watch?v=${v.id}`,
          title: String(sn.title ?? "").slice(0, 300),
          description: String(sn.description ?? "").slice(0, 4000),
          channelId: sn.channelId ?? null,
          channelTitle: sn.channelTitle ?? null,
          channelUrl: sn.channelId ? `https://www.youtube.com/channel/${sn.channelId}` : null,
          thumbnailUrl:
            thumbs.maxres?.url ??
            thumbs.high?.url ??
            thumbs.medium?.url ??
            thumbs.default?.url ??
            null,
          publishedAt: sn.publishedAt ?? null,
          viewCount: st.viewCount != null ? Number(st.viewCount) : null,
          likeCount: st.likeCount != null ? Number(st.likeCount) : null,
          commentCount: st.commentCount != null ? Number(st.commentCount) : null,
          durationSeconds: parseIsoDuration(v.contentDetails?.duration),
          matchedQuery: found.get(v.id)?.query ?? "",
        };
        videos.push(row);
        batchOut.push(row);
      }
      if (batchOut.length && opts.onBatch) {
        await opts.onBatch(batchOut);
      }
    }
  };

  for (let i = 0; i < queries.length; i += 4) {
    const batch = queries.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (q) => {
        try {
          const params: Record<string, string> = {
            part: "snippet",
            type: "video",
            maxResults: String(opts.perQuery ?? 10),
            order: "relevance",
            q,
            safeSearch: "none",
          };
          if (opts.publishedAfter) params.publishedAfter = opts.publishedAfter;
          const json = await ytFetch("search", params);
          return { q, items: (json.items ?? []) as any[] };
        } catch (e) {
          console.warn("[yt-monitor] search failed", q, (e as Error).message);
          return { q, items: [] as any[] };
        }
      }),
    );
    const newIds: string[] = [];
    for (const { q, items } of results) {
      for (const it of items) {
        const id = it?.id?.videoId;
        if (id && !found.has(id)) {
          found.set(id, { snippet: it.snippet, query: q });
          newIds.push(id);
        }
      }
    }
    await hydrateIds(newIds.slice(0, 120 - videos.length));
    if (videos.length >= 120) break;
  }

  return videos;
}

const SYSTEM = `You analyse a public YouTube video for a rights holder's copyright and reputation monitoring desk.
You receive the video metadata, the protected work's details, the REFERENCE frame of the protected work and the video THUMBNAIL.

Report strictly as JSON:
{
  "contentCategory": string,        // review | reaction | explainer | news | fan_edit | full_movie | clip | trailer_reupload | promo | unrelated
  "copyrightUsage": string,         // none | poster_or_screenshot | trailer_footage | movie_footage | promotional_material
  "copyrightSignals": string[],     // short evidence tags e.g. poster_in_thumbnail, scene_frame_used, logo_used, trailer_frames
  "sentiment": string,              // positive | neutral | negative
  "sentimentScore": number,         // -100 very negative .. 100 very positive
  "reputationRisk": string[],       // e.g. defamation_claim, spoiler_leak, boycott_call, abusive_language, false_claim
  "summary": string                 // one or two sentences of concrete evidence
}
Judge copyright usage from the visuals only; do not assume usage from the title alone.
If the thumbnail is unrelated to the reference work, copyrightUsage must be "none".`;

const USAGES: CopyrightUsage[] = [
  "none",
  "poster_or_screenshot",
  "trailer_footage",
  "movie_footage",
  "promotional_material",
];

export async function analyzeYoutubeVideo(opts: {
  video: YtVideo;
  workTitle: string;
  referenceDataUrl: string;
}): Promise<VideoIntel | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const content: any[] = [
      {
        type: "text",
        text:
          `Protected work: ${opts.workTitle}\n` +
          `Video title: ${opts.video.title}\n` +
          `Channel: ${opts.video.channelTitle ?? "unknown"}\n` +
          `Published: ${opts.video.publishedAt ?? "unknown"}\n` +
          `Views: ${opts.video.viewCount ?? "unknown"}\n` +
          `Description: ${opts.video.description.slice(0, 1200)}\n\n` +
          `First image = REFERENCE work. Second image = video THUMBNAIL.`,
      },
      { type: "image_url", image_url: { url: opts.referenceDataUrl } },
    ];
    if (opts.video.thumbnailUrl)
      content.push({ type: "image_url", image_url: { url: opts.video.thumbnailUrl } });

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.warn(
        "[yt-monitor] gateway",
        res.status,
        (await res.text().catch(() => "")).slice(0, 200),
      );
      return null;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const usage = String(p.copyrightUsage ?? "none") as CopyrightUsage;
    const sentiment = String(p.sentiment ?? "neutral");
    const score = Number(p.sentimentScore);
    return {
      contentCategory: String(p.contentCategory ?? "unrelated").slice(0, 40),
      copyrightUsage: USAGES.includes(usage) ? usage : "none",
      copyrightSignals: Array.isArray(p.copyrightSignals)
        ? p.copyrightSignals.map((s) => String(s).slice(0, 48)).slice(0, 10)
        : [],
      sentiment: (["positive", "neutral", "negative"].includes(sentiment)
        ? sentiment
        : "neutral") as Sentiment,
      sentimentScore: Number.isFinite(score) ? Math.max(-100, Math.min(100, Math.round(score))) : 0,
      summary: String(p.summary ?? "").slice(0, 500),
      reputationRisk: Array.isArray(p.reputationRisk)
        ? p.reputationRisk.map((s) => String(s).slice(0, 48)).slice(0, 8)
        : [],
    };
  } catch (e) {
    console.warn("[yt-monitor] analyze failed", (e as Error).message);
    return null;
  }
}

const USAGE_WEIGHT: Record<CopyrightUsage, number> = {
  none: 0,
  poster_or_screenshot: 22,
  promotional_material: 18,
  trailer_footage: 28,
  movie_footage: 45,
};

export function scoreVideo(opts: {
  intel: VideoIntel | null;
  video: YtVideo;
  rekScore: number;
  sameDayRelease: boolean;
}): number {
  let score = 0;
  if (opts.intel) {
    score += USAGE_WEIGHT[opts.intel.copyrightUsage];
    if (opts.intel.sentiment === "negative")
      score += Math.min(25, Math.round(Math.abs(opts.intel.sentimentScore) / 4));
    score += Math.min(15, opts.intel.reputationRisk.length * 7);
  }
  score += Math.round(opts.rekScore * 0.25);
  const views = opts.video.viewCount ?? 0;
  if (views >= 1_000_000) score += 15;
  else if (views >= 100_000) score += 10;
  else if (views >= 10_000) score += 5;
  if (opts.sameDayRelease) score += 10;
  return Math.max(0, Math.min(100, score));
}

/** Rekognition corroboration of a video thumbnail against the reference fingerprint. */
export async function corroborateThumbnail(
  fp: MovieFingerprint,
  thumbnailUrl: string | null,
): Promise<{
  score: number;
  signals: string[];
  faceSimilarity: number;
  celebrityMatches: string[];
  sceneOverlap: number;
  ocrTitleMatch: boolean;
} | null> {
  if (!fp.available || !thumbnailUrl) return null;
  try {
    const { fetchImageBytes } = await import("@/lib/aws/s3.server");
    const fetched = await fetchImageBytes(thumbnailUrl);
    if (!fetched) return null;
    const m = await matchCandidateAgainstFingerprint(fp, fetched.bytes, "");
    return {
      score: m.score,
      signals: m.signals,
      faceSimilarity: m.faceSimilarity,
      celebrityMatches: m.celebrityMatches,
      sceneOverlap: m.sceneOverlap,
      ocrTitleMatch: m.ocrTitleMatch,
    };
  } catch {
    return null;
  }
}

export { buildMovieFingerprint };

/* ------------------------------------------------------------------ *
 * Release Day Review & Reputation Analysis
 * ------------------------------------------------------------------ */

export type ReviewType =
  | "same_day_release"
  | "first_reaction"
  | "early_access"
  | "influencer_critic"
  | "regional_language"
  | "general_review"
  | "not_a_review";
export type ReputationImpact = "high" | "medium" | "low";

export interface KeyStatement {
  statement: string;
  kind: "fact_claim" | "opinion" | "misleading" | "exaggerated" | "spoiler";
  timestamp?: string | null;
}

export interface ReleaseReviewIntel {
  isReview: boolean;
  reviewType: ReviewType;
  sentiment: Sentiment;
  sentimentScore: number;
  keyStatements: KeyStatement[];
  misleadingSignals: string[];
  copyrightUsage: CopyrightUsage;
  copyrightSignals: string[];
  evidenceTimestamps: string[];
  summary: string;
}

/** Fetch a small sample of public top-level comments for reputation context. */
export async function fetchVideoComments(videoId: string, max = 12): Promise<string[]> {
  try {
    const json = await ytFetch("commentThreads", {
      part: "snippet",
      videoId,
      maxResults: String(Math.min(max, 50)),
      order: "relevance",
      textFormat: "plainText",
    });
    return ((json.items ?? []) as any[])
      .map((it) => String(it?.snippet?.topLevelComment?.snippet?.textDisplay ?? "").trim())
      .filter(Boolean)
      .map((t) => t.slice(0, 300))
      .slice(0, max);
  } catch {
    return [];
  }
}

const REVIEW_SYSTEM = `You analyse a public YouTube movie review / reaction video for a rights holder's reputation monitoring desk.
You receive video metadata, a sample of public comments, the protected work's REFERENCE frame and the video THUMBNAIL.

Report strictly as JSON:
{
  "isReview": boolean,               // true if the video reviews, reacts to or discusses the movie
  "reviewType": string,              // same_day_release | first_reaction | early_access | influencer_critic | regional_language | general_review | not_a_review
  "sentiment": string,               // positive | neutral | negative
  "sentimentScore": number,          // -100 .. 100
  "keyStatements": [                 // max 6 concrete statements made about the movie
    { "statement": string, "kind": string, "timestamp": string|null }  // kind: fact_claim | opinion | misleading | exaggerated | spoiler
  ],
  "misleadingSignals": string[],     // false_factual_claim | misleading_statement | exaggerated_negative | coordinated_campaign | spoiler_exposure
  "copyrightUsage": string,          // none | poster_or_screenshot | trailer_footage | movie_footage | promotional_material
  "copyrightSignals": string[],
  "evidenceTimestamps": string[],    // timestamps mentioned in the description/comments that point to the claims, e.g. "01:24"
  "summary": string                  // two sentences: what is claimed and why it matters
}
Distinguish opinion from statements presented as fact. Only mark misleading signals with concrete textual evidence.`;

export async function analyzeReleaseReview(opts: {
  video: YtVideo;
  workTitle: string;
  referenceDataUrl: string;
  comments: string[];
}): Promise<ReleaseReviewIntel | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const content: any[] = [
      {
        type: "text",
        text:
          `Protected work: ${opts.workTitle}\n` +
          `Video title: ${opts.video.title}\n` +
          `Channel: ${opts.video.channelTitle ?? "unknown"}\n` +
          `Published: ${opts.video.publishedAt ?? "unknown"}\n` +
          `Views: ${opts.video.viewCount ?? "unknown"} · Likes: ${opts.video.likeCount ?? "unknown"} · Comments: ${opts.video.commentCount ?? "unknown"}\n` +
          `Description: ${opts.video.description.slice(0, 1500)}\n\n` +
          `Public comments sample:\n${opts.comments
            .map((c) => `- ${c}`)
            .join("\n")
            .slice(0, 2500)}\n\n` +
          `First image = REFERENCE work. Second image = video THUMBNAIL.`,
      },
      { type: "image_url", image_url: { url: opts.referenceDataUrl } },
    ];
    if (opts.video.thumbnailUrl)
      content.push({ type: "image_url", image_url: { url: opts.video.thumbnailUrl } });

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: REVIEW_SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.warn(
        "[yt-release-review] gateway",
        res.status,
        (await res.text().catch(() => "")).slice(0, 200),
      );
      return null;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const p = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, any>;
    const usage = String(p.copyrightUsage ?? "none") as CopyrightUsage;
    const sentiment = String(p.sentiment ?? "neutral");
    const score = Number(p.sentimentScore);
    const kinds = ["fact_claim", "opinion", "misleading", "exaggerated", "spoiler"];
    return {
      isReview: p.isReview !== false,
      reviewType: String(p.reviewType ?? "general_review").slice(0, 32) as ReviewType,
      sentiment: (["positive", "neutral", "negative"].includes(sentiment)
        ? sentiment
        : "neutral") as Sentiment,
      sentimentScore: Number.isFinite(score) ? Math.max(-100, Math.min(100, Math.round(score))) : 0,
      keyStatements: Array.isArray(p.keyStatements)
        ? p.keyStatements
            .slice(0, 6)
            .map((s: any) => ({
              statement: String(s?.statement ?? "").slice(0, 300),
              kind: (kinds.includes(String(s?.kind))
                ? String(s.kind)
                : "opinion") as KeyStatement["kind"],
              timestamp: s?.timestamp ? String(s.timestamp).slice(0, 12) : null,
            }))
            .filter((s: KeyStatement) => s.statement)
        : [],
      misleadingSignals: Array.isArray(p.misleadingSignals)
        ? p.misleadingSignals.map((s: unknown) => String(s).slice(0, 48)).slice(0, 8)
        : [],
      copyrightUsage: USAGES.includes(usage) ? usage : "none",
      copyrightSignals: Array.isArray(p.copyrightSignals)
        ? p.copyrightSignals.map((s: unknown) => String(s).slice(0, 48)).slice(0, 10)
        : [],
      evidenceTimestamps: Array.isArray(p.evidenceTimestamps)
        ? p.evidenceTimestamps.map((s: unknown) => String(s).slice(0, 12)).slice(0, 10)
        : [],
      summary: String(p.summary ?? "").slice(0, 600),
    };
  } catch (e) {
    console.warn("[yt-release-review] failed", (e as Error).message);
    return null;
  }
}

/** Reputation impact = reach x negativity x misleading-information signals. */
export function scoreReputationImpact(opts: {
  intel: ReleaseReviewIntel;
  video: YtVideo;
  sameDayRelease: boolean;
}): { score: number; impact: ReputationImpact } {
  const views = opts.video.viewCount ?? 0;
  let reach = 0;
  if (views >= 1_000_000) reach = 40;
  else if (views >= 250_000) reach = 32;
  else if (views >= 50_000) reach = 22;
  else if (views >= 10_000) reach = 12;
  else reach = 5;

  const negativity =
    opts.intel.sentiment === "negative"
      ? Math.min(30, Math.round(Math.abs(opts.intel.sentimentScore) * 0.3))
      : 0;

  const misleading = Math.min(25, opts.intel.misleadingSignals.length * 9);
  const claims = Math.min(
    10,
    opts.intel.keyStatements.filter(
      (s) => s.kind === "misleading" || s.kind === "fact_claim" || s.kind === "exaggerated",
    ).length * 4,
  );
  const timing = opts.sameDayRelease ? 8 : 0;

  const score = Math.max(0, Math.min(100, reach + negativity + misleading + claims + timing));
  const highReach = views >= 100_000;
  const impact: ReputationImpact =
    highReach && negativity > 0 && (misleading > 0 || score >= 75)
      ? "high"
      : negativity > 0 || misleading > 0
        ? "medium"
        : "low";
  return { score, impact };
}

/** Discovery queries focused on release-window reviews and reaction videos. */
export function buildReleaseReviewQueries(meta: {
  title: string;
  altTitles?: string[];
  actors?: string[];
  language?: string | null;
}): string[] {
  const names = [
    ...new Set(
      [meta.title, ...(meta.altTitles ?? [])].map((t) => (t ?? "").trim()).filter(Boolean),
    ),
  ].slice(0, 3);
  const kws = [
    ...KEYWORDS,
    "public review",
    "audience review",
    "honest review",
    "first day first show",
    "early review",
    "premiere review",
    "critic review",
    "spoiler review",
  ];
  const queries: string[] = [];
  const push = (q: string) => {
    if (q.trim() && !queries.includes(q)) queries.push(q);
  };
  for (const name of names) {
    for (const kw of kws) push(`"${name}" ${kw}`);
    if (meta.language) {
      push(`"${name}" ${meta.language} review`);
      push(`"${name}" ${meta.language} reaction`);
    }
  }
  for (const actor of (meta.actors ?? []).slice(0, 2))
    push(`"${names[0] ?? meta.title}" ${actor} review`);
  return queries.slice(0, 20);
}
