/**
 * Per-tile face classification. Same DetectFacesCommand shape and threshold
 * philosophy as src/lib/deepfake/reference-face-detect.server.ts, adapted to
 * the 6-way taxonomy this feature needs and to bounding-box-vs-tile-area
 * sizing (reference-face-detect only ever sees single dedicated reference
 * uploads, never a small crop from a larger grid, so it has no "too small"
 * concept).
 */
import { DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { getRekognition } from "@/lib/aws/clients.server";

export type FaceClassification =
  "NO_FACE" | "ONE_FACE" | "MULTIPLE_FACES" | "FACE_TOO_SMALL" | "LOW_QUALITY" | "USABLE_FACE";

export interface TileFaceAnalysis {
  classification: FaceClassification;
  confidence: number | null;
  boundingBox: { width: number; height: number; left: number; top: number } | null;
}

const MIN_FACE_AREA_FRACTION = 0.06;
const MIN_CONFIDENCE = 80;
const MIN_SHARPNESS = 20;
const MIN_BRIGHTNESS = 15;
const MAX_BRIGHTNESS = 98;
const MAX_POSE_YAW = 45;
const MAX_POSE_PITCH = 35;

export async function analyzeTileForFace(tileBytes: Uint8Array): Promise<TileFaceAnalysis> {
  const out = await getRekognition().send(
    new DetectFacesCommand({ Image: { Bytes: tileBytes }, Attributes: ["ALL"] }),
  );
  const faces = out.FaceDetails ?? [];

  if (faces.length === 0) {
    return { classification: "NO_FACE", confidence: null, boundingBox: null };
  }
  if (faces.length > 1) {
    return { classification: "MULTIPLE_FACES", confidence: null, boundingBox: null };
  }

  const face = faces[0];
  const box = face.BoundingBox;
  const boundingBox = box
    ? {
        width: box.Width ?? 0,
        height: box.Height ?? 0,
        left: box.Left ?? 0,
        top: box.Top ?? 0,
      }
    : null;
  const confidence = face.Confidence ?? 0;

  if (!boundingBox) {
    // Exactly one face was detected but AWS returned no bounding box to
    // evaluate size/quality against — reachable but genuinely rare.
    return { classification: "ONE_FACE", confidence, boundingBox: null };
  }

  const areaFraction = boundingBox.width * boundingBox.height;
  if (areaFraction < MIN_FACE_AREA_FRACTION) {
    return { classification: "FACE_TOO_SMALL", confidence, boundingBox };
  }

  if (confidence < MIN_CONFIDENCE) {
    return { classification: "LOW_QUALITY", confidence, boundingBox };
  }

  const pose = face.Pose;
  if (pose) {
    const yaw = Math.abs(pose.Yaw ?? 0);
    const pitch = Math.abs(pose.Pitch ?? 0);
    if (yaw > MAX_POSE_YAW || pitch > MAX_POSE_PITCH) {
      return { classification: "LOW_QUALITY", confidence, boundingBox };
    }
  }

  const quality = face.Quality;
  if (quality) {
    const sharpness = quality.Sharpness ?? 100;
    const brightness = quality.Brightness ?? 50;
    if (sharpness < MIN_SHARPNESS || brightness < MIN_BRIGHTNESS || brightness > MAX_BRIGHTNESS) {
      return { classification: "LOW_QUALITY", confidence, boundingBox };
    }
  }

  return { classification: "USABLE_FACE", confidence, boundingBox };
}
