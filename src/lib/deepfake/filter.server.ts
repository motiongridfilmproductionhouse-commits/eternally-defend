import type { RawHit, ClassifiedHit } from "./classify.server";

export type CandidateDecision = "accepted" | "triage" | "rejected";

export interface FilteredCandidate extends RawHit {
  content_match_score: number;
  candidate_decision: CandidateDecision;
  rejection_reason?: string;
  threat_signal_score?: number;
  threat_signals?: string[];
}

const LISTING_PATTERNS = [
  /\/search(?:\/|\?|$)/i,
  /[?&](?:q|query|search|keyword)=/i,
  /\/tag(?:s)?(?:\/|\?|$)/i,
  /\/category(?:\/|\?|$)/i,
  /\/browse(?:\/|\?|$)/i,
  /\/explore(?:\/|\?|$)/i,
  /\/discover(?:\/|\?|$)/i,
];

const GENERIC_TITLES = [
  /^search$/i,
  /^search results?$/i,
  /^videos?$/i,
  /^images?$/i,
  /^browse$/i,
  /^explore$/i,
  /^discover$/i,
  /^no information is available/i,
];

const SAFE_REFERENCE_HOSTS = [
  "wikipedia.org",
  "wikimedia.org",
  "imdb.com",
  "themoviedb.org",
  "tmdb.org",
  "britannica.com",
];

const STOCK_MEDIA_HOSTS = [
  "gettyimages.com",
  "shutterstock.com",
  "alamy.com",
  "dreamstime.com",
  "istockphoto.com",
  "stock.adobe.com",
  "depositphotos.com",
  "pinterest.com",
];

const GENERAL_NEWS_HOSTS = [
  "bbc.com",
  "bbc.co.uk",
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
  "firstpost.com",
  "deccanherald.com",
  "onmanorama.com",
  "mathrubhumi.com",
];

const STRONG_EXPLICIT_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "nude",
    pattern: /\b(?:nude|nudes|naked|nudity|topless|bottomless)\b/i,
  },
  {
    label: "pornographic",
    pattern: /\b(?:porn|porno|pornographic|xxx|adult\s+video)\b/i,
  },
  {
    label: "sexual-content",
    pattern: /\b(?:sex\s+video|sex\s+tape|sexual\s+video|intimate\s+video|explicit\s+video)\b/i,
  },
  {
    label: "leaked-intimate-media",
    pattern:
      /\b(?:leaked\s+(?:nude|video|photo|photos|image|images)|private\s+(?:video|photo|photos|image|images)\s+leak)\b/i,
  },
  {
    label: "undressing",
    pattern:
      /\b(?:undress|undressed|undressing|dressless|without\s+clothes|remove\s+clothes|clothes\s+removed)\b/i,
  },
];

const SYNTHETIC_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "deepfake",
    pattern: /\b(?:deepfake|deep fake|face\s*swap|faceswap)\b/i,
  },
  {
    label: "ai-nude",
    pattern: /\b(?:ai\s+nude|fake\s+nude|synthetic\s+nude|generated\s+nude)\b/i,
  },
  {
    label: "morphed-media",
    pattern: /\b(?:morphed|morphing|face\s+replaced|digitally\s+altered)\b/i,
  },
  {
    label: "synthetic-media",
    pattern: /\b(?:synthetic\s+media|ai[-\s]generated\s+(?:image|video|photo))\b/i,
  },
];

const IMPERSONATION_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "impersonation",
    pattern: /\b(?:impersonation|impersonating|fake\s+account|fake\s+profile)\b/i,
  },
  {
    label: "fake-endorsement",
    pattern: /\b(?:fake\s+endorsement|unauthori[sz]ed\s+advertisement|scam\s+advertisement)\b/i,
  },
];

const REPUTATION_ABUSE_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "defamation",
    pattern:
      /\b(?:defam(?:e|ed|ation|atory)|false\s+allegation|false\s+claim|fabricated\s+claim|malicious\s+rumou?r)\b/i,
  },
  {
    label: "harassment",
    pattern:
      /\b(?:harass(?:ment|ed|ing)?|cyberbully(?:ing)?|abusive\s+post|targeted\s+abuse|hate\s+campaign)\b/i,
  },
];

