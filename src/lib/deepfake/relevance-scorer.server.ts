export interface ScoredLead {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source?: string;
  thumbnail_url?: string;
  image_url?: string;
  is_sensitive?: boolean;
  score: number;
  lead_type: string;
  matched_keywords: string[];
  reason_collected: string;
  [key: string]: unknown;
}

const AI_KEYWORDS = [
  { term: "deepfake", points: 500 },
  { term: "ai generated", points: 500 },
  { term: "face swap", points: 500 },
  { term: "face morph", points: 500 },
  { term: "synthetic media", points: 500 },
  { term: "voice clone", points: 500 },
  { term: "ai edit", points: 450 },
  { term: "morphed", points: 450 },
  { term: "fake video", points: 450 },
  { term: "fake image", points: 450 },
  { term: "ai art", points: 300 },
];

const EXPLICIT_KEYWORDS = [
  { term: "nude", points: 450 },
  { term: "explicit", points: 450 },
  { term: "nsfw", points: 450 },
  { term: "porn", points: 450 },
  { term: "adult", points: 450 },
  { term: "leaked", points: 450 },
  { term: "ai nude", points: 500 },
  { term: "xxx", points: 450 },
];

const PLATFORM_BONUSES = [
  { host: "t.me", points: 400, label: "Telegram" },
  { host: "telegram.org", points: 400, label: "Telegram" },
  { host: "terabox.com", points: 400, label: "TeraBox" },
  { host: "archive.org", points: 400, label: "Archive.org" },
  { host: "mega.nz", points: 400, label: "Mega" },
  { host: "mediafire.com", points: 400, label: "Mediafire" },
  { host: "pixeldrain.com", points: 400, label: "Pixeldrain" },
  { host: "reddit.com", points: 350, label: "Reddit" },
  { host: "x.com", points: 300, label: "X" },
  { host: "twitter.com", points: 300, label: "X" },
  { host: "pinterest.com", points: 250, label: "Pinterest" },
];

const HARMLESS_HOSTS = [
  "wikipedia.org",
  "wikimedia.org",
  "imdb.com",
  "rottentomatoes.com",
  "themoviedb.org",
  "tmdb.org",
  "britannica.com",
  "youtube.com",
  "vimeo.com",
];

const GENERIC_NEWS_HOSTS = [
  "bbc.com",
  "cnn.com",
  "reuters.com",
  "apnews.com",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "hindustantimes.com",
  "indiatimes.com",
  "timesofindia.indiatimes.com",
  "indianexpress.com",
  "news18.com",
  "ndtv.com",
  "thehindu.com",
  "onmanorama.com",
  "mathrubhumi.com",
];

/**
 * Calculates Deepfake Relevance Score (0–1000) for a lead.
 */
export function calculateDeepfakeRelevanceScore(
  hit: {
    url: string;
    title?: string;
    description?: string;
    query?: string;
    source?: string;
    image_url?: string;
    thumbnail_url?: string;
  },
  targetName: string,
): {
  score: number;
  matchedKeywords: string[];
  reasons: string[];
  isHarmless: boolean;
} {
  const text =
    `${hit.title ?? ""} ${hit.description ?? ""} ${hit.url} ${hit.query ?? ""}`.toLowerCase();
  const matchedKeywords: string[] = [];
  const reasons: string[] = [];
  let score = 0;

  // 1. AI & Deepfake Keywords (+500 max)
  for (const item of AI_KEYWORDS) {
    if (text.includes(item.term)) {
      matchedKeywords.push(item.term);
      score += item.points;
    }
  }

  // 2. Explicit Keywords (+450 max)
  for (const item of EXPLICIT_KEYWORDS) {
    if (text.includes(item.term)) {
      matchedKeywords.push(item.term);
      score += item.points;
    }
  }

  // 3. High-Risk Platform Bonuses (+400 max)
  for (const item of PLATFORM_BONUSES) {
    if (hit.url.toLowerCase().includes(item.host)) {
      score += item.points;
      reasons.push(`High-risk distribution platform (${item.label})`);
    }
  }

  // 4. Google Images Hit Bonus (+200)
  if (
    hit.source === "firecrawl_image" ||
    hit.source === "google_images" ||
    hit.image_url ||
    hit.thumbnail_url
  ) {
    score += 200;
    reasons.push("Discovered image candidate lead");
  }

  // 5. Target Name Presence
  if (targetName && text.includes(targetName.toLowerCase())) {
    score += 150;
  }

  // 6. Harmless Host Penalties (-400)
  let isHarmlessHost = false;
  const urlLower = hit.url.toLowerCase();

  for (const host of HARMLESS_HOSTS) {
    if (urlLower.includes(host)) {
      isHarmlessHost = true;
      break;
    }
  }

  if (!isHarmlessHost) {
    for (const host of GENERIC_NEWS_HOSTS) {
      if (urlLower.includes(host)) {
        isHarmlessHost = true;
        break;
      }
    }
  }

  const hasExplicitAiSignal = matchedKeywords.some((k) =>
    ["deepfake", "ai generated", "face swap", "ai nude", "synthetic media"].includes(k),
  );

  if (isHarmlessHost && !hasExplicitAiSignal) {
    score -= 400;
    reasons.push("Official, encyclopedia, or generic news host without explicit AI keywords");
  }

  const finalScore = Math.max(0, Math.min(1000, score));
  return {
    score: finalScore,
    matchedKeywords: Array.from(new Set(matchedKeywords)),
    reasons,
    isHarmless: isHarmlessHost && !hasExplicitAiSignal,
  };
}

