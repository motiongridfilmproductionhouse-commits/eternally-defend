/**
 * Page-level evidence classification for Deepfake Intelligence.
 *
 * Inspects the exact result page (URL + scraped text) before a hit can be
 * treated as a deepfake finding. A name mention alone is never enough.
 * Both identity evidence and synthetic/impersonation evidence are required.
 */

import { normalizeDeepfakeText } from "./filter.server";
import { getIdentityPhrases, matchesSelectedIdentity } from "./identity.server";

export type FindingClassification =
  | "VERIFIED_DEEPFAKE"
  | "PROBABLE_DEEPFAKE"
  | "ADULT_NAME_MENTION"
  | "UNRELATED_ADULT_CONTENT"
  | "UNVERIFIED_LEAD";

export type PageType =
  "search" | "tag" | "category" | "performer_index" | "listing" | "content" | "unknown";

export const CLIENT_VISIBLE_CLASSIFICATIONS: FindingClassification[] = [
  "VERIFIED_DEEPFAKE",
  "PROBABLE_DEEPFAKE",
];

export const INTERNAL_REVIEW_CLASSIFICATIONS: FindingClassification[] = ["UNVERIFIED_LEAD"];

export const PERSISTED_FINDING_CLASSIFICATIONS: FindingClassification[] = [
  "VERIFIED_DEEPFAKE",
  "PROBABLE_DEEPFAKE",
  "UNVERIFIED_LEAD",
];

export interface PageEvidenceTarget {
  name: string;
  aliases?: string[];
  handles?: string[];
}

/** Minimum exact-page body length required for client-visible classifications. */
export const MIN_EXACT_PAGE_TEXT_CHARS = 80;

export interface PageEvidenceInput {
  url: string;
  title?: string | null;
  description?: string | null;
  /** Scraped page body / markdown / main text from the exact result URL. */
  page_text?: string | null;
  /**
   * True only when Firecrawl (or equivalent) successfully inspected the
   * exact result URL. Search snippets alone must never set this.
   */
  page_inspected?: boolean | null;
  query?: string | null;
  target: PageEvidenceTarget;
  hive_deepfake_score?: number | null;
  hive_ai_generated_score?: number | null;
  target_face_match?: boolean | null;
  face_similarity?: number | null;
  is_synthetic?: boolean | null;
  content_category?: string | null;
}

export function hasExactPageContent(
  pageText?: string | null,
  pageInspected?: boolean | null,
): boolean {
  if (pageInspected === false) return false;
  return (pageText ?? "").trim().length >= MIN_EXACT_PAGE_TEXT_CHARS;
}

export interface PageEvidenceResult {
  page_type: PageType;
  identity_confidence: number;
  synthetic_media_confidence: number;
  matched_evidence: string[];
  finding_classification: FindingClassification;
  classification_explanation: string;
  client_visible: boolean;
}

const LISTING_PAGE_TYPES: PageType[] = ["search", "tag", "category", "performer_index", "listing"];

const SEARCH_URL_PATTERNS = [
  /\/search(?:\/|\?|$)/i,
  /\/results?(?:\/|\?|$)/i,
  /[?&](?:q|query|search|keyword|keywords|k|s|term|terms)=/i,
];

