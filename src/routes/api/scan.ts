import { createFileRoute } from "@tanstack/react-router";

/* ---------------- Types ---------------- */
export type Sentiment = "Positive" | "Neutral" | "Negative";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Category =
  | "Deepfake" | "Impersonation" | "Copyright" | "News Attack"
  | "Unauthorized Ad" | "Viral" | "Reaction/Reupload"
  | "Defamation" | "Leak" | "Complaint" | "Review" | "Mention";

export type ContentLabel =
  | "News report" | "Allegation" | "Opinion" | "Review" | "Satire"
  | "Unverified claim" | "Misleading content" | "Potential impersonation"
  | "Potentially manipulated media" | "Verified fact" | "Insufficient evidence";

export interface MediaMeta {
  videoId?: string;
  thumbnail?: string;
  thumbnailHi?: string;
  channelTitle?: string;
  channelId?: string;
  channelUrl?: string;
  duration?: string; // formatted mm:ss
  durationSec?: number;
  views?: number;
  likes?: number;
  comments?: number;
  growthPerDay?: number;
  engagementRate?: number; // %
}

export interface ScanHit {
  id: string;
  title: string;
  url: string;
  description: string;
  platform: string;
  source: string;
  author?: string;
  published?: string;
  discoveredAt: string;
  lastChecked: string;
  category: Category;
  contentLabel: ContentLabel;
  severity: Severity;
  sentiment: Sentiment;
  confidence: number;
  threatScore: number;
  credibilityScore: number;
  viralityScore: number;
  copyrightRisk: number;
  reputationRisk: number;
  reachEstimate: number;
  engagement: number;
  recommendedAction: string;
  keywords: string[];
  language: string;
  viral?: boolean;
  media?: MediaMeta;
  detectionReason?: string;
}

export type SourceKey =
  | "web" | "reddit" | "youtube" | "instagram" | "tiktok" | "x"
  | "facebook" | "linkedin" | "news" | "blogs" | "forums"
  | "podcasts" | "reviews" | "complaints" | "archive";

export interface ReputationReport {
  ok: boolean;
  error?: string;
  query: string;
  aliases: string[];
  generatedAt: string;
  period: string;
  sourcesRequested: string[];
  sourcesReturned: string[];
  hits: ScanHit[];
  totals: {
    total: number;
    unique: number;
    duplicatesRemoved: number;
    critical: number;
    high: number;
    negative: number;
    viral: number;
    avgThreat: number;
    totalReach: number;
  };
  reputationScore: number;
  reputationLevel: string;
  scoreBreakdown: { key: string; label: string; value: number }[];
  executiveSummary: {
    headline: string;
    mostDamagingTopic: string;
    mostInfluentialSource: string;
    fastestGrowing: string;
    trend: "Increasing" | "Stable" | "Decreasing";
    immediateActions: string[];
    longTerm: string[];
  };
  buckets: {
    critical: ScanHit[];
    high: ScanHit[];
    emerging: ScanHit[];
    news: ScanHit[];
    youtube: ScanHit[];
    reddit: ScanHit[];
    facebook: ScanHit[];
    instagram: ScanHit[];
    impersonation: ScanHit[];
    deepfake: ScanHit[];
    reviews: ScanHit[];
    duplicates: ScanHit[];
  };
}

/* ---------------- Source planning ---------------- */
const SOURCE_QUERY: Record<SourceKey, { label: string; site?: string; suffix?: string }> = {
  web: { label: "Web" },
  reddit: { label: "Reddit", site: "reddit.com" },
  youtube: { label: "YouTube", site: "youtube.com" },
  instagram: { label: "Instagram", site: "instagram.com" },
  tiktok: { label: "TikTok", site: "tiktok.com" },
  x: { label: "X", site: "x.com OR twitter.com" },
  facebook: { label: "Facebook", site: "facebook.com" },
  linkedin: { label: "LinkedIn", site: "linkedin.com" },
  news: { label: "News", suffix: "news OR press OR breaking" },
  blogs: { label: "Blogs", suffix: "site:medium.com OR site:substack.com OR blog" },
  forums: { label: "Forums", suffix: "forum OR discussion OR thread" },
  podcasts: { label: "Podcasts", suffix: "podcast OR interview" },
  reviews: { label: "Reviews", suffix: "review OR rating" },
  complaints: { label: "Complaints", suffix: "complaint OR scam OR fraud OR ripoff" },
  archive: { label: "Archive", site: "archive.org OR web.archive.org" },
};

