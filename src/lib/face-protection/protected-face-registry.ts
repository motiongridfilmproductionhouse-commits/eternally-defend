/**
 * Pure logic for the reusable protected-face reference model.
 *
 * The AWS calls live in the server functions; everything here is deterministic
 * so enrollment persistence, monitoring resolution, and manual match
 * classification can be unit tested without AWS or the database.
 */

export const PROTECTED_FACE_ACTIVE = "ACTIVE" as const;
export const PROTECTED_FACE_INACTIVE = "INACTIVE" as const;

export type ProtectedFaceStatus = typeof PROTECTED_FACE_ACTIVE | typeof PROTECTED_FACE_INACTIVE;

/** Similarity gate used by Rekognition search/compare for protected faces. */
export const FACE_MATCH_SIMILARITY_THRESHOLD = 80;
/** Below this searched-face confidence the image is too poor to decide. */
export const FACE_QUALITY_MIN_CONFIDENCE = 90;
/** Similarity band that is real but under the match gate -> human review. */
export const FACE_REVIEW_SIMILARITY_FLOOR = 65;

export type ProtectedFaceLike = {
  id: string;
  user_id?: string | null;
  face_id: string;
  collection_id: string;
  status?: string | null;
};

/** Only ACTIVE references may be used by monitoring or manual scans. */
export function filterActiveProtectedFaces<T extends ProtectedFaceLike>(faces: T[] | null): T[] {
  return (faces ?? []).filter((f) => (f.status ?? PROTECTED_FACE_ACTIVE) === PROTECTED_FACE_ACTIVE);
}

/** Ownership guard: never let one account resolve another account's reference. */
export function assertOwnedProtectedFace<T extends ProtectedFaceLike>(
  face: T | null | undefined,
  userId: string,
): T {
  if (!face || (face.user_id ?? null) !== userId) {
    throw new Error("Protected face not found");
  }
  return face;
}

export type EnrollmentFaceInput = {
  userId: string;
  collectionId: string;
  faceId: string;
  imageId?: string | null;
  externalImageId?: string | null;
  confidence?: number | null;
  boundingBox?: unknown;
  s3Bucket: string;
  s3Key: string;
  label?: string | null;
  verifiedAt: string;
};

/**
 * Row persisted after a successful AWS-backed enrollment. Stores only the
 * private S3 object key — never image bytes, credentials, or face vectors.
 */
export function buildEnrollmentFaceRow(input: EnrollmentFaceInput) {
  return {
    user_id: input.userId,
    collection_id: input.collectionId,
    platform: "onboarding",
    source: "liveness_enrollment",
    label: input.label?.trim() || "Verified liveness reference",
    s3_bucket: input.s3Bucket,
    s3_key: input.s3Key,
    face_id: input.faceId,
    image_id: input.imageId ?? null,
    external_image_id: input.externalImageId ?? null,
    confidence: input.confidence ?? null,
    bounding_box: input.boundingBox ?? null,
    status: PROTECTED_FACE_ACTIVE,
    last_verified_at: input.verifiedAt,
  };
}

export type ManualMatchVerdict = "MATCH" | "NO_MATCH" | "NEEDS_REVIEW";

export type ManualMatchInput = {
  /** Rekognition detected a face in the uploaded image at all. */
  faceDetected: boolean;
  /** Rekognition confidence that the searched region is a face (0-100). */
  faceConfidence: number | null;
  /** Highest similarity returned for the selected protected face, or null. */
  similarity: number | null;
};

/**
 * Maps real Rekognition output to a user-facing verdict. Never invents a
 * percentage: `similarity` is whatever AWS returned (or null).
 */
export function classifyManualMatch(input: ManualMatchInput): {
  verdict: ManualMatchVerdict;
  similarity: number | null;
  reason: string;
} {
  if (!input.faceDetected) {
    return { verdict: "NO_MATCH", similarity: null, reason: "no_face_detected" };
  }

  const similarity = input.similarity;

  if (similarity !== null && similarity >= FACE_MATCH_SIMILARITY_THRESHOLD) {
    return { verdict: "MATCH", similarity, reason: "similarity_above_threshold" };
  }

  if (
    input.faceConfidence !== null &&
    input.faceConfidence < FACE_QUALITY_MIN_CONFIDENCE
  ) {
    return { verdict: "NEEDS_REVIEW", similarity, reason: "low_image_quality" };
  }

  if (similarity !== null && similarity >= FACE_REVIEW_SIMILARITY_FLOOR) {
    return { verdict: "NEEDS_REVIEW", similarity, reason: "borderline_similarity" };
  }

  return { verdict: "NO_MATCH", similarity, reason: "below_threshold" };
}

/** Review status stored on face_match_events for a manual scan verdict. */
export function reviewStatusForVerdict(verdict: ManualMatchVerdict): "pending" | null {
  return verdict === "NO_MATCH" ? null : "pending";
}

/** Scanner ring colour driven strictly by the backend verdict. */
export function scannerToneForVerdict(
  verdict: ManualMatchVerdict | "SCANNING",
): "blue" | "amber" | "red" {
  if (verdict === "MATCH") return "red";
  if (verdict === "NEEDS_REVIEW") return "amber";
  return "blue";
}
