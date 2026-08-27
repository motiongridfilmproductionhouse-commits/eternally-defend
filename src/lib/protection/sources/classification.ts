/**
 * Pure decision function: given the two existing pipeline gates (identity
 * match, synthetic/manipulation detection — see target-identity.ts's
 * two-gate model), decide how a video under an Approved YouTube Source
 * should be classified. No I/O, so this is unit-testable without mocking
 * Supabase/Rekognition/Hive.
 *
 * Both gates are modeled as three-way outcomes, not booleans, because a
 * provider failure or an inconclusive result is a DIFFERENT thing from a
 * confident "no". Collapsing "comparison failed" / "no media to analyze"
 * into the same bucket as "confirmed not a match" / "confirmed not
 * synthetic" would let a transient AWS Rekognition or Hive outage silently
 * launder genuinely risky content into legitimate_appearance / not_subject
 * with zero record for human review — exactly the failure mode an
 * "approved source" suppression feature must never produce. Any gate that
 * comes back uncertain routes to needs_review instead.
 */
export type ApprovedSourceClassification =
  | "legitimate_appearance"
  | "verified_deepfake"
  | "probable_deepfake"
  | "not_subject"
  | "needs_review";

/** "error" = the comparison could not be completed (provider failure, no image) — NOT a confident non-match. */
export type FaceMatchOutcome = "matched" | "not_matched" | "error";

/** "unknown" = the classifier could not confirm either way (provider failure, no media) — NOT a confident "clean". */
export type SyntheticOutcome = "clean" | "synthetic" | "unknown";

export interface ApprovedSourceClassificationInput {
  hasReferenceProfile: boolean;
  faceMatch: FaceMatchOutcome;
  faceSimilarity: number;
  synthetic: SyntheticOutcome;
  syntheticConfidence: number;
}

export function decideApprovedSourceClassification(
  input: ApprovedSourceClassificationInput,
): ApprovedSourceClassification {
  if (!input.hasReferenceProfile) return "needs_review";
  if (input.faceMatch === "error") return "needs_review";
  if (input.faceMatch === "not_matched") return "not_subject";
  // faceMatch === "matched" from here on.
  if (input.synthetic === "unknown") return "needs_review";
  if (input.synthetic === "clean") return "legitimate_appearance";
  // synthetic === "synthetic" from here on.
  return input.faceSimilarity >= 85 && input.syntheticConfidence >= 90
    ? "verified_deepfake"
    : "probable_deepfake";
}

/** Only synthetic-confirmed classifications should ever create evidence/case-prep. */
export function classificationRequiresEvidence(
  classification: ApprovedSourceClassification,
): boolean {
  return classification === "verified_deepfake" || classification === "probable_deepfake";
}
