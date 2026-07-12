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
  | "Potentially manipulated media" | "Verified fact" | "Insufficient evidence"
  | "Potentially harmful" | "Negative commentary" | "Critical review"
  | "Complaint" | "Neutral mention" | "Positive mention";

export type ScanMode = "quick" | "deep" | "investigation";

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
  queryUsed: string;
  viral?: boolean;
}

export type SourceKey =
  | "web" | "reddit" | "youtube" | "instagram" | "tiktok" | "x"
  | "facebook" | "linkedin" | "news" | "blogs" | "forums"
  | "podcasts" | "reviews" | "complaints" | "archive";

export interface PlatformStat {
  key: SourceKey;
  label: string;
  target: number;
  fetched: number;
  unique: number;
  queriesRun: number;
  status: "ok" | "partial" | "failed" | "empty";
  error?: string;
}

export interface ReputationReport {
  ok: boolean;
  error?: string;
  query: string;
  aliases: string[];
  mode: ScanMode;
  generatedAt: string;
  period: string;
  sourcesRequested: string[];
  sourcesReturned: string[];
  platformStats: PlatformStat[];
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
    tiktok: ScanHit[];
    x: ScanHit[];
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
  news: { label: "News", suffix: "news OR press OR breaking OR reported" },
  blogs: { label: "Blogs", suffix: "site:medium.com OR site:substack.com OR blog" },
  forums: { label: "Forums", suffix: "forum OR discussion OR thread OR quora" },
  podcasts: { label: "Podcasts", suffix: "podcast OR interview OR episode" },
  reviews: { label: "Reviews", suffix: "review OR rating OR trustpilot OR yelp" },
  complaints: { label: "Complaints", suffix: "complaint OR scam OR fraud OR ripoff OR pissedconsumer" },
  archive: { label: "Archive", site: "archive.org OR web.archive.org" },
};

/* Per-mode targets and pagination knobs */
const MODE_TARGETS: Record<ScanMode, Partial<Record<SourceKey, number>> & { default: number }> = {
  quick: { default: 25 },
  deep: {
    default: 100,
    web: 200, news: 150, youtube: 150, reddit: 200, x: 100,
    instagram: 80, tiktok: 80, facebook: 80, linkedin: 60,
    blogs: 120, forums: 120, reviews: 120, complaints: 120,
    podcasts: 60, archive: 60,
  },
  investigation: {
    default: 200,
    web: 500, news: 200, youtube: 300, reddit: 300, x: 100,
    instagram: 100, tiktok: 100, facebook: 100, linkedin: 100,
    blogs: 200, forums: 200, reviews: 200, complaints: 200,
    podcasts: 100, archive: 100,
  },
};

const PAGE_SIZE = 25;

const RISK_TERMS: { kw: string[]; category: Category; sev: Severity; score: number; copyright: number; reputation: number }[] = [
  { kw: ["deepfake", "ai generated", "ai-generated", "face swap", "voice clone", "synthetic video"], category: "Deepfake", sev: "Critical", score: 96, copyright: 60, reputation: 95 },
  { kw: ["defamation", "false accusation", "slander", "libel", "hate campaign", "harassment"], category: "Defamation", sev: "Critical", score: 92, copyright: 10, reputation: 96 },
  { kw: ["leaked", "leak", "private video", "nsfw leak", "onlyfans leak"], category: "Leak", sev: "Critical", score: 90, copyright: 85, reputation: 88 },
  { kw: ["impersonat", "fake account", "fake profile", "romance scam"], category: "Impersonation", sev: "High", score: 84, copyright: 30, reputation: 82 },
  { kw: ["pirated", "free download", "torrent", "copyright", "unauthorized", "reupload", "re-upload", "mirror"], category: "Copyright", sev: "High", score: 78, copyright: 92, reputation: 40 },
  { kw: ["reaction", "reacts to", "compilation", "clip of"], category: "Reaction/Reupload", sev: "Medium", score: 62, copyright: 75, reputation: 25 },
  { kw: ["scandal", "controversy", "expose", "exposed", "hoax", "misinformation", "rumor", "allegation", "allegations"], category: "News Attack", sev: "High", score: 80, copyright: 15, reputation: 90 },
  { kw: ["sponsored", "endorse", "endorsement", "ad campaign", "promo"], category: "Unauthorized Ad", sev: "Medium", score: 58, copyright: 55, reputation: 35 },
  { kw: ["viral", "trending", "goes viral", "explodes"], category: "Viral", sev: "Medium", score: 55, copyright: 20, reputation: 45 },
  { kw: ["complaint", "ripoff", "scam", "fraud", "warning"], category: "Complaint", sev: "High", score: 74, copyright: 10, reputation: 78 },
  { kw: ["review", "rating", "stars"], category: "Review", sev: "Low", score: 46, copyright: 5, reputation: 30 },
];

