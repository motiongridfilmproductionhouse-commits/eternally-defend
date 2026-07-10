import { createServerFn } from "@tanstack/react-start";

export type Sentiment = "Positive" | "Neutral" | "Negative";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Category =
  | "Deepfake"
  | "Impersonation"
  | "Copyright"
  | "News Attack"
  | "Unauthorized Ad"
  | "Viral"
  | "Reaction/Reupload"
  | "Defamation"
  | "Leak"
  | "Mention";

export interface ScanHit {
  title: string;
  url: string;
  description: string;
  platform: string;
  source: string; // e.g. "Reddit", "YouTube", "News", "Web"
  author?: string;
  published?: string;
  category: Category;
  severity: Severity;
  sentiment: Sentiment;
  confidence: number;      // 0-100
  riskScore: number;       // 0-100
  copyrightRisk: number;   // 0-100
  reputationRisk: number;  // 0-100
  reachEstimate: number;   // synthetic
  engagement: number;      // synthetic
  recommendedAction: string;
  screenshot?: string;
  viral?: boolean;
}

export type SourceKey =
  | "web" | "reddit" | "youtube" | "instagram" | "tiktok" | "x"
  | "facebook" | "linkedin" | "news" | "blogs" | "forums" | "podcasts" | "archive";

const SOURCE_QUERY: Record<SourceKey, { label: string; site?: string; suffix?: string }> = {
  web: { label: "Web" },
  reddit: { label: "Reddit", site: "reddit.com" },
  youtube: { label: "YouTube", site: "youtube.com" },
  instagram: { label: "Instagram", site: "instagram.com" },
  tiktok: { label: "TikTok", site: "tiktok.com" },
  x: { label: "X (Twitter)", site: "x.com OR twitter.com" },
  facebook: { label: "Facebook", site: "facebook.com" },
  linkedin: { label: "LinkedIn", site: "linkedin.com" },
  news: { label: "News", suffix: "news OR press OR breaking" },
  blogs: { label: "Blogs", suffix: "blog OR medium.com OR substack.com" },
  forums: { label: "Forums", suffix: "forum OR discussion OR thread" },
  podcasts: { label: "Podcasts", suffix: "podcast OR spotify.com OR apple.co" },
  archive: { label: "Archive", site: "archive.org OR web.archive.org" },
};

const RISK_TERMS: { kw: string[]; category: Category; sev: Severity; score: number; copyright: number; reputation: number }[] = [
  { kw: ["deepfake", "ai generated", "ai-generated", "synthetic video", "face swap"], category: "Deepfake", sev: "Critical", score: 96, copyright: 60, reputation: 95 },
  { kw: ["defamation", "false accusation", "slander", "libel", "hate campaign", "harassment", "bullying"], category: "Defamation", sev: "Critical", score: 92, copyright: 10, reputation: 96 },
  { kw: ["leaked", "leak", "private", "nsfw", "onlyfans leak"], category: "Leak", sev: "Critical", score: 90, copyright: 85, reputation: 88 },
  { kw: ["impersonat", "fake account", "fake profile", "scam profile", "romance scam"], category: "Impersonation", sev: "High", score: 84, copyright: 30, reputation: 82 },
  { kw: ["pirated", "free download", "torrent", "copyright", "unauthorized", "watermark removed", "reupload", "re-upload", "mirror"], category: "Copyright", sev: "High", score: 78, copyright: 92, reputation: 40 },
  { kw: ["reaction", "reacts to", "compilation", "clip of", "highlights"], category: "Reaction/Reupload", sev: "Medium", score: 62, copyright: 75, reputation: 25 },
  { kw: ["scandal", "controversy", "expose", "exposed", "hoax", "fake news", "misinformation", "rumor"], category: "News Attack", sev: "High", score: 80, copyright: 15, reputation: 90 },
  { kw: ["ad campaign", "sponsored", "promoted", "endorse", "endorsement"], category: "Unauthorized Ad", sev: "Medium", score: 58, copyright: 55, reputation: 35 },
  { kw: ["viral", "trending", "breaking", "explodes", "goes viral"], category: "Viral", sev: "Medium", score: 55, copyright: 20, reputation: 45 },
];

const POS = ["love", "amazing", "great", "best", "brilliant", "inspiring", "wholesome", "wins", "praised", "success"];
const NEG = ["hate", "worst", "terrible", "scam", "fraud", "controversy", "sued", "lawsuit", "expose", "scandal", "attack", "fake", "leaked", "toxic", "shame"];

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
    if (/(news|times|post|guardian|bbc|cnn|reuters|bloomberg|forbes)/i.test(h)) return { platform: h, source: "News" };
    return { platform: h, source: "Web" };
  } catch { return { platform: "Web", source: "Web" }; }
}

function sentiment(text: string): Sentiment {
  const t = text.toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (n > p + 1) return "Negative";
  if (p > n + 1) return "Positive";
  return "Neutral";
}

