/**
 * Pre-Enrollment Intelligence — stage classification (pure).
 *
 * Wording rules enforced in code, not left to the UI:
 *  - never "deepfake" from a score alone → "Potential manipulation detected"
 *  - never assert an allegation is true, never call anything defamation
 *  - a category only ever shows records that actually exist
 */

export type StageKey =
  | "ai_manipulation"
  | "harmful_content"
  | "impersonation"
  | "privacy_exposure"
  | "search_reputation"
  | "propagation";

export interface ClassifierInput {
  url: string;
  platform?: string | null;
  title?: string | null;
  snippet?: string | null;
  pageText?: string | null;
  isMedia?: boolean;
  searchRank?: number | null;
  targetName: string;
  targetHandles?: string[];
}

export interface Classification {
  stageKey: StageKey;
  category: string;
  /** 0–10 */
  severity: number;
  /** Shown verbatim to staff as the detection reason. */
  reason: string;
  sourceType: "Article" | "Video" | "Social post" | "Forum" | "Other";
  /** Sentiment bucket for the search-reputation stage. */
  searchSentiment: "positive" | "neutral" | "potential_risk";
}

const HARM_PATTERNS: Array<{ re: RegExp; category: string; severity: number; label: string }> = [
  { re: /\b(arrest(ed)?|fir filed|police complaint|charge ?sheet|remand)\b/i, category: "Legal proceeding reported", severity: 7, label: "Reported legal proceeding" },
  { re: /\b(allegation|accus(ed|ation)|assault|harassment|molest|abuse)\b/i, category: "Allegation reported", severity: 8, label: "Reported allegation (not assessed as true)" },
  { re: /\b(scandal|controversy|backlash|outrage|boycott|trolled?)\b/i, category: "Controversy coverage", severity: 5, label: "Controversy or backlash coverage" },
  { re: /\b(fake news|misleading|false claim|debunk(ed)?|hoax|rumour|rumor)\b/i, category: "Misleading claim", severity: 6, label: "Potentially misleading claim about the subject" },
  { re: /\b(leak(ed)?|viral video|mms|private (video|photo)s?)\b/i, category: "Sensitive content claim", severity: 9, label: "Claim of leaked or private content" },
  { re: /\b(hate|slur|abusive|threat(en(ing)?)?|death threat)\b/i, category: "Hostile content", severity: 7, label: "Hostile or abusive content" },
];

const IMPERSONATION_PATTERNS: Array<{ re: RegExp; category: string; severity: number; label: string }> = [
  { re: /\b(fake (account|profile|page)|impersonat|parody account)\b/i, category: "Possible impersonating profile", severity: 8, label: "Page references a fake or impersonating profile" },
  { re: /\b(giveaway|investment (plan|scheme)|trading signals?|forex|crypto doubl|whatsapp \+?\d)\b/i, category: "Possible fraudulent endorsement", severity: 8, label: "Financial or giveaway solicitation using the name" },
  { re: /\b(official (store|website)|shop now|buy (tickets|now))\b/i, category: "Unverified commercial use of name", severity: 5, label: "Commercial use of the name requiring ownership check" },
];

const PRIVACY_PATTERNS: Array<{ re: RegExp; category: string; severity: number; label: string }> = [
  { re: /\b(residence|home address|house at|apartment no)\b/i, category: "Residence reference", severity: 7, label: "Public page references a residence" },
  { re: /(\+?\d[\d\s-]{8,}\d)/, category: "Contact number exposure", severity: 8, label: "Public page contains a contact number pattern" },
  { re: /\b(passport|aadhaar|pan number|date of birth|dob)\b/i, category: "Identifier reference", severity: 8, label: "Public page references a personal identifier" },
  { re: /\b(family|wife|husband|daughter|son|children)\b.{0,40}\b(school|address|photos?)\b/i, category: "Family exposure", severity: 6, label: "Public page links family details" },
];

const POSITIVE_PATTERNS =
  /\b(award|honour(ed)?|honored|praise[ds]?|success|celebrat|acclaim|record-breaking|appointed|felicitat)\b/i;

