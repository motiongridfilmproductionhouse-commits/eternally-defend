/**
 * Video keyframe fingerprinting client.
 *
 * The Worker runtime cannot decode video, so frame extraction runs in the
 * Python crawler service (`POST /frames`), which returns real per-frame
 * perceptual hashes. Those frames are persisted on `protected_asset_frames`
 * so scans can match a candidate image/thumbnail against any frame of a
 * protected video.
 */

export interface ExtractedFrame {
  frameIndex: number;
  timestampSeconds: number;
  phash: string;
  dhash: string;
  ahash: string;
  whash: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  sceneChange: boolean;
  /** Only populated when `includeThumbnails` is requested (base64 JPEG). */
  thumbnailBase64: string | null;
}

export interface FrameExtractionResult {
  fps: number;
  durationSeconds: number;
  totalFrames: number;
  sampledFrames: number;
  strideFrames: number;
  algorithms: string[];
  frames: ExtractedFrame[];
  bytes: number | null;
}

function crawlerBaseUrl(): string {
  const raw = process.env.CRAWLER_SERVICE_URL;
  if (!raw)
    throw new Error("CRAWLER_SERVICE_URL is not configured — video frame hashing unavailable");
  return raw.replace(/\/+$/, "");
}

export function videoFrameExtractionConfigured(): boolean {
  return Boolean(process.env.CRAWLER_SERVICE_URL);
}

/** Extract + hash keyframes for a video reachable at `videoUrl` (e.g. signed S3 URL). */
export async function extractVideoFrames(
  videoUrl: string,
  options: {
    maxFrames?: number;
    minIntervalSeconds?: number;
    timeoutMs?: number;
    /** Also return a small per-frame JPEG thumbnail (base64). Costs payload
     * size, so keep maxFrames small (e.g. 3-5) when this is true. */
    includeThumbnails?: boolean;
  } = {},
): Promise<FrameExtractionResult> {
  const {
    maxFrames = 40,
    minIntervalSeconds = 1,
    timeoutMs = 180_000,
    includeThumbnails = false,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${crawlerBaseUrl()}/frames`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        url: videoUrl,
        max_frames: maxFrames,
        min_interval_seconds: minIntervalSeconds,
        include_thumbnails: includeThumbnails,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Frame extractor returned non-JSON [${response.status}]`);
    }
    if (!response.ok || payload.error) {
      throw new Error(payload.error || `Frame extraction failed [${response.status}]`);
    }
    const frames: ExtractedFrame[] = (Array.isArray(payload.frames) ? payload.frames : []).map(
      (row: Record<string, any>) => ({
        frameIndex: Number(row.frame_index ?? 0),
        timestampSeconds: Number(row.timestamp_seconds ?? 0),
        phash: String(row.phash ?? ""),
        dhash: String(row.dhash ?? ""),
        ahash: String(row.ahash ?? ""),
        whash: row.whash ? String(row.whash) : null,
        sha256: row.sha256 ? String(row.sha256) : null,
        width: row.width != null ? Number(row.width) : null,
        height: row.height != null ? Number(row.height) : null,
        sceneChange: Boolean(row.scene_change),
        thumbnailBase64: row.thumbnail_base64 ? String(row.thumbnail_base64) : null,
      }),
    );
    if (!frames.length) throw new Error("Frame extraction returned no frames");
    return {
      fps: Number(payload.fps ?? 0),
      durationSeconds: Number(payload.duration_seconds ?? 0),
      totalFrames: Number(payload.total_frames ?? 0),
      sampledFrames: Number(payload.sampled_frames ?? frames.length),
      strideFrames: Number(payload.stride_frames ?? 0),
      algorithms: Array.isArray(payload.algorithms) ? payload.algorithms : [],
      frames,
      bytes: payload.bytes != null ? Number(payload.bytes) : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Rows ready for insert into `protected_asset_frames`. */
export function frameRowsForAsset(
  userId: string,
  protectedAssetId: string,
  result: FrameExtractionResult,
) {
  return result.frames.map((frame) => ({
    user_id: userId,
    protected_asset_id: protectedAssetId,
    frame_index: frame.frameIndex,
    timestamp_seconds: frame.timestampSeconds,
    phash: frame.phash || null,
    dhash: frame.dhash || null,
    ahash: frame.ahash || null,
    sha256: frame.sha256,
    width: frame.width,
    height: frame.height,
    metadata: {
      whash: frame.whash,
      scene_change: frame.sceneChange,
      fps: result.fps,
      source: "crawler_service_frames",
    },
  }));
}
