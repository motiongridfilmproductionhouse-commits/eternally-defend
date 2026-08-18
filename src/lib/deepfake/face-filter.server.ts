import { compareAgainstReferences } from "./face-match.server";
import { compareVideoCandidateAgainstReferences } from "./video-face-match.server";

export type FaceFilterCandidate = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  image_url?: string;
  thumbnail_url?: string;
  media_url?: string;
  media_type?: "image" | "video";
  evidence_page_url?: string;
  [key: string]: unknown;
};

export type FaceVerifiedCandidate = FaceFilterCandidate & {
  target_face_match: boolean;
  face_similarity: number;
  matched_face_id: string | null;
  face_verification_status:
    "matched" | "different_person" | "no_image" | "comparison_failed" | "needs_review";
  confidence_band?: string;
  confidence_label?: string;
  /** Set only when verification ran against extracted video keyframes rather
   * than a static image/thumbnail. */
  video_frames_compared?: number;
};

type ReferenceFaceRecord = {
  id: string;
  storage_path: string;
  rekognition_face_id?: string | null;
};

const DEFAULT_THRESHOLD = 70;
const MAX_REFERENCE_FACES = 5;

export type FaceConfidenceBand = "verified" | "probable" | "needs_review" | "rejected";

export function classifyConfidenceBand(similarity: number): {
  band: FaceConfidenceBand;
  label: string;
} {
  if (similarity >= 95) return { band: "verified", label: "Verified Deepfake" };
  if (similarity >= 85) return { band: "probable", label: "Probable Deepfake" };
  if (similarity >= 70) return { band: "needs_review", label: "Needs Human Review" };
  return { band: "rejected", label: "Rejected (Different Person)" };
}

async function loadReferenceImages(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  profileId: string;
}): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  faces: ReferenceFaceRecord[];
  imageBytes: Uint8Array[];
}> {
  const { data: profile, error: profileError } = await input.supabase
    .from("deepfake_target_profiles")
    .select("id, user_id, target_name, authorization_status")
    .eq("id", input.profileId)
    .eq("user_id", input.userId)
    .single();

  if (profileError || !profile) {
    throw new Error("Target face profile was not found or is not accessible.");
  }

  const { data: faceRows, error: facesError } = await input.supabase
    .from("deepfake_reference_faces")
    .select("id, storage_path, rekognition_face_id, face_confidence, created_at")
    .eq("profile_id", input.profileId)
    .order("created_at", { ascending: true })
    .limit(MAX_REFERENCE_FACES);

  if (facesError) {
    throw new Error(`Unable to load reference faces: ${facesError.message}`);
  }

  const faces = (faceRows ?? []) as ReferenceFaceRecord[];
  if (faces.length < 3) {
    throw new Error(
      "At least three enrolled reference faces are required before face-verified scanning.",
    );
  }

  const validFaces: ReferenceFaceRecord[] = [];
  const imageBytes: Uint8Array[] = [];

  for (const face of faces) {
    if (!face.storage_path) continue;
    const { data: file, error: downloadError } = await input.supabase.storage
      .from("deepfake-reference-faces")
      .download(face.storage_path);

    if (downloadError || !file) continue;
    const buffer = await file.arrayBuffer();
    if (!buffer.byteLength) continue;

    validFaces.push(face);
    imageBytes.push(new Uint8Array(buffer));
  }

  if (imageBytes.length < 3) {
    throw new Error("Fewer than three usable reference images could be loaded.");
  }

  return { profile, faces: validFaces, imageBytes };
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
      // Ignore
    }
  }
  return null;
}

