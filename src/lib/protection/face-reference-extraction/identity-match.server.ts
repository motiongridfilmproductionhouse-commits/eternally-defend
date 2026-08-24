/**
 * Identity gating. A tile's face is only ever compared against this
 * customer's OWN already-trusted reference images — never against the
 * shared cross-tenant Rekognition collection (SearchFacesByImage), the same
 * discipline src/lib/deepfake/face-filter.server.ts already follows via
 * compareAgainstReferences. This is what keeps tenant isolation intact: a
 * face can only become a candidate reference for the customer whose own
 * canonical/approved faces it was compared against.
 *
 * Thresholds are intentionally conservative and mirror bands already used
 * elsewhere in this codebase (src/lib/deepfake/face-filter.server.ts's
 * classifyConfidenceBand uses 95/85/70; src/lib/aws/rekognition.server.ts's
 * SearchFacesByImage default threshold is 80). Only the top band may become
 * an auto-approved secondary reference — everything else that reached
 * USABLE_FACE still gets recorded and surfaced for human review, never
 * silently discarded and never auto-trusted.
 */
import { compareReferenceFace } from "@/lib/deepfake/face-match.server";

export type IdentityStatus =
  | "MATCHED_PROTECTED_SUBJECT"
  | "PROBABLE_MATCH"
  | "AMBIGUOUS"
  | "NOT_SUBJECT"
  | "REQUIRES_HUMAN_REVIEW";

export const MATCHED_PROTECTED_SUBJECT_THRESHOLD = 95;
export const PROBABLE_MATCH_THRESHOLD = 85;
export const AMBIGUOUS_THRESHOLD = 70;

/** Pure classification — no AWS calls, directly unit-testable. */
export function classifyIdentitySimilarity(similarity: number | null): IdentityStatus {
  if (similarity === null) return "REQUIRES_HUMAN_REVIEW";
  if (similarity >= MATCHED_PROTECTED_SUBJECT_THRESHOLD) return "MATCHED_PROTECTED_SUBJECT";
  if (similarity >= PROBABLE_MATCH_THRESHOLD) return "PROBABLE_MATCH";
  if (similarity >= AMBIGUOUS_THRESHOLD) return "AMBIGUOUS";
  return "NOT_SUBJECT";
}

/** Only a MATCHED_PROTECTED_SUBJECT result may become an auto-approved reference. */
export function isAutoPromotable(status: IdentityStatus): boolean {
  return status === "MATCHED_PROTECTED_SUBJECT";
}

/** A status the customer can still choose to manually approve from the review queue. */
export function isReviewable(status: IdentityStatus): boolean {
  return (
    status === "PROBABLE_MATCH" || status === "AMBIGUOUS" || status === "REQUIRES_HUMAN_REVIEW"
  );
}

export interface IdentityMatchResult {
  status: IdentityStatus;
  similarity: number | null;
  matchedReferenceIndex: number | null;
}

/**
 * Compares one tile's cropped face bytes against the customer's already-
 * loaded reference image bytes (see pipeline.server.ts for how these are
 * loaded — tier-ordered, canonical first), taking the best (highest-
 * similarity) match across all of them — same "best across references"
 * policy as compareAgainstReferences, just operating on bytes directly so no
 * intermediate temp upload/URL round-trip is needed for a tile that only
 * exists in memory. Returns REQUIRES_HUMAN_REVIEW (never a false
 * NOT_SUBJECT) when there are zero references to compare against, or when
 * every comparison attempt errors out — this is what satisfies identity rule
 * #3: with no anchor at all, nothing is auto-trusted, but nothing is
 * silently thrown away either.
 */
export async function matchTileAgainstReferences(input: {
  tileBytes: Uint8Array;
  referenceImages: Uint8Array[];
}): Promise<IdentityMatchResult> {
  if (input.referenceImages.length === 0) {
    return { status: "REQUIRES_HUMAN_REVIEW", similarity: null, matchedReferenceIndex: null };
  }

  let best: { similarity: number; index: number } | null = null;
  let anySucceeded = false;
  for (let index = 0; index < input.referenceImages.length; index++) {
    try {
      const result = await compareReferenceFace({
        referenceImageBytes: input.referenceImages[index],
        discoveredImageBytes: input.tileBytes,
        similarityThreshold: AMBIGUOUS_THRESHOLD,
      });
      anySucceeded = true;
      if (!best || result.similarity > best.similarity) {
        best = { similarity: result.similarity, index };
      }
    } catch (error) {
      console.warn("[face-reference-extraction] reference comparison failed", {
        referenceIndex: index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!anySucceeded) {
    return { status: "REQUIRES_HUMAN_REVIEW", similarity: null, matchedReferenceIndex: null };
  }

  const similarity = best?.similarity ?? 0;
  return {
    status: classifyIdentitySimilarity(similarity),
    similarity,
    matchedReferenceIndex: best?.index ?? null,
  };
}