/**
 * Determines exact Investigation Lead Type.
 */
export function determineLeadType(
  hit: {
    url: string;
    title?: string;
    description?: string;
    query?: string;
    image_url?: string;
    thumbnail_url?: string;
  },
  similarity = 0,
): string {
  const text =
    `${hit.title ?? ""} ${hit.description ?? ""} ${hit.url} ${hit.query ?? ""}`.toLowerCase();

  if (similarity >= 95) return "Verified Deepfake";
  if (similarity >= 85) return "Probable Deepfake";
  if (hit.url.includes("t.me") || hit.url.includes("telegram")) return "Telegram Distribution";
  if (hit.url.includes("terabox.com")) return "TeraBox Link";
  if (hit.url.includes("reddit.com")) return "Reddit Discussion";
  if (text.includes("ai nude") || text.includes("explicit") || text.includes("nude"))
    return "Explicit AI Image";
  if (text.includes("face swap") || text.includes("face morph")) return "Possible Face Swap";
  if (text.includes("voice clone")) return "Voice Clone";
  if (text.includes("deepfake video") || text.includes("synthetic video")) return "Synthetic Video";
  if (hit.image_url || hit.thumbnail_url) return "Google Images Match";
  if (text.includes("ai generated") || text.includes("deepfake")) return "AI Generated Image";

  return "Needs Human Review";
}

/**
 * Explains why a lead was collected for investigator UI display.
 */
export function explainLeadCollection(
  hit: {
    url: string;
    title?: string;
    description?: string;
    query?: string;
    source?: string;
    image_url?: string;
    thumbnail_url?: string;
  },
  targetName: string,
  similarity?: number,
): {
  reason: string;
  matchedKeywords: string[];
  matchedQuery: string;
  discoveryProvider: string;
  similarity: number;
} {
  const scoring = calculateDeepfakeRelevanceScore(hit, targetName);
  const keywords = scoring.matchedKeywords.length
    ? scoring.matchedKeywords
    : ["target identity match"];
  const provider = hit.source?.replaceAll("_", " ") ?? "google images";

  let mainReason = `Matched search query for protected target identity "${targetName}"`;
  if (similarity && similarity >= 85) {
    mainReason = `Face match verified (${similarity.toFixed(1)}% confidence against target reference profile)`;
  } else if (scoring.matchedKeywords.length) {
    mainReason = `Detected high-signal synthetic media keywords: ${scoring.matchedKeywords.join(", ")}`;
  } else if (scoring.reasons.length) {
    mainReason = scoring.reasons[0];
  }

  return {
    reason: mainReason,
    matchedKeywords: keywords,
    matchedQuery: hit.query ?? `${targetName} deepfake`,
    discoveryProvider: provider,
    similarity: similarity ?? 0,
  };
}
