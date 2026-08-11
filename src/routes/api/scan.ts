import { createFileRoute } from "@tanstack/react-router";
import { inferAutomatedContentPosition, type ContentPosition } from "@/lib/evidence-review";
import {
  sortScanHitsByThreat,
  isHarmlessOrOfficial,
  logRankingDiagnostics,
  canonicalCategoryFor,
} from "@/lib/reputation/ranking.server";
import { scoreIdentity } from "@/lib/scan/identity-confidence";
import {
  emptyScanFunnel,
  countExclusion,
  type ScanPipelineFunnel,
} from "@/lib/scan/pipeline-funnel";
import type { PersistLeadInput } from "@/lib/scan/persist.server";

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */
export type Sentiment = "Positive" | "Neutral" | "Negative";
export type Severity = "Critical" | "High" | "Medium" | "Low";

export type Category =
  | "Deepfake"
  | "Impersonation"
  | "Fake Endorsement"
  | "Defamation"
  | "Leak"
  | "Harassment"
  | "Legal Dispute"
  | "Copyright"
  | "Reaction/Reupload"
  | "Unauthorized Ad"
  | "Allegation"
  | "Exposé"
  | "Controversy"
  | "News"
  | "Criticism"
  | "Boycott"
  | "Complaint"
  | "Review"
  | "Viral"
  | "Mention"
  | "Reputation Risk";

export type ContentLabel =
  | "Neutral mention"
  | "Complaint"
  | "Negative review"
  | "Allegation"
  | "Potential misinformation"
  | "Potential defamation"
  | "Impersonation"
  | "Scam/Fraud"
  | "Trademark/Copyright abuse"
  | "News/Legal dispute"
  | "Needs human review"
  | "Breaking news"
  | "News report"
  | "Exposé"
  | "Controversy"
  | "Criticism"
  | "Opinion"
  | "Review"
  | "Satire"
  | "Unverified claim"
  | "Misleading content"
  | "Leak"
  | "Potential impersonation"
  | "Potentially manipulated media"
  | "Fake endorsement"
  | "Harassment"
  | "Legal dispute"
  | "Copyright misuse"
  | "Defamation risk"
  | "Reputation risk"
  | "Verified fact"
  | "Insufficient evidence";

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
  const start =
    filter === "all"
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
  videoId?: string;
  thumbnail?: string;
  thumbnailHi?: string;
  channelTitle?: string;
  channelId?: string;
  channelUrl?: string;
  duration?: string;
  durationSec?: number;
  views?: number;
  likes?: number;
  comments?: number;
  growthPerDay?: number;
  engagementRate?: number;
  viewsAvailable?: boolean;
  likesAvailable?: boolean;
  commentsAvailable?: boolean;
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
  freshnessWindow?: FreshnessWindow;
  legalTakedownPotential?: number;
  copyrightEnforcementPotential?: number;
  whyItMatters?: string;
  contentPosition?: ContentPosition;
  /** Identity confidence grading (VERIFIED / PROBABLE / AMBIGUOUS). */
  identityTier?: "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "NOT_SUBJECT";
  identityConfidence?: number;
  identityReason?: string;
  /** VERIFIED = risk evidenced; NEEDS_REVIEW = kept for human review. */
  reviewStatus?: "VERIFIED" | "NEEDS_REVIEW";
  /** Search phrase that surfaced this result. */
  searchQueryUsed?: string;
  /** Excerpt of the full page captured during extraction. */
  pageExcerpt?: string;
  metricsAvailable?: { views: boolean; likes: boolean; comments: boolean };
  scoring?: {
    relevance: number;
    harm: number;
    credibility: number;
    virality: number;
    evidenceCompleteness: number;
    legalActionability: number;
    overallPriority: number;
    version: string;
  };
}

export type SourceKey =
  | "web"
  | "reddit"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "x"
  | "facebook"
  | "linkedin"
  | "news"
  | "blogs"
  | "forums"
  | "podcasts"
  | "reviews"
  | "complaints"
  | "archive";

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
    // Time-window buckets — primary discovery view
    breaking: ScanHit[]; // < 24 hours
    recent3d: ScanHit[]; // 1–3 days
    recent7d: ScanHit[]; // 3–7 days
    recent30d: ScanHit[]; // 7–30 days
    // Risk category buckets
    critical: ScanHit[];
    high: ScanHit[];
    highRisk: ScanHit[];
    viral: ScanHit[];
    defamation: ScanHit[];
    expose: ScanHit[];
    leaks: ScanHit[];
    controversies: ScanHit[];
    copyright: ScanHit[];
    deepfake: ScanHit[];
    impersonation: ScanHit[];
    harassment: ScanHit[];
    legal: ScanHit[];
    // Source buckets
    news: ScanHit[];
    youtube: ScanHit[];
    reddit: ScanHit[];
    facebook: ScanHit[];
    instagram: ScanHit[];
    reviews: ScanHit[];
    emerging: ScanHit[];
    duplicates: ScanHit[];
  };
  brandResolution?: {
    subjectType: "Auto" | "Person" | "Brand/Business";
    resolvedBrandName: string | null;
    placeId: string | null;
    website: string | null;
    formattedAddress: string | null;
    businessTypes: string[] | null;
    resolutionConfidence: number;
    resolutionReason: string | null;
    warning?: string | null;
  };
  results?: {
    source: string;
    title: string;
    url: string;
    snippet: string;
    publishedAt: string;
    author: string;
    thumbnail: string;
  }[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCE CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const SOURCE_QUERY: Record<SourceKey, { label: string; site?: string; suffix?: string }> = {
  web: { label: "Web" },
  reddit: { label: "Reddit", site: "reddit.com" },
  youtube: { label: "YouTube", site: "youtube.com" },
  instagram: { label: "Instagram", site: "instagram.com" },
  tiktok: { label: "TikTok", site: "tiktok.com" },
  x: { label: "X", site: "x.com OR twitter.com" },
  facebook: { label: "Facebook", site: "facebook.com" },
  linkedin: { label: "LinkedIn", site: "linkedin.com" },
  news: { label: "News", suffix: "news OR press OR breaking OR exclusive" },
  blogs: { label: "Blogs", suffix: "site:medium.com OR site:substack.com OR blog" },
  forums: { label: "Forums", suffix: "forum OR discussion OR thread" },
  podcasts: { label: "Podcasts", suffix: "podcast OR interview" },
  reviews: { label: "Reviews", suffix: "review OR rating" },
  complaints: { label: "Complaints", suffix: "complaint OR scam OR fraud OR ripoff" },
  archive: { label: "Archive", site: "archive.org OR web.archive.org" },
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
  {
    kw: [
      "deepfake",
      "ai generated face",
      "face swap",
      "voice clone",
      "synthetic video",
      "morphed video",
      "ai video fake",
      "manipulated video",
    ],
    category: "Deepfake",
    sev: "Critical",
    score: 96,
    legalTakedown: 92,
    copyrightEnforce: 60,
    reputation: 95,
  },
  {
    kw: [
      "defamation",
      "defamatory",
      "slander",
      "slanderous",
      "libel",
      "libellous",
      "libelous",
      "false accusation",
      "false accusations",
      "false allegation",
      "false allegations",
      "false claim",
      "false claims",
      "fake news about",
      "spreading lies",
      "spreading rumours",
      "spreading rumors",
      "character assassination",
      "smear campaign",
      "hate campaign",
      "maliciously false",
      "മാനനഷ്ടം",
      "അപവാദ",
    ],
    category: "Defamation",
    sev: "Critical",
    score: 92,
    legalTakedown: 95,
    copyrightEnforce: 10,
    reputation: 96,
  },
  // Softer defamatory-language signals: insults and reputation attacks that
  // rarely use the word "defamation" but are the bulk of real defamatory video
  // titles, especially in Indian-language and transliterated content.
  {
    kw: [
      "cheater",
      "cheating case",
      "fraudster",
      "liar",
      "lying about",
      "characterless",
      "bad character",
      "shameless",
      "vulgar",
      "obscene comment",
      "insulting",
      "insulted",
      "abusing",
      "abused her",
      "abused him",
      "mocking",
      "body shaming",
      "gold digger",
      "prostitute",
      "call girl",
      "drug addict",
      "casting couch",
      "compromise for role",
      "വ്യാജ",
      "അപമാനി",
      "തെറി",
    ],
    category: "Defamation",
    sev: "High",
    score: 85,
    legalTakedown: 80,
    copyrightEnforce: 8,
    reputation: 89,
  },

  {
    kw: [
      "private video",
      "nsfw leak",
      "intimate video",
      "bedroom video",
      "onlyfans leak",
      "sex tape",
      "nude leak",
    ],
    category: "Leak",
    sev: "Critical",
    score: 91,
    legalTakedown: 96,
    copyrightEnforce: 85,
    reputation: 93,
  },
  {
    kw: [
      "arrest",
      "detained",
      "indicted",
      "fir filed",
      "police case",
      "criminal charges",
      "charged with",
    ],
    category: "Legal Dispute",
    sev: "Critical",
    score: 88,
    legalTakedown: 30,
    copyrightEnforce: 5,
    reputation: 90,
  },

  // ── HIGH ────────────────────────────────────────────────────────────────
  {
    kw: ["leaked", "leak video", "content leak"],
    category: "Leak",
    sev: "High",
    score: 82,
    legalTakedown: 78,
    copyrightEnforce: 72,
    reputation: 84,
  },
  {
    kw: [
      "impersonat",
      "fake account",
      "fake profile",
      "fake page",
      "posing as",
      "pretending to be",
    ],
    category: "Impersonation",
    sev: "High",
    score: 84,
    legalTakedown: 88,
    copyrightEnforce: 30,
    reputation: 82,
  },
  {
    kw: [
      "fake endorsement",
      "unauthorized ad",
      "fake ad",
      "using my image without",
      "without my consent",
      "without permission",
    ],
    category: "Fake Endorsement",
    sev: "High",
    score: 80,
    legalTakedown: 83,
    copyrightEnforce: 62,
    reputation: 78,
  },
  {
    kw: [
      "harassment",
      "stalking",
      "cyberbullying",
      "threatening",
      "abusive messages",
      "doxxing",
      "doxing",
    ],
    category: "Harassment",
    sev: "High",
    score: 83,
    legalTakedown: 89,
    copyrightEnforce: 10,
    reputation: 82,
  },
  {
    kw: [
      "lawsuit",
      "court case",
      "legal action",
      "sued",
      "litigation",
      "tribunal",
      "defamation suit",
    ],
    category: "Legal Dispute",
    sev: "High",
    score: 80,
    legalTakedown: 40,
    copyrightEnforce: 8,
    reputation: 85,
  },
  {
    kw: [
      "boycott",
      "cancelled",
      "cancel culture",
      "#boycott",
      "call to ban",
      "blacklist",
      "don't support",
    ],
    category: "Boycott",
    sev: "High",
    score: 76,
    legalTakedown: 28,
    copyrightEnforce: 5,
    reputation: 82,
  },
  {
    kw: ["allegations against", "accused of", "facing allegations", "accused", "allegation"],
    category: "Allegation",
    sev: "High",
    score: 82,
    legalTakedown: 52,
    copyrightEnforce: 10,
    reputation: 87,
  },
  {
    kw: [
      "exposed",
      "expose",
      "exposé",
      "truth about",
      "real story",
      "real truth",
      "investigation into",
      "undercover report",
      "whistleblower",
    ],
    category: "Exposé",
    sev: "High",
    score: 83,
    legalTakedown: 56,
    copyrightEnforce: 15,
    reputation: 88,
  },
  {
    kw: ["controversy", "controversial", "scandal", "outrage over", "public outrage"],
    category: "Controversy",
    sev: "High",
    score: 79,
    legalTakedown: 32,
    copyrightEnforce: 8,
    reputation: 84,
  },
  {
    kw: [
      "copyright infringement",
      "stolen content",
      "unauthorized reupload",
      "DMCA strike",
      "pirated",
    ],
    category: "Copyright",
    sev: "High",
    score: 78,
    legalTakedown: 72,
    copyrightEnforce: 96,
    reputation: 42,
  },
  {
    kw: ["breaking news", "exclusive report", "news update", "news today", "developing story"],
    category: "News",
    sev: "Low",
    score: 24,
    legalTakedown: 4,
    copyrightEnforce: 2,
    reputation: 12,
  },

  // ── MEDIUM ──────────────────────────────────────────────────────────────
  {
    kw: [
      "criticism",
      "criticised",
      "criticized",
      "slammed",
      "backlash",
      "called out",
      "trolled",
      "dragged",
    ],
    category: "Criticism",
    sev: "Medium",
    score: 62,
    legalTakedown: 14,
    copyrightEnforce: 5,
    reputation: 60,
  },
  {
    kw: ["reaction video", "reacts to", "responds to", "response video", "claps back", "reply to"],
    category: "Reaction/Reupload",
    sev: "Medium",
    score: 54,
    legalTakedown: 18,
    copyrightEnforce: 68,
    reputation: 34,
  },
  {
    kw: ["reupload", "re-upload", "mirror site", "free download", "torrent"],
    category: "Copyright",
    sev: "Medium",
    score: 60,
    legalTakedown: 48,
    copyrightEnforce: 91,
    reputation: 36,
  },
  {
    kw: ["complaint against", "complaints filed", "ripoff report", "scam complaint"],
    category: "Complaint",
    sev: "Medium",
    score: 65,
    legalTakedown: 36,
    copyrightEnforce: 10,
    reputation: 72,
  },
  {
    kw: ["goes viral", "viral video", "trending now", "explodes online"],
    category: "Viral",
    sev: "Medium",
    score: 52,
    legalTakedown: 14,
    copyrightEnforce: 20,
    reputation: 44,
  },

  // ── LOW ─────────────────────────────────────────────────────────────────
  {
    kw: ["review", "honest review", "my experience", "rating", "stars out of"],
    category: "Review",
    sev: "Low",
    score: 38,
    legalTakedown: 4,
    copyrightEnforce: 4,
    reputation: 26,
  },
];

const POS = [
  "love",
  "amazing",
  "great",
  "best",
  "brilliant",
  "inspiring",
  "praised",
  "success",
  "wins",
  "wholesome",
  "incredible",
  "legendary",
  "award",
  "congratulations",
];
const NEG = [
  "hate",
  "worst",
  "terrible",
  "scam",
  "fraud",
  "controversy",
  "sued",
  "lawsuit",
  "expose",
  "scandal",
  "attack",
  "fake",
  "leaked",
  "toxic",
  "shame",
  "boycott",
  "cancelled",
  "arrest",
  "abuse",
  "harass",
  "defamation",
  "allegations",
  "accused",
  "complaint",
  "ripoff",
];
const TRUSTED_NEWS =
  /(nytimes|washingtonpost|guardian|bbc|reuters|bloomberg|forbes|wsj|cnn|apnews|npr|ft\.com|economist|axios|theverge|techcrunch|wired|onmanorama|mathrubhumi|manoramaonline|keralakaumudi|deepika|asianet|mediatamil)/i;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════════════════ */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function fetchPlacesNew(
  textQuery: string,
  apiKey: string,
  countryCode?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const url = "https://places.googleapis.com/v1/places:searchText";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    textQuery,
    languageCode: "en",
  };
  if (countryCode && countryCode.length === 2) {
    body.regionCode = countryCode.toUpperCase();
  }
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.types,places.googleMapsUri",
      },
      body: JSON.stringify(body),
    },
    10000,
  );
  if (!res.ok) {
    throw new Error(`Google Places API (New) returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchPlacesClassic(
  query: string,
  apiKey: string,
  countryCode?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
  if (countryCode) {
    url += `&region=${countryCode.toLowerCase()}`;
  }
  const res = await fetchWithTimeout(url, {}, 10000);
  if (!res.ok) {
    throw new Error(`Google Places API (Classic) returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (data.status === "REQUEST_DENIED") {
    throw new Error(`Google Places API (Classic) request denied: ${data.error_message || ""}`);
  }
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPlaceDetailsClassic(placeId: string, apiKey: string): Promise<any> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,website,url,types,place_id&key=${apiKey}`;
  try {
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result;
  } catch {
    return null;
  }
}

function computeResolutionConfidence(
  candidate: { name: string; website?: string; address?: string; types?: string[] },
  query: string,
  userWebsite?: string,
  userCountry?: string,
  userIndustry?: string,
): { confidence: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. Name Similarity
  const normCandName = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (normCandName === normQuery) {
    score += 45;
    reasons.push("Exact name match");
  } else if (normCandName.includes(normQuery) || normQuery.includes(normCandName)) {
    score += 25;
    reasons.push("Partial name match");
  } else {
    const candWords = candidate.name.toLowerCase().split(/\s+/);
    const queryWords = query.toLowerCase().split(/\s+/);
    const overlap = candWords.filter((w) => queryWords.includes(w) && w.length > 2);
    if (overlap.length > 0) {
      score += 15;
      reasons.push("Word overlap in name");
    }
  }

  // 2. Website Match
  if (userWebsite && candidate.website) {
    try {
      const userHost = new URL(
        userWebsite.startsWith("http") ? userWebsite : `http://${userWebsite}`,
      ).hostname.replace(/^www\./, "");
      const candHost = new URL(candidate.website).hostname.replace(/^www\./, "");
      if (userHost === candHost) {
        score += 45;
        reasons.push("Exact official website domain match");
      } else {
        score -= 20;
        reasons.push("Website mismatch with provided URL");
      }
    } catch {
      // Ignored
    }
  } else if (userWebsite && !candidate.website) {
    score -= 10;
  } else if (!userWebsite && candidate.website) {
    score += 5;
  }

  // 3. Location/Country Match
  if (userCountry && candidate.address) {
    const uc = userCountry.toLowerCase().trim();
    const addr = candidate.address.toLowerCase();
    if (addr.includes(uc)) {
      score += 20;
      reasons.push("Location matches country context");
    }
  }

  // 4. Category/Industry Match
  if (userIndustry && candidate.types) {
    const ind = userIndustry.toLowerCase().trim();
    const matchesType = candidate.types.some((t) => {
      const typeStr = t.replace(/_/g, " ").toLowerCase();
      return typeStr.includes(ind) || ind.includes(typeStr);
    });
    if (matchesType) {
      score += 10;
      reasons.push("Category matches industry context");
    }
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return { confidence: finalScore, reasons };
}