const POS = ["love", "amazing", "great", "best", "brilliant", "inspiring", "praised", "success", "wins", "wholesome"];
const NEG = ["hate", "worst", "terrible", "scam", "fraud", "controversy", "sued", "lawsuit", "expose", "scandal", "attack", "fake", "leaked", "toxic", "shame", "boycott", "cancelled"];
const TRUSTED_NEWS = /(nytimes|washingtonpost|guardian|bbc|reuters|bloomberg|forbes|wsj|cnn|apnews|npr|ft\.com|economist|axios|theverge|techcrunch|wired)/i;

/* ---------------- Query expansion ---------------- */
const RISK_MODIFIERS = [
  "", "controversy", "complaint", "allegations", "scam", "fraud",
  "exposed", "criticism", "review", "lawsuit", "problem", "warning",
  "reaction", "latest news", "interview",
];

function expandQueries(name: string, aliases: string[], handles: string[], mode: ScanMode): string[] {
  const base = [name, ...aliases].filter(Boolean);
  const set = new Set<string>();
  const modifiers = mode === "quick"
    ? ["", "review", "controversy"]
    : mode === "deep"
      ? RISK_MODIFIERS
      : [...RISK_MODIFIERS, "leaked", "deepfake", "impersonation", "boycott", "cancelled"];
  for (const b of base) {
    for (const m of modifiers) set.add(m ? `"${b}" ${m}` : `"${b}"`);
  }
  for (const h of handles) set.add(`"${h}"`);
  return Array.from(set);
}

/* ---------------- Firecrawl runner ---------------- */
interface RawHit { url?: string; title?: string; description?: string; snippet?: string; author?: string; date?: string; publishedDate?: string }