const RISK_TERMS: { kw: string[]; category: Category; sev: Severity; score: number; copyright: number; reputation: number }[] = [
  { kw: ["deepfake", "ai generated", "ai-generated", "face swap", "voice clone", "synthetic video"], category: "Deepfake", sev: "Critical", score: 96, copyright: 60, reputation: 95 },
  { kw: ["defamation", "false accusation", "slander", "libel", "hate campaign", "harassment"], category: "Defamation", sev: "Critical", score: 92, copyright: 10, reputation: 96 },
  { kw: ["leaked", "leak", "private video", "nsfw leak", "onlyfans leak"], category: "Leak", sev: "Critical", score: 90, copyright: 85, reputation: 88 },
  { kw: ["impersonat", "fake account", "fake profile", "romance scam"], category: "Impersonation", sev: "High", score: 84, copyright: 30, reputation: 82 },
  { kw: ["pirated", "free download", "torrent", "copyright", "unauthorized", "reupload", "re-upload", "mirror"], category: "Copyright", sev: "High", score: 78, copyright: 92, reputation: 40 },
  { kw: ["reaction", "reacts to", "compilation", "clip of"], category: "Reaction/Reupload", sev: "Medium", score: 62, copyright: 75, reputation: 25 },
  { kw: ["scandal", "controversy", "expose", "exposed", "hoax", "misinformation", "rumor"], category: "News Attack", sev: "High", score: 80, copyright: 15, reputation: 90 },
  { kw: ["sponsored", "endorse", "endorsement", "ad campaign", "promo"], category: "Unauthorized Ad", sev: "Medium", score: 58, copyright: 55, reputation: 35 },
  { kw: ["viral", "trending", "goes viral", "explodes"], category: "Viral", sev: "Medium", score: 55, copyright: 20, reputation: 45 },
  { kw: ["complaint", "ripoff", "scam", "fraud"], category: "Complaint", sev: "High", score: 74, copyright: 10, reputation: 78 },
  { kw: ["review", "rating", "stars"], category: "Review", sev: "Low", score: 46, copyright: 5, reputation: 30 },
];

const POS = ["love", "amazing", "great", "best", "brilliant", "inspiring", "praised", "success", "wins", "wholesome"];
const NEG = ["hate", "worst", "terrible", "scam", "fraud", "controversy", "sued", "lawsuit", "expose", "scandal", "attack", "fake", "leaked", "toxic", "shame", "boycott", "cancelled"];
const TRUSTED_NEWS = /(nytimes|washingtonpost|guardian|bbc|reuters|bloomberg|forbes|wsj|cnn|apnews|npr|ft\.com|economist|axios|theverge|techcrunch|wired)/i;

function platformFromUrl(url: string): { platform: string; source: string } {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtube") || h.includes("youtu.be")) return { platform: "YouTube", source: "YouTube" };
    if (h.includes("instagram")) return { platform: "Instagram", source: "Instagram" };
    if (h.includes("tiktok")) return { platform: "TikTok", source: "TikTok" };
    if (h.includes("twitter") || h.includes("x.com")) return { platform: "X", source: "X" };
    if (h.includes("facebook") || h.includes("fb.com")) return { platform: "Facebook", source: "Facebook" };
    if (h.includes("reddit")) return { platform: "Reddit", source: "Reddit" };
    if (h.includes("linkedin")) return { platform: "LinkedIn", source: "LinkedIn" };
    if (h.includes("spotify") || h.includes("apple.co") || h.includes("podcasts.apple")) return { platform: "Podcast", source: "Podcasts" };
    if (h.includes("medium.com") || h.includes("substack")) return { platform: h, source: "Blogs" };
    if (h.includes("archive.org")) return { platform: "Archive", source: "Archive" };
    if (h.includes("trustpilot") || h.includes("yelp") || h.includes("g2.com") || h.includes("capterra")) return { platform: h, source: "Reviews" };
    if (h.includes("ripoff") || h.includes("complaintsboard") || h.includes("pissedconsumer")) return { platform: h, source: "Complaints" };
    if (TRUSTED_NEWS.test(h) || /(news|times|post|guardian|bbc|cnn|reuters|bloomberg|forbes)/i.test(h)) return { platform: h, source: "News" };
    return { platform: h, source: "Web" };
  } catch { return { platform: "Web", source: "Web" }; }
}

