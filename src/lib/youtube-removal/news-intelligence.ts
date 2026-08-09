/**
 * YouTube Removal Intelligence — News Allegation Intelligence Engine & Topic Classifier.
 *
 * Detects allegation/investigation signals in official news content, classifies news topics,
 * builds allegation search query expansions, and provides neutral safety language helpers.
 */

export type SourceScope = "NON_OFFICIAL_ONLY" | "NEWS_ALLEGATIONS" | "ALL_SOURCES";

export type SourceType =
  | "OFFICIAL_NEWS"
  | "INDEPENDENT_CREATOR"
  | "COMMENTARY"
  | "INTERVIEW"
  | "OTHER";

export type NewsTopicTag =
  | "SCAM_ALLEGATION"
  | "FRAUD_ALLEGATION"
  | "MONEY_LAUNDERING"
  | "LEGAL_CASE"
  | "INVESTIGATION"
  | "CUSTOMER_COMPLAINT"
  | "FINANCIAL_COMPLAINT"
  | "BUSINESS_CONTROVERSY"
  | "PERSONAL_ALLEGATION"
  | "OTHER_CONTROVERSY";

export const ALLEGATION_SIGNAL_VOCABULARY = [
  "scam",
  "fraud",
  "allegation",
  "accusation",
  "investigation",
  "money laundering",
  "complaint",
  "case",
  "controversy",
  "raid",
  "ed",
  "enforcement directorate",
  "police case",
  "court case",
  "cheating",
  "financial irregularity",
  "exposed",
  "legal dispute",
  "investigative report",
  "fir",
  "crime branch",
  "cbi",
  "lokayukta",
  // Malayalam terms & transliterations
  "thattippu",
  "vivadam",
  "kodathi",
  "anweshanam",
  "തട്ടിപ്പ്",
  "കേസ്",
  "വിവാദം",
  "കോടതി",
  "അന്വേഷണം",
  "വിചാരണ",
] as const;

/** Detect if content text contains meaningful allegation / investigation signals. */
export function detectNewsAllegationSignals(text: string): {
  isAllegationMatch: boolean;
  matchedSignals: string[];
} {
  const normalized = (text || "").toLowerCase();
  const matched = ALLEGATION_SIGNAL_VOCABULARY.filter((term) => {
    const lowerTerm = term.toLowerCase();
    if (lowerTerm.length <= 3) {
      // Word boundary for short acronyms like ED, FIR, CBI
      const regex = new RegExp(`\\b${lowerTerm}\\b`, "i");
      return regex.test(normalized);
    }
    return normalized.includes(lowerTerm);
  });

  return {
    isAllegationMatch: matched.length > 0,
    matchedSignals: Array.from(new Set(matched)),
  };
}

/** Classify news topic tags based on text content and matched signals. */
export function classifyNewsTopics(text: string, matchedSignals: string[]): NewsTopicTag[] {
  const normalized = (text || "").toLowerCase();
  const tags = new Set<NewsTopicTag>();

  if (normalized.includes("scam") || normalized.includes("thattippu") || normalized.includes("തട്ടിപ്പ്")) {
    tags.add("SCAM_ALLEGATION");
  }
  if (normalized.includes("fraud") || normalized.includes("cheating") || normalized.includes("financial irregularity")) {
    tags.add("FRAUD_ALLEGATION");
    tags.add("FINANCIAL_COMPLAINT");
  }
  if (normalized.includes("money laundering") || normalized.includes("ed") || normalized.includes("enforcement directorate")) {
    tags.add("MONEY_LAUNDERING");
    tags.add("INVESTIGATION");
  }
  if (normalized.includes("court") || normalized.includes("police") || normalized.includes("fir") || normalized.includes("cbi") || normalized.includes("lokayukta") || normalized.includes("കോടതി")) {
    tags.add("LEGAL_CASE");
  }
  if (normalized.includes("investigation") || normalized.includes("anweshanam") || normalized.includes("raid") || normalized.includes("അന്വേഷണം")) {
    tags.add("INVESTIGATION");
  }
  if (normalized.includes("complaint") || normalized.includes("customer")) {
    tags.add("CUSTOMER_COMPLAINT");
  }
  if (normalized.includes("controversy") || normalized.includes("vivadam") || normalized.includes("വിവാദം")) {
    tags.add("BUSINESS_CONTROVERSY");
  }

  if (tags.size === 0 && matchedSignals.length > 0) {
    tags.add("OTHER_CONTROVERSY");
  }

  return Array.from(tags);
}

/** Classify source type for UI badges. */
export function classifySourceType(channelTitle: string, channelClass: string): SourceType {
  if (channelClass === "official_news") return "OFFICIAL_NEWS";

  const lower = (channelTitle || "").toLowerCase();
  if (lower.includes("commentary") || lower.includes("talks") || lower.includes("review") || lower.includes("hub")) {
    return "COMMENTARY";
  }
  if (lower.includes("interview") || lower.includes("podcast") || lower.includes("uncut")) {
    return "INTERVIEW";
  }

  return "INDEPENDENT_CREATOR";
}

/** Build allegation query expansion for NEWS_ALLEGATIONS and ALL_SOURCES mode. */
export function buildAllegationQueryPlan(targetName: string, aliases: string[] = []): string[] {
  const names = [targetName, ...aliases].map((n) => n.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (q: string) => {
    const k = q.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(q);
    }
  };

  const terms = [
    "scam",
    "fraud",
    "allegation",
    "controversy",
    "investigation",
    "complaint",
    "money laundering",
    "case",
    "exposed",
    "police complaint",
    "court case",
    "ED raid",
  ];

  for (const name of names) {
    for (const term of terms) {
      push(`${name} ${term}`);
    }
  }

  return out;
}

/** Neutral safety language formatter for news allegation cards. */
export function formatNewsSafetyNote(topicTags: NewsTopicTag[]): string {
  if (topicTags.includes("SCAM_ALLEGATION") || topicTags.includes("FRAUD_ALLEGATION")) {
    return "News coverage discussing financial or business allegations involving the target. Review context.";
  }
  if (topicTags.includes("LEGAL_CASE") || topicTags.includes("INVESTIGATION")) {
    return "Reporting on court, police, or regulatory investigation context involving the target.";
  }
  if (topicTags.includes("MONEY_LAUNDERING")) {
    return "Reporting discussing statutory or enforcement agency inquiry context.";
  }
  return "Potential factual allegation detected in news coverage — review context.";
}