async function firecrawlSearch(fc: unknown, query: string, limit: number): Promise<RawHit[]> {
  const client = fc as { search: (q: string, opts?: { limit?: number }) => Promise<unknown> };
  try {
    const res = await client.search(query, { limit });
    const r = res as { web?: unknown[]; news?: unknown[]; images?: unknown[]; data?: unknown[] };
    return [
      ...(Array.isArray(r.web) ? r.web : []),
      ...(Array.isArray(r.news) ? r.news : []),
      ...(Array.isArray(r.data) ? r.data : []),
    ] as RawHit[];
  } catch (e) {
    console.error("[scan] firecrawl error:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function runSource(
  fc: unknown,
  source: SourceKey,
  queries: string[],
  target: number,
  maxQueries: number,
): Promise<{ raw: RawHit[]; queriesRun: number; error?: string }> {
  const cfg = SOURCE_QUERY[source];
  const seen = new Set<string>();
  const out: RawHit[] = [];
  let queriesRun = 0;
  let noNewStreak = 0;
  const qs = queries.slice(0, maxQueries);
  for (const q of qs) {
    if (out.length >= target) break;
    if (noNewStreak >= 3) break;
    const full = cfg.site ? `${q} site:${cfg.site}` : cfg.suffix ? `${q} ${cfg.suffix}` : q;
    const remaining = target - out.length;
    const pageLimit = Math.min(50, Math.max(PAGE_SIZE, remaining));
    const raw = await firecrawlSearch(fc, full, pageLimit);
    queriesRun++;
    let added = 0;
    for (const r of raw) {
      const url = r.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      (r as RawHit & { _q?: string })._q = full;
      out.push(r);
      added++;
      if (out.length >= target) break;
    }
    if (added === 0) noNewStreak++; else noNewStreak = 0;
  }
  return { raw: out, queriesRun };
}

async function runScan(
  queries: string[],
  sources: SourceKey[],
  mode: ScanMode,
): Promise<{ runs: { source: SourceKey; raw: RawHit[]; queriesRun: number; error?: string }[]; error?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { runs: [], error: "FIRECRAWL_API_KEY missing" };
  const { default: Firecrawl } = await import("@mendable/firecrawl-js");
  const fc = new Firecrawl({ apiKey });
  const targets = MODE_TARGETS[mode];
  const maxQueries = mode === "quick" ? 2 : mode === "deep" ? 8 : 14;

  // controlled concurrency: 4 sources at a time
  const CONC = 4;
  const results: { source: SourceKey; raw: RawHit[]; queriesRun: number; error?: string }[] = [];
  for (let i = 0; i < sources.length; i += CONC) {
    const chunk = sources.slice(i, i + CONC);
    const chunkRes = await Promise.allSettled(chunk.map(async (s) => {
      const target = (targets as Record<string, number>)[s] ?? targets.default;
      const r = await runSource(fc, s, queries, target, maxQueries);
      return { source: s, ...r };
    }));
    for (let j = 0; j < chunkRes.length; j++) {
      const r = chunkRes[j];
      if (r.status === "fulfilled") results.push(r.value);
      else results.push({ source: chunk[j], raw: [], queriesRun: 0, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    }
  }
  return { runs: results };
}

/* ---------------- Classification helpers ---------------- */
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
  if (cat === "News Attack") return sent === "Negative" ? "Potentially harmful" : "News report";
  if (cat === "Defamation") return "Allegation";
  if (source === "News") return "News report";
  if (cat === "Review") return sent === "Negative" ? "Critical review" : "Review";
  if (cat === "Complaint") return "Complaint";
  if (cat === "Reaction/Reupload") return "Opinion";
  if (sent === "Negative") return "Negative commentary";
  if (sent === "Positive") return "Positive mention";
  return "Neutral mention";
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

/* ---------------- Report builder ---------------- */
function buildReport(
  query: string,
  aliases: string[],
  mode: ScanMode,
  period: string,
  sourcesRequested: SourceKey[],
  runs: { source: SourceKey; raw: RawHit[]; queriesRun: number; error?: string }[],
  err?: string,
): ReputationReport {
  const now = new Date().toISOString();
  const dedupe = new Map<string, ScanHit>();
  const duplicates: ScanHit[] = [];
  const sourcesReturned = new Set<string>();
  const platformStats: PlatformStat[] = [];
  const targets = MODE_TARGETS[mode];
  let totalRaw = 0;
  let idx = 0;

  for (const run of runs) {
    const cfg = SOURCE_QUERY[run.source];
    const target = (targets as Record<string, number>)[run.source] ?? targets.default;
    let uniqueForSource = 0;
    for (const o of run.raw) {
      totalRaw++;
      const url = o.url ?? "";
      if (!url) continue;
      const title = (o.title ?? url).slice(0, 240);
      const description = (o.description ?? o.snippet ?? "").slice(0, 500);
      const { platform, source } = platformFromUrl(url);
      const c = classify(title, description);
      const sent = sentimentOf(`${title} ${description}`);
      const cred = credibility(source, platform);
      const reach = synthReach(platform, c.sev, idx++);
      const engagement = Math.round(reach * (0.03 + ((idx * 53) % 60) / 1000));
      const virality = Math.min(100, Math.round((reach / 1000) + (c.sev === "Critical" ? 25 : c.sev === "High" ? 15 : 5)));
      const recency = o.publishedDate || o.date ? 70 : 60;
      const threat = Math.min(100, Math.round(
        c.score * 0.25 + cred * 0.20 + Math.min(100, reach / 800) * 0.15 +
        Math.min(100, engagement / 300) * 0.10 + 65 * 0.10 + recency * 0.10 +
        virality * 0.05 + 60 * 0.05
      ));
      const hit: ScanHit = {
        id: `hit-${idx}`,
        title, url, description, platform,
        source: source || cfg.label,
        author: o.author,
        published: o.publishedDate ?? o.date,
        discoveredAt: now, lastChecked: now,
        category: c.category,
        contentLabel: labelOf(c.category, sent, source || cfg.label),
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
        queryUsed: (o as RawHit & { _q?: string })._q ?? "",
        viral: reach > 60000 || c.sev === "Critical",
      };
      if (dedupe.has(url)) { duplicates.push(hit); continue; }
      dedupe.set(url, hit);
      uniqueForSource++;
    }
    if (uniqueForSource > 0) sourcesReturned.add(cfg.label);
    platformStats.push({
      key: run.source,
      label: cfg.label,
      target,
      fetched: run.raw.length,
      unique: uniqueForSource,
      queriesRun: run.queriesRun,
      status: run.error ? "failed" : uniqueForSource === 0 ? "empty" : uniqueForSource >= target ? "ok" : "partial",
      error: run.error,
    });
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
    emerging: hits.filter((h) => h.viralityScore >= 60 && h.severity !== "Critical").slice(0, 40),
    news: hits.filter((h) => h.source === "News"),
    youtube: hits.filter((h) => h.source === "YouTube"),
    reddit: hits.filter((h) => h.source === "Reddit"),
    facebook: hits.filter((h) => h.source === "Facebook"),
    instagram: hits.filter((h) => h.source === "Instagram"),
    tiktok: hits.filter((h) => h.source === "TikTok"),
    x: hits.filter((h) => h.source === "X"),
    impersonation: hits.filter((h) => h.category === "Impersonation"),
    deepfake: hits.filter((h) => h.category === "Deepfake"),
    reviews: hits.filter((h) => h.category === "Review" || h.source === "Reviews" || h.category === "Complaint"),
    duplicates,
  };

  const risk = (arr: ScanHit[]) => arr.length ? Math.round(arr.reduce((a, h) => a + h.threatScore, 0) / arr.length) : 0;
  const scoreBreakdown = [
    { key: "news", label: "News Risk", value: risk(buckets.news) },
    { key: "social", label: "Social Media Risk", value: risk([...buckets.facebook, ...buckets.instagram, ...buckets.x, ...buckets.tiktok]) },
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
    query, aliases, mode, generatedAt: now, period,
    sourcesRequested: sourcesRequested.map((s) => SOURCE_QUERY[s].label),
    sourcesReturned: [...sourcesReturned],
    platformStats,
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
          const aliases: string[] = Array.isArray(body?.aliases) ? body.aliases.map((a: unknown) => String(a).slice(0, 60)).slice(0, 8) : [];
          const handles: string[] = Array.isArray(body?.handles) ? body.handles.map((a: unknown) => String(a).slice(0, 60)).slice(0, 8) : [];
          const period = String(body?.period ?? "Last 30 days").slice(0, 60);
          const modeRaw = String(body?.mode ?? "deep");
          const mode: ScanMode = modeRaw === "quick" || modeRaw === "investigation" ? modeRaw : "deep";
          const sources: SourceKey[] = Array.isArray(body?.sources) && body.sources.length
            ? (body.sources.filter((s: unknown): s is SourceKey => typeof s === "string" && s in SOURCE_QUERY))
            : ["web", "news", "youtube", "reddit", "x", "instagram", "tiktok", "reviews", "complaints", "forums", "blogs"];

          const queries = expandQueries(query, aliases, handles, mode);
          const { runs, error } = await runScan(queries, sources, mode);
          const report = buildReport(query, aliases, mode, period, sources, runs, error);
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