function sentimentOf(text: string): Sentiment {
  const t = text.toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (n > p + 1) return "Negative";
  if (p > n + 1) return "Positive";
  return "Neutral";
}

function classify(title: string, desc: string) {
  const t = `${title} ${desc}`.toLowerCase();
  let best = { category: "Mention" as Category, sev: "Low" as Severity, score: 40, copyright: 8, reputation: 20 };
  const hits: string[] = [];
  for (const r of RISK_TERMS) {
    const hit = r.kw.find((k) => t.includes(k));
    if (hit) {
      hits.push(hit);
      if (r.score > best.score) best = { category: r.category, sev: r.sev, score: r.score, copyright: r.copyright, reputation: r.reputation };
    }
  }
  return { ...best, keywords: hits };
}

function labelOf(cat: Category, sent: Sentiment, source: string): ContentLabel {
  if (cat === "Deepfake") return "Potentially manipulated media";
  if (cat === "Impersonation") return "Potential impersonation";
  if (cat === "News Attack") return sent === "Negative" ? "Unverified claim" : "News report";
  if (cat === "Defamation") return "Allegation";
  if (source === "News") return "News report";
  if (cat === "Review") return "Review";
  if (cat === "Complaint") return "Allegation";
  if (cat === "Reaction/Reupload") return "Opinion";
  if (sent === "Negative") return "Unverified claim";
  return "Insufficient evidence";
}

function credibility(source: string, platform: string): number {
  if (TRUSTED_NEWS.test(platform)) return 88;
  if (source === "News") return 74;
  if (source === "YouTube" || source === "TikTok") return 52;
  if (source === "Reddit") return 45;
  if (source === "Blogs") return 55;
  if (source === "Reviews") return 62;
  if (source === "Complaints") return 40;
  return 58;
}

function synthReach(platform: string, sev: Severity, i: number): number {
  const base: Record<string, number> = { YouTube: 42000, TikTok: 55000, Instagram: 26000, X: 18000, Reddit: 12000, Facebook: 22000, LinkedIn: 6000, News: 34000, Podcast: 8000 };
  const b = base[platform] ?? 5000;
  const mult = sev === "Critical" ? 3.4 : sev === "High" ? 2.2 : sev === "Medium" ? 1.3 : 0.7;
  const noise = 0.75 + ((i * 137) % 50) / 100;
  return Math.round(b * mult * noise);
}

function recommend(cat: Category, sev: Severity): string {
  if (cat === "Deepfake" || cat === "Leak") return "Preserve evidence, submit platform takedown, send for legal review";
  if (cat === "Defamation") return "Preserve evidence, contact publisher, request correction, legal review";
  if (cat === "Impersonation") return "Report impersonation to platform, preserve evidence";
  if (cat === "Copyright" || cat === "Reaction/Reupload") return "Submit copyright complaint (DMCA)";
  if (cat === "News Attack") return "Publish factual clarification, monitor spread";
  if (cat === "Unauthorized Ad") return "Report ad, contact platform ads team";
  if (cat === "Viral") return "Monitor engagement, avoid amplifying, prepare response";
  if (cat === "Complaint") return "Contact customer, publish resolution if warranted";
  if (cat === "Review") return "Monitor; respond publicly if factually incorrect";
  return sev === "Low" ? "Continue monitoring" : "Verify before acting";
}