const MEDIA_HOSTS = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/reel|facebook\.com\/watch|\.mp4|\.webm)/i;

function sourceTypeFor(input: ClassifierInput): Classification["sourceType"] {
  const url = input.url.toLowerCase();
  if (MEDIA_HOSTS.test(url) || input.isMedia) return "Video";
  if (/(reddit\.com|quora\.com|forum|\/threads?\/|discussion)/.test(url)) return "Forum";
  if (/(instagram\.com|facebook\.com|x\.com|twitter\.com|threads\.net)/.test(url)) return "Social post";
  if (/(news|times|herald|express|hindu|mirror|post|tribune|reporter|\/article)/.test(url)) return "Article";
  return "Other";
}

/**
 * Classify one discovery. Returns every stage it legitimately belongs to —
 * possibly none, in which case it is a monitoring record only.
 */
export function classifyDiscovery(input: ClassifierInput): Classification[] {
  const haystack = [input.title, input.snippet, input.pageText?.slice(0, 4000)]
    .filter(Boolean)
    .join(" \n ");
  const sourceType = sourceTypeFor(input);
  const out: Classification[] = [];

  const searchSentiment: Classification["searchSentiment"] = HARM_PATTERNS.some((p) =>
    p.re.test(haystack),
  )
    ? "potential_risk"
    : POSITIVE_PATTERNS.test(haystack)
      ? "positive"
      : "neutral";

  for (const pattern of HARM_PATTERNS) {
    if (pattern.re.test(haystack)) {
      out.push({
        stageKey: "harmful_content",
        category: pattern.category,
        severity: pattern.severity,
        reason: pattern.label,
        sourceType,
        searchSentiment: "potential_risk",
      });
      break; // one harmful classification per item; severity picks the first (highest-intent) match
    }
  }

  for (const pattern of IMPERSONATION_PATTERNS) {
    if (pattern.re.test(haystack)) {
      out.push({
        stageKey: "impersonation",
        category: pattern.category,
        severity: pattern.severity,
        reason: pattern.label,
        sourceType,
        searchSentiment,
      });
      break;
    }
  }

  for (const pattern of PRIVACY_PATTERNS) {
    if (pattern.re.test(haystack)) {
      out.push({
        stageKey: "privacy_exposure",
        category: pattern.category,
        severity: pattern.severity,
        reason: pattern.label,
        sourceType,
        searchSentiment,
      });
      break;
    }
  }

  // Media candidates are recorded as candidates ONLY. Nothing here asserts
  // manipulation: that requires the manipulation analysis to actually run.
  if (sourceType === "Video" || input.isMedia) {
    out.push({
      stageKey: "ai_manipulation",
      category: "Media candidate",
      severity: 2,
      reason: "Media candidate discovered · manipulation analysis pending",
      sourceType,
      searchSentiment,
    });
  }

  if (typeof input.searchRank === "number" && input.searchRank > 0) {
    out.push({
      stageKey: "search_reputation",
      category:
        searchSentiment === "potential_risk"
          ? "Potential risk result"
          : searchSentiment === "positive"
            ? "Positive result"
            : "Neutral result",
      severity: searchSentiment === "potential_risk" ? 4 : 0,
      reason: `Appeared at observed search rank #${input.searchRank}`,
      sourceType,
      searchSentiment,
    });
  }

  return out;
}

/** Mask obviously sensitive strings before anything reaches the UI. */
export function maskSensitive(text: string): string {
  return text
    .replace(/(\+?\d[\d\s-]{6,}\d)/g, (m) => `${m.slice(0, 3)}••••••${m.slice(-2)}`)
    .replace(/([\w.+-]{2})[\w.+-]*@([\w-]+\.[\w.]+)/g, "$1•••@$2");
}

/** Wording guard used by tests: no verdict language may leave the classifier. */
export const FORBIDDEN_VERDICT_WORDS = [/\bdeepfake\b/i, /\bdefamation\b/i, /\bproven\b/i, /\bconfirmed fake\b/i];
