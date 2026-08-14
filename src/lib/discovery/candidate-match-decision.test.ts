import { describe, expect, it } from "vitest";
import { decideCandidateOutcome, type VerificationLike } from "./candidate-match-decision";

function verification(overrides: Partial<VerificationLike> = {}): VerificationLike {
  return {
    downloaded: true,
    verdict: "EXACT",
    similarity: 97,
    distance: 2,
    algorithm: "phash",
    perAlgorithm: { phash: 97 },
    ...overrides,
  };
}

describe("decideCandidateOutcome", () => {
  it("never promotes a candidate whose media was not retrieved", () => {
    const outcome = decideCandidateOutcome({ pageFetched: true, verification: null });
    expect(outcome.promoteToMatch).toBe(false);
    expect(outcome.verificationStatus).toBe("FETCH_FAILED");
    expect(outcome.matchReason).toMatch(/no copyright match created/i);
  });

  it("marks a failed page fetch as FETCH_FAILED with the reason retained", () => {
    const outcome = decideCandidateOutcome({
      pageFetched: false,
      pageFailureReason: "timeout after 20s",
      verification: null,
    });
    expect(outcome.crawlStatus).toBe("FETCH_FAILED");
    expect(outcome.matchReason).toContain("timeout after 20s");
  });

  it("promotes a verified exact match as pending review", () => {
    const outcome = decideCandidateOutcome({
      pageFetched: true,
      verification: verification({ byteIdentical: true }),
    });
    expect(outcome.promoteToMatch).toBe(true);
    expect(outcome.verificationStatus).toBe("VERIFIED_MATCH");
    expect(outcome.confidenceBand).toBe("exact");
    expect(outcome.confidence).toBe(97);
    expect(outcome.reviewStatus).toBe("pending");
    expect(outcome.matchReason).toMatch(/not a finding of infringement/i);
  });

  it("promotes probable and possible bands with graded detection types", () => {
    expect(
      decideCandidateOutcome({
        pageFetched: true,
        verification: verification({ verdict: "PROBABLE", similarity: 82, distance: 11 }),
      }).detectionType,
    ).toBe("probable_reupload");
    expect(
      decideCandidateOutcome({
        pageFetched: true,
        verification: verification({ verdict: "POSSIBLE", similarity: 61, distance: 25 }),
      }).confidenceBand,
    ).toBe("possible");
  });

  it("rejects a retrieved candidate below the possible threshold", () => {
    const outcome = decideCandidateOutcome({
      pageFetched: true,
      verification: verification({ verdict: "NO_MATCH", similarity: 20, distance: 51 }),
    });
    expect(outcome.promoteToMatch).toBe(false);
    expect(outcome.verificationStatus).toBe("REJECTED");
    expect(outcome.crawlStatus).toBe("FETCHED");
  });

  it("treats an undecodable comparison as unverified, not as a match", () => {
    const outcome = decideCandidateOutcome({
      pageFetched: true,
      verification: verification({
        verdict: "UNVERIFIABLE",
        unverifiableReason: "candidate媒 format not decodable",
      }),
    });
    expect(outcome.promoteToMatch).toBe(false);
    expect(outcome.verificationStatus).toBe("FETCH_FAILED");
  });

  it("names video keyframe evidence when the protected asset is a video", () => {
    const outcome = decideCandidateOutcome({
      pageFetched: true,
      isVideoAsset: true,
      verification: verification({ matchedFrameIndex: 7, matchedFrameSeconds: 12.5 }),
    });
    expect(outcome.matchReason).toContain("keyframe #7");
    expect(outcome.matchReason).toContain("12.5s");
  });
});
