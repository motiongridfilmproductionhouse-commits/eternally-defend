/**
 * Face verification for video candidates via extracted keyframes.
 *
 * Deepfake video candidates were previously verified only against a static
 * thumbnail/title text (see face-filter.server.ts / auto-reference-face-filter.server.ts),
 * so a manipulated video whose thumbnail didn't clearly show a matching face
 * was effectively unverifiable. This reuses the existing keyframe-extraction
 * path already wired for protected-asset fingerprinting
 * (src/lib/media/video-frames.server.ts -> crawler-service `/frames`) and, when
 * thumbnails are requested, runs each sampled frame through the same
 * Rekognition comparison used for static images.
 *
 * Bounded on purpose: a small number of frames per video, short-circuiting on
 * a strong match, so this doesn't multiply scan cost unpredictably.
 */
import {
  extractVideoFrames,
  videoFrameExtractionConfigured,
  type ExtractedFrame,
} from "@/lib/media/video-frames.server";
import { compareAgainstReferencesFromBytes } from "./face-match.server";
import { assertNotAborted, isAbortError } from "./scan-runtime.server";

const MAX_VIDEO_FRAMES_FOR_FACE_MATCH = 4;
const MIN_FRAME_INTERVAL_SECONDS = 2;
const VIDEO_FRAME_TIMEOUT_MS = 45_000;

export interface VideoFrameFaceMatchResult {
  matched: boolean;
  similarity: number;
  matchedReferenceIndex: number | null;
  frameIndex: number | null;
  timestampSeconds: number | null;
  framesCompared: number;
}

function decodeThumbnail(frame: ExtractedFrame): Uint8Array | null {
  if (!frame.thumbnailBase64) return null;
  try {
    return new Uint8Array(Buffer.from(frame.thumbnailBase64, "base64"));
  } catch {
    return null;
  }
}

/**
 * Extracts a bounded set of keyframes from `videoUrl` and compares each
 * against the supplied reference face images, returning the strongest match.
 * Returns null (not an error) when keyframe extraction isn't configured, the
 * video can't be processed, or no frame yielded a usable comparison — callers
 * should fall back to their existing "no_image"/needs_review handling.
 */
export async function compareVideoCandidateAgainstReferences(input: {
  videoUrl: string;
  referenceImages: Uint8Array[];
  similarityThreshold?: number;
  signal?: AbortSignal;
}): Promise<VideoFrameFaceMatchResult | null> {
  if (!videoFrameExtractionConfigured() || !input.referenceImages.length) {
    return null;
  }

  let extraction;
  try {
    extraction = await extractVideoFrames(input.videoUrl, {
      maxFrames: MAX_VIDEO_FRAMES_FOR_FACE_MATCH,
      minIntervalSeconds: MIN_FRAME_INTERVAL_SECONDS,
      includeThumbnails: true,
      timeoutMs: VIDEO_FRAME_TIMEOUT_MS,
    });
  } catch (error) {
    console.warn("[DEEPFAKE:FACE] Video keyframe extraction failed:", {
      url: input.videoUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Scene-change frames are the most likely to contain a distinct, matchable
  // face; compare those first so a strong match can short-circuit early.
  const orderedFrames = [...extraction.frames].sort(
    (a, b) => Number(b.sceneChange) - Number(a.sceneChange),
  );

  const threshold = input.similarityThreshold ?? 88;
  let best: VideoFrameFaceMatchResult | null = null;
  let framesCompared = 0;

  for (const frame of orderedFrames) {
    assertNotAborted(input.signal);
    const bytes = decodeThumbnail(frame);
    if (!bytes || !bytes.byteLength) continue;

    framesCompared += 1;
    try {
      const comparison = await compareAgainstReferencesFromBytes({
        referenceImages: input.referenceImages,
        discoveredImageBytes: bytes,
        similarityThreshold: input.similarityThreshold,
        signal: input.signal,
      });

      if (!best || comparison.similarity > best.similarity) {
        best = {
          matched: comparison.matched,
          similarity: comparison.similarity,
          matchedReferenceIndex: comparison.matchedReferenceIndex,
          frameIndex: frame.frameIndex,
          timestampSeconds: frame.timestampSeconds,
          framesCompared,
        };
      }

      if (comparison.similarity >= threshold) break;
    } catch (error) {
      if (isAbortError(error)) throw error;
      console.warn("[DEEPFAKE:FACE] Video frame comparison failed:", {
        url: input.videoUrl,
        frameIndex: frame.frameIndex,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (best) {
    best.framesCompared = framesCompared;
  }

  return best;
}
