/**
 * Deduplication for auto-promotable tiles. Many screenshots re-show the same
 * post, so the same face can turn up dozens of times across a customer's
 * upload history. Existing `deepfake_reference_faces` rows are never
 * deleted or replaced here — a duplicate is simply skipped, keeping
 * whichever version was accepted first. This is deliberately simpler (and
 * safer) than a "keep the best, replace the rest" strategy, which would
 * require mutating/removing an already-approved reference automatically —
 * exactly what the identity rules forbid.
 *
 * Two-stage check: a cheap perceptual-hash prefilter (DCT-based, computed
 * locally in pure JS — no extra AWS calls for the common non-duplicate
 * case), confirmed by a real face comparison only when the hash suggests a
 * possible match.
 */
import { decodeToRgba, resizeToGray } from "@/lib/media/image-raster.server";
import { compareReferenceFace } from "@/lib/deepfake/face-match.server";

const PHASH_SIZE = 32; // DCT input size
const HASH_SIZE = 8; // low-frequency bits retained
const PHASH_HAMMING_THRESHOLD = 10; // out of 64 bits — generous prefilter, confirmed by CompareFaces
const DEDUPE_SIMILARITY_THRESHOLD = 95;

function dct1d(input: number[]): number[] {
  const n = input.length;
  const output = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += input[i] * Math.cos((Math.PI / n) * (i + 0.5) * k);
    }
    output[k] = sum;
  }
  return output;
}

/** Small dependency-free perceptual hash: grayscale -> DCT -> top-left low-frequency bits vs median. */
export async function computePerceptualHash(imageBytes: Uint8Array): Promise<string> {
  const decoded = decodeToRgba(imageBytes);
  if (!decoded) throw new Error("UNSUPPORTED_IMAGE_FORMAT");
  const data = resizeToGray(decoded, PHASH_SIZE, PHASH_SIZE);

  const pixels: number[][] = [];
  for (let y = 0; y < PHASH_SIZE; y++) {
    pixels.push(Array.from(data.subarray(y * PHASH_SIZE, (y + 1) * PHASH_SIZE)));
  }

  // Row-wise then column-wise 1D DCT approximates a 2D DCT well enough for hashing.
  const rowDct = pixels.map((row) => dct1d(row));
  const colDct: number[][] = Array.from({ length: PHASH_SIZE }, () =>
    new Array(PHASH_SIZE).fill(0),
  );
  for (let x = 0; x < PHASH_SIZE; x++) {
    const col = rowDct.map((row) => row[x]);
    const transformed = dct1d(col);
    for (let y = 0; y < PHASH_SIZE; y++) colDct[y][x] = transformed[y];
  }

  const lowFreq: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      if (y === 0 && x === 0) continue; // DC coefficient dominates scale, not useful for the hash
      lowFreq.push(colDct[y][x]);
    }
  }
  const sorted = [...lowFreq].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let hash = "";
  for (const v of lowFreq) hash += v > median ? "1" : "0";
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let dist = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

export interface ExistingReference {
  id: string;
  phash: string | null;
  imageBytes: Uint8Array;
}

export interface DedupeResult {
  isDuplicate: boolean;
  duplicateOfReferenceId: string | null;
}

export async function checkDuplicate(input: {
  candidateBytes: Uint8Array;
  candidatePhash: string;
  existingReferences: ExistingReference[];
}): Promise<DedupeResult> {
  const phashCandidates = input.existingReferences.filter(
    (ref) =>
      ref.phash && hammingDistance(ref.phash, input.candidatePhash) <= PHASH_HAMMING_THRESHOLD,
  );

  for (const ref of phashCandidates) {
    try {
      const result = await compareReferenceFace({
        referenceImageBytes: ref.imageBytes,
        discoveredImageBytes: input.candidateBytes,
        similarityThreshold: DEDUPE_SIMILARITY_THRESHOLD,
      });
      if (result.matched) {
        return { isDuplicate: true, duplicateOfReferenceId: ref.id };
      }
    } catch {
      // A single failed confirmation shouldn't block promotion of a
      // genuinely new reference — fall through and try the next candidate.
    }
  }

  return { isDuplicate: false, duplicateOfReferenceId: null };
}