function isOwnedSource(
  urlStr: string,
  website?: string | null,
  handles?: string[] | null,
): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    // Check website match
    if (website) {
      const webHost = new URL(website.startsWith("http") ? website : `http://${website}`).hostname
        .replace(/^www\./, "")
        .toLowerCase();
      if (host === webHost) return true;
    }

    // Check handles match
    if (handles && handles.length > 0) {
      for (const h of handles) {
        const normH = h.replace(/^@/, "").toLowerCase().trim();
        if (!normH) continue;

        const path = url.pathname.toLowerCase();
        if (
          (host.includes("youtube.com") &&
            (path.includes(`/${normH}`) || path.includes(`@${normH}`))) ||
          ((host.includes("twitter.com") || host.includes("x.com")) &&
            path.startsWith(`/${normH}`)) ||
          (host.includes("instagram.com") && path.startsWith(`/${normH}`)) ||
          (host.includes("facebook.com") && path.startsWith(`/${normH}`)) ||
          (host.includes("linkedin.com") && path.includes(`/${normH}`)) ||
          (host.includes("tiktok.com") && path.startsWith(`/@${normH}`))
        ) {
          return true;
        }
      }
    }
  } catch {
    // Ignore URL parse errors
  }
  return false;
}

interface ResolutionResult {
  resolved: boolean;
  subjectType: "Auto" | "Person" | "Brand/Business";
  resolvedBrandName: string | null;
  placeId: string | null;
  website: string | null;
  formattedAddress: string | null;
  businessTypes: string[] | null;
  googleMapsUrl: string | null;
  resolutionConfidence: number;
  resolutionReason: string | null;
  status:
    | "resolved"
    | "not_resolved"
    | "key_missing"
    | "request_denied"
    | "insufficient_confidence"
    | "disabled"
    | "bypassed";
  error: string | null;
}

async function resolveBrandWithPlaces(
  query: string,
  subjectType: "Auto" | "Person" | "Brand/Business" = "Auto",
  userWebsite?: string,
  userCountry?: string,
  userIndustry?: string,
): Promise<ResolutionResult> {
  const defaultRes: ResolutionResult = {
    resolved: false,
    subjectType,
    resolvedBrandName: null,
    placeId: null,
    website: null,
    formattedAddress: null,
    businessTypes: null,
    googleMapsUrl: null,
    resolutionConfidence: 0,
    resolutionReason: null,
    status: "not_resolved",
    error: null,
  };

  if (subjectType === "Person") {
    defaultRes.status = "bypassed";
    return defaultRes;
  }

  // Auto-mode Brand likelihood heuristics
  if (subjectType === "Auto") {
    const normQuery = query.toLowerCase();
    const hasSite = !!userWebsite;
    const hasIndustry = !!userIndustry;
    const commonCorpSuffix =
      /\b(inc|llc|corp|ltd|co|group|agency|holding|ventures|partners|software|tech|solutions|systems|store|shop|restaurant|cafe|hotel|clinic|hospital|academy|school|university|foundation|trust)\b/.test(
        normQuery,
      );

    const likelyBusiness = hasSite || hasIndustry || commonCorpSuffix;
    if (!likelyBusiness) {
      defaultRes.status = "bypassed";
      return defaultRes;
    }
  }

  const apiKey =
    process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    defaultRes.status = "key_missing";
    defaultRes.error = "Google Places API key is missing";
    return defaultRes;
  }

  // Country code resolution context (e.g. "US" if user provided it)
  let countryCode: string | undefined;
  if (userCountry && userCountry.trim().length === 2) {
    countryCode = userCountry.trim().toUpperCase();
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let places: any[] = [];
    let methodUsed = "New API";

    try {
      // 1. Try New Places API Text Search
      const data = await fetchPlacesNew(query, apiKey, countryCode);
      places = data.places || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.warn(
        `[places:resolve] New Places API failed, falling back to Classic API: ${e.message}`,
      );
      // 2. Fallback to Classic Places API
      methodUsed = "Classic API";
      const classicData = await fetchPlacesClassic(query, apiKey, countryCode);
      if (classicData.results && classicData.results.length > 0) {
        // Retrieve full details for the top classic candidates (max 3 to limit api overhead)
        for (const candidate of classicData.results.slice(0, 3)) {
          const details = await fetchPlaceDetailsClassic(candidate.place_id, apiKey);
          if (details) {
            places.push({
              id: details.place_id,
              displayName: { text: details.name },
              formattedAddress: details.formatted_address,
              websiteUri: details.website,
              googleMapsUri: details.url,
              types: details.types,
            });
          } else {
            places.push({
              id: candidate.place_id,
              displayName: { text: candidate.name },
              formattedAddress: candidate.formatted_address,
              types: candidate.types,
            });
          }
        }
      }
    }

    if (places.length === 0) {
      defaultRes.status = "not_resolved";
      defaultRes.error = `No candidates returned from Google Places API (${methodUsed}).`;
      return defaultRes;
    }

    // Score all candidates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoredCandidates = places.map((p: any) => {
      const cand = {
        id: p.id || p.place_id,
        name: p.displayName?.text || p.name,
        website: p.websiteUri || p.website,
        address: p.formattedAddress || p.formatted_address,
        googleMapsUrl: p.googleMapsUri || p.url,
        types: p.types || [],
      };
      const { confidence, reasons } = computeResolutionConfidence(
        cand,
        query,
        userWebsite,
        userCountry,
        userIndustry,
      );
      return { cand, confidence, reasons };
    });

    // Find candidate with highest score
    scoredCandidates.sort((a, b) => b.confidence - a.confidence);
    const best = scoredCandidates[0];

    const threshold = subjectType === "Brand/Business" ? 50 : 65;
    if (best.confidence < threshold) {
      defaultRes.status = "insufficient_confidence";
      defaultRes.error = `Google Places top match confidence was insufficient (${best.confidence}/${threshold}).`;
      return defaultRes;
    }

    // Success!
    return {
      resolved: true,
      subjectType,
      resolvedBrandName: best.cand.name,
      placeId: best.cand.id,
      website: best.cand.website || null,
      formattedAddress: best.cand.address || null,
      businessTypes: best.cand.types || null,
      googleMapsUrl: best.cand.googleMapsUrl || null,
      resolutionConfidence: best.confidence,
      resolutionReason: best.reasons.join(", ") || "Confidence threshold met",
      status: "resolved",
      error: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error("[places:resolve] Places resolution encountered error:", err);
    defaultRes.status = "request_denied";
    defaultRes.error = `Google Places API request failed: ${err.message || String(err)}`;
    return defaultRes;
  }
}

function platformFromUrl(url: string): { platform: string; source: string } {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtube") || h.includes("youtu.be"))
      return { platform: "YouTube", source: "YouTube" };
    if (h.includes("instagram")) return { platform: "Instagram", source: "Instagram" };
    if (h.includes("tiktok")) return { platform: "TikTok", source: "TikTok" };
    if (h.includes("twitter") || h.includes("x.com")) return { platform: "X", source: "X" };
    if (h.includes("facebook") || h.includes("fb.com"))
      return { platform: "Facebook", source: "Facebook" };
    if (h.includes("reddit")) return { platform: "Reddit", source: "Reddit" };
    if (h.includes("linkedin")) return { platform: "LinkedIn", source: "LinkedIn" };
    if (h.includes("archive.org")) return { platform: "Archive", source: "Archive" };
    if (h.includes("trustpilot") || h.includes("yelp") || h.includes("g2.com"))
      return { platform: h, source: "Reviews" };
    if (h.includes("ripoff") || h.includes("complaintsboard"))
      return { platform: h, source: "Complaints" };
    if (
      TRUSTED_NEWS.test(h) ||
      /(news|times|post|guardian|bbc|cnn|reuters|bloomberg|herald)/i.test(h)
    )
      return { platform: h, source: "News" };
    if (h.includes("medium.com") || h.includes("substack")) return { platform: h, source: "Blogs" };
    return { platform: h, source: "Web" };
  } catch {
    return { platform: "Web", source: "Web" };
  }
}

function sentimentOf(text: string): Sentiment {
  const t = text.toLowerCase();
  let p = 0,
    n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (n > p + 1) return "Negative";
  if (p > n + 1) return "Positive";
  return "Neutral";
}

function classify(
  title: string,
  desc: string,
): {
  category: Category;
  sev: Severity;
  score: number;
  legalTakedown: number;
  copyrightEnforce: number;
  reputation: number;
  keywords: string[];
} {
  const t = `${title} ${desc}`.toLowerCase();
  let best: RiskRule = {
    kw: [],
    category: "Mention",
    sev: "Low",
    score: 38,
    legalTakedown: 4,
    copyrightEnforce: 4,
    reputation: 20,
  };
  const hits: string[] = [];
  for (const r of RISK_TERMS) {
    const hit = r.kw.find((k) => t.includes(k));
    if (hit) {
      hits.push(hit);
      if (r.score > best.score) best = r;
    }
  }
  return {
    category: best.category,
    sev: best.sev,
    score: best.score,
    legalTakedown: best.legalTakedown,
    copyrightEnforce: best.copyrightEnforce,
    reputation: best.reputation,
    keywords: hits,
  };
}

function labelOf(cat: Category, sent: Sentiment, source: string): ContentLabel {
  if (cat === "Deepfake") return "Potentially manipulated media";
  if (cat === "Impersonation") return "Potential impersonation";
  if (cat === "Defamation") return "Unverified claim";
  if (cat === "Fake Endorsement") return "Fake endorsement";
  if (cat === "Harassment") return "Harassment";
  if (cat === "Legal Dispute") return "Legal dispute";
  if (cat === "Allegation") return "Allegation";
  if (cat === "Exposé") return "Exposé";
  if (cat === "Controversy") return "Controversy";
  if (cat === "Criticism") return "Criticism";
  if (cat === "Leak") return "Leak";
  if (cat === "Boycott") return "Reputation risk";
  if (cat === "Copyright") return "Copyright misuse";
  if (cat === "News") return source === "News" ? "Breaking news" : "News report";
  if (source === "News") return "News report";
  if (cat === "Review") return "Review";
  if (cat === "Complaint") return "Allegation";
  if (cat === "Reaction/Reupload") return "Opinion";
  if (sent === "Negative") return "Unverified claim";
  return "Insufficient evidence";
}

function whyItMattersFor(cat: Category, sev: Severity, sent: Sentiment): string {
  if (cat === "Deepfake")
    return "Synthetic media can permanently damage public trust and may constitute fraud or defamation.";
  if (cat === "Defamation")
    return "False public statements carry legal liability and drive significant reputational damage.";
  if (cat === "Leak")
    return "Private content exposure violates dignity, privacy law, and can spread uncontrollably.";
  if (cat === "Impersonation")
    return "Fake accounts mislead fans and may be used to defraud or defame.";
  if (cat === "Fake Endorsement")
    return "Unauthorized brand use damages credibility and constitutes potential fraud.";
  if (cat === "Harassment")
    return "Coordinated harassment campaigns can suppress public voice and cause personal harm.";
  if (cat === "Legal Dispute")
    return "Active legal proceedings are high-visibility and can anchor negative narratives long-term.";
  if (cat === "Boycott")
    return "Cancel campaigns can rapidly erode commercial relationships and public support.";
  if (cat === "Allegation")
    return "Unverified allegations spread quickly and can shape public perception before any resolution.";
  if (cat === "Exposé")
    return "Investigative content tends to rank highly and circulate widely, often framing the narrative.";
  if (cat === "Controversy")
    return "Active public controversies attract media coverage and can escalate rapidly.";
  if (cat === "Criticism")
    return "Critical commentary contributes to negative perception and may signal a broader backlash.";
  if (sev === "Critical")
    return "Critical-severity content poses immediate, serious reputational risk.";
  if (sent === "Negative")
    return "Negative-sentiment content contributes to adverse public perception.";
  return "This result is associated with the searched entity and may affect reputation.";
}

function recommendFor(cat: Category, sev: Severity): string {
  if (cat === "Deepfake" || cat === "Leak")
    return "Preserve evidence immediately, submit platform takedown, engage legal counsel";
  if (cat === "Defamation")
    return "Preserve evidence, contact publisher for correction, consider legal action";
  if (cat === "Impersonation")
    return "Report impersonation to platform, preserve evidence, alert followers";
  if (cat === "Fake Endorsement")
    return "Report to platform ad team, issue public clarification, consider legal notice";
  if (cat === "Harassment")
    return "Document all instances, report to platform, consider law enforcement referral";
  if (cat === "Legal Dispute")
    return "Monitor coverage, coordinate with legal team, prepare factual public statement";
  if (cat === "Boycott")
    return "Assess legitimacy of concerns, issue transparent public response, engage community";
  if (cat === "Allegation" || cat === "Exposé")
    return "Preserve evidence, publish factual clarification, monitor spread";
  if (cat === "Controversy")
    return "Publish factual clarification, monitor spread, avoid amplification";
  if (cat === "Copyright")
    return "Submit DMCA takedown, track mirror sites, consider automated enforcement";
  if (cat === "Criticism") return "Monitor sentiment; respond publicly only if factually incorrect";
  if (cat === "News") return "Monitor coverage spread; prepare factual response if required";
  if (cat === "Review") return "Monitor; respond publicly if factually incorrect";
  return sev === "Low" ? "Continue monitoring" : "Verify before acting";
}

function credibilityScore(source: string, platform: string): number {
  if (TRUSTED_NEWS.test(platform)) return 88;
  if (source === "News") return 76;
  if (source === "YouTube") return 54;
  if (source === "TikTok") return 50;
  if (source === "Reddit") return 46;
  if (source === "Blogs") return 56;
  if (source === "Reviews") return 62;
  if (source === "Complaints") return 40;
  return 58;
}

function ageDaysOf(published?: string): number {
  if (!published) return 400;
  return Math.max(0.01, (Date.now() - new Date(published).getTime()) / 86_400_000);
}

function freshnessWindowOf(ageDays: number): FreshnessWindow {
  if (ageDays < 1) return "24h";
  if (ageDays < 3) return "3d";
  if (ageDays < 7) return "7d";
  if (ageDays < 30) return "30d";
  return "older";
}

