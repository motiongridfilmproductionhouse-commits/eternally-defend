/**
 * Rekognition face detection for reference image quality validation.
 * Falls back gracefully when AWS credentials are unavailable.
 */

import {DetectFacesCommand} from "@aws-sdk/client-rekognition";
import { getRekognitionClient } from "@/lib/aws/rekognition-client.server";
import { downloadFaceImage } from "./face-match.server";
import { assertNotAborted } from "./scan-runtime.server";

export type ReferenceFaceDetection = {
  faceDetected: boolean;
  faceConfidence: number;
  usable: boolean;
  rejectReason: string | null;
};

export function isReferenceFaceDetectionConfigured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}

export async function detectReferenceFace(input: {
  imageUrl: string;
  imageBytes?: Uint8Array;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<ReferenceFaceDetection> {
  if (!isReferenceFaceDetectionConfigured()) {
    return {
      faceDetected: true,
      faceConfidence: 85,
      usable: true,
      rejectReason: null,
    };
  }

  assertNotAborted(input.signal);

  try {
    const bytes =
      input.imageBytes ??
      (await downloadFaceImage(input.imageUrl, {
        signal: input.signal,
        softDeadlineMs: input.softDeadlineMs,
      }));

    const response = await getRekognitionClient().send(
      new DetectFacesCommand({
        Image: { Bytes: bytes },
        Attributes: ["DEFAULT"],
      }),
    );

    const faces = response.FaceDetails ?? [];
    if (!faces.length) {
      return {
        faceDetected: false,
        faceConfidence: 0,
        usable: false,
        rejectReason: "no_face",
      };
    }

    const best = [...faces].sort((a, b) => (b.Confidence ?? 0) - (a.Confidence ?? 0))[0];
    const confidence = best.Confidence ?? 0;
    const pose = best.Pose;
    const quality = best.Quality;

    if (confidence < 80) {
      return {
        faceDetected: true,
        faceConfidence: confidence,
        usable: false,
        rejectReason: "low_face_confidence",
      };
    }

    if (pose) {
      const yaw = Math.abs(pose.Yaw ?? 0);
      const pitch = Math.abs(pose.Pitch ?? 0);
      if (yaw > 45 || pitch > 35) {
        return {
          faceDetected: true,
          faceConfidence: confidence,
          usable: false,
          rejectReason: "extreme_pose",
        };
      }
    }

    if (quality) {
      const sharpness = quality.Sharpness ?? 100;
      const brightness = quality.Brightness ?? 50;
      if (sharpness < 20) {
        return {
          faceDetected: true,
          faceConfidence: confidence,
          usable: false,
          rejectReason: "heavy_blur",
        };
      }
      if (brightness < 15 || brightness > 98) {
        return {
          faceDetected: true,
          faceConfidence: confidence,
          usable: false,
          rejectReason: "poor_brightness",
        };
      }
    }

    return {
      faceDetected: true,
      faceConfidence: confidence,
      usable: true,
      rejectReason: null,
    };
  } catch (error) {
    return {
      faceDetected: false,
      faceConfidence: 0,
      usable: false,
      rejectReason: error instanceof Error ? error.message : "detection_failed",
    };
  }
}
