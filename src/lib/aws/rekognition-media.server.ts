/**
 * Best-effort Amazon Rekognition media analysis helpers used by the Copyright
 * Intelligence engine (labels/scenes, OCR text, celebrities/actors, face
 * comparison, moderation). Every helper is non-throwing: on any AWS error the
 * caller simply loses that signal instead of failing the scan.
 */
import {
  CompareFacesCommand,
  DetectLabelsCommand,
  DetectModerationLabelsCommand,
  DetectTextCommand,
  RecognizeCelebritiesCommand,
} from "@aws-sdk/client-rekognition";
import { getRekognition } from "./clients.server";

/** Rekognition image byte limit for the Bytes API. */
const MAX_BYTES = 5 * 1024 * 1024;

function usable(bytes: Uint8Array): boolean {
  return bytes.length > 1024 && bytes.length <= MAX_BYTES;
}

export interface RekLabel {
  name: string;
  confidence: number;
  categories: string[];
}

export async function detectLabels(bytes: Uint8Array, maxLabels = 30): Promise<RekLabel[]> {
  if (!usable(bytes)) return [];
  try {
    const out = await getRekognition().send(
      new DetectLabelsCommand({
        Image: { Bytes: bytes },
        MaxLabels: maxLabels,
        MinConfidence: 60,
      }),
    );
    return (out.Labels ?? [])
      .map((l) => ({
        name: l.Name ?? "",
        confidence: Math.round(l.Confidence ?? 0),
        categories: (l.Categories ?? []).map((c) => c.Name ?? "").filter(Boolean),
      }))
      .filter((l) => l.name);
  } catch (e) {
    console.warn("[rek-media] detectLabels", (e as Error).name);
    return [];
  }
}

export async function detectText(bytes: Uint8Array): Promise<string[]> {
  if (!usable(bytes)) return [];
  try {
    const out = await getRekognition().send(new DetectTextCommand({ Image: { Bytes: bytes } }));
    return (out.TextDetections ?? [])
      .filter((t) => t.Type === "LINE" && (t.Confidence ?? 0) >= 70)
      .map((t) => (t.DetectedText ?? "").trim())
      .filter(Boolean)
      .slice(0, 40);
  } catch (e) {
    console.warn("[rek-media] detectText", (e as Error).name);
    return [];
  }
}

export interface RekCelebrity {
  name: string;
  confidence: number;
  urls: string[];
}

export async function recognizeCelebrities(
  bytes: Uint8Array,
): Promise<{ celebrities: RekCelebrity[]; faces: number }> {
  if (!usable(bytes)) return { celebrities: [], faces: 0 };
  try {
    const out = await getRekognition().send(
      new RecognizeCelebritiesCommand({ Image: { Bytes: bytes } }),
    );
    const celebrities = (out.CelebrityFaces ?? [])
      .map((c) => ({
        name: c.Name ?? "",
        confidence: Math.round(c.MatchConfidence ?? 0),
        urls: (c.Urls ?? []).slice(0, 3),
      }))
      .filter((c) => c.name);
    const faces = (out.CelebrityFaces?.length ?? 0) + (out.UnrecognizedFaces?.length ?? 0);
    return { celebrities, faces };
  } catch (e) {
    console.warn("[rek-media] recognizeCelebrities", (e as Error).name);
    return { celebrities: [], faces: 0 };
  }
}

/** Highest face similarity between a reference frame and a candidate image. */
export async function compareFaceSimilarity(
  referenceBytes: Uint8Array,
  candidateBytes: Uint8Array,
  threshold = 80,
): Promise<number> {
  if (!usable(referenceBytes) || !usable(candidateBytes)) return 0;
  try {
    const out = await getRekognition().send(
      new CompareFacesCommand({
        SourceImage: { Bytes: referenceBytes },
        TargetImage: { Bytes: candidateBytes },
        SimilarityThreshold: threshold,
        QualityFilter: "AUTO",
      }),
    );
    return Math.round(Math.max(0, ...(out.FaceMatches ?? []).map((m) => m.Similarity ?? 0)));
  } catch (e) {
    const name = (e as Error).name;
    if (name !== "InvalidParameterException") console.warn("[rek-media] compareFaces", name);
    return 0;
  }
}

export async function detectModeration(bytes: Uint8Array): Promise<string[]> {
  if (!usable(bytes)) return [];
  try {
    const out = await getRekognition().send(
      new DetectModerationLabelsCommand({
        Image: { Bytes: bytes },
        MinConfidence: 70,
      }),
    );
    return (out.ModerationLabels ?? [])
      .map((l) => l.Name ?? "")
      .filter(Boolean)
      .slice(0, 10);
  } catch {
    return [];
  }
}

export function isRekognitionConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}