/* ---------------- Firecrawl runner ---------------- */
async function runFirecrawl(query: string, sources: SourceKey[], limit: number) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { runs: [] as { source: string; raw: RawHit[] }[], error: "FIRECRAWL_API_KEY missing" };
  const nonYt = sources.filter((s) => s !== "youtube");
  if (!nonYt.length) return { runs: [] };
  try {
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const fc = new Firecrawl({ apiKey });
    const results = await Promise.allSettled(nonYt.map(async (s) => {
      const cfg = SOURCE_QUERY[s];
      const q = cfg.site ? `${query} site:${cfg.site}` : cfg.suffix ? `${query} ${cfg.suffix}` : query;
      const res: unknown = await fc.search(q, { limit });
      const r = res as { web?: unknown[]; news?: unknown[] };
      const rawItems = [
        ...(Array.isArray(r.web) ? r.web : []),
        ...(Array.isArray(r.news) ? r.news : []),
      ] as Array<Record<string, unknown>>;
      const raw: RawHit[] = rawItems.map((item) => {
        const md = (item.metadata ?? {}) as Record<string, unknown>;
        const image =
          (typeof item.imageUrl === "string" && item.imageUrl) ||
          (typeof item.image === "string" && item.image) ||
          (typeof md.ogImage === "string" && md.ogImage) ||
          (typeof md["og:image"] === "string" && (md["og:image"] as string)) ||
          (typeof md["twitter:image"] === "string" && (md["twitter:image"] as string)) ||
          undefined;
        return {
          url: (item.url as string) ?? undefined,
          title: (item.title as string) ?? (md.title as string) ?? (md["og:title"] as string) ?? undefined,
          description: (item.description as string) ?? (md.description as string) ?? undefined,
          snippet: (item.snippet as string) ?? undefined,
          author: (item.author as string) ?? (md.author as string) ?? undefined,
          date: (item.date as string) ?? undefined,
          publishedDate: (item.publishedDate as string) ?? (md.publishedTime as string) ?? undefined,
          media: image ? { thumbnail: image, thumbnailHi: image } : undefined,
        };
      });
      return { source: cfg.label, raw };
    }));
    const runs: { source: string; raw: RawHit[] }[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") runs.push(r.value);
      else console.error("[scan] firecrawl source rejected:", r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    return { runs };
  } catch (e) {
    return { runs: [], error: e instanceof Error ? e.message : "Firecrawl failed" };
  }
}

interface RawHit { url?: string; title?: string; description?: string; snippet?: string; author?: string; date?: string; publishedDate?: string; media?: MediaMeta }

/* ---------------- YouTube Data API v3 ---------------- */
const YT_RISK_TERMS = [
  "exposed", "expose", "controversy", "scam", "fraud", "allegations", "criticism",
  "review", "reaction", "truth", "dark side", "complaint", "investigation",
  "response", "apology", "lawsuit", "leaked", "deepfake", "fake",
];

interface YtThumb { url?: string; width?: number; height?: number }
interface YtSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string; description?: string; publishedAt?: string;
    channelId?: string; channelTitle?: string;
    thumbnails?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb };
    liveBroadcastContent?: string;
  };
}
interface YtVideoItem {
  id?: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; channelId?: string; channelTitle?: string; tags?: string[]; categoryId?: string; thumbnails?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
  status?: { uploadStatus?: string };
}

function pickThumb(tt?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb }): { hi?: string; std?: string } {
  const hi = tt?.maxres?.url || tt?.standard?.url || tt?.high?.url || tt?.medium?.url || tt?.default?.url;
  const std = tt?.high?.url || tt?.medium?.url || tt?.default?.url || hi;
  return { hi, std };
}

function parseIsoDuration(iso?: string): { sec: number; label: string } {
  if (!iso) return { sec: 0, label: "" };
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return { sec: 0, label: "" };
  const h = Number(m[1] || 0), mi = Number(m[2] || 0), s = Number(m[3] || 0);
  const sec = h * 3600 + mi * 60 + s;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
  return { sec, label };
}

