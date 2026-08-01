import { compareAgainstReferences } from "./face-match.server";
import {
  assertNotAborted,
  isAbortError,
} from "./scan-runtime.server";

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

export type FaceVerifiedCandidate =
  FaceFilterCandidate & {
    target_face_match: boolean;
    face_similarity: number;
    matched_face_id: string | null;
    face_verification_status:
      | "matched"
      | "different_person"
      | "no_image"
      | "comparison_failed";
  };

type ReferenceFaceRecord = {
  id: string;
  storage_path: string;
  rekognition_face_id?: string | null;
};

const DEFAULT_THRESHOLD = 88;
const MAX_REFERENCE_FACES = 5;

async function loadReferenceImages(input: {
  supabase: any;
  userId: string;
  profileId: string;
}): Promise<{
  profile: any;
  faces: ReferenceFaceRecord[];
  imageBytes: Uint8Array[];
}> {
  const { data: profile, error: profileError } =
    await input.supabase
      .from("deepfake_target_profiles")
      .select("id, user_id, target_name, authorization_status")
      .eq("id", input.profileId)
      .eq("user_id", input.userId)
      .single();

  if (profileError || !profile) {
    throw new Error(
      "Target face profile was not found or is not accessible.",
    );
  }

  const { data: faceRows, error: facesError } =
    await input.supabase
      .from("deepfake_reference_faces")
      .select(
        "id, storage_path, rekognition_face_id, face_confidence, created_at",
      )
      .eq("profile_id", input.profileId)
      .order("created_at", {
        ascending: true,
      })
      .limit(MAX_REFERENCE_FACES);

  if (facesError) {
    throw new Error(
      `Unable to load reference faces: ${facesError.message}`,
    );
  }

  const faces =
    (faceRows ?? []) as ReferenceFaceRecord[];

  if (faces.length < 3) {
    throw new Error(
      "At least three enrolled reference faces are required before face-verified scanning.",
    );
  }

  const validFaces: ReferenceFaceRecord[] = [];
  const imageBytes: Uint8Array[] = [];

  for (const face of faces) {
    if (!face.storage_path) continue;

    const { data: file, error: downloadError } =
      await input.supabase.storage
        .from("deepfake-reference-faces")
        .download(face.storage_path);

    if (downloadError || !file) {
      console.warn(
        "[DEEPFAKE:FACE] Reference image download failed:",
        {
          referenceFaceId: face.id,
          storagePath: face.storage_path,
          error:
            downloadError?.message ??
            "No file returned",
        },
      );

      continue;
    }

    const buffer = await file.arrayBuffer();

    if (!buffer.byteLength) {
      continue;
    }

    validFaces.push(face);
    imageBytes.push(new Uint8Array(buffer));
  }

  if (imageBytes.length < 3) {
    throw new Error(
      "Fewer than three usable reference images could be loaded.",
    );
  }

  return {
    profile,
    faces: validFaces,
    imageBytes,
  };
}

function imageUrlForCandidate(
  candidate: FaceFilterCandidate,
): string | null {
  const possibleUrls = [
    candidate.image_url,
    candidate.thumbnail_url,
    candidate.media_type !== "video"
      ? candidate.media_url
      : undefined,
  ];

  for (const value of possibleUrls) {
    if (
      typeof value !== "string" ||
      !value.trim()
    ) {
      continue;
    }

    try {
      const parsed = new URL(value);

      if (
        parsed.protocol === "http:" ||
        parsed.protocol === "https:"
      ) {
        return value;
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return null;
}

export async function filterCandidatesByTargetFace(input: {
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
  assertNotAborted(input.signal);

  const references = await loadReferenceImages({
    supabase: input.supabase,
    userId: input.userId,
    profileId: input.profileId,
  });

  const threshold =
    input.similarityThreshold ??
    DEFAULT_THRESHOLD;

  const matched: FaceVerifiedCandidate[] = [];
  const rejected: FaceVerifiedCandidate[] = [];
  const errors: FaceVerifiedCandidate[] = [];

  /*
   * Rekognition calls are deliberately batched to avoid rate spikes.
   */
  const batchSize = 3;

  for (
    let start = 0;
    start < input.candidates.length;
    start += batchSize
  ) {
    assertNotAborted(input.signal);
    const batch = input.candidates.slice(
      start,
      start + batchSize,
    );

    const results = await Promise.all(
      batch.map(async (candidate) => {
        assertNotAborted(input.signal);
        const discoveredImageUrl =
          imageUrlForCandidate(candidate);

        if (!discoveredImageUrl) {
          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status:
              "no_image" as const,
          };
        }

        try {
          const comparison =
            await compareAgainstReferences({
              referenceImages:
                references.imageBytes,
              discoveredImageUrl,
              similarityThreshold: threshold,
              signal: input.signal,
              softDeadlineMs: input.softDeadlineMs,
            });

          const matchedReferenceIndex =
            comparison.matchedReferenceIndex;

          const matchedFaceId =
            matchedReferenceIndex !== null
              ? references.faces[
                  matchedReferenceIndex
                ]?.rekognition_face_id ??
                references.faces[
                  matchedReferenceIndex
                ]?.id ??
                null
              : null;

          return {
            ...candidate,
            target_face_match:
              comparison.matched,
            face_similarity:
              comparison.similarity,
            matched_face_id: matchedFaceId,
            face_verification_status:
              comparison.matched
                ? ("matched" as const)
                : ("different_person" as const),
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          console.warn(
            "[DEEPFAKE:FACE] Candidate comparison failed:",
            {
              url: candidate.url,
              discoveredImageUrl,
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          );

          return {
            ...candidate,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
            face_verification_status:
              "comparison_failed" as const,
          };
        }
      }),
    );

    for (const result of results) {
      if (
        result.face_verification_status ===
        "matched"
      ) {
        matched.push(result);
      } else if (
        result.face_verification_status ===
          "comparison_failed" ||
        result.face_verification_status ===
          "no_image"
      ) {
        errors.push(result);
      } else {
        rejected.push(result);
      }
    }
  }

  console.log(
    "[DEEPFAKE:FACE] Verification summary:",
    {
      targetName: references.profile.target_name,
      submitted: input.candidates.length,
      matched: matched.length,
      differentPerson: rejected.length,
      unavailable: errors.length,
      threshold,
      referenceFaces:
        references.imageBytes.length,
    },
  );

  return {
    matched,
    rejected,
    errors,
    targetName:
      references.profile.target_name,
  };
}
