/**
 * Real perceptual hashing for the live Node/Worker path.
 *
 * Implements pHash (32x32 DCT, 8x8 low-frequency block, median threshold),
 * dHash (9x8 horizontal gradient) and aHash (8x8 average) over pure-JS
 * decoders so it runs inside the serverless Worker runtime (no sharp, no
 * native addons).
 *
 * These are genuine image-content hashes: they survive re-encoding,
 * resizing, moderate compression, minor colour shifts and light watermarking.
 * They are NOT cryptographic and are never a substitute for downloading the
 * candidate and comparing it against the protected original.
 */
import jpeg from "jpeg-js";
import UPNG from "upng-js";
import { classifySimilarityBand, type SimilarityBand } from "./similarity-bands";

export type PerceptualHashAlgorithm = "phash" | "dhash" | "ahash";

export interface GrayImage {
  width: number;
  height: number;
  /** luma 0-255, row-major */
  data: Float64Array;
}

export interface PerceptualHashes {
  phash: string;
  dhash: string;
  ahash: string;
  width: number;
  height: number;
  bytes: number;
  format: "jpeg" | "png";
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

export function detectImageFormat(bytes: Uint8Array): "jpeg" | "png" | "webp" | "gif" | "unknown" {
  if (startsWith(bytes, JPEG_MAGIC)) return "jpeg";
  if (startsWith(bytes, PNG_MAGIC)) return "png";
  if (
    bytes.length > 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  )
    return "webp";
  if (bytes.length > 3 && String.fromCharCode(bytes[0], bytes[1], bytes[2]) === "GIF") return "gif";
  return "unknown";
}

/** Decode jpeg/png to grayscale. Returns null for formats we cannot decode. */
export function decodeToGray(bytes: Uint8Array): (GrayImage & { format: "jpeg" | "png" }) | null {
  const format = detectImageFormat(bytes);
  try {
    if (format === "jpeg") {
      const raw = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
      return { ...toGray(raw.data, raw.width, raw.height, 4), format: "jpeg" };
    }
    if (format === "png") {
      const img = UPNG.decode(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
      return { ...toGray(rgba, img.width, img.height, 4), format: "png" };
    }
  } catch {
    return null;
  }
  return null;
}

function toGray(pixels: Uint8Array, width: number, height: number, stride: number): GrayImage {
  const data = new Float64Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += stride) {
    // Rec. 601 luma
    data[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
  }
  return { width, height, data };
}

/** Box-filter downscale to exact target size (area average — resize resilient). */
export function resizeGray(img: GrayImage, tw: number, th: number): GrayImage {
  const out = new Float64Array(tw * th);
  const xr = img.width / tw;
  const yr = img.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * yr);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * xr);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          sum += img.data[yy * img.width + xx];
          count++;
        }
      }
      out[y * tw + x] = count ? sum / count : 0;
    }
  }
  return { width: tw, height: th, data: out };
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

const DCT_SIZE = 32;
const HASH_SIZE = 8;

// Precomputed 1-D DCT-II basis for DCT_SIZE.
const DCT_BASIS: Float64Array[] = (() => {
  const basis: Float64Array[] = [];
  for (let u = 0; u < DCT_SIZE; u++) {
    const row = new Float64Array(DCT_SIZE);
    for (let x = 0; x < DCT_SIZE; x++) {
      row[x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE));
    }
    basis.push(row);
  }
  return basis;
})();

function dct2d(img: GrayImage): Float64Array {
  const n = DCT_SIZE;
  const tmp = new Float64Array(n * n);
  // rows
  for (let y = 0; y < n; y++) {
    for (let u = 0; u < n; u++) {
      let sum = 0;
      const basis = DCT_BASIS[u];
      for (let x = 0; x < n; x++) sum += img.data[y * n + x] * basis[x];
      tmp[y * n + u] = sum;
    }
  }
  const out = new Float64Array(n * n);
  // columns
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      let sum = 0;
      const basis = DCT_BASIS[v];
      for (let y = 0; y < n; y++) sum += tmp[y * n + u] * basis[y];
      out[v * n + u] = sum;
    }
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 64-bit pHash from the 8x8 low-frequency DCT block (DC term excluded). */
export function pHashFromGray(img: GrayImage): string {
  const small = resizeGray(img, DCT_SIZE, DCT_SIZE);
  const coeffs = dct2d(small);
  const block: number[] = [];
  for (let v = 0; v < HASH_SIZE; v++) {
    for (let u = 0; u < HASH_SIZE; u++) block.push(coeffs[v * DCT_SIZE + u]);
  }
  const withoutDc = block.slice(1);
  const med = median(withoutDc);
  return bitsToHex(block.map((c, i) => (i === 0 ? (c > med ? 1 : 0) : c > med ? 1 : 0)));
}

