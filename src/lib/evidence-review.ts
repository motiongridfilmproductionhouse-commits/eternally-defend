export const REVIEW_STATUSES = [
  "AUTOMATED_LEAD",
  "REVIEW_REQUIRED",
  "REVIEWED_NO_VIOLATION",
  "REVIEWED_POTENTIAL_VIOLATION",
  "ESCALATION_RECOMMENDED",
  "LEGAL_REVIEW_REQUIRED",
] as const;

export const CONTENT_POSITIONS = [
  "SUPPORTIVE",
  "NEUTRAL",
  "CRITICAL",
  "HOSTILE",
  "UNKNOWN",
] as const;
export const STATEMENT_TYPES = [
  "FACT",
  "OPINION",
  "INSULT",
  "THREAT",
  "SATIRE",
  "NEWS_REPORT",
  "UNKNOWN",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ContentPosition = (typeof CONTENT_POSITIONS)[number];
export type StatementType = (typeof STATEMENT_TYPES)[number];

export interface EvidenceReview {
  reviewStatus: ReviewStatus;
  reviewerName?: string | null;
  reviewerRole?: string | null;
  reviewedAt?: string | null;
  targetPerson?: string | null;
  exactOriginalStatement?: string | null;
  statementLanguage?: string | null;
  verifiedEnglishTranslation?: string | null;
  videoStartTimestamp?: number | null;
  videoEndTimestamp?: number | null;
  speakerIdentity?: string | null;
  contentContext?: string | null;
  contentPosition: ContentPosition;
  statementType: StatementType;
  allegedViolationTypes: string[];
  violationReason?: string | null;
  supportingFacts?: string | null;
  falsityBasis?: string | null;
  victimImpact?: string | null;
  confidenceScore?: number | null;
  legalReviewRequired: boolean;
  recommendedAction?: string | null;
  reviewerNotes?: string | null;
  reviewerDeclarationSigned?: boolean;
}

export interface EvidenceReadiness {
  ready: boolean;
  missing: string[];
}

const ACTIONABLE = new Set<ReviewStatus>([
  "REVIEWED_POTENTIAL_VIOLATION",
  "ESCALATION_RECOMMENDED",
  "LEGAL_REVIEW_REQUIRED",
]);

export function validateReview(review?: EvidenceReview | null): string[] {
  if (!review) return ["Human review"];
  if (!ACTIONABLE.has(review.reviewStatus)) return [];
  const missing: string[] = [];
  if (!review.exactOriginalStatement?.trim()) missing.push("Exact original statement");
  if (review.videoStartTimestamp == null) missing.push("Exact timestamp");
  if (!review.contentContext?.trim()) missing.push("Full content context");
  if (!review.violationReason?.trim()) missing.push("Violation assessment reason");
  if (!review.allegedViolationTypes.length) missing.push("Potential violation category");
  return missing;
}

export function verifiedExportReadiness(
  review: EvidenceReview | null | undefined,
  evidence: {
    transcriptPreserved?: boolean;
    translationRequired?: boolean;
    translationVerified?: boolean;
    fullPageScreenshotPreserved?: boolean;
    originalMediaPreserved?: boolean;
    hashesGenerated?: boolean;
    chainOfCustodyCreated?: boolean;
    channelIdentifiersPreserved?: boolean;
    ownershipProofPreserved?: boolean;
  },
): EvidenceReadiness {
  const missing = validateReview(review);
  if (!review || !ACTIONABLE.has(review.reviewStatus))
    missing.push("Actionable human-review decision");
  if (!review?.reviewerName) missing.push("Reviewer identity");
  if (!review?.reviewedAt) missing.push("Review timestamp");
  if (!review?.recommendedAction) missing.push("Recommended ground/action");
  if (!review?.reviewerDeclarationSigned) missing.push("Reviewer declaration");
  if (!evidence.transcriptPreserved) missing.push("Transcript");
  if (evidence.translationRequired && !evidence.translationVerified)
    missing.push("Verified translation");
  if (!evidence.fullPageScreenshotPreserved) missing.push("Full-page screenshot");
  if (!evidence.hashesGenerated) missing.push("Evidence hashes");
  if (!evidence.chainOfCustodyCreated) missing.push("Chain of custody");
  if (!evidence.channelIdentifiersPreserved) missing.push("Channel identifiers");
  if (
    review?.allegedViolationTypes.includes("Copyright infringement") &&
    !evidence.ownershipProofPreserved
  ) {
    missing.push("Copyright ownership/authorization proof");
  }
  return { ready: missing.length === 0, missing: [...new Set(missing)] };
}

export function inferAutomatedContentPosition(title: string, description: string): ContentPosition {
  const value = `${title} ${description}`.toLowerCase();
  const supportive = [
    "defends",
    "defended",
    "supports",
    "stands with",
    "speaks out against",
    "stop bullying",
    "against bullying",
    "against body shaming",
    "against moral policing",
    "women's choices",
    "womens choices",
    "do not shame",
    "don't shame",
    "responds to trolls",
  ];
  const hostile = [
    "threatens",
    "death threat",
    "doxx",
    "stalking",
    "abusive attack",
    "sexual harassment",
  ];
  if (supportive.some((term) => value.includes(term))) return "SUPPORTIVE";
  if (hostile.some((term) => value.includes(term))) return "HOSTILE";
  return "UNKNOWN";
}