export async function filterCandidatesByTargetFace(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  profileId: string;
  candidates: FaceFilterCandidate[];
  similarityThreshold?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  matched: FaceVerifiedCandidate[];
  rejected: FaceVerifiedCandidate[];
  errors: FaceVerifiedCandidate[];
  targetName: string;
}> {
  const references = await loadReferenceImages({
    supabase: input.supabase,
    userId: input.userId,
    profileId: input.profileId,
  });

  const threshold = input.similarityThreshold ?? DEFAULT_THRESHOLD;
  const matched: FaceVerifiedCandidate[] = [];
  const rejected: FaceVerifiedCandidate[] = [];
  const errors: FaceVerifiedCandidate[] = [];

  const batchSize = 3;
  for (let start = 0; start < input.candidates.length; start += batchSize) {
    const batch = input.candidates.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map(async (candidate) => {
        const discoveredImageUrl = imageUrlForCandidate(candidate);
        if (!discoveredImageUrl) {
          // No static image/thumbnail — if this is a video candidate, verify
          // via extracted keyframes instead of discarding it on text alone.
          if (candidate.media_type === "video" && typeof candidate.media_url === "string") {
            try {
              const videoResult = await compareVideoCandidateAgainstReferences({
                videoUrl: candidate.media_url,
                referenceImages: references.imageBytes,
                similarityThreshold: threshold,
                signal: input.signal,
              });
              if (videoResult) {
                const matchedFaceId =
                  videoResult.matchedReferenceIndex !== null
                    ? (references.faces[videoResult.matchedReferenceIndex]?.rekognition_face_id ??
                      references.faces[videoResult.matchedReferenceIndex]?.id ??
                      null)
                    : null;
                const band = classifyConfidenceBand(videoResult.similarity);
                return {
                  ...candidate,
                  target_face_match: videoResult.similarity >= 70,
                  face_similarity: videoResult.similarity,
                  matched_face_id: matchedFaceId,
                  face_verification_status:
                    videoResult.similarity >= 85
                      ? ("matched" as const)
                      : videoResult.similarity >= 70
                        ? ("needs_review" as const)
                        : ("different_person" as const),
                  confidence_band: band.band,
                  confidence_label: `${band.label} (video keyframe ${videoResult.frameIndex ?? "?"})`,
                  video_frames_compared: videoResult.framesCompared,
                };
              }
            } catch (error) {
              console.warn("[DEEPFAKE:FACE] Video candidate comparison failed:", {
                url: candidate.url,
                mediaUrl: candidate.media_url,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status: "no_image" as const,
            confidence_band: "needs_review",
            confidence_label: "Needs Human Review (No Direct Image)",
          };
        }

        try {
          const comparison = await compareAgainstReferences({
            referenceImages: references.imageBytes,
            discoveredImageUrl,
            similarityThreshold: threshold,
          });

          const matchedReferenceIndex = comparison.matchedReferenceIndex;
          const matchedFaceId =
            matchedReferenceIndex !== null
              ? (references.faces[matchedReferenceIndex]?.rekognition_face_id ??
                references.faces[matchedReferenceIndex]?.id ??
                null)
              : null;

          const band = classifyConfidenceBand(comparison.similarity);

          return {
            ...candidate,
            target_face_match: comparison.similarity >= 70,
            face_similarity: comparison.similarity,
            matched_face_id: matchedFaceId,
            face_verification_status:
              comparison.similarity >= 85
                ? ("matched" as const)
                : comparison.similarity >= 70
                  ? ("needs_review" as const)
                  : ("different_person" as const),
            confidence_band: band.band,
            confidence_label: band.label,
          };
        } catch (error) {
          console.warn("[DEEPFAKE:FACE] Candidate comparison failed:", {
            url: candidate.url,
            discoveredImageUrl,
            error: error instanceof Error ? error.message : String(error),
          });

          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status: "comparison_failed" as const,
            confidence_band: "needs_review",
            confidence_label: "Needs Human Review (Verification Pending)",
          };
        }
      }),
    );

    for (const result of results) {
      if (
        result.face_verification_status === "matched" ||
        result.face_verification_status === "needs_review" ||
        result.face_verification_status === "comparison_failed" ||
        result.face_verification_status === "no_image"
      ) {
        matched.push(result);
      } else {
        rejected.push(result);
      }
    }
  }

  return {
    matched,
    rejected,
    errors,
    targetName: references.profile.target_name,
  };
}
