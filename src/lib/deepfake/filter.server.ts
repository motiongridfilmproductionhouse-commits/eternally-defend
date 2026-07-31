import type {
  RawHit,
  ClassifiedHit,
} from "./classify.server";
import {
  getIdentityPhrases,
  matchesSelectedIdentity,
} from "./identity.server";

export type CandidateDecision =
  | "accepted"
  | "triage"
  | "rejected";

export interface FilteredCandidate extends RawHit {
  content_match_score: number;
  candidate_decision: CandidateDecision;
  rejection_reason?: string;
  threat_signal_score?: number;
  threat_signals?: string[];
}

const LISTING_PATTERNS = [
  /\/search(?:\/|\?|$)/i,
  /\/results?(?:\/|\?|$)/i,
  /[?&](?:q|query|search|keyword|keywords|k|s|term|terms)=/i,
  /\/tag(?:s)?(?:\/|\?|$)/i,
  /\/categor(?:y|ies)(?:\/|\?|$)/i,
  /\/genres?(?:\/|\?|$)/i,
  /\/channels?(?:\/|\?|$)/i,
  /\/(?:pornstar|pornstars|model|models|performer|performers|actress|actor|star|stars)(?:\/|\?|$)/i,
  /\/celebrities(?:\/|\?|$)/i,
  /\/browse(?:\/|\?|$)/i,
  /\/explore(?:\/|\?|$)/i,
  /\/discover(?:\/|\?|$)/i,
  /\/videos?(?:\/)?$/i,
  /\/galleries?(?:\/)?$/i,
  /\/most[-_]?viewed/i,
  /\/top[-_]?rated/i,
  /\/newest(?:\/|\?|$)/i,
  /\/popular(?:\/|\?|$)/i,
  /\/trending(?:\/|\?|$)/i,
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
    pattern:
      /\b(?:nude|nudes|naked|nudity|topless|bottomless)\b/i,
  },
  {
    label: "pornographic",
    pattern:
      /\b(?:porn|porno|pornographic|xxx|adult\s+video)\b/i,
  },
  {
    label: "sexual-content",
    pattern:
      /\b(?:sex\s+video|sex\s+tape|sexual\s+video|intimate\s+video|explicit\s+video)\b/i,
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
    pattern:
      /\b(?:deepfake|deep fake|face\s*swap|faceswap)\b/i,
  },
  {
    label: "ai-nude",
    pattern:
      /\b(?:ai\s+nude|fake\s+nude|synthetic\s+nude|generated\s+nude)\b/i,
  },
  {
    label: "morphed-media",
    pattern:
      /\b(?:morphed|morphing|face\s+replaced|digitally\s+altered)\b/i,
  },
  {
    label: "synthetic-media",
    pattern:
      /\b(?:synthetic\s+media|ai[-\s]generated\s+(?:image|video|photo))\b/i,
  },
];

const IMPERSONATION_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "impersonation",
    pattern:
      /\b(?:impersonation|impersonating|fake\s+account|fake\s+profile)\b/i,
  },
  {
    label: "fake-endorsement",
    pattern:
      /\b(?:fake\s+endorsement|unauthori[sz]ed\s+advertisement|scam\s+advertisement)\b/i,
  },
];

const REPUTATION_ABUSE_PATTERNS: Array<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "defamation",
    pattern: /\b(?:defam(?:e|ed|ation|atory)|false\s+allegation|false\s+claim|fabricated\s+claim|malicious\s+rumou?r)\b/i,
  },
  {
    label: "harassment",
    pattern: /\b(?:harass(?:ment|ed|ing)?|cyberbully(?:ing)?|abusive\s+post|targeted\s+abuse|hate\s+campaign)\b/i,
  },
];

const NORMAL_NEWS_PATTERNS = [
  /\b(?:interview|movie\s+news|film\s+news|box\s+office|review|trailer|teaser|song|photoshoot|award|event|birthday|biography)\b/i,
  /\b(?:stalked|police|complaint|remarks|controversy|statement|revealed|said|says)\b/i,
  /\b(?:official\s+facebook|official\s+instagram|official\s+profile|fan\s+page)\b/i,
];

export function normalizeDeepfakeText(
  value: string,
): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function targetNames(target: {
  name: string;
  aliases?: string[];
  handles?: string[];
}): string[] {
  return getIdentityPhrases(target);
}