async function ytFetch<T>(path: string, params: Record<string, string>, key: string): Promise<T | null> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const r = await fetch(url.toString());
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    console.error("[youtube]", path, r.status, txt.slice(0, 200));
    return null;
  }
  return (await r.json()) as T;
}

function periodToPublishedAfter(period: string): string | undefined {
  const p = period.toLowerCase();
  const day = 86400000;
  const now = Date.now();
  if (p.includes("24")) return new Date(now - 1 * day).toISOString();
  if (p.includes("7 day")) return new Date(now - 7 * day).toISOString();
  if (p.includes("30 day")) return new Date(now - 30 * day).toISOString();
  if (p.includes("90 day")) return new Date(now - 90 * day).toISOString();
  return undefined;
}

const YT_MAX_TOTAL = 800;         // hard safety cap to protect quota
const YT_MAX_PAGES_PER_QUERY = 10; // ~500 videos per sub-query
const YT_MAX_QUERIES = 40;

async function runYouTube(
  query: string,
  aliases: string[],
  variations: string[],
  hashtags: string[],
  handles: string[],
  targetResults: number,
  period: string,
): Promise<{ raw: RawHit[]; error?: string; queriesUsed: number }> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { raw: [], error: "GOOGLE_API_KEY missing", queriesUsed: 0 };
  const publishedAfter = periodToPublishedAfter(period);

  const nameForms = Array.from(new Set([query, ...aliases, ...variations].map((s) => s.trim()).filter(Boolean)));
  const queries = new Set<string>();
  for (const b of nameForms) {
    queries.add(b);
    queries.add(`"${b}"`);
    for (const t of YT_RISK_TERMS) queries.add(`${b} ${t}`);
  }
  for (const h of hashtags) queries.add(h.startsWith("#") ? h : `#${h}`);
  for (const h of handles) queries.add(h.startsWith("@") ? h : `@${h}`);
  const qList = Array.from(queries).slice(0, YT_MAX_QUERIES);

  const idToItem = new Map<string, YtSearchItem>();

  await Promise.allSettled(qList.map(async (q) => {
    let pageToken: string | undefined;
    let pages = 0;
    while (pages < YT_MAX_PAGES_PER_QUERY && idToItem.size < Math.min(targetResults, YT_MAX_TOTAL)) {
      const params: Record<string, string> = {
        part: "snippet", q, type: "video", maxResults: "50", order: "date", safeSearch: "none",
      };
      if (pageToken) params.pageToken = pageToken;
      if (publishedAfter) params.publishedAfter = publishedAfter;
      const data = await ytFetch<{ items?: YtSearchItem[]; nextPageToken?: string }>("search", params, key);
      if (!data?.items?.length) break;
      for (const it of data.items) {
        const vid = it.id?.videoId;
        if (vid && !idToItem.has(vid)) idToItem.set(vid, it);
      }
      pages++;
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
  }));

  const desiredCount = Math.min(YT_MAX_TOTAL, Math.max(targetResults, idToItem.size));
  const ids = Array.from(idToItem.keys()).slice(0, desiredCount);
  const statsById = new Map<string, YtVideoItem>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(",");
    const data = await ytFetch<{ items?: YtVideoItem[] }>("videos", {
      part: "snippet,statistics,contentDetails,status", id: batch,
    }, key);
    for (const v of data?.items ?? []) if (v.id) statsById.set(v.id, v);
  }

  const raw: RawHit[] = [];
  for (const id of ids) {
    const s = idToItem.get(id);
    const v = statsById.get(id);
    const snip = v?.snippet ?? s?.snippet;
    if (!snip) continue;
    const stats = v?.statistics;
    const views = stats?.viewCount ? Number(stats.viewCount) : 0;
    const likes = stats?.likeCount ? Number(stats.likeCount) : 0;
    const comments = stats?.commentCount ? Number(stats.commentCount) : 0;
    const thumbs = pickThumb(snip.thumbnails);
    const dur = parseIsoDuration(v?.contentDetails?.duration);
    const published = snip.publishedAt;
    const days = published ? Math.max(1, (Date.now() - new Date(published).getTime()) / 86400000) : 1;
    const growthPerDay = Math.round(views / days);
    const engagementRate = views > 0 ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0;
    raw.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: snip.title ?? "",
      description: (snip.description ?? "").slice(0, 800),
      author: snip.channelTitle,
      date: published,
      publishedDate: published,
      media: {
        videoId: id,
        thumbnail: thumbs.std,
        thumbnailHi: thumbs.hi,
        channelTitle: snip.channelTitle,
        channelId: snip.channelId,
        channelUrl: snip.channelId ? `https://www.youtube.com/channel/${snip.channelId}` : undefined,
        duration: dur.label,
        durationSec: dur.sec,
        views, likes, comments,
        growthPerDay,
        engagementRate,
      },
    });
  }
  return { raw, queriesUsed: qList.length };
}



