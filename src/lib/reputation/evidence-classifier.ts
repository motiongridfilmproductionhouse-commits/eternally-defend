/**
 * EVIDENCE-GATED REPUTATION RISK CLASSIFIER — source-independent.
 *
 * Replaces keyword-presence classification. A candidate only becomes a
 * reputation-risk finding when ALL of these hold:
 *
 *   subject_match AND subject_directed_risk_evidence AND confidence >= threshold
 *
 * Keyword presence is treated purely as a discovery/relevance signal. Ordinary
 * entertainment material (reviews, trailers, songs, promotions, press events,
 * normal interviews, box-office chatter, general film news) is detected and
 * classified as a neutral mention — it stays persisted and searchable, it is
 * only kept out of the default reputation-risk feed.
 *
 * The same rules apply to YouTube, Reddit, news, blogs, forums, reviews,
 * social sources and arbitrary web pages: only the retrieved text differs.
 */

export type ClassificationTier =
  | "TIER_0_IRRELEVANT"
  | "TIER_1_NEUTRAL"
  | "TIER_2_NEEDS_REVIEW"
  | "TIER_3_REPUTATION_RISK"
  | "TIER_4_HIGH_RISK";

export type EvidenceSource =
  | "title"
  | "description"
  | "transcript"
  | "page_content"
  | "comments"
  | "none";

export type EvidenceLevel = "NONE" | "METADATA_ONLY" | "FULL_CONTENT";

export type RiskCategory =
  | "ALLEGATION"
  | "ACCUSATION"
  | "CONTROVERSY"
  | "CRITICISM"
  | "HARASSMENT"
  | "MISLEADING_NARRATIVE"
  | "MANIPULATED_MEDIA"
  | "IMPERSONATION"
  | "PRIVACY_RISK"
  | "LEGAL_DISPUTE"
  | "MISINFORMATION"
  | null;

export type ContentType =
  | "MOVIE_REVIEW"
  | "MOVIE_SCENE"
  | "TRAILER"
  | "TEASER"
  | "SONG"
  | "PROMOTION"
  | "PRESS_EVENT"
  | "NORMAL_INTERVIEW"
  | "FAN_EDIT"
  | "BOX_OFFICE_DISCUSSION"
  | "GENERAL_FILM_NEWS"
  | "REACTION_WITHOUT_SUBJECT_ALLEGATION"
  | "GENERAL_CONTENT";

export type Classification =
  | "IRRELEVANT"
  | "ENTERTAINMENT_MENTION"
  | "NEUTRAL_MENTION"
  | "OFFICIAL_OR_PROMOTIONAL"
  | "NEEDS_REVIEW"
  | "REPUTATION_RISK"
  | "HIGH_RISK";

export interface RiskEvidence {
  subjectMatched: boolean;
  riskEvidenceFound: boolean;
  riskCategory: RiskCategory;
  /** Verbatim excerpt from the retrieved material. Never synthesised. */
  evidenceText: string | null;
  evidenceSource: EvidenceSource;
  /** 0..1 */
  confidence: number;
  reason: string;
}

export interface EvidenceClassification {
  tier: ClassificationTier;
  classification: Classification;
  contentType: ContentType;
  evidenceLevel: EvidenceLevel;
  evidence: RiskEvidence;
  /** Non-conclusive display label. */
  label: string;
  /** 0..100 reputation-risk score derived AFTER classification. */
  reputationRisk: number;
  /** True when the finding may enter the default reputation-risk feed. */
  inRiskFeed: boolean;
}

export interface EvidenceClassifierInput {
  target: string;
  aliases?: string[];
  title?: string | null;
  description?: string | null;
  pageText?: string | null;
  transcript?: string | null;
  comments?: string | null;
  author?: string | null;
  url?: string | null;
  identityTier?: "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "NOT_SUBJECT";
  /** 0..100 */
  identityConfidence?: number;
}

/** Confidence a risk classification must reach to enter the risk feed. */
export const RISK_CONFIDENCE_THRESHOLD = 0.6;

/* ------------------------------------------------------------------ *
 * Entertainment / neutral content-type detection
 * ------------------------------------------------------------------ */

