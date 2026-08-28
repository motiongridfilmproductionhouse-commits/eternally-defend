/**
 * Pure-JS raster helpers (decode / metadata / grayscale downsample / crop +
 * JPEG re-encode) built on jpeg-js and upng-js.
 *
 * These exist because `sharp` is a native addon: it cannot load in the
 * serverless Worker runtime (it fails with "Could not load the sharp module
 * using the linuxnull-x64 runtime"), which silently killed the face reference
 * extraction module in production. Everything here runs on plain JS typed
 * arrays, so it works identically in Node and in the Worker.
 */
import jpeg from "jpeg-js";
import UPNG from "upng-js";
import { detectImageFormat } from "./perceptual-hash.server";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel */
  data: Uint8Array;
}

/** Decode jpeg/png into RGBA. Returns null for formats we cannot decode. */
export function decodeToRgba(bytes: Uint8Array): RgbaImage | null {
  const format = detectImageFormat(bytes);
  try {
    if (format === "jpeg") {
      const raw = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
      return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) };
    }
    if (format === "png") {
      const img = UPNG.decode(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      return {
        width: img.width,
        height: img.height,
        data: new Uint8Array(UPNG.toRGBA8(img)[0]),
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** Image dimensions, or zeros when the format is undecodable. */
export function imageMetadata(bytes: Uint8Array): { width: number; height: number } {
  const img = decodeToRgba(bytes);
  return { width: img?.width ?? 0, height: img?.height ?? 0 };
}

/**
 * Nearest-neighbour downsample to grayscale (luma 0-255, row-major).
 * Matches what sharp's `.resize(...).grayscale().raw()` produced closely
 * enough for variance-based grid analysis.
 */
export function resizeToGray(
  image: RgbaImage,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  const xRatio = image.width / targetWidth;
  const yRatio = image.height / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x * xRatio));
      const p = (sy * image.width + sx) * 4;
      out[y * targetWidth + x] = Math.round(
        0.299 * image.data[p] + 0.587 * image.data[p + 1] + 0.114 * image.data[p + 2],
      );
    }
  }
  return out;
}

/** Crop a rectangle and re-encode as JPEG. Throws when the source cannot be decoded. */
export function cropToJpeg(
  bytes: Uint8Array,
  rect: { x: number; y: number; width: number; height: number },
  quality = 90,
): Buffer {
  const image = decodeToRgba(bytes);
  if (!image) throw new Error("UNSUPPORTED_IMAGE_FORMAT");

  const left = Math.max(0, Math.min(image.width - 1, Math.round(rect.x)));
  const top = Math.max(0, Math.min(image.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(image.width - left, Math.round(rect.width)));
  const height = Math.max(1, Math.min(image.height - top, Math.round(rect.height)));

  const cropped = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * image.width + left) * 4;
    cropped.set(image.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }

  const encoded = jpeg.encode({ data: cropped, width, height }, quality);
  return Buffer.from(encoded.data);
}
