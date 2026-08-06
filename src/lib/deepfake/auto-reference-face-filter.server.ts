/**
 * Face verification using auto-collected reference images from the investigation pipeline.
 * Enables face-based discovery even when no enrolled profile exists.
 */

import { compareAgainstReferences } from "./face-match.server";
import { downloadFaceImage } from "./face-match.server";
import { assertNotAborted, isAbortError } from "./scan-runtime.server";
import type { CollectedReferenceImage } from "./reference-images";
import type { FaceFilterCandidate, FaceVerifiedCandidate } from "./face-filter.server";

const MAX_AUTO_REFERENCES = 20;
const DEFAULT_THRESHOLD = 88;

async function loadAutoReferenceBytes(
  images: CollectedReferenceImage[],
  signal?: AbortSignal,
): Promise<Uint8Array[]> {
  const sorted = [...images]
    .filter((img) => img.face_detected && img.embedding_indexed)
    .sort((a, b) => b.quality_score - a.quality_score)
    .slice(0, MAX_AUTO_REFERENCES);

  const bytes: Uint8Array[] = [];
  for (const img of sorted) {
    assertNotAborted(signal);
    try {
      const buffer = await downloadFaceImage(img.image_url, { signal });
      bytes.push(buffer);
    } catch {
      // Skip failed downloads.
    }
    if (bytes.length >= MAX_AUTO_REFERENCES) break;
  }

  return bytes;
}

function imageUrlForCandidate(candidate: FaceFilterCandidate): string | null {
  const possibleUrls = [
    candidate.image_url,
    candidate.thumbnail_url,
    candidate.media_type !== "video" ? candidate.media_url : undefined,
  ];

  for (const value of possibleUrls) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return value;
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return null;
}

export async function filterCandidatesByAutoReferences(input: {
  referenceImages: CollectedReferenceImage[];
  candidates: FaceFilterCandidate[];
  similarityThreshold?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  matched: FaceVerifiedCandidate[];
  rejected: FaceVerifiedCandidate[];
  errors: FaceVerifiedCandidate[];
  comparisons: number;
}> {
  assertNotAborted(input.signal);

  const referenceBytes = await loadAutoReferenceBytes(input.referenceImages, input.signal);

  if (referenceBytes.length < 1) {
    return { matched: [], rejected: [], errors: [], comparisons: 0 };
  }

  const threshold = input.similarityThreshold ?? DEFAULT_THRESHOLD;
  const matched: FaceVerifiedCandidate[] = [];
  const rejected: FaceVerifiedCandidate[] = [];
  const errors: FaceVerifiedCandidate[] = [];
  let comparisons = 0;

  const batchSize = 3;
  for (let start = 0; start < input.candidates.length; start += batchSize) {
    assertNotAborted(input.signal);
    const batch = input.candidates.slice(start, start + batchSize);

    const results = await Promise.all(
      batch.map(async (candidate) => {
        assertNotAborted(input.signal);
        const discoveredImageUrl = imageUrlForCandidate(candidate);

        if (!discoveredImageUrl) {
          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status: "no_image" as const,
          };
        }

        try {
          comparisons += 1;

          const comparison = await compareAgainstReferences({
            referenceImages: referenceBytes,
            discoveredImageUrl,
            similarityThreshold: threshold,
            signal: input.signal,
            softDeadlineMs: input.softDeadlineMs,
          });

          return {
            ...candidate,
            target_face_match: comparison.matched,
            face_similarity: comparison.similarity,
            matched_face_id:
              comparison.matchedReferenceIndex !== null
                ? `auto_ref_${comparison.matchedReferenceIndex}`
                : null,
            face_verification_status: comparison.matched
              ? ("matched" as const)
              : ("different_person" as const),
          };
        } catch (error) {
          if (isAbortError(error)) throw error;
          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status: "comparison_failed" as const,
          };
        }
      }),
    );

    for (const result of results) {
      if (result.face_verification_status === "matched") {
        matched.push(result);
      } else if (
        result.face_verification_status === "comparison_failed" ||
        result.face_verification_status === "no_image"
      ) {
        errors.push(result);
      } else {
        rejected.push(result);
      }
    }
  }

  return { matched, rejected, errors, comparisons };
}