/* ═══════════════════════════════════════════════════════════════════════════
   FIRECRAWL
═══════════════════════════════════════════════════════════════════════════ */
interface RawHit {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  author?: string;
  date?: string;
  publishedDate?: string;
  media?: MediaMeta;
  /** Search phrase that discovered this hit (provenance for auditing). */
  queryUsed?: string;
  /** Full page text captured by the extraction stage, when available. */
  pageText?: string;
  /** Which extractor produced pageText. */
  extractor?: string;
  /** Reddit-only reputation-risk classification (see classifyRedditRisk). */
  redditRisk?: {
    categories: string[];
    score: number;
    reason: string;
  };
}

/** Parse a single Firecrawl search result item into a RawHit. */
function fcItemToRaw(item: Record<string, unknown>): RawHit {
  const md = (item.metadata ?? {}) as Record<string, unknown>;
  const image =
    (typeof item.imageUrl === "string" && item.imageUrl) ||
    (typeof item.image === "string" && item.image) ||
    (typeof md.ogImage === "string" && md.ogImage) ||
    (typeof md["og:image"] === "string" && (md["og:image"] as string)) ||
    undefined;
  return {
    url: (item.url as string) ?? undefined,
    title:
      (item.title as string) ?? (md.title as string) ?? (md["og:title"] as string) ?? undefined,
    description: (item.description as string) ?? (md.description as string) ?? undefined,
    snippet: (item.snippet as string) ?? undefined,
    author: (item.author as string) ?? (md.author as string) ?? undefined,
    date: (item.date as string) ?? undefined,
    publishedDate: (item.publishedDate as string) ?? (md.publishedTime as string) ?? undefined,
    media: image ? { thumbnail: image, thumbnailHi: image } : undefined,
  };
}

/**
 * Run a single discovery query through the provider-agnostic Discovery Router.
 *
 * Firecrawl is now only ONE optional provider inside the router: if it is out
 * of credits, rate limited, unauthenticated or unreachable, the router keeps
 * serving results from any other configured provider (SerpApi, Brave), so a
 * Firecrawl outage can never zero out general-web discovery.
 */
async function fcSearch(q: string, limit: number, _scrape = false): Promise<RawHit[]> {
  const { currentDiscoveryRouter } = await import("@/lib/scan/discovery/router.server");
  const router = currentDiscoveryRouter();
  const hits = await router.search(q, limit);
  return hits as unknown as RawHit[];
}

/** Same as fcSearch but skips queries already executed during this scan. */
async function routerSearchUnique(q: string, limit: number): Promise<RawHit[]> {
  const { currentDiscoveryRouter } = await import("@/lib/scan/discovery/router.server");
  const router = currentDiscoveryRouter();
  const hits = await router.search(q, limit, { skipDuplicates: true });
  return hits as unknown as RawHit[];
}

async function runFirecrawl(
  query: string,
  aliases: string[],
  handles: string[],
  sources: SourceKey[],
  limit: number,
): Promise<{
  runs: { source: string; raw: RawHit[] }[];
  error?: string;
  queriesExecuted: number;
  queriesPlanned: number;
  queriesFailed: number;
}> {
  const { generateExpandedQueries } = await import("@/lib/firecrawl/query-generator");
  const queryGroups = generateExpandedQueries(query, aliases, handles);

  const runsMap = new Map<string, RawHit[]>();
  const errors: string[] = [];

  /*
   * COVERAGE FIX: previously only the first 4 queries of every group ran, which
   * threw away most of the planned query plan before any discovery happened.
   * Every planned query now executes, through a bounded concurrency pool.
   */
  const plan = Array.from(
    new Set(queryGroups.flatMap((group) => group.queries.map((q) => q.trim()).filter(Boolean))),
  );
  const queriesPlanned = plan.length;
  let queriesExecuted = 0;
  let queriesFailed = 0;
  let cursor = 0;
  const CONCURRENCY = 6;

  async function worker() {
    while (cursor < plan.length) {
      const q = plan[cursor++];
      queriesExecuted++;
      try {
        const hits = await fcSearch(q, limit);
        for (const hit of hits) {
          const { source } = platformFromUrl(hit.url || "");
          const label = source || "Web";
          if (!runsMap.has(label)) runsMap.set(label, []);
          runsMap.get(label)!.push({ ...hit, queryUsed: q });
        }
      } catch (e) {
        queriesFailed++;
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, plan.length) }, worker));

  console.log(
    `[scan:queries] planned=${queriesPlanned} executed=${queriesExecuted} failed=${queriesFailed}`,
  );

  const runs = Array.from(runsMap.entries()).map(([source, raw]) => ({ source, raw }));
  if (runs.length === 0 && errors.length > 0) {
    return { runs: [], error: errors.join("; "), queriesExecuted, queriesPlanned, queriesFailed };
  }
  return { runs, queriesExecuted, queriesPlanned, queriesFailed };
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
  "controversy",
  "allegations",
  "exposed",
  "scandal",
  "leaked",
  "breaking news",
  "latest news",
  "backlash",
  "response",
  "complaint",
  "police",
  "FIR",
  "court",
  "reaction",
  "viral",
] as const;

const FC_YT_SPECIFIC_TERMS = [
  "controversy",
  "allegations",
  "exposed",
  "reaction",
  "response",
  "latest",
  "Malayalam",
  "complaint",
  "police",
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
  const emptyDiag: FcDiscoveryDiagnostics = {
    active: true,
    queriesExecuted: 0,
    rawUrls: 0,
    relevantUrls: 0,
    uniqueUrls: 0,
    youtubeUrlsDiscovered: 0,
    newsDiscovered: 0,
    socialDiscovered: 0,
    otherWebDiscovered: 0,
    tier1Queries: 0,
    tier2Queries: 0,
    platformQueries: 0,
    ytWebQueries: 0,
    expandedTermsUsed: [],
  };
  try {
    const nameForms = Array.from(new Set([query, ...aliases].map((s) => s.trim()).filter(Boolean)));
    const primary = nameForms[0];
    const quoted = `"${primary}"`;

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
    const tier1Batch = FC_CONTROVERSY_TERMS.slice(0, 8).map((term) => `${quoted} ${term}`);
    const t1 = await Promise.allSettled(
      tier1Batch.map(async (q) => {
        queriesExecuted++;
        return fcSearch(q, 5);
      }),
    );
    for (const r of t1) if (r.status === "fulfilled") absorb(r.value);

    // Second half of Tier 1 — remaining controversy terms
    const tier1BatchB = FC_CONTROVERSY_TERMS.slice(8).map((term) => `${quoted} ${term}`);
    const t1b = await Promise.allSettled(
      tier1BatchB.map(async (q) => {
        queriesExecuted++;
        return fcSearch(q, 4);
      }),
    );
    for (const r of t1b) if (r.status === "fulfilled") absorb(r.value);

    // Also search bare name + any alias forms for general coverage
    const bareResults = await Promise.allSettled(
      nameForms.slice(0, 3).map(async (name) => {
        queriesExecuted++;
        return fcSearch(`${name} news`, 4);
      }),
    );
    for (const r of bareResults) if (r.status === "fulfilled") absorb(r.value);

    const tier1Count = queriesExecuted;

    // ── STAGE 2: Extract trending keywords from Tier-1 results ────────────────
    // Dynamically discover what the current controversy is actually about.
    const expandedTerms = extractExpansionTerms(allRaw, query, aliases);
    const usedTerms: string[] = [];

    if (expandedTerms.length >= 1) {
      const tier2Queries = expandedTerms.slice(0, 5).map((term) => `${quoted} ${term}`);
      // Also try cross-referencing discovered terms with key verbs
      for (const term of expandedTerms.slice(0, 3)) {
        tier2Queries.push(`"${term}" ${primary}`);
      }
      const t2 = await Promise.allSettled(
        tier2Queries.slice(0, 6).map(async (q) => {
          queriesExecuted++;
          usedTerms.push(q);
          return fcSearch(q, 4);
        }),
      );
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
        ...FC_YT_SPECIFIC_TERMS.map((term) => `site:youtube.com/watch ${quoted} ${term}`),
        `site:youtube.com/watch "${primary}" latest 2025`,
      ].slice(0, 7);
      const ytResults = await Promise.allSettled(
        ytQueries.map(async (q) => {
          queriesExecuted++;
          ytWebCount++;
          return fcSearch(q, 5);
        }),
      );
      for (const r of ytResults) if (r.status === "fulfilled") absorb(r.value);
    }

    // ── PLATFORM DISCOVERY ────────────────────────────────────────────────────
    const platResults = await Promise.allSettled(
      FC_PLATFORM_QUERIES.slice(0, 3).map(async ({ suffix }) => {
        queriesExecuted++;
        return fcSearch(`${quoted} ${suffix}`, 4);
      }),
    );
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
    const ytUrls = allRaw.filter((h) => h.url?.includes("youtube.com")).length;
    const newsUrls = allRaw.filter((h) => {
      const { source } = platformFromUrl(h.url ?? "");
      return source === "News";
    }).length;
    const socialPlatforms = new Set(["Reddit", "Instagram", "X", "Facebook", "TikTok", "LinkedIn"]);
    const socialUrls = allRaw.filter((h) => {
      const { source } = platformFromUrl(h.url ?? "");
      return socialPlatforms.has(source);
    }).length;

    return {
      runs,
      diagnostics: {
        active: true,
        queriesExecuted,
        rawUrls: seenUrls.size,
        relevantUrls: allRaw.filter((h) => h.title && h.url).length,
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
  "controversy",
  "latest controversy",
  "controversy 2025",
  "new controversy",
  "scandal",
  "latest scandal",
  // Allegations / accusations
  "allegations",
  "allegation",
  "accused",
  "accused of",
  "accusation",
  // Exposé / investigation
  "expose",
  "exposed",
  "exposé",
  "truth about",
  "real story",
  "real truth",
  "investigation",
  "undercover",
  "probe",
  // Legal / police
  "police",
  "court",
  "FIR",
  "arrest",
  "lawsuit",
  "legal action",
  "case filed",
  "complaint filed",
  // Breaking / news
  "breaking news",
  "latest news",
  "news today",
  "news update",
  "latest update",
  // Response / aftermath
  "response",
  "apology",
  "statement",
  "clarification",
  "reacts",
  "reaction",
  // Negative actions
  "backlash",
  "slammed",
  "trolled",
  "called out",
  "cancelled",
  "boycott",
  // Content risk
  "leaked",
  "leak",
  "viral controversy",
  "viral video",
  // Specific risk types
  "deepfake",
  "fake account",
  "impersonation",
  "fake ad",
  "harassment",
  "abuse",
  // Temporal freshness
  "trending",
  "latest",
  "update",
  "new video",
  // Malayalam / regional variants
  "controversy Malayalam",
  "controversy Kerala",
  "latest Malayalam news",
];

// ── Tier-2: Broader risk terms ─ run with "relevance" ordering ───────────────
const YT_RISK_TERMS = [
  "fraud",
  "scam",
  "dark side",
  "complaint",
  "trolling",
  "issue",
  "discussion",
  "interview",
  "roast",
  "cringe",
  "drama",
  "rant",
  "hate",
  "reply",
  "misinformation",
  "hoax",
  "rumor",
  "rumour",
  "copyright",
  "reupload",
  "endorsement",
  "defamation",
  "criticism",
  "criticized",
  "negative review",
  "bad review",
];

interface YtThumb {
  url?: string;
  width?: number;
  height?: number;
}
interface YtSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: {
      default?: YtThumb;
      medium?: YtThumb;
      high?: YtThumb;
      standard?: YtThumb;
      maxres?: YtThumb;
    };
  };
}
interface YtVideoItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: {
      default?: YtThumb;
      medium?: YtThumb;
      high?: YtThumb;
      standard?: YtThumb;
      maxres?: YtThumb;
    };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

function pickThumb(tt?: {
  default?: YtThumb;
  medium?: YtThumb;
  high?: YtThumb;
  standard?: YtThumb;
  maxres?: YtThumb;
}): { hi?: string; std?: string } {
  const hi =
    tt?.maxres?.url || tt?.standard?.url || tt?.high?.url || tt?.medium?.url || tt?.default?.url;
  const std = tt?.high?.url || tt?.medium?.url || tt?.default?.url || hi;
  return { hi, std };
}

function parseIsoDuration(iso?: string): { sec: number; label: string } {
  if (!iso) return { sec: 0, label: "" };
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return { sec: 0, label: "" };
  const h = Number(m[1] || 0),
    mi = Number(m[2] || 0),
    s = Number(m[3] || 0);
  const sec = h * 3600 + mi * 60 + s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return { sec, label: h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}` };
}

/** Shared object threaded through all concurrent YT requests — allows instant circuit-break. */
interface QuotaFlag {
  exhausted: boolean;
  reason: string;
}

async function ytFetch<T>(
  path: string,
  params: Record<string, string>,
  key: string,
  quotaFlag?: QuotaFlag,
): Promise<T | null> {
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
        const errBody = JSON.parse(txt) as {
          error?: { errors?: { domain?: string; reason?: string }[] };
        };
        const reason = errBody?.error?.errors?.[0]?.reason ?? "";
        if (
          reason === "quotaExceeded" ||
          reason === "dailyLimitExceeded" ||
          reason === "rateLimitExceeded" ||
          r.status === 429
        ) {
          quotaFlag.exhausted = true;
          quotaFlag.reason = reason || `HTTP ${r.status}`;
          console.warn(
            `[youtube] ⚡ quota exhausted (${quotaFlag.reason}) — circuit breaker tripped`,
          );
          return null;
        }
      } catch {
        /* ignore parse errors, fall through to generic error */
      }
    }
    console.error("[youtube]", path, r.status, txt.slice(0, 200));
    return null;
  }
  return (await r.json()) as T;
}

const YT_MAX_PER_WINDOW = 500; // per pass
const YT_HARD_CAP = 2000; // total

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
  const forms = Array.from(new Set(nameForms.map((s) => s.trim()).filter(Boolean))).slice(0, 4);
  const jobs: { q: string; order: "date" | "relevance"; pages: number }[] = [];
  const riskGroups = [
    "controversy|scandal|backlash|exposed|allegation|accused",
    "defamation|slander|libel|false allegation|character assassination",
    "leaked|deepfake|impersonation|harassment|morphed",
    "police|court|arrest|lawsuit|complaint|legal notice",
    "trolled|criticism|boycott|fake|rumour|rumor",
    // Defamatory-language cluster: how real defamatory videos are actually titled.
    "cheater|liar|fraud|vulgar|insult|abusing|characterless",
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
        part: "snippet",
        q: job.q,
        type: "video",
        maxResults: "50",
        order: job.order,
        safeSearch: "none",
        publishedAfter,
        publishedBefore,
        regionCode: "IN",
      };
      if (pageToken) params.pageToken = pageToken;
      const data = await ytFetch<{ items?: YtSearchItem[]; nextPageToken?: string }>(
        "search",
        params,
        key,
        quotaFlag,
      );
      counters.pages++;
      if (!data) {
        counters.errors++;
        break;
      }
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
): Promise<{
  raw: RawHit[];
  error?: string;
  queriesUsed: number;
  pagesScanned: number;
  apiErrors: number;
  quotaExhausted: boolean;
  quotaReason?: string;
}> {
  console.log("[youtube-debug] Runtime environment", {
    hasKey: Boolean(process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY),
    keyLength: (process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY ?? "").length,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
  });

  const key = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key)
    return {
      raw: [],
      error: "GOOGLE_API_KEY missing",
      queriesUsed: 0,
      pagesScanned: 0,
      apiErrors: 0,
      quotaExhausted: false,
    };

  const nameForms = Array.from(
    new Set([query, ...aliases, ...variations].map((s) => s.trim()).filter(Boolean)),
  );
  const idToItem = new Map<string, YtSearchItem>();
  const counters = { pages: 0, errors: 0 };
  const quotaFlag: QuotaFlag = { exhausted: false, reason: "" };

  // ── Pass 1: full month range with freshness ordering (controversy-first) ─────
  // Uses the selected month's publishedAfter + publishedBefore so results are
  // strictly scoped to that calendar month.
  await fetchYTWindow(
    nameForms,
    hashtags,
    handles,
    monthWindow.ytPublishedAfter,
    monthWindow.ytPublishedBefore,
    key,
    idToItem,
    counters,
    quotaFlag,
  );

  // ── Pass 2 (this month only): inner 7-day window to boost most-recent content ──
  // For "This Month" we also run a tighter 7-day sub-window (date-ordered) so
  // breaking controversies from the last week appear at the very top.
  if (monthWindow.filter === "30d" && !quotaFlag.exhausted) {
    const day7Ago = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const today = monthWindow.ytPublishedBefore;
    // Only run the sub-window if the month started > 7 days ago
    if (new Date(day7Ago) > new Date(monthWindow.ytPublishedAfter)) {
      await fetchYTWindow(
        nameForms,
        hashtags,
        handles,
        day7Ago,
        today,
        key,
        idToItem,
        counters,
        quotaFlag,
      );
    }
  }

  if (quotaFlag.exhausted) {
    console.warn(
      `[youtube] quota exhausted after ${idToItem.size} discoveries; returning partial results`,
    );
  }

  // ── Fetch full video metadata for all discovered IDs ────────────────────
  const targetCount = Math.min(300, Math.max(25, targetResults), idToItem.size);
  const ids = Array.from(idToItem.keys()).slice(0, targetCount);
  const statsById = new Map<string, YtVideoItem>();
  for (let i = 0; i < ids.length; i += 50) {
    if (quotaFlag.exhausted) break;
    const batch = ids.slice(i, i + 50).join(",");
    const data = await ytFetch<{ items?: YtVideoItem[] }>(
      "videos",
      {
        part: "snippet,statistics,contentDetails",
        id: batch,
      },
      key,
      quotaFlag,
    );
    for (const v of data?.items ?? []) if (v.id) statsById.set(v.id, v);
  }

  // ── Build RawHit objects ──────────────────────────────────────────────
  const raw: RawHit[] = [];
  for (const id of ids) {
    const s = idToItem.get(id);
    const v = statsById.get(id);
    const snip = v?.snippet ?? s?.snippet;
    if (!snip) continue;
    const stats = v?.statistics;
    const viewsAvailable = stats?.viewCount != null;
    const likesAvailable = stats?.likeCount != null;
    const commentsAvailable = stats?.commentCount != null;
    const views = viewsAvailable ? Number(stats?.viewCount) : 0;
    const likes = likesAvailable ? Number(stats?.likeCount) : 0;
    const comments = commentsAvailable ? Number(stats?.commentCount) : 0;
    const thumbs = pickThumb(snip.thumbnails);
    const dur = parseIsoDuration(v?.contentDetails?.duration);
    const published = snip.publishedAt;
    const days = published
      ? Math.max(1, (Date.now() - new Date(published).getTime()) / 86_400_000)
      : 1;
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
        channelUrl: snip.channelId
          ? `https://www.youtube.com/channel/${snip.channelId}`
          : undefined,
        duration: dur.label,
        durationSec: dur.sec,
        views,
        likes,
        comments,
        growthPerDay,
        engagementRate,
        viewsAvailable,
        likesAvailable,
        commentsAvailable,
      },
    });
  }

  const lastErr =
    counters.errors > 0 && !quotaFlag.exhausted
      ? `${counters.errors} YouTube API error(s)`
      : undefined;
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