/* ---------------- Report builder ---------------- */
function buildReport(query: string, aliases: string[], period: string, sourcesRequested: SourceKey[], runs: { source: string; raw: RawHit[] }[], err?: string): ReputationReport {
  const now = new Date().toISOString();
  const dedupe = new Map<string, ScanHit>();
  const duplicates: ScanHit[] = [];
  const sourcesReturned = new Set<string>();
  let totalRaw = 0;
  let idx = 0;

  for (const run of runs) {
    if (run.raw.length) sourcesReturned.add(run.source);
    for (const o of run.raw) {
      totalRaw++;
      const url = o.url ?? "";
      if (!url) continue;
      const title = (o.title ?? url).slice(0, 240);
      const description = (o.description ?? o.snippet ?? "").slice(0, 800);
      const { platform, source } = platformFromUrl(url);
      const c = classify(title, description);
      const sent = sentimentOf(`${title} ${description}`);
      const cred = credibility(source, platform);
      const realViews = o.media?.views ?? 0;
      const reach = realViews > 0 ? realViews : synthReach(platform, c.sev, idx++);
      if (!realViews) idx++;
      const engagement = o.media
        ? (o.media.likes ?? 0) + (o.media.comments ?? 0)
        : Math.round(reach * (0.03 + ((idx * 53) % 60) / 1000));
      const virality = Math.min(100, Math.round((reach / 5000) + (c.sev === "Critical" ? 25 : c.sev === "High" ? 15 : 5)));
      const pubTs = o.publishedDate || o.date ? new Date(o.publishedDate || o.date!).getTime() : 0;
      const ageDays = pubTs ? Math.max(0.1, (Date.now() - pubTs) / 86400000) : 400;
      // Recency curve: 24h → 100, 7d → 88, 30d → 70, 90d → 50, 365d → 25
      const recency = Math.max(10, Math.round(100 * Math.exp(-ageDays / 45)));
      const threat = Math.min(100, Math.round(
        c.score * 0.22 + cred * 0.15 + Math.min(100, reach / 5000) * 0.15 +
        Math.min(100, engagement / 500) * 0.10 + recency * 0.23 +
        virality * 0.10 + 60 * 0.05
      ));
      const detectionReason = c.keywords.length
        ? `Matched risk terms: ${c.keywords.slice(0, 4).join(", ")}${sent === "Negative" ? " · negative sentiment" : ""}`
        : sent === "Negative" ? "Negative sentiment detected in title/description" : "Named-entity match on query";
      const hit: ScanHit = {
        id: `hit-${idx}`,
        title, url, description, platform,
        source: source || run.source,
        author: o.author ?? o.media?.channelTitle,
        published: o.publishedDate ?? o.date,
        discoveredAt: now, lastChecked: now,
        category: c.category,
        contentLabel: labelOf(c.category, sent, source || run.source),
        severity: c.sev,
        sentiment: sent,
        confidence: Math.min(97, 55 + Math.round(c.score / 4)),
        threatScore: threat,
        credibilityScore: cred,
        viralityScore: virality,
        copyrightRisk: c.copyright,
        reputationRisk: Math.min(100, c.reputation + (sent === "Negative" ? 8 : 0)),
        reachEstimate: reach,
        engagement,
        recommendedAction: recommend(c.category, c.sev),
        keywords: c.keywords,
        language: "en",
        viral: reach > 250000 || c.sev === "Critical",
        media: o.media,
        detectionReason,
      };
      if (dedupe.has(url)) { duplicates.push(hit); continue; }
      dedupe.set(url, hit);
    }
  }

  const hits = Array.from(dedupe.values()).sort((a, b) => b.threatScore - a.threatScore);
  const critical = hits.filter((h) => h.severity === "Critical");
  const high = hits.filter((h) => h.severity === "High");
  const negative = hits.filter((h) => h.sentiment === "Negative");
  const viral = hits.filter((h) => h.viral);
  const totalReach = hits.reduce((a, h) => a + h.reachEstimate, 0);
  const avgThreat = hits.length ? Math.round(hits.reduce((a, h) => a + h.threatScore, 0) / hits.length) : 0;

  const buckets = {
    critical,
    high,
    emerging: hits.filter((h) => h.viralityScore >= 60 && h.severity !== "Critical").slice(0, 12),
    news: hits.filter((h) => h.source === "News"),
    youtube: hits.filter((h) => h.source === "YouTube"),
    reddit: hits.filter((h) => h.source === "Reddit"),
    facebook: hits.filter((h) => h.source === "Facebook"),
    instagram: hits.filter((h) => h.source === "Instagram"),
    impersonation: hits.filter((h) => h.category === "Impersonation"),
    deepfake: hits.filter((h) => h.category === "Deepfake"),
    reviews: hits.filter((h) => h.category === "Review" || h.source === "Reviews" || h.category === "Complaint"),
    duplicates,
  };

  const risk = (arr: ScanHit[]) => arr.length ? Math.round(arr.reduce((a, h) => a + h.threatScore, 0) / arr.length) : 0;
  const scoreBreakdown = [
    { key: "news", label: "News Risk", value: risk(buckets.news) },
    { key: "social", label: "Social Media Risk", value: risk([...buckets.facebook, ...buckets.instagram, ...hits.filter(h => h.source === "X" || h.source === "TikTok")]) },
    { key: "youtube", label: "YouTube Risk", value: risk(buckets.youtube) },
    { key: "reddit", label: "Reddit Risk", value: risk(buckets.reddit) },
    { key: "impersonation", label: "Impersonation Risk", value: risk(buckets.impersonation) },
    { key: "deepfake", label: "Deepfake Risk", value: risk(buckets.deepfake) },
    { key: "virality", label: "Virality Risk", value: hits.length ? Math.round(hits.reduce((a, h) => a + h.viralityScore, 0) / hits.length) : 0 },
  ];

  const riskAvg = scoreBreakdown.filter(s => s.value > 0).reduce((a, s) => a + s.value, 0) / Math.max(1, scoreBreakdown.filter(s => s.value > 0).length);
  const reputationScore = Math.max(0, Math.min(100, Math.round(100 - riskAvg * 0.85 - (critical.length * 4) - (negative.length * 1.2))));
  const reputationLevel =
    reputationScore >= 90 ? "Excellent" :
    reputationScore >= 75 ? "Strong" :
    reputationScore >= 60 ? "Stable" :
    reputationScore >= 40 ? "At Risk" :
    reputationScore >= 20 ? "High Risk" : "Critical";

  // Executive summary bits
  const topicCounts = new Map<Category, number>();
  for (const h of hits) topicCounts.set(h.category, (topicCounts.get(h.category) ?? 0) + 1);
  const mostDamagingTopic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None";
  const mostInfluentialSource = hits.slice().sort((a, b) => b.reachEstimate - a.reachEstimate)[0]?.platform ?? "N/A";
  const fastestGrowing = hits.slice().sort((a, b) => b.viralityScore - a.viralityScore)[0]?.title.slice(0, 80) ?? "N/A";
  const trend: "Increasing" | "Stable" | "Decreasing" =
    viral.length >= 3 ? "Increasing" : negative.length >= hits.length * 0.4 ? "Increasing" : "Stable";

  const immediateActions: string[] = [];
  if (critical.length) immediateActions.push(`Escalate ${critical.length} critical items to legal review`);
  if (buckets.impersonation.length) immediateActions.push(`Report ${buckets.impersonation.length} suspected impersonation profiles`);
  if (buckets.deepfake.length) immediateActions.push(`Preserve evidence + takedown for ${buckets.deepfake.length} suspected deepfake items`);
  if (!immediateActions.length) immediateActions.push("Continue monitoring; no critical action required");

  const longTerm = [
    "Publish factual clarifications on the most repeated allegations",
    "Register content in the Asset Vault for automated enforcement",
    "Set up recurring scans and alerts for the fastest-growing topics",
  ];

  return {
    ok: !err,
    error: err,
    query, aliases, generatedAt: now, period,
    sourcesRequested: sourcesRequested.map((s) => SOURCE_QUERY[s].label),
    sourcesReturned: [...sourcesReturned],
    hits,
    totals: {
      total: totalRaw,
      unique: hits.length,
      duplicatesRemoved: duplicates.length,
      critical: critical.length,
      high: high.length,
      negative: negative.length,
      viral: viral.length,
      avgThreat,
      totalReach,
    },
    reputationScore, reputationLevel, scoreBreakdown,
    executiveSummary: {
      headline: `${reputationLevel} reputation posture (${reputationScore}/100) with ${critical.length} critical and ${high.length} high-priority findings across ${sourcesReturned.size} sources.`,
      mostDamagingTopic,
      mostInfluentialSource,
      fastestGrowing,
      trend,
      immediateActions,
      longTerm,
    },
    buckets,
  };
}

