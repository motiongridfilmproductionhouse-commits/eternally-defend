/**
 * Automatic reference image quality filtering for Deepfake Intelligence.
 */

export const MIN_REFERENCE_WIDTH = 200;
export const MIN_REFERENCE_HEIGHT = 200;
export const MIN_FACE_CONFIDENCE = 80;

export interface ImageQualityInput {
  url: string;
  width?: number | null;
  height?: number | null;
  contentType?: string | null;
  bytesLength?: number | null;
  faceDetected?: boolean;
  faceConfidence?: number | null;
  title?: string | null;
}

export type ImageRejectReason =
  | "tiny_resolution"
  | "heavy_blur_heuristic"
  | "watermark_heavy"
  | "cartoon_or_poster"
  | "no_face"
  | "low_face_confidence"
  | "silhouette"
  | "logo_only"
  | "placeholder"
  | "tracking_pixel"
  | "duplicate";

export interface ImageQualityResult {
  accepted: boolean;
  quality_score: number;
  reject_reason: ImageRejectReason | null;
}

const TRACKING_PIXEL_PATTERNS =
  /(?:pixel|beacon|1x1|spacer|transparent|analytics|doubleclick|facebook\.com\/tr)/i;

const PLACEHOLDER_PATTERNS = /(?:placeholder|no-image|noimage|default-avatar|blank|loading)/i;

const CARTOON_PATTERNS = /(?:cartoon|anime|illustration|vector|clipart|poster-only|wallpaper)/i;

export function assessReferenceImageQuality(input: ImageQualityInput): ImageQualityResult {
  const url = input.url.toLowerCase();
  const title = (input.title ?? "").toLowerCase();
  const blob = `${url} ${title}`;

  if (TRACKING_PIXEL_PATTERNS.test(blob)) {
    return { accepted: false, quality_score: 0, reject_reason: "tracking_pixel" };
  }
  if (PLACEHOLDER_PATTERNS.test(blob)) {
    return { accepted: false, quality_score: 0, reject_reason: "placeholder" };
  }
  if (CARTOON_PATTERNS.test(blob)) {
    return { accepted: false, quality_score: 0, reject_reason: "cartoon_or_poster" };
  }

  const w = input.width ?? 0;
  const h = input.height ?? 0;
  if (w > 0 && h > 0 && (w < MIN_REFERENCE_WIDTH || h < MIN_REFERENCE_HEIGHT)) {
    return { accepted: false, quality_score: 10, reject_reason: "tiny_resolution" };
  }

  if (input.bytesLength != null && input.bytesLength < 2_000) {
    return { accepted: false, quality_score: 5, reject_reason: "tracking_pixel" };
  }

  if (input.faceDetected === false) {
    return { accepted: false, quality_score: 20, reject_reason: "no_face" };
  }

  const faceConf = input.faceConfidence ?? 0;
  if (input.faceDetected && faceConf > 0 && faceConf < MIN_FACE_CONFIDENCE) {
    return { accepted: false, quality_score: faceConf, reject_reason: "low_face_confidence" };
  }

  let score = 50;
  if (w >= 400 && h >= 400) score += 20;
  if (w >= 800) score += 10;
  if (faceConf >= 90) score += 15;
  else if (faceConf >= MIN_FACE_CONFIDENCE) score += 8;

  return { accepted: true, quality_score: Math.min(99, score), reject_reason: null };
}