const REDDIT_RISK_TERMS = [
  "scam",
  "fraud",
  "expose",
  "exposed",
  "controversy",
  "allegation",
  "allegations",
  "leak",
  "leaked",
  "deepfake",
  "impersonation",
  "fake account",
  "harassment",
  "abuse",
  "defamation",
  "explicit",
  "nsfw",
  "nude",
  "porn",
];

const REDDIT_RISK_PATTERN =
  /\b(?:scam|fraud|expos(?:e|ed|ing)|controvers(?:y|ial)|allegation|alleged|defam\w*|leak(?:ed|s)?|deep\s?fake|deepfake|impersonat\w*|fake\s+(?:account|profile|video|photos?)|harass\w*|abus(?:e|ive)|explicit|nsfw|nude|naked|porn|xxx|sex\s+tape|morphed|face\s?swap|complaint|cheat\w*|troll\w*|hate)\b/i;

/* ── Reddit reputation-risk classification ─────────────────────────────────
   Classifies each collected Reddit result into reputation-risk categories and
   produces a 0-100 risk score plus a short human-readable reason.            */

export type RedditRiskCategory =
  | "Defamation"
  | "Scam/Fraud"
  | "Allegations"
  | "Expose"
  | "Harassment"
  | "Impersonation"
  | "Deepfake"
  | "NSFW/Explicit"
  | "Privacy Leak";

interface RedditRiskClassification {
  categories: RedditRiskCategory[];
  score: number;
  reason: string;
}

const REDDIT_RISK_CLASSES: Array<{
  category: RedditRiskCategory;
  weight: number;
  pattern: RegExp;
}> = [
  {
    category: "Defamation",
    weight: 70,
    pattern:
      /\b(?:defam\w*|slander\w*|libel\w*|false\s+(?:claim|claims|statement|statements|accusation\w*)|character\s+assassination|smear\s+campaign|malicious\s+rumou?rs?)\b/i,
  },
  {
    category: "Scam/Fraud",
    weight: 75,
    pattern:
      /\b(?:scam(?:mer|med|ming|s)?|fraud(?:ulent|ster)?|ponzi|phishing|cheat(?:ed|ing|er)?|money\s+laundering|fake\s+(?:investment|giveaway|payment)|ripoff|rip[-\s]off|conned?|swindl\w*)\b/i,
  },
  {
    category: "Allegations",
    weight: 60,
    pattern:
      /\b(?:allegation\w*|alleged(?:ly)?|accus(?:ed|ation\w*|ing)|misconduct|fir\s+filed|police\s+complaint|lawsuit|legal\s+notice|charged\s+with|under\s+investigation)\b/i,
  },
  {
    category: "Expose",
    weight: 55,
    pattern:
      /\b(?:expos(?:e|ed|ing|é)|exposé|call(?:ed|ing)?\s+out|truth\s+about|the\s+real\s+story|scandal|controvers(?:y|ial)|drama|receipts)\b/i,
  },
  {
    category: "Harassment",
    weight: 65,
    pattern:
      /\b(?:harass\w*|bull(?:y|ied|ying)|cyberbully\w*|trolling|troll(?:ed|s)?|hate\s+(?:campaign|speech|comments)|abusive|abuse|threats?|doxx?(?:ed|ing)?|stalk(?:ed|ing|er))\b/i,
  },
  {
    category: "Impersonation",
    weight: 70,
    pattern:
      /\b(?:impersonat\w*|fake\s+(?:account|profile|page|handle|id)|catfish\w*|pretending\s+to\s+be|posing\s+as|clone\s+(?:account|profile))\b/i,
  },
  {
    category: "Deepfake",
    weight: 85,
    pattern:
      /\b(?:deep\s?fake\w*|face\s?swap\w*|morph(?:ed|ing)|ai[-\s]generated\s+(?:image|images|video|videos|photo|photos)|synthetic\s+(?:media|video)|fake\s+(?:video|photos?|images?))\b/i,
  },
  {
    category: "NSFW/Explicit",
    weight: 90,
    pattern:
      /\b(?:nsfw|nude\w*|naked|topless|porn\w*|xxx|sex\s+(?:tape|video|clip)|explicit\s+(?:content|video|photos?)|onlyfans|erotic)\b/i,
  },
  {
    category: "Privacy Leak",
    weight: 80,
    pattern:
      /\b(?:leak(?:ed|s|ing)?|private\s+(?:photos?|videos?|chats?|messages?|number)|personal\s+(?:details|information)\s+(?:leak|exposed)|data\s+breach|mms|address\s+leaked)\b/i,
  },
];

function classifyRedditRisk(hit: RawHit): RedditRiskClassification {
  const text = `${hit.title ?? ""} ${hit.description ?? hit.snippet ?? ""} ${hit.url ?? ""}`;

  const matched = REDDIT_RISK_CLASSES.filter((entry) => entry.pattern.test(text));

  if (!matched.length) {
    return {
      categories: [],
      score: 10,
      reason: "Identity mentioned in a Reddit discussion with no explicit reputation-risk signal",
    };
  }

  const sorted = [...matched].sort((a, b) => b.weight - a.weight);
  const primary = sorted[0];

  /* Highest-weight category dominates; each additional distinct category
     adds a smaller escalation for compounded reputational harm. */
  let score = primary.weight + Math.min(20, (sorted.length - 1) * 7);

  /* A title-level signal is stronger evidence than a buried comment mention. */
  if (primary.pattern.test(hit.title ?? "")) score += 6;

  const categories = sorted.map((entry) => entry.category);
  const label = categories.join(", ");

  return {
    categories,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reason:
      categories.length > 1
        ? `Reddit discussion shows ${label.toLowerCase()} signals about the monitored identity`
        : `Reddit discussion contains ${label.toLowerCase()} language about the monitored identity`,
  };
}

