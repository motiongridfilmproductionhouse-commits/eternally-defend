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
} {
  const accepted: FilteredCandidate[] = [];
  const triage: FilteredCandidate[] = [];
  const rejected: FilteredCandidate[] = [];

  const names = targetNames(target);

  for (const hit of hits) {
    const title = hit.title ?? "";
    const description = hit.description ?? "";
    const visibleText = `${title} ${description}`;
    const fullText = `${title} ${description} ${hit.url}`;

    const visibleTargetMatch = containsTarget(visibleText, names);

    const threat = collectThreatSignals(fullText);
    const host = hostOf(hit.url);

    const safeReferenceHost = hostMatches(host, SAFE_REFERENCE_HOSTS);

    const stockMediaHost = hostMatches(host, STOCK_MEDIA_HOSTS);

    const generalNewsHost = isLikelyNewsHost(host);

    const normalNewsSignal = NORMAL_NEWS_PATTERNS.some((pattern) => pattern.test(visibleText));

    const listing = isListingUrl(hit.url);

    const contentMatchScore = scoreDeepfakeCandidate(hit, target);

    let decision: CandidateDecision;
    let rejectionReason: string | undefined;

    /*
     * Lead-First Candidate Filter:
     * Preserve all candidate leads discovered for the protected identity.
     * Verification (face comparison & AI detection) will classify them later.
     */
    if (safeReferenceHost && !threat.hasStrongExplicitSignal && !threat.hasSyntheticSignal) {
      decision = "rejected";
      rejectionReason = "Reference page without deepfake signal (Wikipedia/IMDb)";
    } else if (threat.hasStrongExplicitSignal || threat.hasSyntheticSignal) {
      decision = "accepted";
    } else if (
      visibleTargetMatch ||
      hit.image_url ||
      hit.thumbnail_url ||
      threat.signals.length > 0
    ) {
      // Any lead referencing the target name or containing image media is accepted for verification!
      decision = "accepted";
    } else {
      decision = "triage";
      rejectionReason = "Requires face comparison and verification";
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