/** 64-bit dHash from the 9x8 horizontal gradient (crop / brightness resilient). */
export function dHashFromGray(img: GrayImage): string {
  const small = resizeGray(img, HASH_SIZE + 1, HASH_SIZE);
  const bits: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const left = small.data[y * (HASH_SIZE + 1) + x];
      const right = small.data[y * (HASH_SIZE + 1) + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

/** 64-bit average hash. */
export function aHashFromGray(img: GrayImage): string {
  const small = resizeGray(img, HASH_SIZE, HASH_SIZE);
  const values = Array.from(small.data);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return bitsToHex(values.map((v) => (v > mean ? 1 : 0)));
}

/** Compute all perceptual hashes for an image buffer. Null when undecodable. */
export function computePerceptualHashes(bytes: Uint8Array): PerceptualHashes | null {
  const gray = decodeToGray(bytes);
  if (!gray || gray.width < 8 || gray.height < 8) return null;
  return {
    phash: pHashFromGray(gray),
    dhash: dHashFromGray(gray),
    ahash: aHashFromGray(gray),
    width: gray.width,
    height: gray.height,
    bytes: bytes.byteLength,
    format: gray.format,
  };
}

/** Hamming distance between two equal-length hex hashes (bit count). */
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (Number.isNaN(x)) return Number.MAX_SAFE_INTEGER;
    distance += ((x & 1) ? 1 : 0) + ((x & 2) ? 1 : 0) + ((x & 4) ? 1 : 0) + ((x & 8) ? 1 : 0);
  }
  return distance;
}

export interface HashSimilarity {
  /** 0-100 similarity of the best-agreeing algorithm */
  similarity: number;
  distance: number;
  algorithm: PerceptualHashAlgorithm;
  perAlgorithm: Partial<Record<PerceptualHashAlgorithm, number>>;
}

const NO_SIMILARITY: HashSimilarity = {
  similarity: 0,
  distance: 64,
  algorithm: "phash",
  perAlgorithm: {},
};

/**
 * Compare two hash sets. pHash carries the verdict; dHash/aHash corroborate.
 * We report the *lowest* similarity of the algorithms that are available for
 * both sides, so a single lucky algorithm cannot inflate confidence.
 */
export function compareHashes(
  a: Partial<Record<PerceptualHashAlgorithm, string | null>>,
  b: Partial<Record<PerceptualHashAlgorithm, string | null>>,
): HashSimilarity {
  const perAlgorithm: Partial<Record<PerceptualHashAlgorithm, number>> = {};
  const distances: Partial<Record<PerceptualHashAlgorithm, number>> = {};
  for (const algo of ["phash", "dhash", "ahash"] as PerceptualHashAlgorithm[]) {
    const left = a[algo];
    const right = b[algo];
    if (!left || !right) continue;
    const bits = Math.max(left.length, right.length) * 4;
    const distance = hammingDistance(left, right);
    if (distance === Number.MAX_SAFE_INTEGER) continue;
    distances[algo] = distance;
    perAlgorithm[algo] = Math.round(((bits - distance) / bits) * 100);
  }
  const entries = Object.entries(perAlgorithm) as [PerceptualHashAlgorithm, number][];
  if (!entries.length) return NO_SIMILARITY;
  const weakest = entries.reduce((low, entry) => (entry[1] < low[1] ? entry : low));
  return {
    similarity: weakest[1],
    distance: distances[weakest[0]] ?? 64,
    algorithm: weakest[0],
    perAlgorithm,
  };
}

/**
 * Similarity bands used for copyright classification (evidence, not proof).
 * Thresholds live in `similarity-bands.ts` — the single source of truth.
 */
export function classifyHashSimilarity(similarity: number): SimilarityBand {
  return classifySimilarityBand(similarity);
}
