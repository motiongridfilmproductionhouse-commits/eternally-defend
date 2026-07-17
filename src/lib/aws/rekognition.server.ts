import {
  CreateCollectionCommand,
  DescribeCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { getRekognition } from "./clients.server";

/** Deterministic per-user collection ID. Rekognition allows [A-Za-z0-9_.-]. */
export function collectionIdForUser(userId: string): string {
  return `eterna_${userId.replace(/-/g, "")}`;
}

export async function ensureCollection(userId: string): Promise<string> {
  const id = collectionIdForUser(userId);
  const rek = getRekognition();
  try {
    await rek.send(new DescribeCollectionCommand({ CollectionId: id }));
    return id;
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name ?? "";
    if (name !== "ResourceNotFoundException") throw e;
    await rek.send(new CreateCollectionCommand({ CollectionId: id }));
    return id;
  }
}

export interface IndexedFace {
  faceId: string;
  imageId?: string;
  confidence?: number;
  boundingBox?: unknown;
  externalImageId?: string;
}

export async function indexFace(opts: {
  collectionId: string;
  bytes: Uint8Array;
  externalImageId: string;
}): Promise<IndexedFace[]> {
  const out = await getRekognition().send(new IndexFacesCommand({
    CollectionId: opts.collectionId,
    Image: { Bytes: opts.bytes },
    ExternalImageId: opts.externalImageId,
    DetectionAttributes: ["ALL"],
    QualityFilter: "AUTO",
    MaxFaces: 1,
  }));

  if (!out.FaceRecords || out.FaceRecords.length === 0) {
    let reason = "No valid face detected or image quality was too low.";
    if (out.UnindexedFaces && out.UnindexedFaces.length > 0) {
      const reasons = out.UnindexedFaces[0].Reasons || [];
      if (reasons.includes("EXCEEDS_MAX_FACES")) {
        reason = "Multiple faces detected. Please ensure only you are in the frame.";
      } else if (reasons.includes("LOW_QUALITY") || reasons.includes("LOW_CONFIDENCE") || reasons.includes("LOW_SHARPNESS")) {
        reason = "Image quality is too low (excessive blur, poor lighting, or poor pose).";
      }
    }
    throw new Error(reason);
  }

  const faceRecord = out.FaceRecords[0];
  const detail = faceRecord.FaceDetail;
  if (detail) {
    const pose = detail.Pose;
    const quality = detail.ImageQuality;
    const confidence = detail.Confidence ?? 0;
    
    if (confidence < 90) {
      throw new Error("Face detection confidence too low.");
    }
    if (pose) {
      const yaw = Math.abs(pose.Yaw ?? 0);
      const pitch = Math.abs(pose.Pitch ?? 0);
      const roll = Math.abs(pose.Roll ?? 0);
      if (yaw > 15 || pitch > 15 || roll > 15) {
        throw new Error("Poor face pose. Please look directly at the camera.");
      }
    }
    if (quality) {
      const sharpness = quality.Sharpness ?? 100;
      const brightness = quality.Brightness ?? 100;
      if (sharpness < 50) {
        throw new Error("Image is too blurry. Please stabilize your camera.");
      }
      if (brightness < 30 || brightness > 90) {
        throw new Error("Poor lighting conditions. Please ensure your face is well-lit.");
      }
    }
  }

  return (out.FaceRecords ?? []).map((r) => ({
    faceId: r.Face?.FaceId ?? "",
    imageId: r.Face?.ImageId,
    confidence: r.Face?.Confidence,
    boundingBox: r.Face?.BoundingBox,
    externalImageId: r.Face?.ExternalImageId,
  })).filter((f) => f.faceId);
}

export interface FaceMatch {
  faceId: string;
  similarity: number;
  externalImageId?: string;
}

export async function searchFacesByImage(opts: {
  collectionId: string;
  bytes: Uint8Array;
  threshold?: number;
  maxFaces?: number;
}): Promise<{ matches: FaceMatch[]; searchedFaceConfidence?: number; searchedFaceBoundingBox?: unknown }> {
  try {
    const out = await getRekognition().send(new SearchFacesByImageCommand({
      CollectionId: opts.collectionId,
      Image: { Bytes: opts.bytes },
      FaceMatchThreshold: opts.threshold ?? 80,
      MaxFaces: opts.maxFaces ?? 5,
      QualityFilter: "AUTO",
    }));
    return {
      matches: (out.FaceMatches ?? []).map((m) => ({
        faceId: m.Face?.FaceId ?? "",
        similarity: m.Similarity ?? 0,
        externalImageId: m.Face?.ExternalImageId,
      })).filter((m) => m.faceId),
      searchedFaceConfidence: out.SearchedFaceConfidence,
      searchedFaceBoundingBox: out.SearchedFaceBoundingBox,
    };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name ?? "";
    // No face detected in probe image, or collection empty — treat as no matches.
    if (name === "InvalidParameterException" || name === "ResourceNotFoundException") {
      return { matches: [] };
    }
    throw e;
  }
}

export async function deleteFace(collectionId: string, faceId: string) {
  await getRekognition().send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: [faceId] }));
}
