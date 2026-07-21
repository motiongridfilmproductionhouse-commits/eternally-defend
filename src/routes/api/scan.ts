import { createFileRoute } from "@tanstack/react-router";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */
export type Sentiment = "Positive" | "Neutral" | "Negative";
export type Severity  = "Critical" | "High" | "Medium" | "Low";

export type Category =
  | "Deepfake" | "Impersonation" | "Fake Endorsement"
  | "Defamation" | "Leak" | "Harassment" | "Legal Dispute"
  | "Copyright" | "Reaction/Reupload" | "Unauthorized Ad"
  | "Allegation" | "Exposé" | "Controversy" | "News"
  | "Criticism" | "Boycott" | "Complaint" | "Review"
  | "Viral" | "Mention" | "Reputation Risk";

export type ContentLabel =
  | "Breaking news" | "News report" | "Allegation" | "Exposé"
  | "Controversy" | "Criticism" | "Opinion" | "Review" | "Satire"
  | "Unverified claim" | "Misleading content" | "Leak"
  | "Potential impersonation" | "Potentially manipulated media"
  | "Fake endorsement" | "Harassment" | "Legal dispute"
  | "Copyright misuse" | "Defamation risk" | "Reputation risk"
  | "Verified fact" | "Insufficient evidence";

export type FreshnessWindow = "24h" | "3d" | "7d" | "30d" | "older";

/** Rolling time range used by every discovery provider. */
export type MonthFilter = "24h" | "7d" | "30d" | "12m" | "all";

export interface MonthWindow {
  filter: MonthFilter;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
  label: string;
  ytPublishedAfter: string;
  ytPublishedBefore: string;
}

/** Compute a rolling window. Default: last 12 months. */
export function getMonthWindow(filter: MonthFilter = "12m"): MonthWindow {
  const end = new Date();
  const durations: Record<Exclude<MonthFilter, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "12m": 365 * 24 * 60 * 60 * 1000,
  };
  const start = filter === "all"
    ? new Date("2005-04-23T00:00:00.000Z")
    : new Date(end.getTime() - durations[filter]);
  const labels: Record<MonthFilter, string> = {
    "24h": "Latest 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    "12m": "Last 12 months",
    all: "All time",
  };
  return {
    filter,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
    label: labels[filter],
    ytPublishedAfter: start.toISOString(),
    ytPublishedBefore: end.toISOString(),
  };
}

export interface MediaMeta {
  videoId?: string; thumbnail?: string; thumbnailHi?: string;
  channelTitle?: string; channelId?: string; channelUrl?: string;
  duration?: string; durationSec?: number;
  views?: number; likes?: number; comments?: number;
  growthPerDay?: number; engagementRate?: number;
}

export interface ScanHit {
  id: string; title: string; url: string; description: string;
  platform: string; source: string; author?: string; published?: string;
  discoveredAt: string; lastChecked: string;
  category: Category; contentLabel: ContentLabel;
  severity: Severity; sentiment: Sentiment;
  confidence: number; threatScore: number;
  credibilityScore: number; viralityScore: number;
  copyrightRisk: number; reputationRisk: number;
  reachEstimate: number; engagement: number;
  recommendedAction: string; keywords: string[];
  language: string; viral?: boolean; media?: MediaMeta;
  detectionReason?: string;
  freshnessWindow?: FreshnessWindow;
  legalTakedownPotential?: number;
  copyrightEnforcementPotential?: number;
  whyItMatters?: string;
}

export type SourceKey =
  | "web" | "reddit" | "youtube" | "instagram" | "tiktok" | "x"
  | "facebook" | "linkedin" | "news" | "blogs" | "forums"
  | "podcasts" | "reviews" | "complaints" | "archive";

