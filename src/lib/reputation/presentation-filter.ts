/**
 * PRESENTATION FILTER — display-layer only.
 *
 * Decides which findings appear in the default Web Scan view. This never
 * deletes, drops, or downgrades anything: every discovered lead, its evidence,
 * and its stored classification remain intact in the database and in the
 * report payload. This module only sorts findings into three presentation
 * tabs and rewrites user-facing legal wording into non-conclusive language.
 */

import { canonicalCategoryFor, type CanonicalThreatCategory } from "./ranking.server";
import type { ScanHit } from "@/routes/api/scan";

export type PresentationTab = "REPUTATION_RISK" | "NEEDS_REVIEW" | "ALL_MENTIONS";

/** Canonical categories that count as reputation-risk content. */
const RISK_CATEGORIES = new Set<CanonicalThreatCategory>([
  "defamation",
  "deepfake",
  "impersonation",
  "scam_or_fraud",
  "harassment_or_abuse",
  "negative_media",
  "privacy_or_leak",
  "misinformation",
  "copyright_infringement",
]);

/** Content labels that describe a reputation-risk narrative. */
const RISK_LABELS = new Set<string>([
  "complaint",
  "negative review",
  "allegation",
  "potential misinformation",
  "potential defamation",
  "impersonation",
  "scam/fraud",
  "trademark/copyright abuse",
  "news/legal dispute",
  "exposé",
  "controversy",
  "criticism",
  "unverified claim",
]);

/**
 * Risk vocabulary requested for the default view: allegation, accusation,
 * controversy, criticism, harassment, misinformation, impersonation,
 * manipulated media, deepfake, privacy risk, legal dispute.
 */
const RISK_TERMS =
  /(allegation|alleged|accusation|accused|controvers|criticis|criticiz|slam|backlash|troll|harass|abuse|bully|threat|misinformation|misleading|fake news|rumou?r|impersonat|fake (account|profile|page)|manipulated media|deepfake|deep fake|face swap|ai[- ]generated|morphed|leak|privacy|doxx|defam|lawsuit|legal notice|court case|fir |police complaint|arrest|scandal|boycott|expose|exposé|fraud|scam)/i;

const MEDIUM_PLUS = new Set(["Medium", "High", "Critical"]);

function hitText(hit: ScanHit): string {
  return [
    hit.title,
    hit.description,
    hit.category,
    hit.contentLabel,
    hit.whyItMatters,
    (hit.keywords ?? []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** True when the finding carries at least one reputation-risk signal. */
export function hasRiskSignal(hit: ScanHit): boolean {
  const category = canonicalCategoryFor(hit);
  if (RISK_CATEGORIES.has(category)) return true;
  if (RISK_LABELS.has((hit.contentLabel ?? "").toLowerCase())) return true;
  if (MEDIUM_PLUS.has(hit.severity) && hit.sentiment === "Negative") return true;
  if ((hit.reputationRisk ?? 0) >= 50) return true;
  return RISK_TERMS.test(hitText(hit));
}

/** True when the finding is confidently tied to the scan subject. */
export function isSubjectVerified(hit: ScanHit): boolean {
  if (hit.identityTier === "NOT_SUBJECT") return false;
  if (hit.identityTier === "VERIFIED" || hit.identityTier === "PROBABLE") return true;
  if (typeof hit.identityConfidence === "number") return hit.identityConfidence >= 70;
  return hit.confidence >= 85;
}

/** True when severity qualifies as MEDIUM/HIGH reputation risk. */
export function isMediumOrHigherRisk(hit: ScanHit): boolean {
  return MEDIUM_PLUS.has(hit.severity) || (hit.reputationRisk ?? 0) >= 50;
}

/**
 * Routes a finding to a presentation tab.
 * - REPUTATION_RISK: verified subject + (MEDIUM/HIGH severity or risk category)
 * - NEEDS_REVIEW:    risk signals but unverified identity, mid confidence,
 *                    or explicitly flagged for human review
 * - ALL_MENTIONS:    neutral / official / general mentions (never deleted)
 */
export function presentationTabFor(hit: ScanHit): PresentationTab {
  /*
   * EVIDENCE-GATED ROUTING takes precedence. When the classifier ran, the tab
   * follows the tier — never keyword text. Keyword heuristics below remain only
   * for legacy findings persisted before the evidence gate existed.
   */
  if (hit.classificationTier) {
    switch (hit.classificationTier) {
      case "TIER_3_REPUTATION_RISK":
      case "TIER_4_HIGH_RISK":
        return hit.riskEvidence?.riskEvidenceFound ? "REPUTATION_RISK" : "NEEDS_REVIEW";
      case "TIER_2_NEEDS_REVIEW":
        return "NEEDS_REVIEW";
      default:
        return "ALL_MENTIONS";
    }
  }

  const flaggedForReview =
    hit.contentLabel === "Needs human review" ||
    hit.reviewStatus === "NEEDS_REVIEW" ||
    hit.identityTier === "AMBIGUOUS";

  const risk = hasRiskSignal(hit);
  const verified = isSubjectVerified(hit);

  if (risk && verified && !flaggedForReview && isMediumOrHigherRisk(hit)) {
    return "REPUTATION_RISK";
  }
  if (risk && (flaggedForReview || !verified || !isMediumOrHigherRisk(hit))) {
    return "NEEDS_REVIEW";
  }
  if (flaggedForReview && hit.confidence >= 50) return "NEEDS_REVIEW";
  return "ALL_MENTIONS";
}


export interface PresentationBuckets {
  reputationRisk: ScanHit[];
  needsReview: ScanHit[];
  allMentions: ScanHit[];
}

/** Splits findings into the three tabs. Nothing is discarded. */
export function splitForPresentation(hits: ScanHit[]): PresentationBuckets {
  const buckets: PresentationBuckets = {
    reputationRisk: [],
    needsReview: [],
    allMentions: [],
  };
  for (const hit of hits) {
    const tab = presentationTabFor(hit);
    if (tab === "REPUTATION_RISK") buckets.reputationRisk.push(hit);
    else if (tab === "NEEDS_REVIEW") buckets.needsReview.push(hit);
    else buckets.allMentions.push(hit);
  }
  // "All Mentions" is the complete corpus view — risk items stay visible there.
  buckets.allMentions = hits.slice();
  return buckets;
}

/**
 * Never asserts that content IS defamatory. Legal conclusions require human
 * or legal review, so defamation-flavoured machine labels become explicit
 * review prompts.
 */
export function safeRiskLabel(label: string | undefined | null): string {
  const raw = (label ?? "").trim();
  if (!raw) return "Potential Reputation Risk";
  const lower = raw.toLowerCase();
  if (lower.includes("defam")) return "Potential Defamation Review";
  if (lower === "allegation" || lower === "unverified claim") {
    return `${raw} — Potential Reputation Risk`;
  }
  return raw;
}

/** Non-conclusive headline label for a risk finding. */
export function riskHeadlineLabel(hit: ScanHit): string {
  const category = canonicalCategoryFor(hit);
  if (category === "defamation") return "Potential Defamation Review";
  return "Potential Reputation Risk";
}