function containsTarget(
  text: string,
  names: string[],
  target?: {
    name: string;
    aliases?: string[];
    handles?: string[];
  },
): boolean {
  if (target) {
    return matchesSelectedIdentity(text, target);
  }

  const normalized = normalizeDeepfakeText(text);

  return names.some((name) => {
    if (!name) return false;

    const escaped = name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    return new RegExp(
      `(?:^|\\s)${escaped}(?:$|\\s)`,
      "i",
    ).test(normalized);
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function hostMatches(
  host: string,
  domains: string[],
): boolean {
  return domains.some(
    (domain) =>
      host === domain ||
      host.endsWith(`.${domain}`),
  );
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

export function isListingUrl(url: string): boolean {
  return LISTING_PATTERNS.some((pattern) =>
    pattern.test(url),
  );
}

function isGenericTitle(title: string): boolean {
  const clean = title.trim();

  return (
    !clean ||
    GENERIC_TITLES.some((pattern) =>
      pattern.test(clean),
    )
  );
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
    hasStrongExplicitSignal:
      STRONG_EXPLICIT_PATTERNS.some((item) =>
        item.pattern.test(text),
      ),
    hasSyntheticSignal:
      SYNTHETIC_PATTERNS.some((item) =>
        item.pattern.test(text),
      ),
    hasImpersonationSignal:
      IMPERSONATION_PATTERNS.some((item) =>
        item.pattern.test(text),
      ),
    hasReputationAbuseSignal:
      REPUTATION_ABUSE_PATTERNS.some((item) =>
        item.pattern.test(text),
      ),
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
  const combinedText =
    `${title} ${description} ${hit.url}`;

  const titleMatch = containsTarget(title, names, target);
  const descriptionMatch = containsTarget(
    description,
    names,
    target,
  );

  const visibleTargetMatch =
    titleMatch || descriptionMatch;

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
    const fullText =
      `${title} ${description} ${hit.url}`;

    const visibleTargetMatch = containsTarget(
      visibleText,
      names,
      target,
    );

    const threat = collectThreatSignals(fullText);
    const host = hostOf(hit.url);

    const safeReferenceHost = hostMatches(
      host,
      SAFE_REFERENCE_HOSTS,
    );

    const stockMediaHost = hostMatches(
      host,
      STOCK_MEDIA_HOSTS,
    );

    const generalNewsHost = isLikelyNewsHost(host);

    const normalNewsSignal =
      NORMAL_NEWS_PATTERNS.some((pattern) =>
        pattern.test(visibleText),
      );

    const listing = isListingUrl(hit.url);

    const contentMatchScore =
      scoreDeepfakeCandidate(hit, target);

    let decision: CandidateDecision;
    let rejectionReason: string | undefined;

    /*
     * Reject results that do not visibly reference the target.
     */
    if (!visibleTargetMatch) {
      decision = "rejected";
      rejectionReason =
        "Target name is not visibly present in the result";
    }

    /*
     * Search, tag, category, performer-index and generic listing pages
     * must never become deepfake findings. They routinely contain the
     * target name plus adult keywords without hosting a specific asset.
     */
    else if (listing || isGenericTitle(title)) {
      decision = "rejected";
      rejectionReason =
        "Search, tag, category, performer-index or generic listing page excluded before classification";
    }

    /*
     * Wikimedia, Wikipedia and stock-photo pages are not threats
     * unless their title/snippet contains a strong explicit or
     * synthetic-media signal.
     */
    else if (
      (safeReferenceHost || stockMediaHost) &&
      !threat.hasStrongExplicitSignal &&
      !threat.hasSyntheticSignal
    ) {
      decision = "rejected";
      rejectionReason =
        "Reference or stock-media page without a deepfake or explicit-content signal";
    }

    /* Deepfake Intelligence is an abuse-source monitor, not a news feed. */
    else if (generalNewsHost) {
      decision = "rejected";
      rejectionReason =
        "General news coverage is excluded from synthetic-media findings";
    }

    /*
     * Ordinary news, interviews and social posts must not appear
     * merely because the target's name is present.
     */
    else if (
      normalNewsSignal &&
      !threat.hasStrongExplicitSignal &&
      !threat.hasSyntheticSignal &&
       !threat.hasImpersonationSignal &&
       !threat.hasReputationAbuseSignal
    ) {
      decision = "rejected";
      rejectionReason =
        "Normal news or social content without a relevant threat signal";
    }

    /*
     * Every displayed finding must contain a real risk signal.
     */
    else if (
      threat.signals.length === 0
    ) {
      decision = "rejected";
      rejectionReason =
       "No deepfake, explicit-content, impersonation or reputation-abuse signal";
    }

    /*
     * Accept only when there is a synthetic/impersonation signal.
     * Explicit adult language with a name mention is not enough on its
     * own — those pages are inspected later and classified as
     * ADULT_NAME_MENTION when synthetic evidence is absent.
     *
     * Strong explicit + synthetic signals may be accepted for crawl.
     * Explicit-only hits go to triage for page inspection, not primary.
     */
    else if (
      threat.hasSyntheticSignal &&
      threat.signals.some((signal) =>
        [
          "deepfake",
          "ai-nude",
          "morphed-media",
          "synthetic-media",
        ].includes(signal),
      )
    ) {
      decision = "accepted";
    }

    else if (
      threat.hasStrongExplicitSignal &&
      threat.hasSyntheticSignal
    ) {
      decision = "accepted";
    }

    else if (threat.hasStrongExplicitSignal) {
      decision = "triage";
      rejectionReason =
        "Adult name mention without synthetic/impersonation evidence; requires page inspection";
    }

    /*
     * Impersonation-only results can go to triage.
     */
    else if (
      (threat.hasImpersonationSignal || threat.hasReputationAbuseSignal) &&
      !listing
    ) {
      decision = "triage";
      rejectionReason =
        "Possible impersonation or reputation-abuse risk requires verification";
    } else {
      decision = "rejected";
      rejectionReason =
        "Insufficient evidence of a relevant synthetic-media threat";
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
  const score =
    finding.content_match_score ?? 0;

  const hasThreatSignal =
    (finding.threat_signals?.length ?? 0) > 0;

  return (
    score >= 50 &&
    hasThreatSignal &&
    finding.confidence >= 10 &&
    finding.content_category !== "unclassified"
  );
}