const NORMAL_NEWS_PATTERNS = [
  /\b(?:interview|movie\s+news|film\s+news|box\s+office|review|trailer|teaser|song|photoshoot|award|event|birthday|biography)\b/i,
  /\b(?:stalked|police|complaint|remarks|controversy|statement|revealed|said|says)\b/i,
  /\b(?:official\s+facebook|official\s+instagram|official\s+profile|fan\s+page)\b/i,
];

export function normalizeDeepfakeText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function targetNames(target: { name: string; aliases?: string[]; handles?: string[] }): string[] {
  return [target.name, ...(target.aliases ?? []), ...(target.handles ?? [])]
    .map(normalizeDeepfakeText)
    .filter((value) => value.length >= 3);
}

function containsTarget(text: string, names: string[]): boolean {
  const normalized = normalizeDeepfakeText(text);

  return names.some((name) => {
    if (!name) return false;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(normalized);
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isLikelyNewsHost(host: string): boolean {
  if (hostMatches(host, GENERAL_NEWS_HOSTS)) return true;

  return host
    .split(".")
    .some((label) =>
      /^(?:news|times|daily|herald|tribune|journal|chronicle|observer|newspaper|press|bulletin)$/i.test(
        label,
      ),
    );
}

function isListingUrl(url: string): boolean {
  return LISTING_PATTERNS.some((pattern) => pattern.test(url));
}

function isGenericTitle(title: string): boolean {
  const clean = title.trim();

  return !clean || GENERIC_TITLES.some((pattern) => pattern.test(clean));
}

function collectThreatSignals(text: string): {
  signals: string[];
  score: number;
  hasStrongExplicitSignal: boolean;
  hasSyntheticSignal: boolean;
  hasImpersonationSignal: boolean;
  hasReputationAbuseSignal: boolean;
} {
  const signals: string[] = [];
  let score = 0;

  for (const item of STRONG_EXPLICIT_PATTERNS) {
    if (item.pattern.test(text)) {
      signals.push(item.label);
      score += 55;
    }
  }

  for (const item of SYNTHETIC_PATTERNS) {
    if (item.pattern.test(text)) {
      signals.push(item.label);
      score += 50;
    }
  }

  for (const item of IMPERSONATION_PATTERNS) {
    if (item.pattern.test(text)) {
      signals.push(item.label);
      score += 35;
    }
  }

  for (const item of REPUTATION_ABUSE_PATTERNS) {
    if (item.pattern.test(text)) {
      signals.push(item.label);
      score += 40;
    }
  }

  return {
    signals: Array.from(new Set(signals)),
    score: Math.min(score, 100),
    hasStrongExplicitSignal: STRONG_EXPLICIT_PATTERNS.some((item) => item.pattern.test(text)),
    hasSyntheticSignal: SYNTHETIC_PATTERNS.some((item) => item.pattern.test(text)),
    hasImpersonationSignal: IMPERSONATION_PATTERNS.some((item) => item.pattern.test(text)),
    hasReputationAbuseSignal: REPUTATION_ABUSE_PATTERNS.some((item) => item.pattern.test(text)),
  };
}

export function scoreDeepfakeCandidate(
  hit: RawHit,
  target: {
    name: string;
    aliases?: string[];
    handles?: string[];
  },
): number {
  const names = targetNames(target);

  const title = hit.title ?? "";
  const description = hit.description ?? "";
  const combinedText = `${title} ${description} ${hit.url}`;

  const titleMatch = containsTarget(title, names);
  const descriptionMatch = containsTarget(description, names);

  const visibleTargetMatch = titleMatch || descriptionMatch;

  const threat = collectThreatSignals(combinedText);

  let score = 0;

  if (titleMatch) score += 30;
  if (descriptionMatch) score += 20;

  if (threat.hasStrongExplicitSignal) {
    score += 45;
  }

  if (threat.hasSyntheticSignal) {
    score += 45;
  }

  if (threat.hasImpersonationSignal) {
    score += 25;
  }

  if (threat.hasReputationAbuseSignal) {
    score += 30;
  }

  if (!visibleTargetMatch) {
    score -= 60;
  }

  if (isListingUrl(hit.url)) {
    score -= 20;
  }

  if (isGenericTitle(title)) {
    score -= 15;
  }

  return Math.max(0, Math.min(100, score));
}

const APP_STORE_HOSTS = ["play.google.com", "apps.apple.com", "appstore.com"];

const BIOGRAPHY_REFERENCE_HOSTS = [
  "wikipedia.org",
  "wikimedia.org",
  "imdb.com",
  "rottentomatoes.com",
  "themoviedb.org",
  "tmdb.org",
  "britannica.com",
  "biography.com",
  "famousbirthdays.com",
  "fandom.com",
  "wiki.com",
  "celebs.com",
  "allcelebs.com",
];

const FILM_REVIEW_HOSTS = [
  "letterboxd.com",
  "metacritic.com",
  "rogerebert.com",
  "cinemablend.com",
  "filmcompanion.in",
  "screenrant.com",
  "collider.com",
  "variety.com",
  "hollywoodreporter.com",
  "deadline.com",
];

const OFFICIAL_SOCIAL_HOSTS = ["facebook.com", "instagram.com", "threads.net", "linkedin.com"];

const SHOPPING_HOSTS = [
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "walmart.com",
  "flipkart.com",
  "shop.com",
  "store.com",
];

const HIGH_RISK_SYNTHETIC_HOSTS = [
  "t.me",
  "telegram.org",
  "terabox.com",
  "mega.nz",
  "coomer.su",
  "kemono.su",
  "anonfiles.com",
  "cyberdrop.me",
  "pixeldrain.com",
  "imgur.com",
  "reddit.com",
  "x.com",
  "twitter.com",
];

export function isCollegeOrGovHost(host: string): boolean {
  return (
    /\.(?:edu|gov|ac\.in|ac\.uk|gov\.in|gov\.uk|gov\.au)$/i.test(host) ||
    /^(?:college|university|school|dept|gov)\./i.test(host)
  );
}

export interface FilterDiagnostics {
  syntheticCandidatesFound: number;
  unrelatedPagesDiscarded: number;
  officialPagesDiscarded: number;
  newsPagesDiscarded: number;
  biographyPagesDiscarded: number;
}

export function filterDeepfakeCandidates(
  hits: RawHit[],
  target: {
    name: string;
    aliases?: string[];
    handles?: string[];
  },
): {
  accepted: FilteredCandidate[];
  triage: FilteredCandidate[];
  rejected: FilteredCandidate[];
  diagnostics: FilterDiagnostics;
} {
  const accepted: FilteredCandidate[] = [];
  const triage: FilteredCandidate[] = [];
  const rejected: FilteredCandidate[] = [];
  const diagnostics: FilterDiagnostics = {
    syntheticCandidatesFound: 0,
    unrelatedPagesDiscarded: 0,
    officialPagesDiscarded: 0,
    newsPagesDiscarded: 0,
    biographyPagesDiscarded: 0,
  };

  const names = targetNames(target);

  for (const hit of hits) {
    const title = hit.title ?? "";
    const description = hit.description ?? "";
    const visibleText = `${title} ${description}`;
    const fullText = `${title} ${description} ${hit.url}`;

    const visibleTargetMatch = containsTarget(visibleText, names);
    const threat = collectThreatSignals(fullText);
    const host = hostOf(hit.url);

    const isAppStore = hostMatches(host, APP_STORE_HOSTS);
    const isBiography =
      hostMatches(host, SAFE_REFERENCE_HOSTS) || hostMatches(host, BIOGRAPHY_REFERENCE_HOSTS);
    const isFilmReview = hostMatches(host, FILM_REVIEW_HOSTS);
    const isOfficialSocial = hostMatches(host, OFFICIAL_SOCIAL_HOSTS);
    const isCollegeGov = isCollegeOrGovHost(host);
    const isShopping = hostMatches(host, SHOPPING_HOSTS);
    const isGeneralNews = isLikelyNewsHost(host);
    const isStockMedia = hostMatches(host, STOCK_MEDIA_HOSTS);
    const isHighRiskSyntheticHost = hostMatches(host, HIGH_RISK_SYNTHETIC_HOSTS);

    const normalNewsSignal = NORMAL_NEWS_PATTERNS.some((pattern) => pattern.test(visibleText));
    const listing = isListingUrl(hit.url);
    const contentMatchScore = scoreDeepfakeCandidate(hit, target);

    let decision: CandidateDecision;
    let rejectionReason: string | undefined;

    const hasPositiveSyntheticSignal = threat.hasSyntheticSignal || isHighRiskSyntheticHost;

    if (hasPositiveSyntheticSignal) {
      decision = "accepted";
      diagnostics.syntheticCandidatesFound++;
    } else if (listing) {
      decision = "rejected";
      rejectionReason = "Search listing page excluded before crawl";
      diagnostics.unrelatedPagesDiscarded++;
    } else if (isAppStore || isOfficialSocial || isCollegeGov) {
      decision = "rejected";
      rejectionReason = "Official page discarded (App Store/Social/College/Gov)";
      diagnostics.officialPagesDiscarded++;
    } else if (isBiography || isFilmReview) {
      decision = "rejected";
      rejectionReason = "Biography / film review page discarded without AI signal";
      diagnostics.biographyPagesDiscarded++;
    } else if (threat.hasStrongExplicitSignal && !threat.hasSyntheticSignal) {
      decision = "triage";
      rejectionReason = "Explicit name mention without synthetic signal";
    } else if (isGeneralNews || normalNewsSignal) {
      decision = "rejected";
      rejectionReason = "General news article discarded without AI signal";
      diagnostics.newsPagesDiscarded++;
    } else if (isShopping || isStockMedia) {
      decision = "rejected";
      rejectionReason = "Unrelated page discarded (Shopping/Stock media)";
      diagnostics.unrelatedPagesDiscarded++;
    } else if (
      visibleTargetMatch &&
      // A name-matched candidate should not be discarded just because the
      // provider only returned a direct media URL (common for video hits)
      // instead of a thumbnail/image — any of the three is sufficient
      // evidence to send it on for face/media verification.
      ((hit as any).image_url || (hit as any).thumbnail_url || (hit as any).media_url) &&
      !isGeneralNews &&
      !isBiography
    ) {
      decision = "accepted";
      diagnostics.syntheticCandidatesFound++;
    } else {
      decision = "rejected";
      rejectionReason = "Unrelated page discarded (no synthetic media evidence)";
      diagnostics.unrelatedPagesDiscarded++;
    }

    const candidate: FilteredCandidate = {
      ...hit,
      content_match_score: contentMatchScore,
      threat_signal_score: threat.score,
      threat_signals: threat.signals,
      candidate_decision: decision,
      rejection_reason: rejectionReason,
    };

    if (decision === "accepted") {
      accepted.push(candidate);
    } else if (decision === "triage") {
      triage.push(candidate);
    } else {
      rejected.push(candidate);
    }
  }

  const byRelevance = (a: FilteredCandidate, b: FilteredCandidate) =>
    b.content_match_score - a.content_match_score ||
    (b.threat_signal_score ?? 0) - (a.threat_signal_score ?? 0);

  return {
    accepted: accepted.sort(byRelevance),
    triage: triage.sort(byRelevance),
    rejected,
    diagnostics,
  };
}

export function shouldShowPrimaryFinding(
  finding: ClassifiedHit & {
    content_match_score?: number;
    threat_signals?: string[];
  },
): boolean {
  const score = finding.content_match_score ?? 0;

  const hasThreatSignal = (finding.threat_signals?.length ?? 0) > 0;

  return (
    score >= 50 &&
    hasThreatSignal &&
    finding.confidence >= 10 &&
    finding.content_category !== "unclassified"
  );
}

export type PageTypeCategory =
  | "HOSTING_PAGE"
  | "DOWNLOAD_PAGE"
  | "PREVIEW_PAGE"
  | "GALLERY_PAGE"
  | "IMAGE_PAGE"
  | "VIDEO_PAGE"
  | "FORUM_THREAD"
  | "SOCIAL_POST"
  | "DISCUSSION"
  | "NEWS"
  | "BLOG"
  | "BIOGRAPHY"
  | "OFFICIAL"
  | "WIKIPEDIA"
  | "IMDB"
  | "PRESS_RELEASE"
  | "MOVIE_REVIEW"
  | "SHOP"
  | "APP_STORE"
  | "COLLEGE"
  | "GOVERNMENT"
  | "DIRECTORY"
  | "SEARCH_RESULTS";

export function classifyPageType(url: string, title = ""): PageTypeCategory {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  if (urlLower.includes("wikipedia.org")) return "WIKIPEDIA";
  if (urlLower.includes("imdb.com") || urlLower.includes("rottentomatoes.com")) return "IMDB";
  if (
    urlLower.includes(".edu") ||
    urlLower.includes("/college") ||
    urlLower.includes("/university")
  )
    return "COLLEGE";
  if (urlLower.includes(".gov") || urlLower.includes("/government")) return "GOVERNMENT";
  if (urlLower.includes("apps.apple.com") || urlLower.includes("play.google.com"))
    return "APP_STORE";
  if (
    urlLower.includes("amazon.") ||
    urlLower.includes("ebay.") ||
    urlLower.includes("etsy.") ||
    urlLower.includes("/shop")
  )
    return "SHOP";

  if (
    urlLower.includes("t.me") ||
    urlLower.includes("terabox") ||
    urlLower.includes("mega.nz") ||
    urlLower.includes("pixeldrain")
  ) {
    return "DOWNLOAD_PAGE";
  }
  if (
    urlLower.includes("mrdeepfakes") ||
    urlLower.includes("sexcelebrity") ||
    urlLower.includes("coomer") ||
    urlLower.includes("nifty")
  ) {
    return "HOSTING_PAGE";
  }

  if (LISTING_PATTERNS.some((p) => p.test(urlLower))) return "SEARCH_RESULTS";
  if (isLikelyNewsHost(urlLower)) return "NEWS";

  if (titleLower.includes("biography") || urlLower.includes("biography")) return "BIOGRAPHY";
  if (titleLower.includes("review") || urlLower.includes("review")) return "MOVIE_REVIEW";

  if (
    urlLower.includes("reddit.com") ||
    urlLower.includes("/forum") ||
    urlLower.includes("/thread")
  )
    return "FORUM_THREAD";
  if (urlLower.includes("x.com") || urlLower.includes("twitter.com")) return "SOCIAL_POST";

  if (titleLower.includes("gallery") || urlLower.includes("gallery")) return "GALLERY_PAGE";
  if (urlLower.includes(".jpg") || urlLower.includes(".png") || urlLower.includes(".webp"))
    return "IMAGE_PAGE";
  if (urlLower.includes(".mp4") || urlLower.includes(".webm") || urlLower.includes("/video"))
    return "VIDEO_PAGE";

  return "PREVIEW_PAGE";
}

export type CandidateEvidenceInput = {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  face_similarity?: number | null;
  confidence?: number | null;
  is_synthetic?: boolean | null;
  finding_classification?: string | null;
  page_type?: string | null;
  takedown_recommended?: boolean | null;
  explicit_media_confirmed?: boolean | null;
  synthetic_media_confirmed?: boolean | null;
  hosting_or_distribution_confirmed?: boolean | null;
  nudity_detected?: boolean | null;
  explicit_media_detected?: boolean | null;
  synthetic_nudity_detected?: boolean | null;
  sexual_content_detected?: boolean | null;
  explicit_face_swap_detected?: boolean | null;
  deepfake_detected?: boolean | null;
  face_swap_detected?: boolean | null;
  synthetic_face_detected?: boolean | null;
  ai_generated_media_detected?: boolean | null;
  manipulation_artifacts_detected?: boolean | null;
};

/**
 * Strict Canonical Gate — qualifiesForVerifiedExplicitFeed
 * Returns true ONLY when ALL 4 mandatory conditions pass:
 * Condition A: Face Verified (face_similarity >= 85%)
 * Condition B: Explicit Content Confirmed (media classifier explicit signal)
 * Condition C: Synthetic / Manipulation Confirmed (deepfake / face swap signal)
 * Condition D: Media Hosting or Distribution Confirmed (host, mirror, player, download)
 */
export function qualifiesForVerifiedExplicitFeed(candidate: CandidateEvidenceInput): boolean {
  if (!candidate) return false;
  const urlLower = (candidate.url || "").toLowerCase();
  const titleLower = (candidate.title || "").toLowerCase();
  const cls = (candidate.finding_classification || "").toUpperCase();

  // Hard reject non-explicit/news/wikipedia/biography/store hosts
  if (
    urlLower.includes("wikipedia.org") ||
    urlLower.includes("imdb.com") ||
    urlLower.includes("rottentomatoes.com") ||
    urlLower.includes(".edu") ||
    urlLower.includes(".gov") ||
    urlLower.includes("apps.apple.com") ||
    urlLower.includes("play.google.com") ||
    urlLower.includes("amazon.") ||
    urlLower.includes("asianetnews.") ||
    urlLower.includes("filmibeat.") ||
    urlLower.includes("pinterest.com")
  ) {
    return false;
  }

  // CONDITION A: Face Verified (face_similarity >= 85%)
  const faceSim = candidate.face_similarity ?? candidate.confidence ?? null;
  if (faceSim === null || faceSim < 85) {
    return false;
  }

  // CONDITION B: Explicit Content Confirmed
  const isExplicitConfirmed =
    candidate.explicit_media_confirmed === true ||
    candidate.nudity_detected === true ||
    candidate.explicit_media_detected === true ||
    candidate.synthetic_nudity_detected === true ||
    candidate.sexual_content_detected === true ||
    candidate.explicit_face_swap_detected === true ||
    cls.includes("EXPLICIT") ||
    cls.includes("NUDITY");

  if (!isExplicitConfirmed) {
    return false;
  }

  // CONDITION C: Synthetic / Manipulation Confirmed
  const isSyntheticConfirmed =
    candidate.synthetic_media_confirmed === true ||
    candidate.is_synthetic === true ||
    candidate.deepfake_detected === true ||
    candidate.face_swap_detected === true ||
    candidate.synthetic_face_detected === true ||
    candidate.ai_generated_media_detected === true ||
    candidate.manipulation_artifacts_detected === true ||
    cls.includes("SYNTHETIC") ||
    cls.includes("DEEPFAKE") ||
    cls.includes("FACE_SWAP");

  if (!isSyntheticConfirmed) {
    return false;
  }

  // CONDITION D: Media Hosting or Distribution Confirmed
  const isHost =
    candidate.hosting_or_distribution_confirmed === true ||
    candidate.takedown_recommended === true ||
    urlLower.includes("t.me") ||
    urlLower.includes("terabox") ||
    urlLower.includes("mega.nz") ||
    urlLower.includes("pixeldrain") ||
    urlLower.includes("mrdeepfakes") ||
    urlLower.includes("sexcelebrity") ||
    urlLower.includes("coomer") ||
    urlLower.includes("nifty") ||
    urlLower.includes("/video") ||
    urlLower.includes("/image") ||
    urlLower.includes(".jpg") ||
    urlLower.includes(".mp4") ||
    titleLower.includes("gallery") ||
    titleLower.includes("download");

  if (!isHost) {
    return false;
  }

  return true;
}

export const qualifiesForExplicitThreatFeed = qualifiesForVerifiedExplicitFeed;