const ENTERTAINMENT_PATTERNS: Array<{ type: ContentType; re: RegExp }> = [
  { type: "TRAILER", re: /\b(official\s+)?trailer\b|\btrailer\s*(launch|reaction|out)\b/i },
  { type: "TEASER", re: /\bteaser\b|\bfirst look\b|\bglimpse\b|\bmotion poster\b/i },
  {
    type: "SONG",
    re: /\b(video song|lyrical|lyric video|full song|audio jukebox|jukebox|song promo|music video|bgm|title track)\b/i,
  },
  {
    type: "MOVIE_REVIEW",
    re: /\b(movie review|film review|review\s*[|&·-]|public review|audience review|theatre response|first day first show|fdfs|honest review|rating\b.*\breview|review\s+in\s+\w+)\b/i,
  },
  {
    type: "MOVIE_SCENE",
    re: /\b(scene|climax|comedy scene|fight scene|full movie|movie clip|deleted scene|best scenes)\b/i,
  },
  {
    type: "PROMOTION",
    re: /\b(promo|promotion|now streaming|in cinemas|book (your )?tickets|releasing on|out now|ott release|available on (prime|netflix|hotstar|zee|sony ?liv|aha))\b/i,
  },
  {
    type: "PRESS_EVENT",
    re: /\b(press meet|press conference|audio launch|pre.?release event|success meet|trailer launch event|promotion event|red carpet|award (show|night|function))\b/i,
  },
  {
    type: "NORMAL_INTERVIEW",
    re: /\b(exclusive interview|interview with|in conversation with|candid chat|rapid fire|q&a|talks about (his|her|the) (movie|film|character|role))\b/i,
  },
  { type: "FAN_EDIT", re: /\b(fan ?made|fan edit|whatsapp status|status video|edit\b.*\b4k|mashup|tribute|whatsapp)\b/i },
  {
    type: "BOX_OFFICE_DISCUSSION",
    re: /\b(box office|collection(s)?\b|day \d+ collection|worldwide gross|opening day|verdict\b.*\bhit|blockbuster|footfall)\b/i,
  },
  {
    type: "GENERAL_FILM_NEWS",
    re: /\b(release date|shooting (begins|starts|wrapped)|first schedule|cast (and|&) crew|signs (his|her|new) (next|film)|to star|announced|poster (out|released)|update\b.*\bmovie)\b/i,
  },
  {
    type: "REACTION_WITHOUT_SUBJECT_ALLEGATION",
    re: /\b(reaction|react(ing)? to|breakdown|explained|theory|celebrity reaction)\b/i,
  },
];

const OFFICIAL_CHANNEL_RE =
  /\b(official|entertainments?|studios?|films?|movies|music|productions?|cinemas?|tv|records|network)\b/i;

/* ------------------------------------------------------------------ *
 * Subject-directed risk assertions
 * ------------------------------------------------------------------ */

/**
 * Each rule requires an actual assertion — not a topic word. Rules are matched
 * only inside a sentence that also mentions the subject (or in a title where
 * the subject appears), so "review" or "legal" alone can never classify.
 */
interface RiskRule {
  category: Exclude<RiskCategory, null>;
  /** Assertion patterns (verb/claim-level, not topic-level). */
  re: RegExp;
  /** Base confidence when matched inside retrieved full content. */
  base: number;
  high?: boolean;
}