async function runReddit(
  query: string,
  aliases: string[],
  monthWindow: MonthWindow,
): Promise<{ raw: RawHit[]; error?: string }> {
  const nameForms = Array.from(new Set([query, ...aliases].map((s) => s.trim()).filter(Boolean)));
  if (!nameForms.length) return { raw: [] };

  const searchTerms = nameForms
    .map((name) => (name.includes(" ") ? `"${name.replaceAll('"', "")}"` : name))
    .join(" OR ");
  const errors: string[] = [];
  const raw: RawHit[] = [];

  let t = "all";
  if (monthWindow.filter === "24h") t = "day";
  else if (monthWindow.filter === "7d") t = "week";
  else if (monthWindow.filter === "30d") t = "month";
  else if (monthWindow.filter === "12m") t = "year";

  const riskGroup = `(${REDDIT_RISK_TERMS.map((term) =>
    term.includes(" ") ? `"${term}"` : term,
  ).join(" OR ")})`;

  /* Direct public Reddit search: posts (relevance + newest) and comments. */
  const redditRequests: Array<{ q: string; sort: string; type?: string; t: string }> = [
    { q: searchTerms, sort: "relevance", t },
    { q: searchTerms, sort: "new", t: "all" },
    { q: `(${searchTerms}) AND ${riskGroup}`, sort: "relevance", t: "all" },
    { q: `(${searchTerms}) AND ${riskGroup}`, sort: "new", t: "all" },
    { q: `(${searchTerms}) AND ${riskGroup}`, sort: "relevance", t: "all", type: "comment" },
  ];

  const fetchReddit = async (req: (typeof redditRequests)[number]) => {
    const url = new URL("https://www.reddit.com/search.json");
    url.searchParams.set("q", req.q);
    url.searchParams.set("sort", req.sort);
    url.searchParams.set("t", req.t);
    url.searchParams.set("limit", "100");
    url.searchParams.set("raw_json", "1");
    if (req.type) url.searchParams.set("type", req.type);

    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "EternaSentinel/1.0 public-reputation-monitoring",
        },
      },
      10_000,
    );

    if (!res.ok || !res.headers.get("content-type")?.includes("json")) {
      throw new Error(`Reddit public search returned ${res.status}`);
    }

    const data = await res.json();
    const out: RawHit[] = [];
    for (const child of data?.data?.children ?? []) {
      const item = child?.data;
      if (!item?.permalink || item.removed_by_category) continue;
      const published = item.created_utc
        ? new Date(item.created_utc * 1000).toISOString()
        : undefined;
      const isComment = child?.kind === "t1" || Boolean(item.body);
      const title = String(
        item.title || item.link_title || (isComment ? "Reddit comment" : "Reddit discussion"),
      );
      const snippet = String(item.body || item.selftext || item.title || "").slice(0, 800);
      const thumb =
        typeof item.thumbnail === "string" && item.thumbnail.startsWith("http")
          ? item.thumbnail
          : undefined;

      out.push({
        url: new URL(item.permalink, "https://www.reddit.com").toString(),
        title,
        description: snippet,
        snippet,
        author: String(item.author || "anonymous"),
        date: published,
        publishedDate: published,
        media: thumb ? { thumbnail: thumb, thumbnailHi: thumb } : undefined,
      });
    }
    return out;
  };

  const directSettled = await Promise.allSettled(redditRequests.map(fetchReddit));
  for (const result of directSettled) {
    if (result.status === "fulfilled") raw.push(...result.value);
    else
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  /* Reddit blocks unauthenticated JSON from many cloud IPs. Fall back to the
     indexed public web instead of coupling Reddit coverage to YouTube state. */
  if (raw.length < 10) {
    const redditQueries = [
      `site:reddit.com ${searchTerms}`,
      `site:reddit.com ${searchTerms} (scam OR fraud OR expose OR controversy OR allegations OR leaked OR deepfake OR impersonation)`,
      `site:reddit.com ${searchTerms} (harassment OR abuse OR defamation OR explicit OR nsfw OR nude OR porn)`,
      `site:reddit.com ${searchTerms} comments`,
    ];
    const settled = await Promise.allSettled(
      redditQueries.map((redditQuery) => fcSearch(redditQuery, 10)),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") raw.push(...result.value);
      else
        errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const identities = nameForms.map((name) => {
    const normalized = normalize(name);
    return {
      full: normalized,
      tokens: normalized.split(" ").filter((token) => token.length >= 4),
    };
  });

  /*
   * Relevance keeps every discussion that plausibly concerns the monitored
   * identity — full-name matches rank highest, but partial/token matches and
   * risk-topic threads are retained too instead of being dropped.
   */
  const relevance = (hit: RawHit) => {
    const title = normalize(hit.title ?? "");
    const description = normalize(hit.description ?? hit.snippet ?? "");
    const urlText = normalize(hit.url ?? "");
    const haystack = `${title} ${description} ${urlText}`;

    let score = 0;
    for (const identity of identities) {
      if (!identity.full) continue;
      if (title.includes(identity.full)) score = Math.max(score, 100);
      else if (description.includes(identity.full) || urlText.includes(identity.full)) {
        score = Math.max(score, 75);
      } else if (identity.tokens.length) {
        const matched = identity.tokens.filter((token) => haystack.includes(token));
        if (matched.length === identity.tokens.length) score = Math.max(score, 70);
        else if (matched.length) score = Math.max(score, 45);
      }
    }

    if (
      REDDIT_RISK_PATTERN.test(`${hit.title ?? ""} ${hit.description ?? ""} ${hit.snippet ?? ""}`)
    ) {
      score += 30;
    }

    return score;
  };

  const unique = new Map<string, RawHit>();
  for (const hit of raw.sort((a, b) => relevance(b) - relevance(a))) {
    if (!hit.url || relevance(hit) < 40) continue;
    try {
      const parsed = new URL(hit.url);
      parsed.hash = "";
      for (const key of [...parsed.searchParams.keys()]) {
        if (/^(?:utm_|ref$|share_id$)/i.test(key)) parsed.searchParams.delete(key);
      }
      const key = `${parsed.hostname.replace(/^www\./, "").toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
      if (!unique.has(key)) unique.set(key, { ...hit, url: parsed.toString() });
    } catch {
      continue;
    }
  }

  /* Classify every collected Reddit result by reputation risk, then rank
     risk-bearing discussions above neutral mentions. */
  const results = Array.from(unique.values())
    .map((hit) => ({ ...hit, redditRisk: classifyRedditRisk(hit) }))
    .sort((a, b) => b.redditRisk.score - a.redditRisk.score || relevance(b) - relevance(a))
    .slice(0, 80);
  return results.length
    ? { raw: results }
    : { raw: [], error: errors.join("; ") || "No indexed Reddit discussions found" };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECOND-STAGE KEYWORD EXTRACTION
   Pulls trending terms from the first-pass results so we can run an expansion
   search to catch content we didn't directly query for.
═══════════════════════════════════════════════════════════════════════════ */
function extractExpansionTerms(raw: RawHit[], query: string, aliases: string[]): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "is",
    "in",
    "at",
    "of",
    "on",
    "to",
    "for",
    "with",
    "by",
    "this",
    "that",
    "was",
    "are",
    "from",
    "have",
    "has",
    "been",
    "not",
    "but",
    "its",
    "his",
    "her",
    "their",
    "he",
    "she",
    "we",
    "you",
    "they",
    "it",
  ]);
  const entityNames = new Set([query.toLowerCase(), ...aliases.map((a) => a.toLowerCase())]);
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
  audit?: { funnel: ScanPipelineFunnel; leads: PersistLeadInput[] },
): ReputationReport {
  const now = new Date().toISOString();
  const dedupe = new Map<string, ScanHit>();
  const duplicates: ScanHit[] = [];
  const sourcesReturned = new Set<string>();
  let totalRaw = 0;
  let idx = 0;
  const normalizeEntity = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_-]+/g, " ")
      // Malayalam is intentionally included so entity matching preserves the script.
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[^a-zA-Z0-9\u0D00-\u0D7F ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const entityForms = Array.from(
    new Set([query, ...aliases].map(normalizeEntity).filter((value) => value.length >= 3)),
  );
  const entityTokenSets = entityForms.map((form) =>
    form.split(" ").filter((token) => token.length >= 4),
  );

  for (const run of runs) {
    if (run.raw.length) sourcesReturned.add(run.source);
    for (const o of run.raw) {
      totalRaw++;
      const url = o.url ?? "";
      if (!url) continue;
      const title = (o.title ?? url).slice(0, 240);
      const description = (o.description ?? o.snippet ?? "").slice(0, 800);
      const { platform, source } = platformFromUrl(url);
      const pageText = o.pageText ?? null;
      /*
       * IDENTITY GATE (confidence-scored, not binary).
       * Only NOT_SUBJECT is dropped, and that verdict requires page text —
       * a missing search snippet can never delete a candidate any more.
       */
      const identity = scoreIdentity({
        target: query,
        aliases,
        title,
        description,
        snippet: o.snippet,
        url,
        author: o.author ?? o.media?.channelTitle,
        pageText,
      });
      if (audit) {
        audit.funnel.discovered++;
        if (identity.tier === "VERIFIED") audit.funnel.verified++;
        else if (identity.tier === "PROBABLE") audit.funnel.probable++;
      }
      if (identity.tier === "NOT_SUBJECT") {
        if (audit) {
          countExclusion(audit.funnel, "identity_not_subject");
          audit.leads.push({
            url,
            canonicalUrl: url,
            title,
            source: source || run.source,
            platform,
            query: o.queryUsed ?? null,
            stage: "excluded",
            identity_tier: identity.tier,
            identity_confidence: identity.confidence,
            matched_signals: identity.matchedSignals,
            failed_signals: identity.failedSignals,
            exclusion_reason: "identity_not_subject",
            extractor: o.extractor ?? null,
            page_excerpt: pageText ? pageText.slice(0, 1200) : null,
            severity: null,
            threat_score: null,
          });
        }
        continue;
      }



      let c = classify(title, description);
      const sent = sentimentOf(`${title} ${description}`);
      const contentPosition = inferAutomatedContentPosition(title, description);
      const contextOnlyTerms = new Set([
        "controversy",
        "controversial",
        "backlash",
        "responds to",
        "response video",
        "reaction video",
        "trolled",
        "moral policing",
      ]);
      const onlyContextSignals =
        c.keywords.length > 0 && c.keywords.every((term) => contextOnlyTerms.has(term));
      if (contentPosition === "SUPPORTIVE" || onlyContextSignals) {
        c = {
          ...c,
          sev: "Low",
          score: Math.min(c.score, 28),
          legalTakedown: 0,
          copyrightEnforce: 0,
          reputation: Math.min(c.reputation, 18),
        };
      }
      const riskMatched = c.keywords.length > 0 || sent === "Negative";
      const isOfficialYouTubeLead =
        (source === "YouTube" || run.source === "YouTube") && Boolean(o.media?.videoId);
      const isYouTubeLead = source === "YouTube" || run.source === "YouTube";
      const isRedditEntityLead = source === "Reddit" || run.source === "Reddit";
      /*
       * NO SNIPPET-ONLY DELETION. Previously a web result without a risk keyword
       * in its 800-char snippet was discarded outright. Uncertain candidates are
       * now kept and flagged NEEDS_REVIEW so coverage is auditable.
       */
      const needsReview =
        !riskMatched || identity.tier === "AMBIGUOUS" || identity.tier === "PROBABLE";
      if (audit && needsReview) audit.funnel.needs_review++;
      const cred = credibilityScore(source, platform);
      const realViews = o.media?.views ?? 0;
      const viewsAvailable = o.media?.viewsAvailable === true;
      const likesAvailable = o.media?.likesAvailable === true;
      const commentsAvailable = o.media?.commentsAvailable === true;
      const reach = viewsAvailable ? realViews : 0;
      const engagement =
        (likesAvailable ? (o.media?.likes ?? 0) : 0) +
        (commentsAvailable ? (o.media?.comments ?? 0) : 0);
      idx++;
      const virality = Math.min(
        100,
        Math.round(reach / 5000 + (c.sev === "Critical" ? 28 : c.sev === "High" ? 18 : 7)),
      );

      // Recency-weighted threat score — freshness is a first-class signal
      const published = o.publishedDate ?? o.date;
      const ageDays = ageDaysOf(published);
      // Recency curve: 24h → 100, 7d → 85, 30d → 65, 90d → 45, 365d → 22
      const recency = Math.max(10, Math.round(100 * Math.exp(-ageDays / 40)));
      const threat = Math.min(
        100,
        Math.round(
          c.score * 0.2 +
            cred * 0.14 +
            Math.min(100, reach / 5000) * 0.15 +
            Math.min(100, engagement / 500) * 0.1 +
            recency * 0.26 + // freshness is the largest single weight
            virality * 0.1 +
            60 * 0.05,
        ),
      );

      /* Reddit results carry their own reputation-risk classification. */
      const redditRisk = isRedditEntityLead ? o.redditRisk : undefined;

      const detectionReason = redditRisk
        ? redditRisk.categories.length
          ? `Reddit risk ${redditRisk.score}/100 · ${redditRisk.categories.join(", ")} · ${redditRisk.reason}`
          : `Reddit risk ${redditRisk.score}/100 · ${redditRisk.reason}`
        : c.keywords.length
          ? `Matched: ${c.keywords.slice(0, 4).join(", ")}${sent === "Negative" ? " · negative sentiment" : ""}`
          : sent === "Negative"
            ? "Negative sentiment in title/description"
            : isOfficialYouTubeLead
              ? "Official YouTube API · named-entity monitoring lead"
              : isRedditEntityLead
                ? "Indexed Reddit discussion · exact named-entity match"
                : "Named-entity match";

      const hit: ScanHit = {
        id: `hit-${idx}`,
        title,
        url,
        description,
        platform,
        source: source || run.source,
        author: o.author ?? o.media?.channelTitle,
        published,
        discoveredAt: now,
        lastChecked: now,
        category: c.category,
        contentLabel: labelOf(c.category, sent, source || run.source),
        severity: c.sev,
        sentiment: sent,
        confidence: Math.min(97, 52 + Math.round(c.score / 3.5)),
        threatScore: threat,
        credibilityScore: cred,
        viralityScore: virality,
        copyrightRisk: c.copyrightEnforce,
        reputationRisk: Math.max(
          redditRisk?.score ?? 0,
          Math.min(100, c.reputation + (sent === "Negative" ? 8 : 0)),
        ),
        reachEstimate: reach,
        engagement,
        recommendedAction:
          contentPosition === "SUPPORTIVE" || onlyContextSignals
            ? "Preserve and review; no apparent violation from title or metadata alone"
            : "Preserve and conduct human review before selecting any platform or legal action",
        keywords: redditRisk?.categories.length
          ? Array.from(new Set([...redditRisk.categories, ...c.keywords]))
          : c.keywords,
        language: "en",
        viral: reach > 250000 || c.sev === "Critical",
        media: o.media,
        detectionReason,
        freshnessWindow: freshnessWindowOf(ageDays),
        legalTakedownPotential: c.legalTakedown,
        copyrightEnforcementPotential: c.copyrightEnforce,
        whyItMatters: whyItMattersFor(c.category, c.sev, sent),
        contentPosition,
        identityTier: identity.tier,
        identityConfidence: identity.confidence,
        identityReason: identity.reason,
        reviewStatus: needsReview ? "NEEDS_REVIEW" : "VERIFIED",
        searchQueryUsed: o.queryUsed,
        pageExcerpt: pageText ? pageText.slice(0, 600) : undefined,
        metricsAvailable: {
          views: viewsAvailable,
          likes: likesAvailable,
          comments: commentsAvailable,
        },
        scoring: {
          relevance: identity.confidence,
          harm: c.score,
          credibility: cred,
          virality,
          evidenceCompleteness: Math.round(
            ([published, o.author, o.media?.channelId, viewsAvailable].filter(Boolean).length / 4) *
              100,
          ),
          legalActionability: c.legalTakedown,
          overallPriority: threat,
          version: "evidence-risk-v2.0",
        },
      };

      if (audit) {
        audit.leads.push({
          url,
          canonicalUrl: url,
          title,
          source: source || run.source,
          platform,
          query: o.queryUsed ?? null,
          stage: needsReview ? "needs_review" : "verified",
          identity_tier: identity.tier,
          identity_confidence: identity.confidence,
          matched_signals: identity.matchedSignals,
          failed_signals: identity.failedSignals,
          exclusion_reason: null,
          extractor: o.extractor ?? null,
          page_excerpt: pageText ? pageText.slice(0, 1200) : null,
          severity: c.sev,
          threat_score: threat,
        });
      }

      if (dedupe.has(url)) {
        duplicates.push(hit);
        if (audit) audit.funnel.duplicates_removed++;
        continue;
      }
      dedupe.set(url, hit);
    }
  }
  if (audit) audit.funnel.unique = dedupe.size;


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
  let keptUndated = 0;
  let keptDated = 0;

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
    if (inside) {
      keptDated++;
    } else {
      rejectedByDate++;
    }
    return inside;
  };

  const filteredHits = allBeforeFilter.filter(inWindow);

  // ── Server-side diagnostic logging (console only, never in client response) ──
  const srcBreakdown = allBeforeFilter.reduce(
    (acc, h) => {
      acc[h.source] = (acc[h.source] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log(`[scan:filter] query="${query}" range=${monthWindow.label}`);
  console.log(`[scan:filter]   raw dedupe total  : ${totalBeforeFilter}`);
  console.log(`[scan:filter]   kept (dated)       : ${keptDated}`);
  console.log(`[scan:filter]   kept (undated)      : ${keptUndated}`);
  console.log(`[scan:filter]   rejected (out-of-window): ${rejectedByDate}`);
  console.log(`[scan:filter]   final hits          : ${filteredHits.length}`);
  console.log(`[scan:filter]   by source (pre-filter): ${JSON.stringify(srcBreakdown)}`);
  if (filteredHits.length === 0) {
    console.warn(`[scan:filter] ⚠ ZERO RESULTS — pre-filter had ${totalBeforeFilter} hits.`);
    if (totalBeforeFilter === 0)
      console.warn(`[scan:filter]   → Firecrawl/YouTube returned no raw hits at all.`);
    else if (rejectedByDate === totalBeforeFilter)
      console.warn(
        `[scan:filter]   → ALL hits rejected by date filter (all have dates outside ${monthWindow.label}).`,
      );
  }

  // ── Threat Ranking Sort ───────────────────────────────────────────────────
  // Sort hits by deterministic threat ranking score descending so critical/high
  // actionable threats (defamation, deepfakes, leaks, impersonation) rank first.
  const hits = sortScanHitsByThreat(filteredHits);

  // Step 1: Log classification per result
  hits.forEach((h) => {
    const cat = canonicalCategoryFor(h);
    console.log("[scan:classify]", {
      title: h.title,
      url: h.url,
      platform: h.platform,
      provider: h.source,
      severity: h.severity,
      threat_category: cat,
      confidence: h.confidence,
      official_content: cat === "official_content",
      neutral_mention: cat === "neutral_mention",
      insufficient_evidence: h.contentLabel === "Insufficient evidence",
      ranking_score: h.threatScore,
    });
  });

  // Step 2 & 9: Log ranking diagnostics
  logRankingDiagnostics(hits, totalBeforeFilter, true);

  // Critical and High threats must exclude official/harmless content
  const critical = hits.filter((h) => h.severity === "Critical" && !isHarmlessOrOfficial(h));
  const high = hits.filter((h) => h.severity === "High" && !isHarmlessOrOfficial(h));
  const negative = hits.filter((h) => h.sentiment === "Negative");
  const viral = hits.filter((h) => h.viral);
  const totalReach = hits.reduce((a, h) => a + h.reachEstimate, 0);
  const avgThreat = hits.length
    ? Math.round(hits.reduce((a, h) => a + h.threatScore, 0) / hits.length)
    : 0;

  // ── Buckets ───────────────────────────────────────────────────────────────
  const byWindow = (w: FreshnessWindow) => hits.filter((h) => h.freshnessWindow === w);
  const byCat = (...cats: Category[]) => hits.filter((h) => cats.includes(h.category));

  const buckets = {
    // Time-window buckets — primary discovery view
    breaking: byWindow("24h"),
    recent3d: byWindow("3d"),
    recent7d: byWindow("7d"),
    recent30d: byWindow("30d"),
    // Risk category buckets
    critical,
    high,
    highRisk: hits.filter((h) => h.severity === "Critical" || h.severity === "High"),
    viral,
    defamation: byCat("Defamation"),
    expose: byCat("Exposé", "Allegation"),
    leaks: byCat("Leak"),
    controversies: byCat("Controversy", "Boycott"),
    copyright: byCat("Copyright", "Reaction/Reupload"),
    deepfake: byCat("Deepfake"),
    impersonation: byCat("Impersonation", "Fake Endorsement"),
    harassment: byCat("Harassment"),
    legal: byCat("Legal Dispute"),
    // Source buckets
    news: hits.filter((h) => h.source === "News"),
    youtube: hits.filter((h) => h.source === "YouTube"),
    reddit: hits.filter((h) => h.source === "Reddit"),
    facebook: hits.filter((h) => h.source === "Facebook"),
    instagram: hits.filter((h) => h.source === "Instagram"),
    reviews: hits.filter((h) => h.category === "Review" || h.category === "Complaint"),
    emerging: hits.filter((h) => h.viralityScore >= 60 && h.severity !== "Critical").slice(0, 12),
    duplicates,
  };

  // ── Calibrated observed-risk score ────────────────────────────────────────
  // This is an evidence-based risk index, not a popularity score. Missing
  // platform metrics never become invented reach or engagement.
  const risk = (arr: ScanHit[]) =>
    arr.length ? Math.round(arr.reduce((a, h) => a + h.threatScore, 0) / arr.length) : 0;
  const scoreBreakdown = [
    { key: "news", label: "News Risk", value: risk(buckets.news) },
    {
      key: "social",
      label: "Social Media Risk",
      value: risk([
        ...buckets.facebook,
        ...buckets.instagram,
        ...hits.filter((h) => h.source === "X" || h.source === "TikTok"),
      ]),
    },
    { key: "youtube", label: "YouTube Risk", value: risk(buckets.youtube) },
    { key: "reddit", label: "Reddit Risk", value: risk(buckets.reddit) },
    { key: "impersonation", label: "Impersonation Risk", value: risk(buckets.impersonation) },
    { key: "deepfake", label: "Deepfake Risk", value: risk(buckets.deepfake) },
    { key: "legal", label: "Legal Risk", value: risk(buckets.legal) },
    {
      key: "virality",
      label: "Virality Risk",
      value: hits.length
        ? Math.round(hits.reduce((a, h) => a + h.viralityScore, 0) / hits.length)
        : 0,
    },
  ];

  const severityFactor: Record<Severity, number> = {
    Critical: 1,
    High: 0.74,
    Medium: 0.42,
    Low: 0.16,
  };
  const categoryFactor: Partial<Record<Category, number>> = {
    Deepfake: 1,
    Defamation: 1,
    Leak: 0.96,
    Impersonation: 0.92,
    "Fake Endorsement": 0.88,
    Harassment: 0.86,
    "Legal Dispute": 0.84,
    Allegation: 0.72,
    Exposé: 0.68,
    Boycott: 0.62,
    Controversy: 0.58,
    Criticism: 0.38,
    Complaint: 0.36,
    Copyright: 0.3,
    "Reaction/Reupload": 0.24,
    Viral: 0.22,
    News: 0.14,
    Review: 0.12,
    Mention: 0.08,
  };
  const sourceCredibility: Record<string, number> = {
    News: 1,
    YouTube: 0.78,
    Reddit: 0.58,
    Facebook: 0.62,
    Instagram: 0.62,
    X: 0.6,
    TikTok: 0.56,
    Web: 0.68,
  };

  const hitRisks = hits
    .map((h) => {
      const age = ageDaysOf(h.published);
      const recency =
        age < 0
          ? 0.55
          : age <= 3
            ? 1
            : age <= 7
              ? 0.9
              : age <= 30
                ? 0.76
                : age <= 180
                  ? 0.58
                  : 0.42;
      const sourceWeight = sourceCredibility[h.source] ?? 0.62;
      const verifiedReach =
        h.reachEstimate > 0 ? Math.min(1, Math.log10(h.reachEstimate + 1) / 7) : 0;
      const sentiment = h.sentiment === "Negative" ? 1 : h.sentiment === "Neutral" ? 0.78 : 0.42;
      const severity = severityFactor[h.severity] ?? 0.16;
      const category = categoryFactor[h.category] ?? 0.18;
      return Math.min(
        100,
        100 *
          severity *
          category *
          sentiment *
          (0.56 + 0.2 * recency + 0.16 * sourceWeight + 0.08 * verifiedReach),
      );
    })
    .sort((a, b) => b - a);

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

  const datedCount = hits.filter((h) => Boolean(h.published)).length;
  const metricCount = hits.filter((h) => h.reachEstimate > 0).length;
  const sourceCount = new Set(hits.map((h) => h.source)).size;
  const coverageConfidence = hits.length
    ? Math.round(
        Math.min(
          100,
          Math.min(1, hits.length / 50) * 35 +
            Math.min(1, sourceCount / 6) * 30 +
            (datedCount / hits.length) * 20 +
            (metricCount / hits.length) * 15,
        ),
      )
    : 0;
  /*
   * Do not convert weak discovery coverage into an artificially high
   * reputation score. A small result set from only one source cannot
   * reliably represent a person's overall online reputation.
   */
  const hasReliableCoverage = hits.length >= 20 && sourceCount >= 3 && coverageConfidence >= 60;

  const reputationScore = hasReliableCoverage
    ? Math.max(0, Math.min(100, Math.round(100 - observedRisk)))
    : 50;

  const reputationLevel = !hasReliableCoverage
    ? "Insufficient Data"
    : reputationScore >= 90
      ? "Excellent"
      : reputationScore >= 75
        ? "Strong"
        : reputationScore >= 60
          ? "Stable"
          : reputationScore >= 40
            ? "At Risk"
            : reputationScore >= 20
              ? "High Risk"
              : "Critical";

  // ── Executive summary ─────────────────────────────────────────────────────
  const topicCounts = new Map<Category, number>();
  for (const h of hits) topicCounts.set(h.category, (topicCounts.get(h.category) ?? 0) + 1);
  const mostDamagingTopic =
    [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None";
  const mostInfluentialSource =
    hits.slice().sort((a, b) => b.reachEstimate - a.reachEstimate)[0]?.platform ?? "N/A";
  const fastestGrowing =
    hits
      .slice()
      .sort((a, b) => b.viralityScore - a.viralityScore)[0]
      ?.title.slice(0, 80) ?? "N/A";
  const trend: "Increasing" | "Stable" | "Decreasing" =
    buckets.breaking.length + buckets.recent3d.length >= 5
      ? "Increasing"
      : viral.length >= 3
        ? "Increasing"
        : negative.length >= hits.length * 0.45
          ? "Increasing"
          : "Stable";

  const immediateActions: string[] = [];
  if (critical.length)
    immediateActions.push(
      `Escalate ${critical.length} critical item${critical.length > 1 ? "s" : ""} to legal review`,
    );
  if (buckets.breaking.length)
    immediateActions.push(
      `${buckets.breaking.length} result${buckets.breaking.length > 1 ? "s" : ""} published in the last 24 hours — monitor for escalation`,
    );
  if (buckets.impersonation.length)
    immediateActions.push(
      `Report ${buckets.impersonation.length} suspected impersonation profile${buckets.impersonation.length > 1 ? "s" : ""}`,
    );
  if (buckets.deepfake.length)
    immediateActions.push(
      `Preserve evidence + platform takedown for ${buckets.deepfake.length} deepfake item${buckets.deepfake.length > 1 ? "s" : ""}`,
    );
  if (buckets.leaks.length)
    immediateActions.push(
      `Submit takedowns for ${buckets.leaks.length} leaked content item${buckets.leaks.length > 1 ? "s" : ""}`,
    );
  if (!immediateActions.length)
    immediateActions.push("Continue monitoring; no critical action required");

  // Diagnostic warning when summary metrics exceed rendered row counts
  const renderedCriticalCount = hits.filter(
    (h) => h.severity === "Critical" && !isHarmlessOrOfficial(h),
  ).length;
  const renderedHighCount = hits.filter(
    (h) => h.severity === "High" && !isHarmlessOrOfficial(h),
  ).length;
  const renderedBreakingCount = buckets.breaking.length;

  if (
    critical.length > renderedCriticalCount ||
    high.length > renderedHighCount ||
    buckets.breaking.length > renderedBreakingCount
  ) {
    console.warn(`[scan:diagnostic] ⚠ Diagnostic warning: summary metric discrepancy detected!`, {
      summaryCritical: critical.length,
      renderedCritical: renderedCriticalCount,
      summaryHigh: high.length,
      renderedHigh: renderedHighCount,
      summaryBreaking: buckets.breaking.length,
      renderedBreaking: renderedBreakingCount,
    });
  }

  return {
    ok: !err,
    error: err,
    query,
    aliases,
    generatedAt: now,
    period: monthWindow.label,
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
    reputationScore,
    reputationLevel,
    scoreBreakdown,
    executiveSummary: {
      headline: hasReliableCoverage
        ? `${reputationLevel} observed reputation risk (${reputationScore}/100, ${coverageConfidence}% coverage confidence) · ${critical.length} critical, ${high.length} high-priority across ${sourcesReturned.size} source${sourcesReturned.size !== 1 ? "s" : ""} · ${buckets.breaking.length} breaking (last 24h).`
        : `Insufficient coverage for a reliable overall reputation score · ${hits.length} results across ${sourcesReturned.size} source${sourcesReturned.size !== 1 ? "s" : ""} · ${coverageConfidence}% coverage confidence. Continue discovery before making a reputation assessment.`,
      mostDamagingTopic,
      mostInfluentialSource,
      fastestGrowing,
      trend,
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
        const { DiscoveryRouter, withDiscoveryRouter } = await import(
          "@/lib/scan/discovery/router.server"
        );
        /*
         * Acceptance-test switch: ?disableProviders=firecrawl forces the router
         * to run without Firecrawl so the secondary-provider path is provable.
         */
        const disabledParam = new URL(request.url).searchParams.get("disableProviders") ?? "";
        const discoveryRouter = new DiscoveryRouter({
          disable: disabledParam
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .filter((v): v is "firecrawl" | "serpapi" | "brave" =>
              v === "firecrawl" || v === "serpapi" || v === "brave",
            ),
        });
        return withDiscoveryRouter(discoveryRouter, async () => {
        try {
          const body = await request.json().catch(() => ({}));
          const query = String(body?.query ?? "")
            .trim()
            .slice(0, 200);
          if (!query) return Response.json({ ok: false, error: "Query required" }, { status: 400 });

          const aliases: string[] = Array.isArray(body?.aliases)
            ? body.aliases.map((a: unknown) => String(a).slice(0, 60)).slice(0, 20)
            : [];
          const variations: string[] = Array.isArray(body?.variations)
            ? body.variations.map((a: unknown) => String(a).slice(0, 60)).slice(0, 40)
            : [];
          const hashtags: string[] = Array.isArray(body?.hashtags)
            ? body.hashtags.map((a: unknown) => String(a).slice(0, 40)).slice(0, 20)
            : [];
          const handles: string[] = Array.isArray(body?.handles)
            ? body.handles.map((a: unknown) => String(a).slice(0, 40)).slice(0, 20)
            : [];
          const limit = Math.min(Math.max(Number(body?.limit ?? 8), 1), 10);
          const ytTarget = Math.min(Math.max(Number(body?.youtubeTarget ?? 1500), 25), 2000);
          const sources: SourceKey[] =
            Array.isArray(body?.sources) && body.sources.length
              ? body.sources.filter(
                  (s: unknown): s is SourceKey => typeof s === "string" && s in SOURCE_QUERY,
                )
              : ["web", "reddit", "youtube", "news", "x", "blogs", "forums", "reviews"];

          // Rolling scan range — defaults to the last 12 months.
          const rawMonthFilter = body?.monthFilter as string | undefined;
          const monthFilter: MonthFilter =
            rawMonthFilter === "24h" ||
            rawMonthFilter === "7d" ||
            rawMonthFilter === "30d" ||
            rawMonthFilter === "all"
              ? rawMonthFilter
              : "12m";
          const monthWindow = getMonthWindow(monthFilter);
          console.log(
            `[scan] range: ${monthWindow.label} (${monthWindow.startIso} → ${monthWindow.endIso})`,
          );

          const wantYouTube = sources.includes("youtube");
          const wantReddit = sources.includes("reddit");
          const nonYtOrRedditSources = sources.filter(
            (s) => s !== "youtube" && s !== "reddit",
          ) as SourceKey[];
          const expansionQuery = aliases.length
            ? `${query} OR ${aliases.map((a) => `"${a}"`).join(" OR ")}`
            : query;
          const controversyQuery = `${expansionQuery} controversy OR allegations OR scandal OR expose OR leaked`;

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 1 — Run YouTube, baseline Firecrawl, and Reddit concurrently
          // ══════════════════════════════════════════════════════════════════════
          const [ytSettled, fcSettled, redditSettled] =
            await Promise.allSettled([
              wantYouTube
                ? runYouTube(query, aliases, variations, hashtags, handles, ytTarget, monthWindow)
                : Promise.resolve({
                    raw: [] as RawHit[],
                    error: undefined as string | undefined,
                    queriesUsed: 0,
                    pagesScanned: 0,
                    apiErrors: 0,
                    quotaExhausted: false,
                    quotaReason: undefined as string | undefined,
                  }),
              runFirecrawl(query, aliases, handles, sources, limit),
              wantReddit
                ? runReddit(query, aliases, monthWindow)
                : Promise.resolve({ raw: [] as RawHit[], error: undefined as string | undefined }),
            ]);

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 1b — Provider-specific logging & success state checks
          // ══════════════════════════════════════════════════════════════════════
          let ytSuccess = false;
          let ytRaw: RawHit[] = [];
          let ytQuotaExhausted = false;
          let ytQueriesUsed = 0;
          let ytPagesScanned = 0;
          let ytApiErrors = 0;
          let ytError: string | undefined = undefined;
          let ytQuotaReason: string | undefined = undefined;

          if (ytSettled.status === "fulfilled") {
            const val = ytSettled.value;
            ytRaw = val.raw;
            ytQueriesUsed = val.queriesUsed;
            ytPagesScanned = val.pagesScanned;
            ytApiErrors = val.apiErrors;
            ytError = val.error;
            ytQuotaReason = val.quotaReason;
            ytQuotaExhausted =
              val.quotaExhausted || (wantYouTube && val.raw.length === 0 && val.apiErrors > 5);
            if (wantYouTube) {
              if (val.error) {
                console.error(`[scan] YouTube: error - ${val.error}`);
              } else {
                console.log(`[scan] YouTube: success (${val.raw.length} results)`);
                ytSuccess = true;
              }
            } else {
              ytSuccess = true;
            }
          } else {
            ytError = ytSettled.reason?.message || String(ytSettled.reason);
            console.error(`[scan] YouTube: error - ${ytError}`);
          }

          let fcSuccess = false;
          let fcRuns: { source: string; raw: RawHit[] }[] = [];
          let fcError: string | undefined = undefined;
          let fcQueriesExecuted = 0;
          let fcQueriesPlanned = 0;
          let fcQueriesFailed = 0;

          if (fcSettled.status === "fulfilled") {
            const val = fcSettled.value;
            fcQueriesExecuted = val.queriesExecuted;
            fcQueriesPlanned = val.queriesPlanned;
            fcQueriesFailed = val.queriesFailed;
            fcRuns = val.runs;
            if (val.error && !val.runs.length) {
              fcError = val.error;
              console.error(`[scan] Firecrawl: error - ${val.error}`);
            } else {
              fcSuccess = true;
              console.log(`[scan] Firecrawl: success (${val.runs.reduce((acc, r) => acc + r.raw.length, 0)} results, ${fcQueriesExecuted} queries)`);
            }
          } else {
            fcError = fcSettled.reason?.message || String(fcSettled.reason);
            console.error(`[scan] Firecrawl: error - ${fcError}`);
          }

          let redditSuccess = false;
          let redditRaw: RawHit[] = [];
          let redditError: string | undefined = undefined;

          if (redditSettled.status === "fulfilled") {
            const val = redditSettled.value;
            if (val.error) {
              redditError = val.error;
              console.error(`[scan] Reddit: error - ${val.error}`);
            } else {
              redditSuccess = true;
              redditRaw = val.raw;
              console.log(`[scan] Reddit: success (${val.raw.length} results)`);
            }
          } else {
            redditError = redditSettled.reason?.message || String(redditSettled.reason);
            console.error(`[scan] Reddit: error - ${redditError}`);
          }

          console.log("[scan-debug] YouTube stage result", {
            discovered: ytRaw.length,
            quotaExhausted: ytQuotaExhausted,
            apiErrors: ytApiErrors,
            queriesUsed: ytQueriesUsed,
            pagesScanned: ytPagesScanned,
            error: ytError ?? null,
          });

          console.log("[scan-debug] Initial Firecrawl result", {
            hits: fcRuns.flatMap((run) => run.raw).length,
            runs: fcRuns.length,
          });

          // Return HTTP 500 if every active provider failed
          const activeProvidersCount = (wantYouTube ? 1 : 0) + 1 + (wantReddit ? 1 : 0);
          const failedProvidersCount =
            (wantYouTube && !ytSuccess ? 1 : 0) +
            (!fcSuccess ? 1 : 0) +
            (wantReddit && !redditSuccess ? 1 : 0);

          if (failedProvidersCount === activeProvidersCount) {
            console.error("[scan] All active search providers failed.");
            return Response.json(
              {
                ok: false,
                error: `Every search provider failed to execute. YouTube: ${ytError || "none"}, Firecrawl: ${fcError || "none"}, Reddit: ${redditError || "none"}`,
              },
              { status: 500 },
            );
          }

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 2 — Firecrawl Discovery Mode (always runs if quota exhausted;
          //           also supplements when YT returns 0 results for any reason)
          // ══════════════════════════════════════════════════════════════════════
          let fcDiscovery: {
            runs: { source: string; raw: RawHit[] }[];
            diagnostics: FcDiscoveryDiagnostics;
          } | null = null;
          const ytQuotaExhaustedFinal =
            ytQuotaExhausted || (wantYouTube && ytRaw.length === 0 && ytApiErrors > 5);

          if (ytQuotaExhaustedFinal) {
            console.log("[scan] YouTube quota exhausted — activating Firecrawl Discovery Mode");
            fcDiscovery = await runFirecrawlDiscoveryMode(query, aliases, sources);
          }

          // ══════════════════════════════════════════════════════════════════════
          // STAGE 3 — Keyword expansion & multi-group consolidation
          // ══════════════════════════════════════════════════════════════════════
          const firstPassRaw = [
            ...ytRaw,
            ...redditRaw,
            ...fcRuns.flatMap((r) => r.raw),
            ...(fcDiscovery?.runs ?? []).flatMap((r) => r.raw),
          ];

          console.log("[scan-debug] Discovery totals", {
            youtube: ytRaw.length,
            firecrawlRuns: fcRuns.length,
            firecrawlRaw: fcRuns.flatMap((r) => r.raw).length,
            firecrawlDiscovery: fcDiscovery?.runs.flatMap((run) => run.raw).length ?? 0,
            firstPassRaw: firstPassRaw.length,
          });

          let expansionRuns: { source: string; raw: RawHit[] }[] = [];
          if (firstPassRaw.length >= 3) {
            const trendingTerms = extractExpansionTerms(firstPassRaw, query, aliases);
            if (trendingTerms.length >= 2) {
              const expansionQ = `${query} ${trendingTerms.slice(0, 4).join(" ")}`;
              console.log("[scan] keyword expansion query:", expansionQ);
              const fcExp = await runFirecrawl(
                expansionQ,
                aliases,
                handles,
                (["news", "web", "reddit"] as SourceKey[]).filter((s) => sources.includes(s)),
                4,
              );
              if (fcExp.runs) {
                expansionRuns = fcExp.runs;
              }
            }
          }

          // ══════════════════════════════════════════════════════════════════════
          // Stage 3b — Normalize all provider responses
          // ══════════════════════════════════════════════════════════════════════
          interface NormalizedHit {
            source: string;
            title: string;
            url: string;
            snippet: string;
            publishedAt: string;
            author: string;
            thumbnail: string;
          }

          const allNormalized: NormalizedHit[] = [];

          if (ytSuccess && ytRaw.length) {
            for (const item of ytRaw) {
              allNormalized.push({
                source: "YouTube",
                title: item.title || "",
                url: item.url || "",
                snippet: item.description || item.snippet || "",
                publishedAt: item.publishedDate || item.date || "",
                author: item.author || "",
                thumbnail: item.media?.thumbnail || "",
              });
            }
          }

          if (redditSuccess && redditRaw.length) {
            for (const item of redditRaw) {
              allNormalized.push({
                source: "Reddit",
                title: item.title || "",
                url: item.url || "",
                snippet: item.description || item.snippet || "",
                publishedAt: item.publishedDate || item.date || "",
                author: item.author || "",
                thumbnail: item.media?.thumbnail || "",
              });
            }
          }

          if (fcSuccess) {
            const combinedFcRuns = [
              ...fcRuns,
              ...expansionRuns,
              ...(fcDiscovery?.runs ?? []),
            ];
            for (const run of combinedFcRuns) {
              for (const item of run.raw) {
                const { source } = platformFromUrl(item.url || "");
                allNormalized.push({
                  source: source || run.source || "Web",
                  title: item.title || "",
                  url: item.url || "",
                  snippet: item.description || item.snippet || "",
                  publishedAt: item.publishedDate || item.date || "",
                  author: item.author || "",
                  thumbnail: item.media?.thumbnail || "",
                });
              }
            }
          }

          const {
            buildSubjectIdentityProfile,
            verifySubjectEntity,
          } = await import("@/lib/firecrawl/entity-verifier");

          const subjectProfile = buildSubjectIdentityProfile(query, [
            ...aliases,
            ...variations,
          ]);

          const OFFICIAL_NEWS_PATTERNS: RegExp[] = [
            /\b(?:24\s*news|twenty\s*four\s*news|24\s*kerala)\b/i,
            /\b(?:asianet\s*news|asianetnews|asianet\s*live)\b/i,
            /\b(?:manorama\s*news|manoramamax|mm\s*tv)\b/i,
            /\b(?:mathrubhumi\s*news|mathrubhumi\s*live)\b/i,
            /\b(?:mediaone|mediaone\s*tv|mediaone\s*news)\b/i,
            /\b(?:reporter\s*tv|reporter\s*live|reporter\s*news)\b/i,
            /\b(?:news18\s*kerala|news18\s*malayalam|news18\s*south)\b/i,
            /\b(?:kairali\s*news|kairali\s*tv|kairali\s*people)\b/i,
            /\b(?:janam\s*tv|janam\s*news)\b/i,
            /\b(?:amrita\s*news|amrita\s*tv)\b/i,
            /\b(?:ndtv|zee\s*news|republic\s*tv|times\s*now|india\s*today|abp\s*news)\b/i,
          ];

          const isOfficialNewsChannel = (channel: string, title: string = "", url: string = ""): boolean => {
            const blob = `${channel} ${title} ${url}`.toLowerCase();
            return OFFICIAL_NEWS_PATTERNS.some((pattern) => pattern.test(channel) || pattern.test(blob));
          };

          // Deduplicate by URL
          const cleanUrl = (urlStr: string): string => {
            try {
              const parsed = new URL(urlStr);
              let pathname = parsed.pathname;
              if (pathname.endsWith("/") && pathname.length > 1) {
                pathname = pathname.slice(0, -1);
              }
              return `${parsed.protocol}//${parsed.hostname}${pathname}${parsed.search}`;
            } catch {
              return urlStr.trim().toLowerCase();
            }
          };

          const funnelCounters = {
            discovered_total: allNormalized.length,
            deduplicated_total: 0,
            official_news_excluded: 0,
            verification_attempted: 0,
            verified_subject: 0,
            probable_subject: 0,
            not_subject: 0,
            verification_failed: 0,
            verification_skipped: 0,
            missing_metadata: 0,
            transcript_available: 0,
            transcript_unavailable: 0,
            classifier_called: 0,
            classifier_failed: 0,
            classifier_parse_failed: 0,
            persisted_results: 0,
            hidden_results: 0,
          };

          interface RejectedCandidateRecord {
            video_id: string;
            title: string;
            channel: string;
            rejection_stage: string;
            rejection_reason: string;
            verification_score: number;
            matched_target_signals: string[];
            failed_target_signals: string[];
            url?: string;
            thumbnail?: string;
          }

          const rejectedCandidates: RejectedCandidateRecord[] = [];
          const seenUrls = new Set<string>();
          const uniqueNormalized: NormalizedHit[] = [];

          // 1. Deduplication stage
          const deduplicatedHits: NormalizedHit[] = [];
          for (const hit of allNormalized) {
            if (!hit.url || !hit.title) {
              funnelCounters.missing_metadata++;
              rejectedCandidates.push({
                video_id: hit.url ? cleanUrl(hit.url) : `missing-${rejectedCandidates.length}`,
                title: hit.title || "Untitled",
                channel: hit.author || "Unknown",
                rejection_stage: "METADATA_CHECK",
                rejection_reason: "Missing title or URL metadata",
                verification_score: 0,
                matched_target_signals: [],
                failed_target_signals: ["missing_metadata"],
                url: hit.url,
                thumbnail: hit.thumbnail,
              });
              continue;
            }

            const cleaned = cleanUrl(hit.url);
            if (seenUrls.has(cleaned)) continue;
            seenUrls.add(cleaned);
            deduplicatedHits.push(hit);
          }

          funnelCounters.deduplicated_total = deduplicatedHits.length;

          const { classifyRemovalEligibility } = await import("@/lib/firecrawl/removal-classifier");

          const removalCounters = {
            evidence_analyzed: 0,
            evidence_sufficient: 0,
            evidence_insufficient: 0,
            evidence_unavailable: 0,
            transcript_evidence: 0,
            caption_evidence: 0,
            description_evidence: 0,
            title_only_evidence: 0,
            thumbnail_ocr_evidence: 0,
            multi_source_evidence: 0,
            title_only_but_marked_sufficient: 0,
            high_removal: 0,
            medium_removal: 0,
            low_removal: 0,
            not_eligible: 0,
            analysis_failed: 0,
            evidence_reason_counts: {} as Record<string, number>,
            removal_reason_counts: {} as Record<string, number>,
            infrastructure_reason_counts: {} as Record<string, number>,
            action_recommendation_counts: {} as Record<string, number>,
          };

          interface PerVideoAnalysisRecord {
            video_id: string;
            title: string;
            channel: string;
            subject_verification_status: string;
            verification_score: number;
            evidence_status: string;
            evidence_confidence: number;
            evidence_sources: string[];
            evidence_source_count: number;
            removal_classification: string;
            removal_score: number;
            action_recommendation: string;
            policy_signals: unknown;
            human_readable_reason: string;
            evidence_reason_codes: string[];
            removal_reason_codes: string[];
            infrastructure_reason_codes: string[];
            supporting_evidence: string[];
            transcript_available: boolean;
            analysis_version: string;
            url?: string;
            thumbnail?: string;
          }

          const perVideoAnalysisRecords: PerVideoAnalysisRecord[] = [];

          // 2. Official News Filter & Target Verification stage
          for (const hit of deduplicatedHits) {
            const videoId = hit.url.match(/(?:v=|\/embed\/|\/shorts\/|\/watch\?v=)([\w-]{6,})/)?.[1] || hit.url;

            if (isOfficialNewsChannel(hit.author, hit.title, hit.url)) {
              funnelCounters.official_news_excluded++;
              rejectedCandidates.push({
                video_id: videoId,
                title: hit.title,
                channel: hit.author || "Official News Channel",
                rejection_stage: "OFFICIAL_NEWS_FILTER",
                rejection_reason: `Excluded official news publisher (${hit.author || "News"})`,
                verification_score: 0,
                matched_target_signals: [],
                failed_target_signals: ["official_news_excluded"],
                url: hit.url,
                thumbnail: hit.thumbnail,
              });
              continue;
            }

            funnelCounters.verification_attempted++;
            funnelCounters.transcript_unavailable++; // default until transcript fetcher runs

            const verification = verifySubjectEntity(
              {
                title: hit.title || "",
                description: hit.snippet || "",
                snippet: hit.snippet || "",
                url: hit.url,
                author: hit.author || "",
                channelTitle: hit.author || "",
              },
              subjectProfile,
            );

            if (verification.subjectMatchStatus === "VERIFIED_SUBJECT" || verification.subjectMatchStatus === "MATCH") {
              funnelCounters.verified_subject++;
            } else if (verification.subjectMatchStatus === "PROBABLE_SUBJECT" || verification.subjectMatchStatus === "PROBABLE_MATCH") {
              funnelCounters.probable_subject++;
            } else if (verification.subjectMatchStatus === "VERIFICATION_FAILED") {
              funnelCounters.verification_failed++;
            } else {
              funnelCounters.not_subject++;
            }

            if (!verification.isVerifiedFinding) {
              rejectedCandidates.push({
                video_id: videoId,
                title: hit.title,
                channel: hit.author || "Unknown Channel",
                rejection_stage: "TARGET_IDENTITY_VERIFICATION",
                rejection_reason: verification.mismatchReasons.join("; ") || `Identity verification threshold not met (${verification.subjectMatchScore}/100)`,
                verification_score: verification.subjectMatchScore,
                matched_target_signals: verification.matchedTargetSignals,
                failed_target_signals: verification.failedTargetSignals,
                url: hit.url,
                thumbnail: hit.thumbnail,
              });
              continue;
            }

            // Target Verified Candidate -> Run Removal Eligibility Classification
            removalCounters.evidence_analyzed++;

            const removalRes = classifyRemovalEligibility({
              title: hit.title || "",
              snippet: hit.snippet || "",
              description: hit.snippet || "",
              author: hit.author || "",
              url: hit.url,
              subjectVerificationStatus: verification.subjectMatchStatus,
              verificationScore: verification.subjectMatchScore,
            });

            if (removalRes.evidenceStatus === "SUFFICIENT") removalCounters.evidence_sufficient++;
            else if (removalRes.evidenceStatus === "INSUFFICIENT") removalCounters.evidence_insufficient++;
            else removalCounters.evidence_unavailable++;

            if (removalRes.evidenceSources.includes("TRANSCRIPT")) removalCounters.transcript_evidence++;
            if (removalRes.evidenceSources.includes("CAPTIONS")) removalCounters.caption_evidence++;
            if (removalRes.evidenceSources.includes("DESCRIPTION")) removalCounters.description_evidence++;
            if (removalRes.evidenceSources.length === 1 && removalRes.evidenceSources.includes("TITLE")) removalCounters.title_only_evidence++;
            if (removalRes.evidenceSources.includes("THUMBNAIL_OCR")) removalCounters.thumbnail_ocr_evidence++;
            if (removalRes.evidenceSourceCount > 1) removalCounters.multi_source_evidence++;

            if (removalRes.evidenceStatus === "SUFFICIENT" && removalRes.evidenceSources.length === 1 && removalRes.evidenceSources.includes("TITLE")) {
              removalCounters.title_only_but_marked_sufficient++;
            }

            if (removalRes.removalClassification === "HIGH_REMOVAL") removalCounters.high_removal++;
            else if (removalRes.removalClassification === "MEDIUM_REMOVAL") removalCounters.medium_removal++;
            else if (removalRes.removalClassification === "LOW_REMOVAL") removalCounters.low_removal++;
            else if (removalRes.removalClassification === "ANALYSIS_FAILED") removalCounters.analysis_failed++;
            else removalCounters.not_eligible++;

            for (const code of removalRes.evidenceReasons) {
              removalCounters.evidence_reason_counts[code] = (removalCounters.evidence_reason_counts[code] || 0) + 1;
            }
            for (const code of removalRes.removalReasons) {
              removalCounters.removal_reason_counts[code] = (removalCounters.removal_reason_counts[code] || 0) + 1;
            }
            for (const code of removalRes.infrastructureReasons) {
              removalCounters.infrastructure_reason_counts[code] = (removalCounters.infrastructure_reason_counts[code] || 0) + 1;
            }

            const recCode = removalRes.actionRecommendation;
            removalCounters.action_recommendation_counts[recCode] = (removalCounters.action_recommendation_counts[recCode] || 0) + 1;

            perVideoAnalysisRecords.push({
              video_id: videoId,
              title: hit.title,
              channel: hit.author || "Unknown Channel",
              subject_verification_status: verification.subjectMatchStatus,
              verification_score: verification.subjectMatchScore,
              evidence_status: removalRes.evidenceStatus,
              evidence_confidence: removalRes.evidenceConfidence,
              evidence_sources: removalRes.evidenceSources,
              evidence_source_count: removalRes.evidenceSourceCount,
              removal_classification: removalRes.removalClassification,
              removal_score: removalRes.removalScore,
              action_recommendation: removalRes.actionRecommendation,
              policy_signals: removalRes.policySignals,
              human_readable_reason: removalRes.humanReadableReason,
              evidence_reason_codes: removalRes.evidenceReasons,
              removal_reason_codes: removalRes.removalReasons,
              infrastructure_reason_codes: removalRes.infrastructureReasons,
              supporting_evidence: removalRes.supportingEvidence,
              transcript_available: Boolean(verification.transcriptAvailable),
              analysis_version: removalRes.analysisVersion,
              url: hit.url,
              thumbnail: hit.thumbnail,
            });

            funnelCounters.persisted_results++;
            uniqueNormalized.push(hit);
          }

          // Sort by publishedAt (newest first)
          uniqueNormalized.sort((a, b) => {
            const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return dateB - dateA;
          });

          // ══════════════════════════════════════════════════════════════════════
          // Merge all runs — accumulate per source, deduplicate by URL in buildReport
          // ══════════════════════════════════════════════════════════════════════
          const allRuns = [
            ...fcRuns,
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
          if (ytRaw.length) {
            const ytRun = mergedRuns.find((r) => r.source === "YouTube");
            if (ytRun) ytRun.raw.unshift(...ytRaw);
            else mergedRuns.push({ source: "YouTube", raw: ytRaw });
          }

          if (redditRaw.length) {
            const redditRun = mergedRuns.find((r) => r.source === "Reddit");
            if (redditRun) redditRun.raw.unshift(...redditRaw);
            else mergedRuns.push({ source: "Reddit", raw: redditRaw });
          }

          const overallErr =
            !mergedRuns.some((r) => r.raw.length > 0) && !ytQuotaExhaustedFinal && !fcError
              ? "No results returned"
              : undefined;

          /* ── EXTRACTION STAGE ────────────────────────────────────────────
           * Crawl4AI (with plain-fetch fallback) fetches the full page for
           * non-API leads BEFORE identity/risk decisions are made, so nothing
           * is judged on a search snippet alone.
           */
          const pipelineFunnel = emptyScanFunnel();
          pipelineFunnel.queries_planned = fcQueriesPlanned + ytQueriesUsed;
          pipelineFunnel.queries_executed = fcQueriesExecuted + ytQueriesUsed;
          pipelineFunnel.queries_failed = fcQueriesFailed;

          const extractTargets: string[] = [];
          for (const run of mergedRuns) {
            for (const hit of run.raw) {
              if (!hit.url) continue;
              if (hit.media?.videoId) continue; // YouTube API leads already have metadata
              extractTargets.push(hit.url);
            }
          }
          try {
            const { extractPages } = await import("@/lib/scan/page-extract.server");
            const extracted = await extractPages(extractTargets, {
              concurrency: 6,
              timeoutMs: 12_000,
              max: 150,
            });
            pipelineFunnel.extraction_attempted = extracted.size;
            for (const run of mergedRuns) {
              for (const hit of run.raw) {
                const page = hit.url ? extracted.get(hit.url) : undefined;
                if (!page) continue;
                hit.extractor = page.extractor;
                if (page.ok && page.pageText) {
                  hit.pageText = page.pageText;
                  pipelineFunnel.extracted++;
                } else {
                  pipelineFunnel.extraction_failed++;
                }
              }
            }
          } catch (e) {
            console.warn(
              `[scan:extract] extraction stage failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }

          /* ── OPENAI RESEARCH LAYER (additive, best-effort) ────────────────
           * Coverage-gap detection -> new queries -> EXISTING discovery
           * providers -> Crawl4AI extraction of the new URLs only.
           * Depth is hard-capped at one research pass + one expansion pass.
           * Any failure marks OPENAI_RESEARCH_UNAVAILABLE and the scan continues.
           */
          const aiDiag = (await import("@/lib/scan/openai/types")).emptyScanAiDiagnostics();
          const { AiCallBudget, getScanAiModel, isResearchEnabled, isReasoningEnabled } =
            await import("@/lib/scan/openai/client.server");
          const aiBudget = new AiCallBudget(10);
          aiDiag.model = getScanAiModel();
          pipelineFunnel.ai = aiDiag;

          const knownUrls = new Set<string>();
          for (const run of mergedRuns) {
            for (const hit of run.raw) if (hit.url) knownUrls.add(hit.url);
          }

          if (!isResearchEnabled()) {
            aiDiag.research_status = "DISABLED";
          } else {
            try {
              const { runResearchAgent } = await import(
                "@/lib/scan/openai/research-agent.server"
              );
              /*
               * FIX: previously derived from hit provenance, which produced an
               * empty list whenever discovery providers failed. The router
               * registry holds every query actually dispatched.
               */
              const { currentDiscoveryRouter } = await import(
                "@/lib/scan/discovery/router.server"
              );
              const routerForQueries = currentDiscoveryRouter();
              const executedQueries = Array.from(
                new Set([
                  ...routerForQueries.executed(),
                  ...mergedRuns
                    .flatMap((r) => r.raw.map((h) => h.queryUsed))
                    .filter((q): q is string => Boolean(q)),
                ]),
              );
              aiDiag.base_queries_passed = executedQueries.length;
              const domainsCovered = Array.from(
                new Set(
                  Array.from(knownUrls).map((u) => {
                    try {
                      return new URL(u).hostname.replace(/^www\./, "");
                    } catch {
                      return "";
                    }
                  }),
                ),
              ).filter(Boolean);
              const evidenceSummaries = mergedRuns
                .flatMap((r) => r.raw)
                .filter((h) => h.url && (h.pageText || h.snippet || h.description))
                .slice(0, 25)
                .map((h) => ({
                  title: h.title ?? "",
                  url: h.url ?? "",
                  excerpt: (h.pageText || h.snippet || h.description || "").slice(0, 400),
                }));

              const research = await runResearchAgent(
                {
                  target: query,
                  aliases,
                  variations,
                  queriesExecuted: executedQueries,
                  domainsCovered,
                  narrativeClusters: Array.from(
                    new Set(uniqueNormalized.map((h) => h.title).filter(Boolean)),
                  ).slice(0, 30),
                  evidenceSummaries,
                },
                aiBudget,
              );

              if (!research.ok) {
                aiDiag.research_status = "OPENAI_RESEARCH_UNAVAILABLE";
                aiDiag.notes.push(`research: ${research.error}`);
              } else {
                aiDiag.research_status = "OK";
                aiDiag.coverage_assessment = research.data.coverage_assessment;
                aiDiag.missing_narratives = research.data.missing_narratives.length;

                const { planExpansionQueries, runExpansionPass } = await import(
                  "@/lib/scan/openai/expansion.server"
                );
                const suggested = planExpansionQueries(research.data, executedQueries);
                aiDiag.ai_queries_suggested = suggested.length;
                /* Dedup against base discovery AND against each other. */
                const seenExpansion = new Set(
                  executedQueries.map((q) => q.trim().replace(/\s+/g, " ").toLowerCase()),
                );
                const expansionQueries: string[] = [];
                for (const q of suggested) {
                  const key = q.trim().replace(/\s+/g, " ").toLowerCase();
                  if (!key || seenExpansion.has(key)) {
                    aiDiag.ai_queries_duplicate++;
                    continue;
                  }
                  seenExpansion.add(key);
                  expansionQueries.push(q);
                }
                aiDiag.expansion_queries_generated = expansionQueries.length;

                if (expansionQueries.length) {
                  /* Expansion uses the SAME resilient discovery router as base
                   * discovery — never Firecrawl directly. */
                  const expansion = await runExpansionPass(
                    expansionQueries,
                    (q, limit) => routerSearchUnique(q, limit) as Promise<never[]>,
                    { concurrency: 4, limitPerQuery: 5, knownUrls },
                  );
                  aiDiag.expansion_queries_executed = expansion.queriesExecuted;
                  aiDiag.ai_queries_executed = expansion.queriesExecuted;
                  aiDiag.ai_queries_failed = expansion.queriesFailed;
                  aiDiag.expansion_new_urls = expansion.hits.length;
                  pipelineFunnel.queries_planned += expansionQueries.length;
                  pipelineFunnel.queries_executed += expansion.queriesExecuted;
                  pipelineFunnel.queries_failed += expansion.queriesFailed;

                  if (expansion.hits.length) {
                    const newHits = expansion.hits as unknown as RawHit[];
                    // Extract full pages for the AI-discovered URLs (Crawl4AI first).
                    try {
                      const { extractPages } = await import(
                        "@/lib/scan/page-extract.server"
                      );
                      const newExtracted = await extractPages(
                        newHits.map((h) => h.url).filter((u): u is string => Boolean(u)),
                        { concurrency: 4, timeoutMs: 12_000, max: 60 },
                      );
                      pipelineFunnel.extraction_attempted += newExtracted.size;
                      for (const hit of newHits) {
                        const page = hit.url ? newExtracted.get(hit.url) : undefined;
                        if (!page) continue;
                        hit.extractor = page.extractor;
                        if (page.ok && page.pageText) {
                          hit.pageText = page.pageText;
                          pipelineFunnel.extracted++;
                        } else {
                          pipelineFunnel.extraction_failed++;
                        }
                      }
                    } catch (e) {
                      console.warn(
                        `[scan:ai-extract] ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }

                    const aiRun = mergedRuns.find((r) => r.source === "AI Research");
                    if (aiRun) aiRun.raw.push(...newHits);
                    else mergedRuns.push({ source: "AI Research", raw: newHits });
                  }
                }
              }
            } catch (e) {
              aiDiag.research_status = "OPENAI_RESEARCH_UNAVAILABLE";
              aiDiag.notes.push(e instanceof Error ? e.message.slice(0, 200) : "research failed");
            }
          }

          const audit = { funnel: pipelineFunnel, leads: [] as PersistLeadInput[] };


          const report = buildReport(
            query,
            [...aliases, ...variations, ...handles],
            monthWindow,
            sources,
            mergedRuns,
            overallErr,
            audit,
          );

          report.results = uniqueNormalized;

          /* ── OPENAI REASONING LAYER (additive, best-effort) ───────────────
           * Reasons over RETRIEVED evidence only, after identity verification.
           * It annotates existing findings; it never creates one. A verdict
           * without grounded page text stays MODEL_SUGGESTED / HUMAN_REVIEW.
           */
          if (!isReasoningEnabled()) {
            aiDiag.reasoning_status = "DISABLED";
          } else {
            try {
              const { runReasoningAgent } = await import(
                "@/lib/scan/openai/reasoning-agent.server"
              );
              const { createReasoningCache } = await import("@/lib/scan/openai/cache.server");
              const packets = report.hits
                .filter((h) => h.url)
                .slice(0, 48)
                .map((h) => ({
                  id: h.url,
                  title: (h.title ?? "").slice(0, 200),
                  canonical_url: h.url,
                  platform: h.platform ?? "web",
                  source: h.source ?? "web",
                  published_date: h.published ?? null,
                  author: h.author ?? null,
                  passages: (h.pageExcerpt || h.description || "").slice(0, 1200),
                  entity_confidence: h.identityConfidence ?? h.confidence ?? 0,
                  identity_tier: h.identityTier ?? "AMBIGUOUS",
                  classifier_output: `${h.category ?? ""}/${h.contentLabel ?? ""}/${h.severity ?? ""}`,
                }));

              const reasoning = await runReasoningAgent(
                packets,
                aiBudget,
                createReasoningCache(),
              );
              aiDiag.evidence_analyzed = reasoning.analyzed;
              aiDiag.cache_hits = reasoning.cacheHits;
              aiDiag.ai_failures = reasoning.failures;
              aiDiag.reasoning_status =
                reasoning.verdicts.size > 0
                  ? "OK"
                  : reasoning.error
                    ? "OPENAI_REASONING_UNAVAILABLE"
                    : "SKIPPED";
              if (reasoning.error) aiDiag.notes.push(`reasoning: ${reasoning.error}`);

              for (const hit of report.hits) {
                const verdict = hit.url ? reasoning.verdicts.get(hit.url) : undefined;
                if (!verdict) continue;
                (hit as unknown as Record<string, unknown>).aiAnalysis = verdict;
                if (verdict.reputation_risk === "HIGH") aiDiag.high_risk++;
                else if (verdict.reputation_risk === "MEDIUM") aiDiag.medium_risk++;
                if (
                  verdict.recommended_action === "HUMAN_REVIEW" ||
                  verdict.recommended_action === "HUMAN_REVIEW_REQUIRED" ||
                  verdict.recommended_action === "POTENTIAL_LEGAL_REVIEW"
                ) {
                  aiDiag.needs_review++;
                }
              }

              for (const lead of audit.leads) {
                const verdict =
                  reasoning.verdicts.get(lead.url) ?? reasoning.verdicts.get(lead.canonicalUrl);
                if (!verdict) continue;
                lead.ai_content_type = verdict.content_type;
                lead.ai_reputation_risk = verdict.reputation_risk;
                lead.ai_subject_confidence = verdict.subject_confidence;
                lead.ai_evidence_confidence = verdict.evidence_confidence;
                lead.ai_recommended_action = verdict.recommended_action;
                lead.ai_evidence_basis = verdict.evidence_basis ?? "MODEL_SUGGESTED";
                lead.ai_reasoning_summary = verdict.reasoning_summary;
              }
            } catch (e) {
              aiDiag.reasoning_status = "OPENAI_REASONING_UNAVAILABLE";
              aiDiag.notes.push(e instanceof Error ? e.message.slice(0, 200) : "reasoning failed");
            }
          }

          // Provenance: mark leads discovered by AI-generated queries.
          for (const lead of audit.leads) {
            if (lead.source === "AI Research") lead.query_origin = "OPENAI_RESEARCH";
          }



          /* ── PERSIST EVERY STAGE (admin auditable) ─────────────────────── */
          pipelineFunnel.persisted = audit.leads.length;
          console.log(`[scan:funnel] ${JSON.stringify(pipelineFunnel)}`);
          try {
            const { persistScanRun } = await import("@/lib/scan/persist.server");
            const persisted = await persistScanRun({
              query,
              aliases: [...aliases, ...variations, ...handles],
              sources,
              funnel: pipelineFunnel,
              leads: audit.leads,
            });
            if (persisted.error) console.warn(`[scan:persist] ${persisted.error}`);
          } catch (e) {
            console.warn(
              `[scan:persist] failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }


          // ══════════════════════════════════════════════════════════════════════
          // Admin Diagnostics & Coverage Counters
          // ══════════════════════════════════════════════════════════════════════
          const { getFirecrawlConfigInfo } = await import(
  "@/lib/firecrawl/firecrawl.server"
);
const fcConfig = getFirecrawlConfigInfo();

          const sourceCounts: Record<string, number> = {};
          for (const r of mergedRuns)
            sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + r.raw.length;

          const totalRawFetched = mergedRuns.reduce((s, r) => s + r.raw.length, 0);

          (report as unknown as Record<string, unknown>).diagnostics = {
            funnel: {
              ...funnelCounters,
              ...pipelineFunnel,
              persisted_results: uniqueNormalized.length,
              rejected_candidates: rejectedCandidates,
              removal: {
                ...removalCounters,
                per_video_records: perVideoAnalysisRecords,
              },
            },
            pipeline: pipelineFunnel,
            openai: aiDiag,

            queriesGenerated: fcQueriesExecuted + ytQueriesUsed + (fcDiscovery?.diagnostics?.queriesExecuted ?? 0),
            queriesExecuted: fcQueriesExecuted + ytQueriesUsed + (fcDiscovery?.diagnostics?.queriesExecuted ?? 0),
            queriesFailed: (fcError ? 1 : 0) + (ytError ? 1 : 0) + (redditError ? 1 : 0),
            firecrawlQueriesExecuted: fcQueriesExecuted + (fcDiscovery?.diagnostics?.queriesExecuted ?? 0),
            firecrawlResultsReceived: fcRuns.reduce((acc, r) => acc + r.raw.length, 0),
            candidateUrls: totalRawFetched,
            uniqueUrls: uniqueNormalized.length,
            pagesScraped: 0,
            subjectMatches: report.hits.filter((h) => h.confidence > 70).length,
            ambiguousMatches: report.hits.filter((h) => h.confidence <= 70).length,
            neutralResults: report.hits.filter((h) => h.sentiment === "Neutral").length,
            negativeCandidates: report.hits.filter((h) => h.sentiment === "Negative").length,
            highRiskCandidates: report.hits.filter((h) => h.severity === "High" || h.severity === "Critical").length,
            resultsPersisted: report.hits.length,
            firecrawl: {
  configured: fcConfig.firecrawlConfigured,
  reachable: fcSuccess || Boolean(fcError),
  authenticated:
    !fcError?.includes("AUTH_ERROR") &&
    !fcError?.includes("Unauthorized") &&
    !fcError?.includes("401"),
  statusCode:
    fcError?.includes("AUTH_ERROR") ||
    fcError?.includes("Unauthorized") ||
    fcError?.includes("401")
      ? 401
      : fcError?.includes("RATE_LIMITED") || fcError?.includes("429")
        ? 429
        : fcSuccess
          ? 200
          : 503,
  errorCode:
    fcError?.includes("AUTH_ERROR") ||
    fcError?.includes("Unauthorized") ||
    fcError?.includes("401")
      ? "AUTH_ERROR"
      : fcError?.includes("RATE_LIMITED") || fcError?.includes("429")
        ? "RATE_LIMITED"
        : fcError
          ? "PROVIDER_ERROR"
          : null,
  requestsAttempted: fcQueriesExecuted,
  requestsSucceeded: fcSuccess ? fcQueriesExecuted : 0,
  requestsFailed: fcError ? 1 : 0,
  authFailures:
    fcError?.includes("AUTH_ERROR") ||
    fcError?.includes("Unauthorized") ||
    fcError?.includes("401")
      ? 1
      : 0,
  rateLimitedRequests:
    fcError?.includes("RATE_LIMITED") || fcError?.includes("429") ? 1 : 0,
  queriesExecuted: fcQueriesExecuted,
  webResults: sourceCounts["Web"] ?? 0,
  newsResults: sourceCounts["News"] ?? 0,
  imageResults: 0,
  scrapedPages: 0,
  scrapeFailures: 0,
  latencyMs: null,
},
            youtube: {
              queriesRun: ytQueriesUsed,
              pagesScanned: ytPagesScanned,
              videosFound: ytRaw.length,
              apiErrors: ytApiErrors,
              quotaExhausted: ytQuotaExhaustedFinal,
              quotaReason: ytQuotaReason ?? null,
              error: ytError ?? null,
              target: ytTarget,
              status: ytQuotaExhaustedFinal
                ? "quota_exhausted"
                : ytRaw.length > 0
                  ? "ok"
                  : wantYouTube
                    ? "no_results"
                    : "disabled",
            },
            firecrawlDiscovery: fcDiscovery ? { ...fcDiscovery.diagnostics } : { active: false },
            monthFilter,
            monthWindow: {
              filter: monthWindow.filter,
              label: monthWindow.label,
              startIso: monthWindow.startIso,
              endIso: monthWindow.endIso,
            },
            sourceCounts,
            totalRawFetched,
            sourcesWithResults: mergedRuns.filter((r) => r.raw.length > 0).map((r) => r.source),
            scannedAt: new Date().toISOString(),
            breakingCount: report.buckets.breaking.length,
            recent3dCount: report.buckets.recent3d.length,
            recent7dCount: report.buckets.recent7d.length,
            filterDiag: {
              preFilterCount: report.totals.total,
              keptDated: report.hits.filter((h) => !!h.published).length,
              keptUndated: report.hits.filter((h) => !h.published).length,
              finalCount: report.hits.length,
              monthLabel: monthWindow.label,
              windowStart: monthWindow.startIso,
              windowEnd: monthWindow.endIso,
            },
          };
          return Response.json(report);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Scan failed";
          console.error("scan route failed:", msg);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
        });
      },
    },
  },
});
