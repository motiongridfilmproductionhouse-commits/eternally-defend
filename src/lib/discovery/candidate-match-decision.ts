/**
 * Candidate -> copyright match gating.
 *
 * HARD RULES encoded here (do not relax without product sign-off):
 *  1. A search/reverse-image provider result NEVER becomes a copyright match.
 *     Only a candidate whose media was actually retrieved and compared can be
 *     promoted.
 *  2. If retrieval fails, the candidate stays UNVERIFIED / FETCH_FAILED.
 *  3. Every promoted match starts `review_status = 'pending'`.
 *  4. Visual similarity is evidence, not infringement, and never sets
 *     enforcement eligibility. Enforcement stays out of this module entirely.
 */

export type CrawlStatus = "PENDING" | "FETCHED" | "FETCH_FAILED" | "SKIPPED";
export type VerificationStatus = "UNVERIFIED" | "VERIFIED_MATCH" | "REJECTED" | "FETCH_FAILED";
export type ConfidenceBand = "exact" | "probable" | "possible" | "none";

export interface VerificationLike {
  downloaded: boolean;
  verdict: "EXACT" | "PROBABLE" | "POSSIBLE" | "NO_MATCH" | "UNVERIFIABLE";
  similarity: number;
  distance: number;
  algorithm: string;
  perAlgorithm?: Record<string, number>;
  matchedFrameIndex?: number;
  matchedFrameSeconds?: number | null;
  byteIdentical?: boolean;
  unverifiableReason?: string;
}

export interface CandidateOutcome {
  crawlStatus: CrawlStatus;
  verificationStatus: VerificationStatus;
  /** true only when a real retrieval + comparison produced a match band */
  promoteToMatch: boolean;
  confidence: number;
  confidenceBand: ConfidenceBand;
  detectionType: string;
  matchReason: string;
  /** New matches from this pipeline are always pending human review. */
  reviewStatus: "pending";
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Decide what a candidate becomes, given the outcome of real media retrieval.
 *
 * `pageFetched` reflects retrieval of the exact page URL; `verification` is
 * null when no media could be downloaded/compared at all.
 */
export function decideCandidateOutcome(input: {
  pageFetched: boolean;
  pageFailureReason?: string | null;
  verification: VerificationLike | null;
  isVideoAsset?: boolean;
}): CandidateOutcome {
  const base = {
    reviewStatus: "pending" as const,
    promoteToMatch: false,
    confidence: 0,
    confidenceBand: "none" as ConfidenceBand,
    detectionType: "unverified_candidate",
  };

  if (!input.verification || !input.verification.downloaded) {
    const reason =
      input.verification?.unverifiableReason ??
      input.pageFailureReason ??
      "Candidate media could not be retrieved";
    return {
      ...base,
      crawlStatus: input.pageFetched ? "FETCHED" : "FETCH_FAILED",
      verificationStatus: "FETCH_FAILED",
      matchReason: `Not verified — ${reason}. Candidate retained as UNVERIFIED; no copyright match created.`,
    };
  }

  const v = input.verification;
  const frameNote =
    v.matchedFrameIndex != null
      ? ` Best match on keyframe #${v.matchedFrameIndex}${
          v.matchedFrameSeconds != null ? ` (${v.matchedFrameSeconds.toFixed(1)}s)` : ""
        }.`
      : "";
  const byteNote = v.byteIdentical ? " Candidate bytes are identical to the protected original." : "";
  const evidence = `Retrieved candidate media and compared against the protected ${
    input.isVideoAsset ? "video keyframes" : "original"
  }: ${v.algorithm} similarity ${pct(v.similarity)} (hamming distance ${v.distance}).${frameNote}${byteNote}`;

  if (v.verdict === "UNVERIFIABLE") {
    return {
      ...base,
      crawlStatus: "FETCHED",
      verificationStatus: "FETCH_FAILED",
      matchReason: `Not verified — ${v.unverifiableReason ?? "comparison not possible"}. No copyright match created.`,
    };
  }

  if (v.verdict === "NO_MATCH") {
    return {
      ...base,
      crawlStatus: "FETCHED",
      verificationStatus: "REJECTED",
      matchReason: `Rejected — ${evidence} Below the possible-match threshold.`,
    };
  }

  const band: ConfidenceBand =
    v.verdict === "EXACT" ? "exact" : v.verdict === "PROBABLE" ? "probable" : "possible";
  const detectionType = detectionTypeForBand(band);

  return {
    reviewStatus: "pending",
    crawlStatus: "FETCHED",
    verificationStatus: "VERIFIED_MATCH",
    promoteToMatch: true,
    confidence: Math.round(v.similarity),
    confidenceBand: band,
    detectionType,
    matchReason: `${evidence} Classified ${band.toUpperCase()} — pending human review. Visual similarity alone is not a finding of infringement.`,
  };
}