const RISK_RULES: RiskRule[] = [
  {
    category: "MANIPULATED_MEDIA",
    re: /\b(deepfake|deep fake|face ?swap(ped)?|morphed (photo|image|video|clip)|ai[- ]generated (nude|photo|video) of|synthetic (video|nude)|fake (nude|obscene) (photo|image|video))\b/i,
    base: 0.9,
    high: true,
  },
  {
    category: "IMPERSONATION",
    re: /\b(fake (account|profile|page|handle)|impersonat(ing|ion|es|ed)|posing as|pretending to be|duplicate account|cloned (profile|account))\b/i,
    base: 0.85,
    high: true,
  },
  {
    category: "PRIVACY_RISK",
    re: /\b(leaked (photos?|video|clip|chat|number|footage)|private (photos?|video|chats?) leaked|doxx(ed|ing)|mms|obscene (photos?|video) of|intimate (photos?|video))\b/i,
    base: 0.85,
    high: true,
  },
  {
    category: "HARASSMENT",
    re: /\b(harass(ed|ing|ment)|abused|abusing|threaten(ed|ing)|death threats?|rape threats?|targeted (abuse|attack|campaign)|hate campaign|body ?sham(ed|ing)|cyber ?bull(y|ied|ying)|slut ?sham)\b/i,
    base: 0.82,
    high: true,
  },
  {
    category: "ALLEGATION",
    re: /\b(alleg(ed|es|ation|ations|edly)|accus(ed|es|ation|ations|ing)|complaint (filed|lodged|registered) against|fir (filed|registered|lodged) against|booked (for|under)|charged with|arrested (for|in)|misconduct|misbehav(ed|iour|ior)|harassment (case|complaint) against|assault(ed)?|molest|drug (case|probe)|cheating case|fraud (case|charges)|forgery)\b/i,
    base: 0.8,
    high: true,
  },
  {
    category: "LEGAL_DISPUTE",
    re: /\b(lawsuit|sued|suing|legal notice (to|against|served)|court (case|order|summons)|police (case|complaint) against|banned by (the )?(producers?|association|amma|feft?a)|ban(ned)? from (films|industry)|contract (breach|dispute)|producers? (association )?(ban|blacklist)|blacklisted|arbitration|compensation (claim|demand)|criminal case)\b/i,
    base: 0.78,
  },
  {
    category: "MISINFORMATION",
    re: /\b(fake news (about|on)|false (claim|news|report|information) (about|regarding|on)|debunk(ed|ing)|hoax|misinformation|fact ?check(ed)?|baseless (claim|rumour|rumor)|spreading (lies|rumours|rumors)|misquoted)\b/i,
    base: 0.72,
  },
  {
    category: "MISLEADING_NARRATIVE",
    re: /\b(misleading (title|thumbnail|claim|edit|narrative)|clickbait (claim|title)|out of context|edited (clip|video) to|twisted (statement|words)|defam(e|ed|ing|atory|ation)|character assassination|smear campaign)\b/i,
    base: 0.75,
  },
  {
    category: "CONTROVERSY",
    re: /\b(controversy (over|around|after|regarding)|sparked? (a )?(row|controversy|outrage)|apolog(y|ised|ized) after|faces? (backlash|flak|outrage|criticism) (for|over|after)|under fire (for|over)|slammed (for|over)|trolled (for|over)|boycott(ed|ing)? \w+|walked out of|quit(s)? (the )?(film|project) after|feud|clash(ed)? with|row with|fallout with|dispute with)\b/i,
    base: 0.7,
  },
  {
    category: "CRITICISM",
    re: /\b(criticis(ed|ing|m)|criticiz(ed|ing)|condemn(ed|ing)|called out (for|over)|questioned (his|her|the actor'?s) (behaviour|behavior|conduct|attitude)|unprofessional|arrogant behaviour|arrogant behavior|no ?ne wants to work with|blamed (for|him|her))\b/i,
    base: 0.66,
  },
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function norm(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function subjectForms(input: EvidenceClassifierInput): string[] {
  return Array.from(
    new Set(
      [input.target, ...(input.aliases ?? [])]
        .map((value) => norm(String(value ?? "")).toLowerCase())
        .filter((value) => value.length >= 3),
    ),
  );
}

function subjectTokens(forms: string[]): string[] {
  const tokens = new Set<string>();
  for (const form of forms) {
    for (const token of form.split(/[^a-z0-9\u0D00-\u0D7F]+/i)) {
      if (token.length >= 4) tokens.add(token.toLowerCase());
    }
  }
  return Array.from(tokens);
}

/** Sentence mentions the subject by full form, or by a distinctive token. */
function mentionsSubject(sentence: string, forms: string[], tokens: string[]): boolean {
  const s = sentence.toLowerCase();
  if (forms.some((form) => s.includes(form))) return true;
  const hits = tokens.filter((token) => s.includes(token));
  return hits.length >= Math.min(2, tokens.length);
}

function sentencesOf(text: string): string[] {
  return norm(text)
    .split(/(?<=[.!?…])\s+|\n+|\s+\|\s+|\s+·\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
    .slice(0, 400);
}

function detectContentType(title: string, description: string, author: string): ContentType {
  const text = `${title} ${description}`;
  for (const { type, re } of ENTERTAINMENT_PATTERNS) {
    if (re.test(text)) return type;
  }
  if (author && OFFICIAL_CHANNEL_RE.test(author)) return "PROMOTION";
  return "GENERAL_CONTENT";
}

const ENTERTAINMENT_TYPES = new Set<ContentType>([
  "MOVIE_REVIEW",
  "MOVIE_SCENE",
  "TRAILER",
  "TEASER",
  "SONG",
  "PROMOTION",
  "PRESS_EVENT",
  "NORMAL_INTERVIEW",
  "FAN_EDIT",
  "BOX_OFFICE_DISCUSSION",
  "GENERAL_FILM_NEWS",
  "REACTION_WITHOUT_SUBJECT_ALLEGATION",
]);

const CATEGORY_LABELS: Record<Exclude<RiskCategory, null>, string> = {
  ALLEGATION: "Allegation",
  ACCUSATION: "Accusation",
  CONTROVERSY: "Controversy",
  CRITICISM: "Criticism",
  HARASSMENT: "Harassment",
  MISLEADING_NARRATIVE: "Misleading Narrative",
  MANIPULATED_MEDIA: "Manipulated Media",
  IMPERSONATION: "Impersonation",
  PRIVACY_RISK: "Privacy Risk",
  LEGAL_DISPUTE: "Legal Dispute",
  MISINFORMATION: "Misinformation",
};

const HIGH_RISK_CATEGORIES = new Set<Exclude<RiskCategory, null>>([
  "MANIPULATED_MEDIA",
  "IMPERSONATION",
  "PRIVACY_RISK",
  "HARASSMENT",
  "ALLEGATION",
  "MISINFORMATION",
]);

interface EvidenceHit {
  rule: RiskRule;
  sentence: string;
  source: EvidenceSource;
  matched: string;
}

function scanForEvidence(
  text: string,
  source: EvidenceSource,
  forms: string[],
  tokens: string[],
): EvidenceHit[] {
  if (!text) return [];
  const hits: EvidenceHit[] = [];
  for (const sentence of sentencesOf(text)) {
    if (!mentionsSubject(sentence, forms, tokens)) continue;
    for (const rule of RISK_RULES) {
      const match = rule.re.exec(sentence);
      if (match) hits.push({ rule, sentence, source, matched: match[0] });
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ *
 * Main entry point
 * ------------------------------------------------------------------ */

export function classifyWithEvidence(input: EvidenceClassifierInput): EvidenceClassification {
  const title = norm(String(input.title ?? ""));
  const description = norm(String(input.description ?? ""));
  const author = norm(String(input.author ?? ""));
  const pageText = String(input.pageText ?? "");
  const transcript = String(input.transcript ?? "");
  const comments = String(input.comments ?? "");

  const forms = subjectForms(input);
  const tokens = subjectTokens(forms);
  const contentType = detectContentType(title, description, author);

  const identityTier = input.identityTier ?? "AMBIGUOUS";
  const identityConfidence =
    typeof input.identityConfidence === "number"
      ? input.identityConfidence
      : identityTier === "VERIFIED"
        ? 90
        : identityTier === "PROBABLE"
          ? 70
          : 45;

  const subjectMatched = identityTier !== "NOT_SUBJECT";
  const hasFullContent = Boolean(
    (pageText && pageText.length > 200) || transcript.length > 80 || comments.length > 80,
  );
  const evidenceLevel: EvidenceLevel = hasFullContent ? "FULL_CONTENT" : "METADATA_ONLY";

  if (!subjectMatched) {
    return {
      tier: "TIER_0_IRRELEVANT",
      classification: "IRRELEVANT",
      contentType,
      evidenceLevel: "NONE",
      evidence: {
        subjectMatched: false,
        riskEvidenceFound: false,
        riskCategory: null,
        evidenceText: null,
        evidenceSource: "none",
        confidence: 0,
        reason: "The retrieved content is not about the scanned subject.",
      },
      label: "Not the scanned subject",
      reputationRisk: 0,
      inRiskFeed: false,
    };
  }

  /* Evidence extraction — full content first, metadata last. */
  const hits: EvidenceHit[] = [
    ...scanForEvidence(transcript, "transcript", forms, tokens),
    ...scanForEvidence(pageText, "page_content", forms, tokens),
    ...scanForEvidence(comments, "comments", forms, tokens),
    ...scanForEvidence(description, "description", forms, tokens),
    ...scanForEvidence(title, "title", forms, tokens),
  ];

  /*
   * Titles are short and often lack a full sentence, so a title-level match is
   * accepted when the subject appears anywhere in the title.
   */
  if (!hits.length && mentionsSubject(`${title} ${description}`, forms, tokens)) {
    for (const rule of RISK_RULES) {
      const match = rule.re.exec(`${title} ${description}`);
      if (match) {
        hits.push({
          rule,
          sentence: title || description,
          source: title && rule.re.test(title) ? "title" : "description",
          matched: match[0],
        });
        break;
      }
    }
  }

  const entertainment = ENTERTAINMENT_TYPES.has(contentType);

  if (!hits.length) {
    const classification: Classification = entertainment
      ? contentType === "PROMOTION" || contentType === "PRESS_EVENT"
        ? "OFFICIAL_OR_PROMOTIONAL"
        : "ENTERTAINMENT_MENTION"
      : "NEUTRAL_MENTION";
    return {
      tier: "TIER_1_NEUTRAL",
      classification,
      contentType,
      evidenceLevel,
      evidence: {
        subjectMatched: true,
        riskEvidenceFound: false,
        riskCategory: null,
        evidenceText: null,
        evidenceSource: "none",
        confidence: 0,
        reason: entertainment
          ? `Ordinary entertainment content (${contentType.toLowerCase().replace(/_/g, " ")}); no reputation-impacting claim directed at the subject was found in the retrieved material.`
          : "No reputation-impacting claim directed at the subject was found in the retrieved material.",
      },
      label: entertainment ? "Entertainment mention" : "Neutral mention",
      reputationRisk: 0,
      inRiskFeed: false,
    };
  }

  /* Strongest evidence wins; full content outranks metadata. */
  const sourceWeight: Record<EvidenceSource, number> = {
    transcript: 1,
    page_content: 0.98,
    comments: 0.85,
    description: 0.7,
    title: 0.68,
    none: 0,
  };
  hits.sort(
    (a, b) =>
      b.rule.base * sourceWeight[b.source] - a.rule.base * sourceWeight[a.source] ||
      b.sentence.length - a.sentence.length,
  );
  const best = hits[0];

  let confidence = best.rule.base * sourceWeight[best.source];
  // Identity certainty modulates risk confidence.
  confidence *= 0.65 + (Math.min(100, Math.max(0, identityConfidence)) / 100) * 0.35;
  // Metadata-only evidence can never justify a high-severity conclusion.
  if (evidenceLevel === "METADATA_ONLY") confidence = Math.min(confidence, 0.58);
  // Corroboration across multiple independent excerpts raises confidence.
  const distinctSources = new Set(hits.map((h) => h.source));
  if (distinctSources.size > 1) confidence = Math.min(0.97, confidence + 0.05);
  // Entertainment framing requires stronger evidence before promotion.
  if (entertainment && !best.rule.high) confidence -= 0.12;
  confidence = Math.max(0, Math.min(0.97, Number(confidence.toFixed(2))));

  const category = best.rule.category;
  const evidenceText = best.sentence.slice(0, 400);

  const metadataOnly = evidenceLevel === "METADATA_ONLY";
  const qualifies = confidence >= RISK_CONFIDENCE_THRESHOLD && !metadataOnly;

  if (!qualifies) {
    return {
      tier: "TIER_2_NEEDS_REVIEW",
      classification: "NEEDS_REVIEW",
      contentType,
      evidenceLevel,
      evidence: {
        subjectMatched: true,
        riskEvidenceFound: false,
        riskCategory: category,
        evidenceText,
        evidenceSource: best.source,
        confidence,
        reason: metadataOnly
          ? `Possible ${CATEGORY_LABELS[category].toLowerCase()} signal appears only in ${best.source.replace(/_/g, " ")} metadata ("${best.matched}"); full content was not retrieved, so this is held for human review.`
          : `Evidence for a ${CATEGORY_LABELS[category].toLowerCase()} concerning the subject is present but below the confidence threshold.`,
      },
      label: "Needs Review",
      reputationRisk: Math.round(confidence * 45),
      inRiskFeed: false,
    };
  }

  const high = Boolean(best.rule.high) && HIGH_RISK_CATEGORIES.has(category) && confidence >= 0.75;

  return {
    tier: high ? "TIER_4_HIGH_RISK" : "TIER_3_REPUTATION_RISK",
    classification: high ? "HIGH_RISK" : "REPUTATION_RISK",
    contentType,
    evidenceLevel,
    evidence: {
      subjectMatched: true,
      riskEvidenceFound: true,
      riskCategory: category,
      evidenceText,
      evidenceSource: best.source,
      confidence,
      reason: `The retrieved ${best.source.replace(/_/g, " ")} makes a specific ${CATEGORY_LABELS[category].toLowerCase()} concerning the scanned subject ("${best.matched}").`,
    },
    label: CATEGORY_LABELS[category],
    reputationRisk: Math.round(Math.min(100, confidence * 100 * (high ? 1 : 0.82))),
    inRiskFeed: true,
  };
}

/** Human-readable, non-conclusive tier label. */
export function tierLabel(tier: ClassificationTier): string {
  switch (tier) {
    case "TIER_0_IRRELEVANT":
      return "Irrelevant";
    case "TIER_1_NEUTRAL":
      return "Neutral";
    case "TIER_2_NEEDS_REVIEW":
      return "Needs Review";
    case "TIER_3_REPUTATION_RISK":
      return "Potential Reputation Risk";
    case "TIER_4_HIGH_RISK":
      return "High Risk";
  }
}