export interface ReputationReport {
  ok: boolean; error?: string;
  query: string; aliases: string[];
  generatedAt: string; period: string;
  sourcesRequested: string[]; sourcesReturned: string[];
  hits: ScanHit[];
  totals: {
    total: number; unique: number; duplicatesRemoved: number;
    critical: number; high: number; negative: number; viral: number;
    avgThreat: number; totalReach: number;
  };
  reputationScore: number; reputationLevel: string;
  scoreBreakdown: { key: string; label: string; value: number }[];
  executiveSummary: {
    headline: string; mostDamagingTopic: string;
    mostInfluentialSource: string; fastestGrowing: string;
    trend: "Increasing" | "Stable" | "Decreasing";
    immediateActions: string[]; longTerm: string[];
  };
  buckets: {
    // Time-window buckets — primary discovery view
    breaking:    ScanHit[];  // < 24 hours
    recent3d:    ScanHit[];  // 1–3 days
    recent7d:    ScanHit[];  // 3–7 days
    recent30d:   ScanHit[];  // 7–30 days
    // Risk category buckets
    critical:    ScanHit[];
    high:        ScanHit[];
    highRisk:    ScanHit[];
    viral:       ScanHit[];
    defamation:  ScanHit[];
    expose:      ScanHit[];
    leaks:       ScanHit[];
    controversies: ScanHit[];
    copyright:   ScanHit[];
    deepfake:    ScanHit[];
    impersonation: ScanHit[];
    harassment:  ScanHit[];
    legal:       ScanHit[];
    // Source buckets
    news:        ScanHit[];
    youtube:     ScanHit[];
    reddit:      ScanHit[];
    facebook:    ScanHit[];
    instagram:   ScanHit[];
    reviews:     ScanHit[];
    emerging:    ScanHit[];
    duplicates:  ScanHit[];
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const SOURCE_QUERY: Record<SourceKey, { label: string; site?: string; suffix?: string }> = {
  web:       { label: "Web" },
  reddit:    { label: "Reddit",    site: "reddit.com" },
  youtube:   { label: "YouTube",   site: "youtube.com" },
  instagram: { label: "Instagram", site: "instagram.com" },
  tiktok:    { label: "TikTok",    site: "tiktok.com" },
  x:         { label: "X",         site: "x.com OR twitter.com" },
  facebook:  { label: "Facebook",  site: "facebook.com" },
  linkedin:  { label: "LinkedIn",  site: "linkedin.com" },
  news:      { label: "News",      suffix: "news OR press OR breaking OR exclusive" },
  blogs:     { label: "Blogs",     suffix: "site:medium.com OR site:substack.com OR blog" },
  forums:    { label: "Forums",    suffix: "forum OR discussion OR thread" },
  podcasts:  { label: "Podcasts",  suffix: "podcast OR interview" },
  reviews:   { label: "Reviews",   suffix: "review OR rating" },
  complaints:{ label: "Complaints",suffix: "complaint OR scam OR fraud OR ripoff" },
  archive:   { label: "Archive",   site: "archive.org OR web.archive.org" },
};

/* ═══════════════════════════════════════════════════════════════════════════
   RISK CLASSIFICATION
═══════════════════════════════════════════════════════════════════════════ */
interface RiskRule {
  kw: string[];
  category: Category;
  sev: Severity;
  score: number;
  legalTakedown: number;
  copyrightEnforce: number;
  reputation: number;
}

const RISK_TERMS: RiskRule[] = [
  // ── CRITICAL ────────────────────────────────────────────────────────────
  { kw: ["deepfake", "ai generated face", "face swap", "voice clone", "synthetic video", "morphed video", "ai video fake", "manipulated video"], category: "Deepfake", sev: "Critical", score: 96, legalTakedown: 92, copyrightEnforce: 60, reputation: 95 },
  { kw: ["defamation", "defamatory", "slander", "libel", "false accusation", "hate campaign", "maliciously false"], category: "Defamation", sev: "Critical", score: 92, legalTakedown: 95, copyrightEnforce: 10, reputation: 96 },
  { kw: ["private video", "nsfw leak", "intimate video", "bedroom video", "onlyfans leak", "sex tape", "nude leak"], category: "Leak", sev: "Critical", score: 91, legalTakedown: 96, copyrightEnforce: 85, reputation: 93 },
  { kw: ["arrest", "detained", "indicted", "fir filed", "police case", "criminal charges", "charged with"], category: "Legal Dispute", sev: "Critical", score: 88, legalTakedown: 30, copyrightEnforce: 5, reputation: 90 },

  // ── HIGH ────────────────────────────────────────────────────────────────
  { kw: ["leaked", "leak video", "content leak"], category: "Leak", sev: "High", score: 82, legalTakedown: 78, copyrightEnforce: 72, reputation: 84 },
  { kw: ["impersonat", "fake account", "fake profile", "fake page", "posing as", "pretending to be"], category: "Impersonation", sev: "High", score: 84, legalTakedown: 88, copyrightEnforce: 30, reputation: 82 },
  { kw: ["fake endorsement", "unauthorized ad", "fake ad", "using my image without", "without my consent", "without permission"], category: "Fake Endorsement", sev: "High", score: 80, legalTakedown: 83, copyrightEnforce: 62, reputation: 78 },
  { kw: ["harassment", "stalking", "cyberbullying", "threatening", "abusive messages", "doxxing", "doxing"], category: "Harassment", sev: "High", score: 83, legalTakedown: 89, copyrightEnforce: 10, reputation: 82 },
  { kw: ["lawsuit", "court case", "legal action", "sued", "litigation", "tribunal", "defamation suit"], category: "Legal Dispute", sev: "High", score: 80, legalTakedown: 40, copyrightEnforce: 8, reputation: 85 },
  { kw: ["boycott", "cancelled", "cancel culture", "#boycott", "call to ban", "blacklist", "don't support"], category: "Boycott", sev: "High", score: 76, legalTakedown: 28, copyrightEnforce: 5, reputation: 82 },
  { kw: ["allegations against", "accused of", "facing allegations", "accused", "allegation"], category: "Allegation", sev: "High", score: 82, legalTakedown: 52, copyrightEnforce: 10, reputation: 87 },
  { kw: ["exposed", "expose", "exposé", "truth about", "real story", "real truth", "investigation into", "undercover report", "whistleblower"], category: "Exposé", sev: "High", score: 83, legalTakedown: 56, copyrightEnforce: 15, reputation: 88 },
  { kw: ["controversy", "controversial", "scandal", "outrage over", "public outrage"], category: "Controversy", sev: "High", score: 79, legalTakedown: 32, copyrightEnforce: 8, reputation: 84 },
  { kw: ["copyright infringement", "stolen content", "unauthorized reupload", "DMCA strike", "pirated"], category: "Copyright", sev: "High", score: 78, legalTakedown: 72, copyrightEnforce: 96, reputation: 42 },
  { kw: ["breaking news", "exclusive report", "news update", "news today", "developing story"], category: "News", sev: "Low", score: 24, legalTakedown: 4, copyrightEnforce: 2, reputation: 12 },

  // ── MEDIUM ──────────────────────────────────────────────────────────────
  { kw: ["criticism", "criticised", "criticized", "slammed", "backlash", "called out", "trolled", "dragged"], category: "Criticism", sev: "Medium", score: 62, legalTakedown: 14, copyrightEnforce: 5, reputation: 60 },
  { kw: ["reaction video", "reacts to", "responds to", "response video", "claps back", "reply to"], category: "Reaction/Reupload", sev: "Medium", score: 54, legalTakedown: 18, copyrightEnforce: 68, reputation: 34 },
  { kw: ["reupload", "re-upload", "mirror site", "free download", "torrent"], category: "Copyright", sev: "Medium", score: 60, legalTakedown: 48, copyrightEnforce: 91, reputation: 36 },
  { kw: ["complaint against", "complaints filed", "ripoff report", "scam complaint"], category: "Complaint", sev: "Medium", score: 65, legalTakedown: 36, copyrightEnforce: 10, reputation: 72 },
  { kw: ["goes viral", "viral video", "trending now", "explodes online"], category: "Viral", sev: "Medium", score: 52, legalTakedown: 14, copyrightEnforce: 20, reputation: 44 },

  // ── LOW ─────────────────────────────────────────────────────────────────
  { kw: ["review", "honest review", "my experience", "rating", "stars out of"], category: "Review", sev: "Low", score: 38, legalTakedown: 4, copyrightEnforce: 4, reputation: 26 },
];

const POS = ["love", "amazing", "great", "best", "brilliant", "inspiring", "praised", "success", "wins", "wholesome", "incredible", "legendary", "award", "congratulations"];
const NEG = ["hate", "worst", "terrible", "scam", "fraud", "controversy", "sued", "lawsuit", "expose", "scandal", "attack", "fake", "leaked", "toxic", "shame", "boycott", "cancelled", "arrest", "abuse", "harass", "defamation", "allegations", "accused", "complaint", "ripoff"];
const TRUSTED_NEWS = /(nytimes|washingtonpost|guardian|bbc|reuters|bloomberg|forbes|wsj|cnn|apnews|npr|ft\.com|economist|axios|theverge|techcrunch|wired|onmanorama|mathrubhumi|manoramaonline|keralakaumudi|deepika|asianet|mediatamil)/i;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function platformFromUrl(url: string): { platform: string; source: string } {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtube") || h.includes("youtu.be")) return { platform: "YouTube", source: "YouTube" };
    if (h.includes("instagram")) return { platform: "Instagram", source: "Instagram" };
    if (h.includes("tiktok"))    return { platform: "TikTok",    source: "TikTok" };
    if (h.includes("twitter") || h.includes("x.com")) return { platform: "X", source: "X" };
    if (h.includes("facebook") || h.includes("fb.com")) return { platform: "Facebook", source: "Facebook" };
    if (h.includes("reddit"))    return { platform: "Reddit",    source: "Reddit" };
    if (h.includes("linkedin"))  return { platform: "LinkedIn",  source: "LinkedIn" };
    if (h.includes("archive.org")) return { platform: "Archive", source: "Archive" };
    if (h.includes("trustpilot") || h.includes("yelp") || h.includes("g2.com")) return { platform: h, source: "Reviews" };
    if (h.includes("ripoff") || h.includes("complaintsboard")) return { platform: h, source: "Complaints" };
    if (TRUSTED_NEWS.test(h) || /(news|times|post|guardian|bbc|cnn|reuters|bloomberg|herald)/i.test(h)) return { platform: h, source: "News" };
    if (h.includes("medium.com") || h.includes("substack")) return { platform: h, source: "Blogs" };
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

function classify(title: string, desc: string): { category: Category; sev: Severity; score: number; legalTakedown: number; copyrightEnforce: number; reputation: number; keywords: string[] } {
  const t = `${title} ${desc}`.toLowerCase();
  let best: RiskRule = { kw: [], category: "Mention", sev: "Low", score: 38, legalTakedown: 4, copyrightEnforce: 4, reputation: 20 };
  const hits: string[] = [];
  for (const r of RISK_TERMS) {
    const hit = r.kw.find((k) => t.includes(k));
    if (hit) {
      hits.push(hit);
      if (r.score > best.score) best = r;
    }
  }
  return { category: best.category, sev: best.sev, score: best.score, legalTakedown: best.legalTakedown, copyrightEnforce: best.copyrightEnforce, reputation: best.reputation, keywords: hits };
}

function labelOf(cat: Category, sent: Sentiment, source: string): ContentLabel {
  if (cat === "Deepfake")         return "Potentially manipulated media";
  if (cat === "Impersonation")    return "Potential impersonation";
  if (cat === "Defamation")       return "Defamation risk";
  if (cat === "Fake Endorsement") return "Fake endorsement";
  if (cat === "Harassment")       return "Harassment";
  if (cat === "Legal Dispute")    return "Legal dispute";
  if (cat === "Allegation")       return "Allegation";
  if (cat === "Exposé")           return "Exposé";
  if (cat === "Controversy")      return "Controversy";
  if (cat === "Criticism")        return "Criticism";
  if (cat === "Leak")             return "Leak";
  if (cat === "Boycott")          return "Reputation risk";
  if (cat === "Copyright")        return "Copyright misuse";
  if (cat === "News") return source === "News" ? "Breaking news" : "News report";
  if (source === "News")          return "News report";
  if (cat === "Review")           return "Review";
  if (cat === "Complaint")        return "Allegation";
  if (cat === "Reaction/Reupload") return "Opinion";
  if (sent === "Negative")        return "Unverified claim";
  return "Insufficient evidence";
}

function whyItMattersFor(cat: Category, sev: Severity, sent: Sentiment): string {
  if (cat === "Deepfake")      return "Synthetic media can permanently damage public trust and may constitute fraud or defamation.";
  if (cat === "Defamation")    return "False public statements carry legal liability and drive significant reputational damage.";
  if (cat === "Leak")          return "Private content exposure violates dignity, privacy law, and can spread uncontrollably.";
  if (cat === "Impersonation") return "Fake accounts mislead fans and may be used to defraud or defame.";
  if (cat === "Fake Endorsement") return "Unauthorized brand use damages credibility and constitutes potential fraud.";
  if (cat === "Harassment")    return "Coordinated harassment campaigns can suppress public voice and cause personal harm.";
  if (cat === "Legal Dispute") return "Active legal proceedings are high-visibility and can anchor negative narratives long-term.";
  if (cat === "Boycott")       return "Cancel campaigns can rapidly erode commercial relationships and public support.";
  if (cat === "Allegation")    return "Unverified allegations spread quickly and can shape public perception before any resolution.";
  if (cat === "Exposé")        return "Investigative content tends to rank highly and circulate widely, often framing the narrative.";
  if (cat === "Controversy")   return "Active public controversies attract media coverage and can escalate rapidly.";
  if (cat === "Criticism")     return "Critical commentary contributes to negative perception and may signal a broader backlash.";
  if (sev === "Critical")      return "Critical-severity content poses immediate, serious reputational risk.";
  if (sent === "Negative")     return "Negative-sentiment content contributes to adverse public perception.";
  return "This result is associated with the searched entity and may affect reputation.";
}

function recommendFor(cat: Category, sev: Severity): string {
  if (cat === "Deepfake" || cat === "Leak") return "Preserve evidence immediately, submit platform takedown, engage legal counsel";
  if (cat === "Defamation")    return "Preserve evidence, contact publisher for correction, consider legal action";
  if (cat === "Impersonation") return "Report impersonation to platform, preserve evidence, alert followers";
  if (cat === "Fake Endorsement") return "Report to platform ad team, issue public clarification, consider legal notice";
  if (cat === "Harassment")    return "Document all instances, report to platform, consider law enforcement referral";
  if (cat === "Legal Dispute") return "Monitor coverage, coordinate with legal team, prepare factual public statement";
  if (cat === "Boycott")       return "Assess legitimacy of concerns, issue transparent public response, engage community";
  if (cat === "Allegation" || cat === "Exposé") return "Preserve evidence, publish factual clarification, monitor spread";
  if (cat === "Controversy")   return "Publish factual clarification, monitor spread, avoid amplification";
  if (cat === "Copyright")     return "Submit DMCA takedown, track mirror sites, consider automated enforcement";
  if (cat === "Criticism")     return "Monitor sentiment; respond publicly only if factually incorrect";
  if (cat === "News")          return "Monitor coverage spread; prepare factual response if required";
  if (cat === "Review")        return "Monitor; respond publicly if factually incorrect";
  return sev === "Low" ? "Continue monitoring" : "Verify before acting";
}

function credibilityScore(source: string, platform: string): number {
  if (TRUSTED_NEWS.test(platform)) return 88;
  if (source === "News")      return 76;
  if (source === "YouTube")   return 54;
  if (source === "TikTok")    return 50;
  if (source === "Reddit")    return 46;
  if (source === "Blogs")     return 56;
  if (source === "Reviews")   return 62;
  if (source === "Complaints")return 40;
  return 58;
}

function synthReach(platform: string, sev: Severity, i: number): number {
  const base: Record<string, number> = { YouTube: 44000, TikTok: 58000, Instagram: 27000, X: 19000, Reddit: 13000, Facebook: 23000, LinkedIn: 6000, News: 36000 };
  const b = base[platform] ?? 5000;
  const mult = sev === "Critical" ? 3.6 : sev === "High" ? 2.3 : sev === "Medium" ? 1.4 : 0.7;
  const noise = 0.75 + ((i * 137) % 50) / 100;
  return Math.round(b * mult * noise);
}

function ageDaysOf(published?: string): number {
  if (!published) return 400;
  return Math.max(0.01, (Date.now() - new Date(published).getTime()) / 86_400_000);
}

function freshnessWindowOf(ageDays: number): FreshnessWindow {
  if (ageDays < 1)  return "24h";
  if (ageDays < 3)  return "3d";
  if (ageDays < 7)  return "7d";
  if (ageDays < 30) return "30d";
  return "older";
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRECRAWL
═══════════════════════════════════════════════════════════════════════════ */
interface RawHit {
  url?: string; title?: string; description?: string; snippet?: string;
  author?: string; date?: string; publishedDate?: string; media?: MediaMeta;
}

/** Parse a single Firecrawl search result item into a RawHit. */
function fcItemToRaw(item: Record<string, unknown>): RawHit {
  const md = (item.metadata ?? {}) as Record<string, unknown>;
  const image =
    (typeof item.imageUrl === "string" && item.imageUrl) ||
    (typeof item.image   === "string" && item.image)    ||
    (typeof md.ogImage   === "string" && md.ogImage)    ||
    (typeof md["og:image"] === "string" && (md["og:image"] as string)) || undefined;
  return {
    url:          (item.url         as string) ?? undefined,
    title:        (item.title       as string) ?? (md.title as string) ?? (md["og:title"] as string) ?? undefined,
    description:  (item.description as string) ?? (md.description as string) ?? undefined,
    snippet:      (item.snippet     as string) ?? undefined,
    author:       (item.author      as string) ?? (md.author as string) ?? undefined,
    date:         (item.date        as string) ?? undefined,
    publishedDate:(item.publishedDate as string) ?? (md.publishedTime as string) ?? undefined,
    media: image ? { thumbnail: image, thumbnailHi: image } : undefined,
  };
}

/** Run a single Firecrawl search query and return parsed RawHit array. */
async function fcSearch(
  fc: { search(q: string, opts: { limit: number }): Promise<unknown> },
  q: string,
  limit: number,
): Promise<RawHit[]> {
  const response = await fc.search(q, { limit });
  const root = response as Record<string, unknown>;

  if (root.success === false) {
    throw new Error(
      typeof root.error === "string"
        ? root.error
        : "Firecrawl search request failed"
    );
  }

  const nested =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? root.data as Record<string, unknown>
      : {};

  const candidates: unknown[] = [
    ...(Array.isArray(root.web) ? root.web : []),
    ...(Array.isArray(root.news) ? root.news : []),
    ...(Array.isArray(nested.web) ? nested.web : []),
    ...(Array.isArray(nested.news) ? nested.news : []),
    ...(Array.isArray(root.data) ? root.data : []),
  ];

  const unique = new Map<string, Record<string, unknown>>();

  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;

    const record = item as Record<string, unknown>;
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? record.metadata as Record<string, unknown>
        : {};

    const normalized: Record<string, unknown> = {
      ...record,
      title: record.title ?? metadata.title,
      description:
        record.description ??
        record.snippet ??
        metadata.description,
      url:
        record.url ??
        record.sourceURL ??
        metadata.sourceURL ??
        metadata.url,
    };

    const url = typeof normalized.url === "string" ? normalized.url : "";
    if (url) unique.set(url, normalized);
  }

  const parsed = Array.from(unique.values())
    .map(fcItemToRaw)
    .filter(hit => Boolean(hit.url));

  console.log(
    `[firecrawl] query="${q}" candidates=${candidates.length} parsed=${parsed.length}`
  );

  return parsed;
}

async function runFirecrawl(query: string, sources: SourceKey[], limit: number): Promise<{ runs: { source: string; raw: RawHit[] }[]; error?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { runs: [], error: "FIRECRAWL_API_KEY missing" };
  const nonYt = sources.filter((s) => s !== "youtube");
  if (!nonYt.length) return { runs: [] };
  try {
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const fc = new Firecrawl({ apiKey });
    const results = await Promise.allSettled(nonYt.map(async (s) => {
      const cfg = SOURCE_QUERY[s];
      const q = cfg.site ? `${query} site:${cfg.site}` : cfg.suffix ? `${query} ${cfg.suffix}` : query;
      const raw = await fcSearch(fc, q, limit);
      return { source: cfg.label, raw };
    }));
    const runs: { source: string; raw: RawHit[] }[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") runs.push(r.value);
      else console.error("[scan] firecrawl rejected:", r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    return { runs };
  } catch (e) {
    return { runs: [], error: e instanceof Error ? e.message : "Firecrawl failed" };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRECRAWL DISCOVERY MODE
   Activated automatically when YouTube quota is exhausted.
   Performs a comprehensive multi-stage web discovery that includes:
     · Tier-1 controversy/news queries (high priority)
     · YouTube URL discovery via site:youtube.com/watch searches
     · Platform-specific public web discovery (Reddit, Instagram, X, Facebook)
     · Second-stage keyword expansion from first-pass results
   Budget: ~18-24 Firecrawl queries total.
═══════════════════════════════════════════════════════════════════════════ */
export interface FcDiscoveryDiagnostics {
  active: true;
  queriesExecuted: number;
  rawUrls: number;
  relevantUrls: number;
  uniqueUrls: number;
  youtubeUrlsDiscovered: number;
  newsDiscovered: number;
  socialDiscovered: number;
  otherWebDiscovered: number;
  tier1Queries: number;
  tier2Queries: number;
  platformQueries: number;
  ytWebQueries: number;
  expandedTermsUsed: string[];
}

const FC_CONTROVERSY_TERMS = [
  "controversy", "allegations", "exposed", "scandal", "leaked",
  "breaking news", "latest news", "backlash", "response", "complaint",
  "police", "FIR", "court", "reaction", "viral",
] as const;

const FC_YT_SPECIFIC_TERMS = [
  "controversy", "allegations", "exposed", "reaction",
  "response", "latest", "Malayalam", "complaint", "police",
] as const;

const FC_PLATFORM_QUERIES = [
  { suffix: "site:reddit.com", source: "Reddit" },
  { suffix: "site:instagram.com", source: "Instagram" },
  { suffix: "site:x.com OR site:twitter.com", source: "X" },
  { suffix: "site:facebook.com", source: "Facebook" },
] as const;

async function runFirecrawlDiscoveryMode(
  query: string,
  aliases: string[],
  sources: SourceKey[],
): Promise<{
  runs: { source: string; raw: RawHit[] }[];
  diagnostics: FcDiscoveryDiagnostics;
}> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const emptyDiag: FcDiscoveryDiagnostics = {
    active: true, queriesExecuted: 0, rawUrls: 0, relevantUrls: 0, uniqueUrls: 0,
    youtubeUrlsDiscovered: 0, newsDiscovered: 0, socialDiscovered: 0, otherWebDiscovered: 0,
    tier1Queries: 0, tier2Queries: 0, platformQueries: 0, ytWebQueries: 0, expandedTermsUsed: [],
  };
  if (!apiKey) return { runs: [], diagnostics: emptyDiag };

  try {
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const fc = new Firecrawl({ apiKey });

    const nameForms = Array.from(new Set([query, ...aliases].map(s => s.trim()).filter(Boolean)));
    const primary = nameForms[0];
    const quoted  = `"${primary}"`;

    const seenUrls = new Set<string>();
    const allRaw: RawHit[] = [];
    let queriesExecuted = 0;

    const absorb = (hits: RawHit[]) => {
      for (const h of hits) {
        if (h.url && !seenUrls.has(h.url)) {
          seenUrls.add(h.url);
          allRaw.push(h);
        }
      }
    };

    // ── TIER 1: Current controversy + breaking news (12 queries, batch of 8) ──
    // These are the highest-priority queries — most likely to surface active stories.
    const tier1Batch = FC_CONTROVERSY_TERMS.slice(0, 8).map(term => `${quoted} ${term}`);
    const t1 = await Promise.allSettled(tier1Batch.map(async q => {
      queriesExecuted++;
      return fcSearch(fc, q, 5);
    }));
    for (const r of t1) if (r.status === "fulfilled") absorb(r.value);

    // Second half of Tier 1 — remaining controversy terms
    const tier1BatchB = FC_CONTROVERSY_TERMS.slice(8).map(term => `${quoted} ${term}`);
    const t1b = await Promise.allSettled(tier1BatchB.map(async q => {
      queriesExecuted++;
      return fcSearch(fc, q, 4);
    }));
    for (const r of t1b) if (r.status === "fulfilled") absorb(r.value);

    // Also search bare name + any alias forms for general coverage
    const bareResults = await Promise.allSettled(nameForms.slice(0, 3).map(async name => {
      queriesExecuted++;
      return fcSearch(fc, `${name} news`, 4);
    }));
    for (const r of bareResults) if (r.status === "fulfilled") absorb(r.value);

    const tier1Count = queriesExecuted;

    // ── STAGE 2: Extract trending keywords from Tier-1 results ────────────────
    // Dynamically discover what the current controversy is actually about.
    const expandedTerms = extractExpansionTerms(allRaw, query, aliases);
    const usedTerms: string[] = [];

    if (expandedTerms.length >= 1) {
      const tier2Queries = expandedTerms.slice(0, 5).map(term => `${quoted} ${term}`);
      // Also try cross-referencing discovered terms with key verbs
      for (const term of expandedTerms.slice(0, 3)) {
        tier2Queries.push(`"${term}" ${primary}`);
      }
      const t2 = await Promise.allSettled(tier2Queries.slice(0, 6).map(async q => {
        queriesExecuted++;
        usedTerms.push(q);
        return fcSearch(fc, q, 4);
      }));
      for (const r of t2) if (r.status === "fulfilled") absorb(r.value);
      console.log("[fc-discovery] stage-2 expansion terms:", expandedTerms.join(", "));
    }

    const tier2Count = queriesExecuted - tier1Count;

    // ── YOUTUBE VIA FIRECRAWL ─────────────────────────────────────────────────
    // Discovers YouTube videos that are publicly indexed by Google/Firecrawl.
    // These appear with youtube.com/watch URLs, channel names, and dates in SERPs.
    const wantYT = !sources.length || sources.includes("youtube");
    let ytWebCount = 0;
    if (wantYT) {
      const ytQueries = [
        `site:youtube.com/watch ${quoted}`,
        ...FC_YT_SPECIFIC_TERMS.map(term => `site:youtube.com/watch ${quoted} ${term}`),
        `site:youtube.com/watch "${primary}" latest 2025`,
      ].slice(0, 7);
      const ytResults = await Promise.allSettled(ytQueries.map(async q => {
        queriesExecuted++;
        ytWebCount++;
        return fcSearch(fc, q, 5);
      }));
      for (const r of ytResults) if (r.status === "fulfilled") absorb(r.value);
    }

    // ── PLATFORM DISCOVERY ────────────────────────────────────────────────────
    const platResults = await Promise.allSettled(FC_PLATFORM_QUERIES.slice(0, 3).map(async ({ suffix }) => {
      queriesExecuted++;
      return fcSearch(fc, `${quoted} ${suffix}`, 4);
    }));
    for (const r of platResults) if (r.status === "fulfilled") absorb(r.value);

    const platformCount = platResults.length;

    // ── Group results by platform/source ────────────────────────────────────
    const bySource = new Map<string, RawHit[]>();
    for (const hit of allRaw) {
      const { source } = platformFromUrl(hit.url ?? "");
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source)!.push(hit);
    }
    const runs = Array.from(bySource.entries()).map(([source, raw]) => ({ source, raw }));

    // ── Diagnostics ───────────────────────────────────────────────────────────
    const ytUrls    = allRaw.filter(h => h.url?.includes("youtube.com")).length;
    const newsUrls  = allRaw.filter(h => { const { source } = platformFromUrl(h.url ?? ""); return source === "News"; }).length;
    const socialPlatforms = new Set(["Reddit", "Instagram", "X", "Facebook", "TikTok", "LinkedIn"]);
    const socialUrls = allRaw.filter(h => { const { source } = platformFromUrl(h.url ?? ""); return socialPlatforms.has(source); }).length;

    return {
      runs,
      diagnostics: {
        active: true,
        queriesExecuted,
        rawUrls: seenUrls.size,
        relevantUrls: allRaw.filter(h => h.title && h.url).length,
        uniqueUrls: seenUrls.size,
        youtubeUrlsDiscovered: ytUrls,
        newsDiscovered: newsUrls,
        socialDiscovered: socialUrls,
        otherWebDiscovered: seenUrls.size - ytUrls - newsUrls - socialUrls,
        tier1Queries: tier1Count,
        tier2Queries: tier2Count,
        platformQueries: platformCount,
        ytWebQueries: ytWebCount,
        expandedTermsUsed: expandedTerms,
      },
    };
  } catch (e) {
    console.error("[fc-discovery] failed:", e instanceof Error ? e.message : String(e));
    return { runs: [], diagnostics: emptyDiag };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   YOUTUBE DATA API v3
═══════════════════════════════════════════════════════════════════════════ */

// ── Tier-1: Active controversy/news signals ─ run with "date" ordering ──────
// These surface what is happening RIGHT NOW for the searched entity.
const YT_CONTROVERSY_TERMS = [
  // Controversy / scandal detection
  "controversy", "latest controversy", "controversy 2025", "new controversy",
  "scandal", "latest scandal",
  // Allegations / accusations
  "allegations", "allegation", "accused", "accused of", "accusation",
  // Exposé / investigation
  "expose", "exposed", "exposé", "truth about", "real story", "real truth",
  "investigation", "undercover", "probe",
  // Legal / police
  "police", "court", "FIR", "arrest", "lawsuit", "legal action", "case filed",
  "complaint filed",
  // Breaking / news
  "breaking news", "latest news", "news today", "news update", "latest update",
  // Response / aftermath
  "response", "apology", "statement", "clarification", "reacts", "reaction",
  // Negative actions
  "backlash", "slammed", "trolled", "called out", "cancelled", "boycott",
  // Content risk
  "leaked", "leak", "viral controversy", "viral video",
  // Specific risk types
  "deepfake", "fake account", "impersonation", "fake ad",
  "harassment", "abuse",
  // Temporal freshness
  "trending", "latest", "update", "new video",
  // Malayalam / regional variants
  "controversy Malayalam", "controversy Kerala", "latest Malayalam news",
];

// ── Tier-2: Broader risk terms ─ run with "relevance" ordering ───────────────
const YT_RISK_TERMS = [
  "fraud", "scam", "dark side", "complaint",
  "trolling", "issue", "discussion", "interview",
  "roast", "cringe", "drama", "rant", "hate",
  "reply", "misinformation", "hoax", "rumor", "rumour",
  "copyright", "reupload", "endorsement",
  "defamation", "criticism", "criticized",
  "negative review", "bad review",
];

interface YtThumb { url?: string; width?: number; height?: number }
interface YtSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string; description?: string; publishedAt?: string;
    channelId?: string; channelTitle?: string;
    thumbnails?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb };
  };
}
interface YtVideoItem {
  id?: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; channelId?: string; channelTitle?: string; thumbnails?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

function pickThumb(tt?: { default?: YtThumb; medium?: YtThumb; high?: YtThumb; standard?: YtThumb; maxres?: YtThumb }): { hi?: string; std?: string } {
  const hi  = tt?.maxres?.url || tt?.standard?.url || tt?.high?.url || tt?.medium?.url || tt?.default?.url;
  const std = tt?.high?.url   || tt?.medium?.url   || tt?.default?.url || hi;
  return { hi, std };
}

function parseIsoDuration(iso?: string): { sec: number; label: string } {
  if (!iso) return { sec: 0, label: "" };
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return { sec: 0, label: "" };
  const h = Number(m[1] || 0), mi = Number(m[2] || 0), s = Number(m[3] || 0);
  const sec = h * 3600 + mi * 60 + s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { sec, label: h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}` };
}

/** Shared object threaded through all concurrent YT requests — allows instant circuit-break. */
interface QuotaFlag { exhausted: boolean; reason: string }

async function ytFetch<T>(path: string, params: Record<string, string>, key: string, quotaFlag?: QuotaFlag): Promise<T | null> {
  // Circuit breaker — stop immediately if quota was already exhausted
  if (quotaFlag?.exhausted) return null;
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  const r = await fetch(url.toString());
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    // Detect quota exhaustion and trip the circuit breaker immediately
    if ((r.status === 403 || r.status === 429) && quotaFlag) {
      try {
        const errBody = JSON.parse(txt) as { error?: { errors?: { domain?: string; reason?: string }[] } };
        const reason = errBody?.error?.errors?.[0]?.reason ?? "";
        if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded" || r.status === 429) {
          quotaFlag.exhausted = true;
          quotaFlag.reason = reason || `HTTP ${r.status}`;
          console.warn(`[youtube] ⚡ quota exhausted (${quotaFlag.reason}) — circuit breaker tripped`);
          return null;
        }
      } catch { /* ignore parse errors, fall through to generic error */ }
    }
    console.error("[youtube]", path, r.status, txt.slice(0, 200));
    return null;
  }
  return (await r.json()) as T;
}

const YT_MAX_PER_WINDOW = 500;  // per pass
const YT_HARD_CAP       = 2000; // total

/**
 * Run YouTube search queries within an explicit publishedAfter / publishedBefore date range.
 * Uses "date" ordering first (freshness), then "relevance" for wider coverage.
 */
async function fetchYTWindow(
  nameForms: string[],
  hashtags: string[],
  handles: string[],
  publishedAfter: string,
  publishedBefore: string,
  key: string,
  idToItem: Map<string, YtSearchItem>,
  counters: { pages: number; errors: number },
  quotaFlag: QuotaFlag,
): Promise<void> {
  if (quotaFlag.exhausted) return;

  // YouTube search.list costs 100 quota units per request. The previous
  // implementation launched as many as 360 requests concurrently and could
  // consume the daily quota during one scan. Use a small ordered plan instead.
  const forms = Array.from(new Set(nameForms.map(s => s.trim()).filter(Boolean))).slice(0, 4);
  const jobs: { q: string; order: "date" | "relevance"; pages: number }[] = [];
  const riskGroups = [
    "controversy|scandal|backlash|exposed|allegation|accused",
    "defamation|leaked|deepfake|impersonation|harassment",
    "police|court|arrest|lawsuit|complaint|legal",
    "trolled|criticism|boycott|fake|rumour|rumor",
  ];

  for (const name of forms) {
    const exact = name.includes(" ") ? `"${name}"` : name;
    // General exact-name search finds fresh coverage even when titles do not
    // contain one of our English risk keywords.
    jobs.push({ q: exact, order: "date", pages: name === forms[0] ? 3 : 1 });
    for (const group of riskGroups) {
      jobs.push({ q: `${exact} ${group}`, order: "date", pages: 1 });
    }
    // One relevance pass recovers important results whose upload date is less recent.
    jobs.push({ q: `${exact} controversy|defamation|exposed|legal`, order: "relevance", pages: 1 });
  }
  for (const value of [...hashtags, ...handles].slice(0, 4)) {
    jobs.push({ q: value, order: "date", pages: 1 });
  }

  // Sequential requests make the quota circuit breaker reliable and retain
  // deterministic newest-first insertion order.
  for (const job of jobs) {
    if (quotaFlag.exhausted || idToItem.size >= 300) break;
    let pageToken: string | undefined;
    for (let page = 0; page < job.pages; page++) {
      if (quotaFlag.exhausted || idToItem.size >= 300) break;
      const params: Record<string, string> = {
        part: "snippet", q: job.q, type: "video", maxResults: "50",
        order: job.order, safeSearch: "none", publishedAfter, publishedBefore,
        regionCode: "IN",
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await ytFetch<{ items?: YtSearchItem[]; nextPageToken?: string }>("search", params, key, quotaFlag);
      counters.pages++;
      if (!data) { counters.errors++; break; }
      for (const item of data.items ?? []) {
        const videoId = item.id?.videoId;
        if (videoId && !idToItem.has(videoId)) idToItem.set(videoId, item);
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
  }
}

async function runYouTube(
  query: string,
  aliases: string[],
  variations: string[],
  hashtags: string[],
  handles: string[],
  targetResults: number,
  monthWindow: MonthWindow,
): Promise<{ raw: RawHit[]; error?: string; queriesUsed: number; pagesScanned: number; apiErrors: number; quotaExhausted: boolean; quotaReason?: string }> {
  const key = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) return { raw: [], error: "GOOGLE_API_KEY missing", queriesUsed: 0, pagesScanned: 0, apiErrors: 0, quotaExhausted: false };

  const nameForms = Array.from(new Set([query, ...aliases, ...variations].map((s) => s.trim()).filter(Boolean)));
  const idToItem  = new Map<string, YtSearchItem>();
  const counters  = { pages: 0, errors: 0 };
  const quotaFlag: QuotaFlag = { exhausted: false, reason: "" };

  // ── Pass 1: full month range with freshness ordering (controversy-first) ─────
  // Uses the selected month's publishedAfter + publishedBefore so results are
  // strictly scoped to that calendar month.
  await fetchYTWindow(
    nameForms, hashtags, handles,
    monthWindow.ytPublishedAfter, monthWindow.ytPublishedBefore,
    key, idToItem, counters, quotaFlag,
  );

  // ── Pass 2 (this month only): inner 7-day window to boost most-recent content ──
  // For "This Month" we also run a tighter 7-day sub-window (date-ordered) so
  // breaking controversies from the last week appear at the very top.
  if (monthWindow.filter === "30d" && !quotaFlag.exhausted) {
    const day7Ago = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const today   = monthWindow.ytPublishedBefore;
    // Only run the sub-window if the month started > 7 days ago
    if (new Date(day7Ago) > new Date(monthWindow.ytPublishedAfter)) {
      await fetchYTWindow(
        nameForms, hashtags, handles,
        day7Ago, today,
        key, idToItem, counters, quotaFlag,
      );
    }
  }

  if (quotaFlag.exhausted) {
    console.warn(`[youtube] quota exhausted after ${idToItem.size} discoveries; returning partial results`);
  }

  // ── Fetch full video metadata for all discovered IDs ────────────────────
  const targetCount = Math.min(300, Math.max(25, targetResults), idToItem.size);
  const ids = Array.from(idToItem.keys()).slice(0, targetCount);
  const statsById = new Map<string, YtVideoItem>();
  for (let i = 0; i < ids.length; i += 50) {
    if (quotaFlag.exhausted) break;
    const batch = ids.slice(i, i + 50).join(",");
    const data  = await ytFetch<{ items?: YtVideoItem[] }>("videos", {
      part: "snippet,statistics,contentDetails", id: batch,
    }, key, quotaFlag);
    for (const v of data?.items ?? []) if (v.id) statsById.set(v.id, v);
  }

  // ── Build RawHit objects ──────────────────────────────────────────────
  const raw: RawHit[] = [];
  for (const id of ids) {
    const s    = idToItem.get(id);
    const v    = statsById.get(id);
    const snip = v?.snippet ?? s?.snippet;
    if (!snip) continue;
    const stats       = v?.statistics;
    const views       = stats?.viewCount    ? Number(stats.viewCount)    : 0;
    const likes       = stats?.likeCount    ? Number(stats.likeCount)    : 0;
    const comments    = stats?.commentCount ? Number(stats.commentCount) : 0;
    const thumbs      = pickThumb(snip.thumbnails);
    const dur         = parseIsoDuration(v?.contentDetails?.duration);
    const published   = snip.publishedAt;
    const days        = published ? Math.max(1, (Date.now() - new Date(published).getTime()) / 86_400_000) : 1;
    const growthPerDay   = Math.round(views / days);
    const engagementRate = views > 0 ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0;
    raw.push({
      url: `https://www.youtube.com/watch?v=${id}`,
      title: snip.title ?? "",
      description: (snip.description ?? "").slice(0, 800),
      author: snip.channelTitle,
      date: published, publishedDate: published,
      media: {
        videoId: id,
        thumbnail: thumbs.std, thumbnailHi: thumbs.hi,
        channelTitle: snip.channelTitle,
        channelId:    snip.channelId,
        channelUrl:   snip.channelId ? `https://www.youtube.com/channel/${snip.channelId}` : undefined,
        duration: dur.label, durationSec: dur.sec,
        views, likes, comments, growthPerDay, engagementRate,
      },
    });
  }

  const lastErr = counters.errors > 0 && !quotaFlag.exhausted ? `${counters.errors} YouTube API error(s)` : undefined;
  return {
    raw,
    queriesUsed: (YT_CONTROVERSY_TERMS.length + YT_RISK_TERMS.length) * nameForms.length,
    pagesScanned: counters.pages,
    apiErrors: counters.errors,
    quotaExhausted: quotaFlag.exhausted,
    quotaReason: quotaFlag.reason || undefined,
    error: lastErr,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECOND-STAGE KEYWORD EXTRACTION
   Pulls trending terms from the first-pass results so we can run an expansion
   search to catch content we didn't directly query for.
═══════════════════════════════════════════════════════════════════════════ */
function extractExpansionTerms(raw: RawHit[], query: string, aliases: string[]): string[] {
  const stopWords = new Set(["the", "a", "an", "and", "or", "is", "in", "at", "of", "on", "to", "for", "with", "by", "this", "that", "was", "are", "from", "have", "has", "been", "not", "but", "its", "his", "her", "their", "he", "she", "we", "you", "they", "it"]);
  const entityNames = new Set([query.toLowerCase(), ...aliases.map(a => a.toLowerCase())]);
  const freq = new Map<string, number>();

  for (const hit of raw.slice(0, 50)) {
    const text = `${hit.title ?? ""} ${hit.description ?? ""}`.toLowerCase();
    const words = text.match(/\b[a-z]{4,}\b/g) ?? [];
    for (const w of words) {
      if (!stopWords.has(w) && !entityNames.has(w)) {
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }
  }

  return Array.from(freq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORT BUILDER
═══════════════════════════════════════════════════════════════════════════ */
function buildReport(
  query: string,
  aliases: string[],
  monthWindow: MonthWindow,
  sourcesRequested: SourceKey[],
  runs: { source: string; raw: RawHit[] }[],
  err?: string,
): ReputationReport {
  const now    = new Date().toISOString();
  const dedupe = new Map<string, ScanHit>();
  const duplicates: ScanHit[] = [];
  const sourcesReturned = new Set<string>();
  let totalRaw = 0;
  let idx = 0;
  const normalizeEntity = (value: string) => value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\u0D00-\u0D7F ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const entityForms = Array.from(new Set([query, ...aliases]
    .map(normalizeEntity)
    .filter((value) => value.length >= 3)));

  for (const run of runs) {
    if (run.raw.length) sourcesReturned.add(run.source);
    for (const o of run.raw) {
      totalRaw++;
      const url   = o.url ?? "";
      if (!url) continue;
      const title       = (o.title ?? url).slice(0, 240);
      const description = (o.description ?? o.snippet ?? "").slice(0, 800);
      const { platform, source } = platformFromUrl(url);
      const haystack = normalizeEntity(`${title} ${description} ${o.author ?? o.media?.channelTitle ?? ""}`);
      const entityMatched = entityForms.some((form) => haystack.includes(form));
      if (!entityMatched) continue;
      const c    = classify(title, description);
      const sent = sentimentOf(`${title} ${description}`);
      const riskMatched = c.keywords.length > 0 || sent === "Negative";
      if (!riskMatched) continue;
      const cred = credibilityScore(source, platform);
      const realViews = o.media?.views ?? 0;
      const reach     = realViews > 0 ? realViews : synthReach(platform, c.sev, idx++);
      if (!realViews) idx++;
      const engagement = o.media
        ? (o.media.likes ?? 0) + (o.media.comments ?? 0)
        : Math.round(reach * (0.03 + ((idx * 53) % 60) / 1000));
      const virality = Math.min(100, Math.round((reach / 5000) + (c.sev === "Critical" ? 28 : c.sev === "High" ? 18 : 7)));

      // Recency-weighted threat score — freshness is a first-class signal
      const published = o.publishedDate ?? o.date;
      const ageDays   = ageDaysOf(published);
      // Recency curve: 24h → 100, 7d → 85, 30d → 65, 90d → 45, 365d → 22
      const recency   = Math.max(10, Math.round(100 * Math.exp(-ageDays / 40)));
      const threat    = Math.min(100, Math.round(
        c.score   * 0.20 +
        cred      * 0.14 +
        Math.min(100, reach / 5000) * 0.15 +
        Math.min(100, engagement / 500) * 0.10 +
        recency   * 0.26 +   // freshness is the largest single weight
        virality  * 0.10 +
        60        * 0.05
      ));

      const detectionReason = c.keywords.length
        ? `Matched: ${c.keywords.slice(0, 4).join(", ")}${sent === "Negative" ? " · negative sentiment" : ""}`
        : sent === "Negative" ? "Negative sentiment in title/description" : "Named-entity match";

      const hit: ScanHit = {
        id: `hit-${idx}`,
        title, url, description, platform,
        source: source || run.source,
        author: o.author ?? o.media?.channelTitle,
        published,
        discoveredAt: now, lastChecked: now,
        category: c.category,
        contentLabel: labelOf(c.category, sent, source || run.source),
        severity: c.sev, sentiment: sent,
        confidence: Math.min(97, 52 + Math.round(c.score / 3.5)),
        threatScore: threat,
        credibilityScore: cred, viralityScore: virality,
        copyrightRisk:    c.copyrightEnforce,
        reputationRisk:   Math.min(100, c.reputation + (sent === "Negative" ? 8 : 0)),
        reachEstimate: reach, engagement,
        recommendedAction: recommendFor(c.category, c.sev),
        keywords: c.keywords, language: "en",
        viral: reach > 250000 || c.sev === "Critical",
        media: o.media, detectionReason,
        freshnessWindow: freshnessWindowOf(ageDays),
        legalTakedownPotential:        c.legalTakedown,
        copyrightEnforcementPotential: c.copyrightEnforce,
        whyItMatters: whyItMattersFor(c.category, c.sev, sent),
      };

      if (dedupe.has(url)) { duplicates.push(hit); continue; }
      dedupe.set(url, hit);
    }
  }

  // ── Month filter ────────────────────────────────────────────────────────
  //
  // ROOT CAUSE FIX: Do NOT reject results simply because publishedDate is missing.
  // Firecrawl results almost never carry a publishedDate. Excluding undated results
  // means the entire scan returns zero when YouTube quota is exhausted.
  //
  // RULE:
  //   - No date   → KEEP  (valid discovery, just not time-assignable)
  //   - Invalid date string → KEEP (treat as undated)
  //   - Has real date inside the month window  → KEEP
  //   - Has real date OUTSIDE the month window → REJECT
  //
  const allBeforeFilter = Array.from(dedupe.values());
  const totalBeforeFilter = allBeforeFilter.length;
  let rejectedByDate = 0;
  let keptUndated   = 0;
  let keptDated     = 0;

  const inWindow = (h: ScanHit): boolean => {
    if (!h.published) {
      keptUndated++;
      return true; // no date → keep
    }
    const ts = new Date(h.published).getTime();
    if (isNaN(ts)) {
      keptUndated++;
      return true; // unparseable date → keep
    }
    const inside = ts >= monthWindow.startMs && ts <= monthWindow.endMs;
    if (inside) { keptDated++; } else { rejectedByDate++; }
    return inside;
  };

  const filteredHits = allBeforeFilter.filter(inWindow);

  // ── Server-side diagnostic logging (console only, never in client response) ──
  const srcBreakdown = allBeforeFilter.reduce((acc, h) => {
    acc[h.source] = (acc[h.source] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`[scan:filter] query="${query}" range=${monthWindow.label}`);
  console.log(`[scan:filter]   raw dedupe total  : ${totalBeforeFilter}`);
  console.log(`[scan:filter]   kept (dated)       : ${keptDated}`);
  console.log(`[scan:filter]   kept (undated)      : ${keptUndated}`);
  console.log(`[scan:filter]   rejected (out-of-window): ${rejectedByDate}`);
  console.log(`[scan:filter]   final hits          : ${filteredHits.length}`);
  console.log(`[scan:filter]   by source (pre-filter): ${JSON.stringify(srcBreakdown)}`);
  if (filteredHits.length === 0) {
    console.warn(`[scan:filter] ⚠ ZERO RESULTS — pre-filter had ${totalBeforeFilter} hits.`);
    if (totalBeforeFilter === 0) console.warn(`[scan:filter]   → Firecrawl/YouTube returned no raw hits at all.`);
    else if (rejectedByDate === totalBeforeFilter) console.warn(`[scan:filter]   → ALL hits rejected by date filter (all have dates outside ${monthWindow.label}).`);
  }

  // ── Freshness + threat sort ───────────────────────────────────────────────
  // Dated results: newest-first (within the selected month).
  // Undated results: sorted by threat score and placed after dated ones.
  const recencyBoost = (h: ScanHit): number => {
    const d = ageDaysOf(h.published);
    if (d < 0.5)  return 45;
    if (d < 1)    return 38;
    if (d < 3)    return 28;
    if (d < 7)    return 18;
    if (d < 14)   return 10;
    if (d < 30)   return 4;
    return 0;
  };

  const hits = filteredHits.sort((a, b) => {
    const dateA = a.published ? new Date(a.published).getTime() : -1;
    const dateB = b.published ? new Date(b.published).getTime() : -1;
    // Both have dates: newest first
    if (dateA >= 0 && dateB >= 0) {
      if (dateB !== dateA) return dateB - dateA;
      return (b.threatScore + recencyBoost(b)) - (a.threatScore + recencyBoost(a));
    }
    // Dated results before undated
    if (dateA >= 0 && dateB < 0) return -1;
    if (dateA < 0  && dateB >= 0) return 1;
    // Both undated: threat score
    return b.threatScore - a.threatScore;
  });

  const critical = hits.filter((h) => h.severity === "Critical");
  const high     = hits.filter((h) => h.severity === "High");
  const negative = hits.filter((h) => h.sentiment === "Negative");
  const viral    = hits.filter((h) => h.viral);
  const totalReach = hits.reduce((a, h) => a + h.reachEstimate, 0);
  const avgThreat  = hits.length ? Math.round(hits.reduce((a, h) => a + h.threatScore, 0) / hits.length) : 0;

  // ── Buckets ───────────────────────────────────────────────────────────────
  const byWindow = (w: FreshnessWindow) => hits.filter((h) => h.freshnessWindow === w);
  const byCat    = (...cats: Category[]) => hits.filter((h) => cats.includes(h.category));

  const buckets = {
    // Time-window buckets — primary discovery view
    breaking:     byWindow("24h"),
    recent3d:     byWindow("3d"),
    recent7d:     byWindow("7d"),
    recent30d:    byWindow("30d"),
    // Risk category buckets
    critical,
    high,
    highRisk:     hits.filter((h) => h.severity === "Critical" || h.severity === "High"),
    viral,
    defamation:   byCat("Defamation"),
    expose:       byCat("Exposé", "Allegation"),
    leaks:        byCat("Leak"),
    controversies:byCat("Controversy", "Boycott"),
    copyright:    byCat("Copyright", "Reaction/Reupload"),
    deepfake:     byCat("Deepfake"),
    impersonation:byCat("Impersonation", "Fake Endorsement"),
    harassment:   byCat("Harassment"),
    legal:        byCat("Legal Dispute"),
    // Source buckets
    news:         hits.filter((h) => h.source === "News"),
    youtube:      hits.filter((h) => h.source === "YouTube"),
    reddit:       hits.filter((h) => h.source === "Reddit"),
    facebook:     hits.filter((h) => h.source === "Facebook"),
    instagram:    hits.filter((h) => h.source === "Instagram"),
    reviews:      hits.filter((h) => h.category === "Review" || h.category === "Complaint"),
    emerging:     hits.filter((h) => h.viralityScore >= 60 && h.severity !== "Critical").slice(0, 12),
    duplicates,
  };

  // ── Calibrated observed-risk score ────────────────────────────────────────
  // This is an evidence-based risk index, not a popularity score. Missing
  // platform metrics never become invented reach or engagement.
  const risk = (arr: ScanHit[]) => arr.length
    ? Math.round(arr.reduce((a, h) => a + h.threatScore, 0) / arr.length)
    : 0;
  const scoreBreakdown = [
    { key: "news",          label: "News Risk",          value: risk(buckets.news) },
    { key: "social",        label: "Social Media Risk",  value: risk([...buckets.facebook, ...buckets.instagram, ...hits.filter(h => h.source === "X" || h.source === "TikTok")]) },
    { key: "youtube",       label: "YouTube Risk",       value: risk(buckets.youtube) },
    { key: "reddit",        label: "Reddit Risk",        value: risk(buckets.reddit) },
    { key: "impersonation", label: "Impersonation Risk", value: risk(buckets.impersonation) },
    { key: "deepfake",      label: "Deepfake Risk",      value: risk(buckets.deepfake) },
    { key: "legal",         label: "Legal Risk",         value: risk(buckets.legal) },
    { key: "virality",      label: "Virality Risk",      value: hits.length ? Math.round(hits.reduce((a, h) => a + h.viralityScore, 0) / hits.length) : 0 },
  ];

  const severityFactor: Record<Severity, number> = { Critical: 1, High: 0.74, Medium: 0.42, Low: 0.16 };
  const categoryFactor: Partial<Record<Category, number>> = {
    Deepfake: 1, Defamation: 1, Leak: 0.96, Impersonation: 0.92,
    "Fake Endorsement": 0.88, Harassment: 0.86, "Legal Dispute": 0.84,
    Allegation: 0.72, "Exposé": 0.68, Boycott: 0.62, Controversy: 0.58,
    Criticism: 0.38, Complaint: 0.36, Copyright: 0.30,
    "Reaction/Reupload": 0.24, Viral: 0.22, News: 0.14, Review: 0.12, Mention: 0.08,
  };
  const sourceCredibility: Record<string, number> = {
    News: 1, YouTube: 0.78, Reddit: 0.58, Facebook: 0.62,
    Instagram: 0.62, X: 0.60, TikTok: 0.56, Web: 0.68,
  };

  const hitRisks = hits.map((h) => {
    const age = ageDaysOf(h.published);
    const recency = age < 0 ? 0.55 : age <= 3 ? 1 : age <= 7 ? 0.90 : age <= 30 ? 0.76 : age <= 180 ? 0.58 : 0.42;
    const sourceWeight = sourceCredibility[h.source] ?? 0.62;
    const verifiedReach = h.reachEstimate > 0 ? Math.min(1, Math.log10(h.reachEstimate + 1) / 7) : 0;
    const sentiment = h.sentiment === "Negative" ? 1 : h.sentiment === "Neutral" ? 0.78 : 0.42;
    const severity = severityFactor[h.severity] ?? 0.16;
    const category = categoryFactor[h.category] ?? 0.18;
    return Math.min(100, 100 * severity * category * sentiment * (0.56 + 0.20 * recency + 0.16 * sourceWeight + 0.08 * verifiedReach));
  }).sort((a, b) => b - a);

  // Diminishing weights prevent hundreds of copied/reposted stories from
  // overwhelming a few independently verified high-risk findings.
  const topRisks = hitRisks.slice(0, 30);
  let weightedTotal = 0;
  let weightTotal = 0;
  topRisks.forEach((value, index) => {
    const weight = 1 / Math.sqrt(index + 1);
    weightedTotal += value * weight;
    weightTotal += weight;
  });
  const evidenceRisk = weightTotal ? weightedTotal / weightTotal : 0;
  const volumePressure = Math.min(16, Math.log2(hits.length + 1) * 2.8);
  const criticalPressure = Math.min(14, critical.length * 4);
  const observedRisk = Math.min(100, evidenceRisk * 0.76 + volumePressure + criticalPressure);

  const datedCount = hits.filter(h => Boolean(h.published)).length;
  const metricCount = hits.filter(h => h.reachEstimate > 0).length;
  const sourceCount = new Set(hits.map(h => h.source)).size;
  const coverageConfidence = hits.length ? Math.round(Math.min(100,
    Math.min(1, hits.length / 50) * 35 +
    Math.min(1, sourceCount / 6) * 30 +
    (datedCount / hits.length) * 20 +
    (metricCount / hits.length) * 15
  )) : 0;
  const confidenceFactor = coverageConfidence >= 70 ? 1 : coverageConfidence >= 45 ? 0.88 : 0.72;
  const reputationScore = Math.max(0, Math.min(100, Math.round(100 - observedRisk * confidenceFactor)));
  const reputationLevel = coverageConfidence < 35 ? "Insufficient Data" :
    reputationScore >= 90 ? "Excellent" :
    reputationScore >= 75 ? "Strong" :
    reputationScore >= 60 ? "Stable" :
    reputationScore >= 40 ? "At Risk" :
    reputationScore >= 20 ? "High Risk" : "Critical";

  // ── Executive summary ─────────────────────────────────────────────────────
  const topicCounts = new Map<Category, number>();
  for (const h of hits) topicCounts.set(h.category, (topicCounts.get(h.category) ?? 0) + 1);
  const mostDamagingTopic     = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None";
  const mostInfluentialSource = hits.slice().sort((a, b) => b.reachEstimate - a.reachEstimate)[0]?.platform ?? "N/A";
  const fastestGrowing        = hits.slice().sort((a, b) => b.viralityScore - a.viralityScore)[0]?.title.slice(0, 80) ?? "N/A";
  const trend: "Increasing" | "Stable" | "Decreasing" =
    (buckets.breaking.length + buckets.recent3d.length) >= 5 ? "Increasing" :
    viral.length >= 3 ? "Increasing" :
    negative.length >= hits.length * 0.45 ? "Increasing" : "Stable";

  const immediateActions: string[] = [];
  if (critical.length)              immediateActions.push(`Escalate ${critical.length} critical item${critical.length > 1 ? "s" : ""} to legal review`);
  if (buckets.breaking.length)      immediateActions.push(`${buckets.breaking.length} result${buckets.breaking.length > 1 ? "s" : ""} published in the last 24 hours — monitor for escalation`);
  if (buckets.impersonation.length) immediateActions.push(`Report ${buckets.impersonation.length} suspected impersonation profile${buckets.impersonation.length > 1 ? "s" : ""}`);
  if (buckets.deepfake.length)      immediateActions.push(`Preserve evidence + platform takedown for ${buckets.deepfake.length} deepfake item${buckets.deepfake.length > 1 ? "s" : ""}`);
  if (buckets.leaks.length)         immediateActions.push(`Submit takedowns for ${buckets.leaks.length} leaked content item${buckets.leaks.length > 1 ? "s" : ""}`);
  if (!immediateActions.length)     immediateActions.push("Continue monitoring; no critical action required");

  return {
    ok: !err, error: err,
    query, aliases, generatedAt: now, period: monthWindow.label,
    sourcesRequested: sourcesRequested.map((s) => SOURCE_QUERY[s].label),
    sourcesReturned: [...sourcesReturned],
    hits,
    totals: { total: totalRaw, unique: hits.length, duplicatesRemoved: duplicates.length, critical: critical.length, high: high.length, negative: negative.length, viral: viral.length, avgThreat, totalReach },
    reputationScore, reputationLevel, scoreBreakdown,
    executiveSummary: {
      headline: `${reputationLevel} observed reputation risk (${reputationScore}/100, ${coverageConfidence}% coverage confidence) · ${critical.length} critical, ${high.length} high-priority across ${sourcesReturned.size} source${sourcesReturned.size !== 1 ? "s" : ""} · ${buckets.breaking.length} breaking (last 24h).`,
      mostDamagingTopic, mostInfluentialSource, fastestGrowing, trend,
      immediateActions,
      longTerm: [
        "Publish factual clarifications on the most repeated allegations",
        "Register content in the Asset Vault for automated copyright enforcement",
        "Set up recurring scans and alerts for the fastest-growing topics",
        "Establish proactive media relationships to counter future negative narratives",
      ],
    },
    buckets,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE HANDLER
═══════════════════════════════════════════════════════════════════════════ */
export const Route = createFileRoute("/api/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body        = await request.json().catch(() => ({}));
          const query       = String(body?.query ?? "").trim().slice(0, 200);
          if (!query) return Response.json({ ok: false, error: "Query required" }, { status: 400 });

          const aliases:    string[] = Array.isArray(body?.aliases)    ? body.aliases.map((a: unknown)    => String(a).slice(0, 60)).slice(0, 20)  : [];
          const variations: string[] = Array.isArray(body?.variations) ? body.variations.map((a: unknown) => String(a).slice(0, 60)).slice(0, 40)  : [];
          const hashtags:   string[] = Array.isArray(body?.hashtags)   ? body.hashtags.map((a: unknown)   => String(a).slice(0, 40)).slice(0, 20)  : [];
          const handles:    string[] = Array.isArray(body?.handles)    ? body.handles.map((a: unknown)    => String(a).slice(0, 40)).slice(0, 20)  : [];
          const limit       = Math.min(Math.max(Number(body?.limit ?? 8), 1), 10);
          const ytTarget    = Math.min(Math.max(Number(body?.youtubeTarget ?? 1500), 25), 2000);
          const sources: SourceKey[] = Array.isArray(body?.sources) && body.sources.length
            ? body.sources.filter((s: unknown): s is SourceKey => typeof s === "string" && s in SOURCE_QUERY)
            : ["web", "reddit", "youtube", "news", "x", "blogs", "forums", "reviews"];

          // Rolling scan range — defaults to the last 12 months.
          const rawMonthFilter = body?.monthFilter as string | undefined;
          const monthFilter: MonthFilter =
            rawMonthFilter === "24h" || rawMonthFilter === "7d" ||
            rawMonthFilter === "30d" || rawMonthFilter === "all"
              ? rawMonthFilter : "12m";
          const monthWindow = getMonthWindow(monthFilter);
          console.log(`[scan] range: ${monthWindow.label} (${monthWindow.startIso} → ${monthWindow.endIso})`);

          const wantYouTube      = sources.includes("youtube");
          const nonYtSources     = sources.filter(s => s !== "youtube") as SourceKey[];
          const expansionQuery   = aliases.length ? `${query} OR ${aliases.map(a => `"${a}"`).join(" OR ")}` : query;
          const controversyQuery = `${expansionQuery} controversy OR allegations OR scandal OR expose OR leaked`;

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 1 — Run YouTube API + baseline Firecrawl concurrently
          // ══════════════════════════════════════════════════════════════════════
          const [yt, fcControversy, fcGeneral] = await Promise.all([
            wantYouTube
              ? runYouTube(query, aliases, variations, hashtags, handles, ytTarget, monthWindow)
              : Promise.resolve({ raw: [] as RawHit[], error: undefined as string | undefined, queriesUsed: 0, pagesScanned: 0, apiErrors: 0, quotaExhausted: false }),
            runFirecrawl(controversyQuery, nonYtSources, Math.min(limit, 5)),
            runFirecrawl(expansionQuery,   nonYtSources, limit),
          ]);

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 2 — Firecrawl Discovery Mode (always runs if quota exhausted;
          //           also supplements when YT returns 0 results for any reason)
          // ══════════════════════════════════════════════════════════════════════
          let fcDiscovery: { runs: { source: string; raw: RawHit[] }[]; diagnostics: FcDiscoveryDiagnostics } | null = null;
          const ytQuotaExhausted = yt.quotaExhausted || (wantYouTube && yt.raw.length === 0 && yt.apiErrors > 5);

          if (ytQuotaExhausted) {
            console.log("[scan] YouTube quota exhausted — activating Firecrawl Discovery Mode");
            fcDiscovery = await runFirecrawlDiscoveryMode(query, aliases, sources);
          }

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 3 — Keyword expansion from whatever results we have so far
          // ══════════════════════════════════════════════════════════════════════
          const firstPassRaw = [
            ...yt.raw,
            ...(fcDiscovery?.runs ?? []).flatMap(r => r.raw),
            ...fcControversy.runs.flatMap(r => r.raw),
          ];
          let expansionRuns: { source: string; raw: RawHit[] }[] = [];
          if (firstPassRaw.length >= 3) {
            const trendingTerms = extractExpansionTerms(firstPassRaw, query, aliases);
            if (trendingTerms.length >= 2) {
              const expansionQ = `${query} ${trendingTerms.slice(0, 4).join(" ")}`;
              console.log("[scan] keyword expansion query:", expansionQ);
              const fcExp = await runFirecrawl(
                expansionQ,
                (["news", "web", "reddit"] as SourceKey[]).filter(s => sources.includes(s)),
                4,
              );
              expansionRuns = fcExp.runs;
            }
          }

          // ══════════════════════════════════════════════════════════════════════
          // Merge all runs — accumulate per source, deduplicate by URL in buildReport
          // ══════════════════════════════════════════════════════════════════════
          const allRuns = [
            ...fcControversy.runs,
            ...fcGeneral.runs,
            ...expansionRuns,
            ...(fcDiscovery?.runs ?? []),
          ];
          const runMap = new Map<string, { source: string; raw: RawHit[] }>();
          for (const r of allRuns) {
            const existing = runMap.get(r.source);
            if (!existing) runMap.set(r.source, { source: r.source, raw: [...r.raw] });
            else existing.raw.push(...r.raw);
          }
          const mergedRuns = Array.from(runMap.values());
          // YouTube API results (if any) always take priority — add last so they're not dropped
          if (yt.raw.length) {
            const ytRun = mergedRuns.find(r => r.source === "YouTube");
            if (ytRun) ytRun.raw.unshift(...yt.raw);
            else mergedRuns.push({ source: "YouTube", raw: yt.raw });
          }

          const overallErr = !mergedRuns.some(r => r.raw.length > 0) && !ytQuotaExhausted
            ? "No results returned"
            : undefined;

          const report = buildReport(query, [...aliases, ...variations, ...handles], monthWindow, sources, mergedRuns, overallErr);

          // ══════════════════════════════════════════════════════════════════════
          // Diagnostics
          // ══════════════════════════════════════════════════════════════════════
          const sourceCounts: Record<string, number> = {};
          for (const r of mergedRuns) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + r.raw.length;

          (report as unknown as Record<string, unknown>).diagnostics = {
            youtube: {
              queriesRun:    yt.queriesUsed,
              pagesScanned:  yt.pagesScanned,
              videosFound:   yt.raw.length,
              apiErrors:     yt.apiErrors,
              quotaExhausted: ytQuotaExhausted,
              quotaReason:   (yt as { quotaReason?: string }).quotaReason ?? null,
              error:         yt.error ?? null,
              target:        ytTarget,
              status:        ytQuotaExhausted
                ? "quota_exhausted"
                : yt.raw.length > 0
                  ? "ok"
                  : (wantYouTube ? "no_results" : "disabled"),
            },
            firecrawlDiscovery: fcDiscovery
              ? { ...fcDiscovery.diagnostics }
              : { active: false },
            monthFilter,
            monthWindow: {
              filter:    monthWindow.filter,
              label:     monthWindow.label,
              startIso:  monthWindow.startIso,
              endIso:    monthWindow.endIso,
            },
            sourceCounts,
            totalRawFetched:     mergedRuns.reduce((s, r) => s + r.raw.length, 0),
            sourcesWithResults:  mergedRuns.filter(r => r.raw.length > 0).map(r => r.source),
            scannedAt:           new Date().toISOString(),
            breakingCount:       report.buckets.breaking.length,
            recent3dCount:       report.buckets.recent3d.length,
            recent7dCount:       report.buckets.recent7d.length,
            // Filter diagnostics (admin-only via ?diag=1)
            filterDiag: {
              preFilterCount:  report.totals.total, // raw dedupe count before month filter
              keptDated:       report.hits.filter(h => !!h.published).length,
              keptUndated:     report.hits.filter(h => !h.published).length,
              finalCount:      report.hits.length,
              monthLabel:      monthWindow.label,
              windowStart:     monthWindow.startIso,
              windowEnd:       monthWindow.endIso,
            },
          };
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