function classify(title: string, desc: string, platform: string) {
  const t = `${title} ${desc}`.toLowerCase();
  let best = { category: "Mention" as Category, severity: "Low" as Severity, score: 40, copyright: 10, reputation: 20, confidence: 60 };
  for (const r of RISK_TERMS) {
    if (r.kw.some((k) => t.includes(k))) {
      if (r.score > best.score) best = { category: r.category, severity: r.sev, score: r.score, copyright: r.copyright, reputation: r.reputation, confidence: Math.min(97, 60 + Math.round(r.score / 4)) };
    }
  }
  // Platform boost for video/social virality
  if (["YouTube", "TikTok", "Instagram"].includes(platform)) best.score = Math.min(100, best.score + 4);
  return best;
}

function recommendedAction(c: Category, sev: Severity): string {
  if (c === "Deepfake" || c === "Leak") return "File DMCA + emergency platform takedown";
  if (c === "Defamation") return "Issue legal notice, preserve evidence";
  if (c === "Impersonation") return "Report fake profile to platform";
  if (c === "Copyright" || c === "Reaction/Reupload") return "Send DMCA takedown";
  if (c === "News Attack") return "Draft press response, monitor spread";
  if (c === "Unauthorized Ad") return "Report ad, contact platform ads team";
  if (c === "Viral") return "Monitor engagement, prepare response";
  return sev === "Low" ? "Monitor" : "Review manually";
}

function synthReach(platform: string, sev: Severity): number {
  const base: Record<string, number> = { YouTube: 45000, TikTok: 62000, Instagram: 28000, X: 18000, Reddit: 12000, Facebook: 22000, LinkedIn: 6000, News: 34000, Podcast: 8000 };
  const b = base[platform] ?? 4000;
  const mult = sev === "Critical" ? 3.4 : sev === "High" ? 2.2 : sev === "Medium" ? 1.3 : 0.7;
  return Math.round(b * mult * (0.8 + Math.random() * 0.6));
}

interface RawHit { url?: string; title?: string; description?: string; snippet?: string; author?: string; date?: string; publishedDate?: string; screenshot?: string }

export const scanWeb = createServerFn({ method: "POST" })
  .inputValidator((data: { query: string; limit?: number; sources?: SourceKey[] }) => {
    const q = String(data?.query ?? "").trim();
    if (!q || q.length > 200) throw new Error("Query is required (1-200 chars)");
    const limit = Math.min(Math.max(Number(data?.limit ?? 8), 1), 15);
    const sources = (Array.isArray(data?.sources) && data.sources.length > 0 ? data.sources : ["web", "reddit", "youtube", "news"]) as SourceKey[];
    return { query: q, limit, sources };
  })
  .handler(async ({ data }): Promise<{ hits: ScanHit[]; error?: string; sourcesUsed: string[] }> => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return { hits: [], sourcesUsed: [], error: "FIRECRAWL_API_KEY missing" };

    try {
      const { default: Firecrawl } = await import("@mendable/firecrawl-js");
      const fc = new Firecrawl({ apiKey });

      const runs = await Promise.allSettled(data.sources.map(async (s) => {
        const cfg = SOURCE_QUERY[s];
        const q = cfg.site
          ? `${data.query} site:${cfg.site}`
          : cfg.suffix
          ? `${data.query} ${cfg.suffix}`
          : data.query;
        const res: unknown = await fc.search(q, { limit: data.limit });
        const r = res as { web?: unknown[]; data?: unknown[]; news?: unknown[] };
        const raw: unknown[] = [
          ...(Array.isArray(r.web) ? r.web : []),
          ...(Array.isArray(r.news) ? r.news : []),
          ...(Array.isArray(r.data) ? r.data : []),
        ];
        return { source: cfg.label, raw };
      }));

      const dedupe = new Map<string, ScanHit>();
      for (const run of runs) {
        if (run.status !== "fulfilled") continue;
        for (const it of run.value.raw) {
          const o = it as RawHit;
          const url = o.url ?? "";
          if (!url || dedupe.has(url)) continue;
          const title = o.title ?? url;
          const description = o.description ?? o.snippet ?? "";
          const { platform, source } = platformFromUrl(url);
          const c = classify(title, description, platform);
          const sent = sentiment(`${title} ${description}`);
          const reach = synthReach(platform, c.severity);
          const engagement = Math.round(reach * (0.02 + Math.random() * 0.08));
          const viral = reach > 60000 || c.severity === "Critical";
          dedupe.set(url, {
            title, url, description, platform,
            source: source || run.value.source,
            author: o.author,
            published: o.publishedDate ?? o.date,
            category: c.category,
            severity: c.severity,
            sentiment: sent,
            confidence: c.confidence,
            riskScore: Math.min(100, c.score + (sent === "Negative" ? 6 : 0)),
            copyrightRisk: c.copyright,
            reputationRisk: Math.min(100, c.reputation + (sent === "Negative" ? 8 : 0)),
            reachEstimate: reach,
            engagement,
            recommendedAction: recommendedAction(c.category, c.severity),
            screenshot: o.screenshot,
            viral,
          });
        }
      }

      const hits = Array.from(dedupe.values()).sort((a, b) => b.riskScore - a.riskScore);
      return { hits, sourcesUsed: data.sources.map((s) => SOURCE_QUERY[s].label) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      console.error("Firecrawl scan failed:", msg);
      return { hits: [], sourcesUsed: [], error: msg };
    }
  });
