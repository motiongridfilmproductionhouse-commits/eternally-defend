/**
 * Candidate media verification.
 *
 * Every finding that claims a copy of a protected asset must pass through here:
 * the candidate media is DOWNLOADED and compared against the protected
 * original's real perceptual hashes (and, for video, against its per-frame
 * hashes). Search-provider results alone never produce a verified match.
 *
 * Visual similarity is evidence, not proof of infringement, and this module
 * deliberately returns a graded verdict rather than an enforcement decision.
 */
import { fetchImageBytes } from "@/lib/aws/s3.server";
import {
  classifyHashSimilarity,
  compareHashes,
  computePerceptualHashes,
  detectImageFormat,
  type PerceptualHashes,
} from "./perceptual-hash.server";

export interface ProtectedFingerprint {
  protectedAssetId: string;
  phash: string | null;
  dhash: string | null;
  ahash: string | null;
  /** Per-frame hashes for video assets (may be empty). */
  frames?: Array<{
    frameIndex: number;
    timestampSeconds: number | null;
    phash: string | null;
    dhash: string | null;
    ahash: string | null;
  }>;
}

export type MatchVerdict = "EXACT" | "PROBABLE" | "POSSIBLE" | "NO_MATCH" | "UNVERIFIABLE";

export interface CandidateVerification {
  protectedAssetId: string;
  candidateUrl: string;
  downloaded: boolean;
  /** Reason the candidate could not be verified (undecodable format, 404, ...) */
  unverifiableReason?: string;
  similarity: number;
  distance: number;
  algorithm: string;
  perAlgorithm: Record<string, number>;
  verdict: MatchVerdict;
  /** Best matching frame for video assets. */
  matchedFrameIndex?: number;
  matchedFrameSeconds?: number | null;
  candidateHashes?: PerceptualHashes;
  candidateSha256?: string;
  byteIdentical: boolean;
  comparedAt: string;
}

const VERDICT_BY_BAND: Record<ReturnType<typeof classifyHashSimilarity>, MatchVerdict> = {
  exact: "EXACT",
  probable: "PROBABLE",
  possible: "POSSIBLE",
  unrelated: "NO_MATCH",
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function unverifiable(
  fingerprint: ProtectedFingerprint,
  candidateUrl: string,
  reason: string,
  downloaded: boolean,
): CandidateVerification {
  return {
    protectedAssetId: fingerprint.protectedAssetId,
    candidateUrl,
    downloaded,
    unverifiableReason: reason,
    similarity: 0,
    distance: 64,
    algorithm: "phash",
    perAlgorithm: {},
    verdict: "UNVERIFIABLE",
    byteIdentical: false,
    comparedAt: new Date().toISOString(),
  };
}

/** Verify already-downloaded bytes against a protected fingerprint. */
export async function verifyCandidateBytes(
  fingerprint: ProtectedFingerprint,
  candidateUrl: string,
  bytes: Uint8Array,
  referenceSha256?: string | null,
): Promise<CandidateVerification> {
  const format = detectImageFormat(bytes);
  const hashes = computePerceptualHashes(bytes);
  const candidateSha256 = await sha256Hex(bytes);
  if (!hashes) {
    return {
      ...unverifiable(
        fingerprint,
        candidateUrl,
        `Undecodable image format (${format}) — perceptual comparison not possible`,
        true,
      ),
      candidateSha256,
      byteIdentical: Boolean(referenceSha256 && referenceSha256 === candidateSha256),
    };
  }

  if (!fingerprint.phash && !fingerprint.dhash && !(fingerprint.frames?.length ?? 0)) {
    return {
      ...unverifiable(
        fingerprint,
        candidateUrl,
        "Protected asset has no perceptual fingerprint yet",
        true,
      ),
      candidateHashes: hashes,
      candidateSha256,
    };
  }

  let best = compareHashes(
    { phash: fingerprint.phash, dhash: fingerprint.dhash, ahash: fingerprint.ahash },
    hashes,
  );
  let matchedFrameIndex: number | undefined;
  let matchedFrameSeconds: number | null | undefined;

  for (const frame of fingerprint.frames ?? []) {
    const frameCompare = compareHashes(
      { phash: frame.phash, dhash: frame.dhash, ahash: frame.ahash },
      hashes,
    );
    if (frameCompare.similarity > best.similarity) {
      best = frameCompare;
      matchedFrameIndex = frame.frameIndex;
      matchedFrameSeconds = frame.timestampSeconds;
    }
  }

  return {
    protectedAssetId: fingerprint.protectedAssetId,
    candidateUrl,
    downloaded: true,
    similarity: best.similarity,
    distance: best.distance,
    algorithm: best.algorithm,
    perAlgorithm: best.perAlgorithm as Record<string, number>,
    verdict: VERDICT_BY_BAND[classifyHashSimilarity(best.similarity)],
    matchedFrameIndex,
    matchedFrameSeconds,
    candidateHashes: hashes,
    candidateSha256,
    byteIdentical: Boolean(referenceSha256 && referenceSha256 === candidateSha256),
    comparedAt: new Date().toISOString(),
  };
}

/** Download a candidate media URL and verify it against a protected fingerprint. */
export async function verifyCandidateUrl(
  fingerprint: ProtectedFingerprint,
  candidateUrl: string,
  referenceSha256?: string | null,
): Promise<CandidateVerification> {
  const downloaded = await fetchImageBytes(candidateUrl);
  if (!downloaded) {
    return unverifiable(fingerprint, candidateUrl, "Candidate media could not be downloaded", false);
  }
  return verifyCandidateBytes(fingerprint, candidateUrl, downloaded.bytes, referenceSha256);
}

/** Verify many candidates with bounded concurrency; keeps the best per URL. */
export async function verifyCandidateUrls(
  fingerprint: ProtectedFingerprint,
  candidateUrls: string[],
  options: { concurrency?: number; limit?: number; referenceSha256?: string | null } = {},
): Promise<CandidateVerification[]> {
  const { concurrency = 4, limit = 40, referenceSha256 = null } = options;
  const unique = Array.from(new Set(candidateUrls.filter(Boolean))).slice(0, limit);
  const out: CandidateVerification[] = [];
  for (let offset = 0; offset < unique.length; offset += concurrency) {
    const batch = unique.slice(offset, offset + concurrency);
    const settled = await Promise.all(
      batch.map((url) =>
        verifyCandidateUrl(fingerprint, url, referenceSha256).catch(() =>
          unverifiable(fingerprint, url, "Verification threw", false),
        ),
      ),
    );
    out.push(...settled);
  }
  return out;
}

/** A verification counts as corroborating evidence only at PROBABLE or better. */
export function isCorroborated(v: CandidateVerification): boolean {
  return v.downloaded && (v.verdict === "EXACT" || v.verdict === "PROBABLE");
}