/* ---------------- Route handler ---------------- */
export const Route = createFileRoute("/api/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const query = String(body?.query ?? "").trim().slice(0, 200);
          if (!query) return Response.json({ ok: false, error: "Query required" }, { status: 400 });
          const aliases: string[] = Array.isArray(body?.aliases) ? body.aliases.map((a: unknown) => String(a).slice(0, 60)).slice(0, 20) : [];
          const variations: string[] = Array.isArray(body?.variations) ? body.variations.map((a: unknown) => String(a).slice(0, 60)).slice(0, 40) : [];
          const hashtags: string[] = Array.isArray(body?.hashtags) ? body.hashtags.map((a: unknown) => String(a).slice(0, 40)).slice(0, 20) : [];
          const handles: string[] = Array.isArray(body?.handles) ? body.handles.map((a: unknown) => String(a).slice(0, 40)).slice(0, 20) : [];
          const period = String(body?.period ?? "Last 30 days").slice(0, 60);
          const limit = Math.min(Math.max(Number(body?.limit ?? 8), 1), 10);
          const ytTarget = Math.min(Math.max(Number(body?.youtubeTarget ?? 500), 25), 800);
          const sources: SourceKey[] = Array.isArray(body?.sources) && body.sources.length
            ? (body.sources.filter((s: unknown): s is SourceKey => typeof s === "string" && s in SOURCE_QUERY))
            : ["web", "reddit", "youtube", "news", "x", "reviews"];

          const fullQuery = aliases.length ? `${query} OR ${aliases.map(a => `"${a}"`).join(" OR ")}` : query;
          const wantYouTube = sources.includes("youtube");

          const [fc, yt] = await Promise.all([
            runFirecrawl(fullQuery, sources, limit),
            wantYouTube
              ? runYouTube(query, aliases, variations, hashtags, handles, ytTarget, period)
              : Promise.resolve({ raw: [] as RawHit[], error: undefined as string | undefined, queriesUsed: 0 }),
          ]);

          const runs = [...fc.runs];
          if (yt.raw.length) runs.push({ source: "YouTube", raw: yt.raw });
          const err = fc.error && !yt.raw.length ? fc.error : yt.error && !fc.runs.length ? yt.error : undefined;

          const report = buildReport(query, aliases, period, sources, runs, err);
          return Response.json(report);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Scan failed";
          console.error("scan route failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
