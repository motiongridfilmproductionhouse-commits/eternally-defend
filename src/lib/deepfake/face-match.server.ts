import {CompareFacesCommand} from "@aws-sdk/client-rekognition";
import { getRekognitionClient } from "@/lib/aws/rekognition-client.server";
import {
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  mergeAbortSignals,
} from "./scan-runtime.server";

const rekognition = { send: (cmd: any) => getRekognitionClient().send(cmd) };

const DEFAULT_SIMILARITY_THRESHOLD = 88;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function isAllowedImageType(contentType: string): boolean {
  return ["image/jpeg", "image/png", "image/webp"].includes(
    contentType.split(";")[0].trim().toLowerCase(),
  );
}

export async function downloadFaceImage(
  url: string,
  options?: { signal?: AbortSignal; softDeadlineMs?: number },
): Promise<Uint8Array> {
  assertNotAborted(options?.signal);
  const timeoutMs = boundTimeoutMs(20_000, options?.signal, options?.softDeadlineMs);
  const signal = mergeAbortSignals(options?.signal, AbortSignal.timeout(timeoutMs));

  const response = await fetch(url, {
    headers: {
      Accept: "image/jpeg,image/png,image/webp,image/*",
      "User-Agent": "Mozilla/5.0 EternaSentinel/1.0",
    },
    redirect: "follow",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!isAllowedImageType(contentType)) {
    throw new Error(`Unsupported image content type: ${contentType || "unknown"}.`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the 10 MB processing limit.");
  }

  const buffer = await response.arrayBuffer();
  assertNotAborted(options?.signal);

  if (!buffer.byteLength) {
    throw new Error("Downloaded image is empty.");
  }

  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the 10 MB processing limit.");
  }

  return new Uint8Array(buffer);
}

export type FaceMatchResult = {
  matched: boolean;
  similarity: number;
  threshold: number;
  faceConfidence: number;
  boundingBox?: {
    width?: number;
    height?: number;
    left?: number;
    top?: number;
  };
  unmatchedFaces: number;
};

export async function compareReferenceFace(input: {
  referenceImageBytes: Uint8Array;
  discoveredImageBytes?: Uint8Array;
  discoveredImageUrl?: string;
  similarityThreshold?: number;
}): Promise<FaceMatchResult> {
  if (!input.referenceImageBytes.byteLength) {
    throw new Error("Reference image is empty.");
  }

  if (!input.discoveredImageBytes && !input.discoveredImageUrl) {
    throw new Error("A discovered image or image URL is required.");
  }

  const discoveredImageBytes =
    input.discoveredImageBytes ?? (await downloadFaceImage(input.discoveredImageUrl!));

  const threshold = input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const response = await rekognition.send(
    new CompareFacesCommand({
      SourceImage: {
        Bytes: input.referenceImageBytes,
      },
      TargetImage: {
        Bytes: discoveredImageBytes,
      },
      SimilarityThreshold: threshold,
      QualityFilter: "MEDIUM",
    }),
  );

  const bestMatch = [...(response.FaceMatches ?? [])].sort(
    (a, b) => (b.Similarity ?? 0) - (a.Similarity ?? 0),
  )[0];

  return {
    matched: Boolean(bestMatch),
    similarity: bestMatch?.Similarity ?? 0,
    threshold,
    faceConfidence: bestMatch?.Face?.Confidence ?? 0,
    boundingBox: bestMatch?.Face?.BoundingBox
      ? {
          width: bestMatch.Face.BoundingBox.Width,
          height: bestMatch.Face.BoundingBox.Height,
          left: bestMatch.Face.BoundingBox.Left,
          top: bestMatch.Face.BoundingBox.Top,
        }
      : undefined,
    unmatchedFaces: response.UnmatchedFaces?.length ?? 0,
  };
}

export async function compareAgainstReferences(input: {
  referenceImages: Uint8Array[];
  discoveredImageUrl: string;
  similarityThreshold?: number;
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<
  FaceMatchResult & {
    matchedReferenceIndex: number | null;
  }
> {
  assertNotAborted(input.signal);

  if (!input.referenceImages.length) {
    throw new Error("At least one reference image is required.");
  }

  const discoveredImageBytes = await downloadFaceImage(input.discoveredImageUrl, {
    signal: input.signal,
    softDeadlineMs: input.softDeadlineMs,
  });

  let bestResult:
    | (FaceMatchResult & {
        matchedReferenceIndex: number;
      })
    | null = null;

  for (let index = 0; index < input.referenceImages.length; index++) {
    assertNotAborted(input.signal);
    try {
      const result = await compareReferenceFace({
        referenceImageBytes: input.referenceImages[index],
        discoveredImageBytes,
        similarityThreshold: input.similarityThreshold,
      });

      if (!bestResult || result.similarity > bestResult.similarity) {
        bestResult = {
          ...result,
          matchedReferenceIndex: index,
        };
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      console.warn("[DEEPFAKE:FACE] Reference comparison failed:", {
        referenceIndex: index,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!bestResult) {
    return {
      matched: false,
      similarity: 0,
      threshold: input.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      faceConfidence: 0,
      unmatchedFaces: 0,
      matchedReferenceIndex: null,
    };
  }

  return bestResult;
}