const TAG_URL_PATTERNS = [/\/tags?(?:\/|\?|$)/i, /\/labelled?\//i, /[?&]tags?=/i];

const CATEGORY_URL_PATTERNS = [
  /\/categor(?:y|ies)(?:\/|\?|$)/i,
  /\/genres?(?:\/|\?|$)/i,
  /\/channels?(?:\/|\?|$)/i,
  /\/sections?(?:\/|\?|$)/i,
];

const PERFORMER_INDEX_URL_PATTERNS = [
  /\/(?:pornstar|pornstars|model|models|performer|performers|actress|actor|star|stars)(?:\/|\?|$)/i,
  /\/people(?:\/|\?|$)/i,
  /\/celebrities(?:\/|\?|$)/i,
];

const GENERIC_LISTING_URL_PATTERNS = [
  /\/browse(?:\/|\?|$)/i,
  /\/explore(?:\/|\?|$)/i,
  /\/discover(?:\/|\?|$)/i,
  /\/videos?(?:\/)?$/i,
  /\/photos?(?:\/)?$/i,
  /\/galleries?(?:\/)?$/i,
  /\/most[-_]?viewed/i,
  /\/top[-_]?rated/i,
  /\/newest(?:\/|\?|$)/i,
  /\/popular(?:\/|\?|$)/i,
  /\/trending(?:\/|\?|$)/i,
  /\/best(?:\/|\?|$)/i,
];

const LISTING_TITLE_PATTERNS = [
  /^search results?/i,
  /\bsearch results?\b/i,
  /\bvideos?\s+tagged\b/i,
  /\btagged\s+with\b/i,
  /\bcategory\b/i,
  /\bbrowse\b/i,
  /\bpornstar(?:s)?\b/i,
  /\bperformer(?:s)?\b/i,
  /\bmodels?\s+list\b/i,
  /\bno information is available/i,
];

const ADULT_SITE_PATTERNS = [
  /\b(?:porn|xxx|xvideos|xnxx|pornhub|xhamster|onlyfans|fansly|adult|nsfw|hentai|sex\s*tape)\b/i,
  /\b(?:nude|nudes|naked|escort|camgirl)\b/i,
];

const SYNTHETIC_PATTERNS: Array<{ label: string; pattern: RegExp; weight: number }> = [
  {
    label: "deepfake",
    pattern: /\b(?:deepfake|deep\s*fake)\b/i,
    weight: 45,
  },
  {
    label: "face-swap",
    pattern: /\b(?:face\s*swap|faceswap|face\s*replaced)\b/i,
    weight: 40,
  },
  {
    label: "ai-nude",
    pattern:
      /\b(?:ai\s*nude|fake\s*nude|synthetic\s*nude|generated\s*nude|undress(?:ing)?\s*ai)\b/i,
    weight: 45,
  },
  {
    label: "morphed-media",
    pattern:
      /\b(?:morph(?:ed|ing)|digitally\s+altered|ai[-\s]?generated\s+(?:image|video|photo|nude|porn))\b/i,
    weight: 35,
  },
  {
    label: "impersonation",
    pattern: /\b(?:impersonat(?:e|ed|ion|ing)|fake\s+(?:account|profile|celebrity))\b/i,
    weight: 30,
  },
];

const EXPLICIT_ONLY_PATTERNS = [
  /\b(?:nude|nudes|naked|nudity|porn|porno|xxx|sex\s+video|sex\s+tape|leaked)\b/i,
];

function targetNames(target: PageEvidenceTarget): string[] {
  return getIdentityPhrases(target);
}

function containsTarget(text: string, names: string[], target?: PageEvidenceTarget): boolean {
  if (target) {
    return matchesSelectedIdentity(text, target);
  }

  const normalized = normalizeDeepfakeText(text);
  if (!normalized) return false;

  return names.some((name) => {
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(normalized);
  });
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function detectPageType(
  url: string,
  title?: string | null,
  pageText?: string | null,
): PageType {
  const titleText = title ?? "";
  const bodyHint = `${titleText} ${pageText ?? ""}`.slice(0, 2_000);

  if (SEARCH_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return "search";
  }

  if (TAG_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return "tag";
  }

  if (CATEGORY_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return "category";
  }

  if (PERFORMER_INDEX_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    /*
     * /pornstar/Name can be a performer profile index (listing of clips)
     * rather than a single deepfake asset page.
     */
    return "performer_index";
  }

  if (GENERIC_LISTING_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return "listing";
  }

  if (LISTING_TITLE_PATTERNS.some((pattern) => pattern.test(titleText))) {
    return "listing";
  }

  if (
    /\b(?:search results?|videos?\s+for|results\s+for)\b/i.test(bodyHint) &&
    /\b(?:filter|sort by|showing\s+\d+|page\s+\d+)\b/i.test(bodyHint)
  ) {
    return "search";
  }

  return "content";
}

export function isExcludedListingPageType(pageType: PageType): boolean {
  return LISTING_PAGE_TYPES.includes(pageType);
}

function scoreIdentityEvidence(input: {
  url: string;
  title: string;
  description: string;
  pageText: string;
  names: string[];
  target: PageEvidenceTarget;
  targetFaceMatch?: boolean | null;
  faceSimilarity?: number | null;
}): { confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let score = 0;

  const titleMatch = containsTarget(input.title, input.names, input.target);
  const descriptionMatch = containsTarget(input.description, input.names, input.target);
  const bodyMatch = containsTarget(input.pageText, input.names, input.target);
  const urlMatch = containsTarget(
    decodeURIComponent(input.url.replace(/[/_+\-.]/g, " ")),
    input.names,
    input.target,
  );

  if (titleMatch) {
    score += 40;
    evidence.push("identity:title");
  }

  if (descriptionMatch) {
    score += 20;
    evidence.push("identity:description");
  }

  if (bodyMatch) {
    score += 25;
    evidence.push("identity:page-body");
  }

  if (urlMatch && !titleMatch && !descriptionMatch && !bodyMatch) {
    /*
     * URL-only name mentions are weak (common on search/tag pages)
     * and must never alone justify a deepfake classification.
     */
    score += 10;
    evidence.push("identity:url-only");
  }

  if (input.targetFaceMatch) {
    const similarity = input.faceSimilarity ?? 0;
    score += similarity >= 88 ? 40 : 25;
    evidence.push("identity:face-match");
  }

  return {
    confidence: clampScore(score),
    evidence,
  };
}

function scoreSyntheticEvidence(input: {
  title: string;
  description: string;
  pageText: string;
  url: string;
  hiveDeepfakeScore?: number | null;
  hiveAiGeneratedScore?: number | null;
  isSynthetic?: boolean | null;
  contentCategory?: string | null;
}): { confidence: number; evidence: string[]; hasSyntheticSignal: boolean } {
  const evidence: string[] = [];
  let score = 0;

  const combined = [input.title, input.description, input.pageText, input.url].join(" ");

  for (const item of SYNTHETIC_PATTERNS) {
    if (item.pattern.test(combined)) {
      score += item.weight;
      evidence.push(`synthetic:${item.label}`);
    }
  }

  const hiveDeepfake = input.hiveDeepfakeScore ?? 0;
  const hiveAi = input.hiveAiGeneratedScore ?? 0;

  if (hiveDeepfake >= 0.9) {
    score += 50;
    evidence.push("synthetic:hive-deepfake");
  } else if (hiveDeepfake >= 0.7) {
    score += 30;
    evidence.push("synthetic:hive-deepfake-probable");
  }

  if (hiveAi >= 0.9) {
    score += 30;
    evidence.push("synthetic:hive-ai-generated");
  } else if (hiveAi >= 0.75) {
    score += 15;
    evidence.push("synthetic:hive-ai-generated-probable");
  }

  if (
    input.isSynthetic ||
    [
      "deepfake",
      "synthetic_media",
      "suspected_explicit_deepfake",
      "suspected_synthetic_media",
    ].includes(input.contentCategory ?? "")
  ) {
    score += 15;
    evidence.push("synthetic:media-classifier");
  }

  const hasSyntheticSignal = evidence.some((item) => item.startsWith("synthetic:"));

  /*
   * Explicit adult language without synthetic/impersonation terms must not
   * count as synthetic-media evidence.
   */
  if (!hasSyntheticSignal && EXPLICIT_ONLY_PATTERNS.some((pattern) => pattern.test(combined))) {
    evidence.push("adult:explicit-language-only");
  }

  return {
    confidence: clampScore(score),
    evidence,
    hasSyntheticSignal,
  };
}

function isAdultContext(input: {
  url: string;
  title: string;
  description: string;
  pageText: string;
}): boolean {
  const combined = [input.url, input.title, input.description, input.pageText].join(" ");

  return ADULT_SITE_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Classify a crawled result page using identity + synthetic evidence.
 * Call after scraping/inspecting the exact page whenever possible.
 */
export function classifyPageEvidence(input: PageEvidenceInput): PageEvidenceResult {
  const title = input.title ?? "";
  const description = input.description ?? "";
  const pageText = input.page_text ?? "";
  const names = targetNames(input.target);
  const exactPage = hasExactPageContent(pageText, input.page_inspected);

  const pageType = detectPageType(input.url, title, pageText);

  /*
   * Listing exclusion may use search snippets (these classes are never
   * client-visible). PROBABLE/VERIFIED scoring may only use exact-page
   * crawl evidence — never query text or unreached search snippets.
   */
  const listingIdentity = scoreIdentityEvidence({
    url: input.url,
    title,
    description,
    pageText,
    names,
    target: input.target,
    targetFaceMatch: false,
    faceSimilarity: null,
  });

  const scoredTitle = exactPage ? title : "";
  const scoredDescription = exactPage ? description : "";
  const scoredBody = exactPage ? pageText : "";

  const identity = scoreIdentityEvidence({
    url: input.url,
    title: scoredTitle,
    description: scoredDescription,
    pageText: scoredBody,
    names,
    target: input.target,
    targetFaceMatch: exactPage ? input.target_face_match : false,
    faceSimilarity: exactPage ? input.face_similarity : null,
  });

  const synthetic = scoreSyntheticEvidence({
    title: scoredTitle,
    description: scoredDescription,
    pageText: scoredBody,
    url: exactPage ? input.url : "",
    hiveDeepfakeScore: exactPage ? input.hive_deepfake_score : null,
    hiveAiGeneratedScore: exactPage ? input.hive_ai_generated_score : null,
    isSynthetic: exactPage ? input.is_synthetic : null,
    contentCategory: exactPage ? input.content_category : null,
  });

  const adultContext = isAdultContext({
    url: input.url,
    title,
    description,
    pageText,
  });

  const matchedEvidence = Array.from(
    new Set([
      `page_type:${pageType}`,
      exactPage ? "crawl:exact-page" : "crawl:unavailable",
      ...identity.evidence,
      ...synthetic.evidence,
    ]),
  );

  const listingHasIdentity =
    listingIdentity.confidence >= 40 &&
    !listingIdentity.evidence.every((item) => item === "identity:url-only");
  const hasIdentity =
    identity.confidence >= 40 && !identity.evidence.every((item) => item === "identity:url-only");
  const hasStrongIdentity =
    identity.confidence >= 70 &&
    (Boolean(input.target_face_match) ||
      identity.evidence.includes("identity:page-body") ||
      (identity.evidence.includes("identity:title") &&
        identity.evidence.includes("identity:description")));
  const hasSynthetic = synthetic.hasSyntheticSignal && synthetic.confidence >= 40;
  const hasStrongSynthetic = synthetic.confidence >= 70;
  const hasVisualSyntheticConfirmation =
    (input.hive_deepfake_score ?? 0) >= 0.9 ||
    (Boolean(input.target_face_match) && (input.hive_ai_generated_score ?? 0) >= 0.9);

  let findingClassification: FindingClassification;
  let explanation: string;

  if (isExcludedListingPageType(pageType)) {
    if (listingHasIdentity && adultContext) {
      findingClassification = "ADULT_NAME_MENTION";
      explanation = `Excluded ${pageType.replace(/_/g, " ")} page. Generic search, tag, category, performer-index or listing pages are not deepfake findings even when they mention the target name.`;
    } else if (adultContext) {
      findingClassification = "UNRELATED_ADULT_CONTENT";
      explanation = `Excluded ${pageType.replace(/_/g, " ")} page. Adult listing or index content without verified target deepfake evidence.`;
    } else {
      findingClassification = "UNRELATED_ADULT_CONTENT";
      explanation = `Excluded ${pageType.replace(/_/g, " ")} page. Not a specific synthetic-media content page.`;
    }
  } else if (!exactPage) {
    /*
     * Fail closed: crawl failure / empty page body can never become
     * client-visible, even when search snippets mention deepfake terms.
     */
    findingClassification = "UNVERIFIED_LEAD";
    explanation =
      "Exact-page crawl failed or returned empty content. Result retained as UNVERIFIED_LEAD for human review and is not client-visible.";
  } else if (!hasIdentity && !hasSynthetic) {
    findingClassification = "UNRELATED_ADULT_CONTENT";
    explanation =
      "Page lacks both identity evidence for the protected person and synthetic/impersonation evidence.";
  } else if (hasIdentity && !hasSynthetic) {
    findingClassification = "ADULT_NAME_MENTION";
    explanation =
      "Target name is present, but there is no synthetic or impersonation evidence. A name mention alone is never classified as a deepfake.";
  } else if (!hasIdentity && hasSynthetic) {
    findingClassification = "UNRELATED_ADULT_CONTENT";
    explanation =
      "Synthetic-media language or scores were detected, but the protected identity is not evidenced on the page itself.";
  } else if (
    exactPage &&
    hasStrongIdentity &&
    hasStrongSynthetic &&
    hasVisualSyntheticConfirmation
  ) {
    findingClassification = "VERIFIED_DEEPFAKE";
    explanation =
      "Verified deepfake: exact-page identity evidence plus visual synthetic-media confirmation (Hive deepfake and/or face-matched AI-generated media).";
  } else if (
    exactPage &&
    hasIdentity &&
    hasSynthetic &&
    identity.confidence >= 50 &&
    synthetic.confidence >= 50
  ) {
    findingClassification = "PROBABLE_DEEPFAKE";
    explanation =
      "Probable deepfake: the crawled content page shows both identity evidence and synthetic/impersonation evidence, pending stronger visual verification.";
  } else {
    findingClassification = "UNVERIFIED_LEAD";
    explanation =
      "Unverified lead retained for human review. Some identity or synthetic signals exist, but evidence is insufficient for a client-facing deepfake finding.";
  }

  return {
    page_type: pageType,
    identity_confidence: identity.confidence,
    synthetic_media_confidence: synthetic.confidence,
    matched_evidence: matchedEvidence,
    finding_classification: findingClassification,
    classification_explanation: explanation,
    client_visible: CLIENT_VISIBLE_CLASSIFICATIONS.includes(findingClassification),
  };
}

export function shouldPersistFinding(classification: FindingClassification): boolean {
  return PERSISTED_FINDING_CLASSIFICATIONS.includes(classification);
}

export function isClientVisibleClassification(
  classification: FindingClassification | string | null | undefined,
): boolean {
  return CLIENT_VISIBLE_CLASSIFICATIONS.includes(classification as FindingClassification);
}

export interface FinalizedFindingFields {
  page_type: PageType;
  identity_confidence: number;
  synthetic_media_confidence: number;
  matched_evidence: string[];
  finding_classification: FindingClassification;
  classification_explanation: string;
  client_visible: boolean;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  content_category: string;
  confidence: number;
  is_synthetic: boolean;
  face_referenced: boolean;
  takedown_recommended: boolean;
  visibility: "primary" | "triage";
  ai_reasoning: string;
}

/**
 * Combine crawled page evidence with optional media-classifier scores
 * into the final finding taxonomy used for persistence and client filtering.
 */
export function finalizeDeepfakeFinding(
  input: PageEvidenceInput & {
    existing_reasoning?: string | null;
    existing_category?: string | null;
    existing_confidence?: number | null;
  },
): FinalizedFindingFields {
  const evidence = classifyPageEvidence(input);

  const riskLevel =
    evidence.finding_classification === "VERIFIED_DEEPFAKE"
      ? "CRITICAL"
      : evidence.finding_classification === "PROBABLE_DEEPFAKE"
        ? "HIGH"
        : evidence.finding_classification === "UNVERIFIED_LEAD"
          ? "MEDIUM"
          : "LOW";

  const contentCategory =
    evidence.finding_classification === "VERIFIED_DEEPFAKE"
      ? "deepfake"
      : evidence.finding_classification === "PROBABLE_DEEPFAKE"
        ? "probable_deepfake"
        : evidence.finding_classification === "UNVERIFIED_LEAD"
          ? "unverified_lead"
          : evidence.finding_classification === "ADULT_NAME_MENTION"
            ? "adult_name_mention"
            : "unrelated_adult_content";

  const confidence = clampScore(
    Math.max(
      input.existing_confidence ?? 0,
      Math.round((evidence.identity_confidence + evidence.synthetic_media_confidence) / 2),
    ),
  );

  const reasoningParts = [
    evidence.classification_explanation,
    input.existing_reasoning?.trim() || null,
  ].filter(Boolean);

  return {
    ...evidence,
    risk_level: riskLevel,
    content_category: contentCategory,
    confidence,
    is_synthetic:
      evidence.finding_classification === "VERIFIED_DEEPFAKE" ||
      evidence.finding_classification === "PROBABLE_DEEPFAKE",
    face_referenced: evidence.identity_confidence >= 40,
    takedown_recommended:
      evidence.finding_classification === "VERIFIED_DEEPFAKE" ||
      evidence.finding_classification === "PROBABLE_DEEPFAKE",
    visibility: evidence.client_visible ? "primary" : "triage",
    ai_reasoning: reasoningParts.join(" "),
  };
}

/**
 * True when a crawled page should continue to media classification (Hive/vision).
 * Listing pages and name-only adult mentions are excluded.
 */
export function shouldAnalyzeMedia(
  result: PageEvidenceResult,
  options?: { page_inspected?: boolean | null; page_text?: string | null },
): boolean {
  if (isExcludedListingPageType(result.page_type)) {
    return false;
  }

  if (
    result.finding_classification === "ADULT_NAME_MENTION" ||
    result.finding_classification === "UNRELATED_ADULT_CONTENT"
  ) {
    return false;
  }

  /*
   * Media analysis is only useful after an exact-page crawl. Empty crawls
   * remain UNVERIFIED_LEAD and must not be elevated by thumbnail scoring.
   */
  if (!hasExactPageContent(options?.page_text, options?.page_inspected)) {
    return false;
  }

  /*
   * Require on-page identity evidence before spending Hive/vision quota.
   * Synthetic text is optional here — visual models may still confirm
   * deepfake media when page copy is thin.
   */
  return result.identity_confidence >= 40;
}
