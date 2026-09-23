import { describe, expect, it } from "vitest";
import {
  PRELIMINARY_MODEL_VERSION,
  VERIFIED_MODEL_VERSION,
  computePreliminaryExposure,
  computeVerifiedRisk,
  type RiskFindingInput,
} from "./risk-model";

function finding(over: Partial<RiskFindingInput> = {}): RiskFindingInput {
  return {
    id: Math.random().toString(36).slice(2),
    state: "NEEDS_HUMAN_REVIEW",
    identityBucket: "MATCHED",
    severity: 9,
    sourceAuthority: 8,
    searchRank: 2,
    platform: "Web",
    reuploadCount: 2,
    publishedAt: new Date().toISOString(),
    aiManipulationConfidence: null,
    identityConfidence: 90,
    ...over,
  };
}

describe("verified risk assessment", () => {
  it("is PENDING_VERIFICATION while nothing is human verified", () => {
    const result = computeVerifiedRisk([finding(), finding(), finding()], "PARTIAL");
    expect(result.band).toBe("PENDING_VERIFICATION");
    expect(result.score).toBe(0);
    expect(result.findingsAwaitingVerification).toBe(3);
    expect(result.modelVersion).toBe(VERIFIED_MODEL_VERSION);
  });

  it("unverified findings cannot affect the verified assessment", () => {
    const base = [finding({ state: "VERIFIED", severity: 5, reuploadCount: 0, platform: "Web" })];
    const withNoise = [
      ...base,
      finding({ state: "NEEDS_HUMAN_REVIEW", severity: 10, platform: "YouTube", reuploadCount: 9 }),
      finding({ state: "CLASSIFIED", severity: 10, platform: "Instagram", reuploadCount: 9 }),
      finding({ state: "DISCOVERED", severity: 10, platform: "X", reuploadCount: 9 }),
    ];
    const a = computeVerifiedRisk(base, "PARTIAL");
    const b = computeVerifiedRisk(withNoise, "PARTIAL");
    expect(b.score).toBe(a.score);
    expect(b.band).toBe(a.band);
    expect(b.findingsConsidered).toBe(1);
  });

  it("five unverified allegations score strictly below five verified high-risk findings", () => {
    const unverified = Array.from({ length: 5 }, () => finding({ state: "NEEDS_HUMAN_REVIEW" }));
    const verified = Array.from({ length: 5 }, () => finding({ state: "VERIFIED" }));

    const unverifiedVerifiedTrack = computeVerifiedRisk(unverified, "PARTIAL");
    const verifiedTrack = computeVerifiedRisk(verified, "PARTIAL");
    expect(unverifiedVerifiedTrack.score).toBeLessThan(verifiedTrack.score);

    // And in the preliminary track the unverified set is still capped well below.
    const prelimUnverified = computePreliminaryExposure(unverified, "PARTIAL");
    const prelimVerified = computePreliminaryExposure(verified, "PARTIAL");
    expect(prelimUnverified.score).toBeLessThan(prelimVerified.score);
  });

  it("ignores identity buckets other than MATCHED", () => {
    const result = computeVerifiedRisk(
      [finding({ state: "VERIFIED", identityBucket: "POSSIBLE_MATCH" })],
      "PARTIAL",
    );
    expect(result.band).toBe("PENDING_VERIFICATION");
  });

  it("reports insufficient data when coverage is thin", () => {
    const result = computeVerifiedRisk([finding({ state: "VERIFIED" })], "LIMITED");
    expect(result.band).toBe("INSUFFICIENT_DATA");
  });
});

describe("preliminary exposure signal", () => {
  it("labels itself as preliminary and counts awaiting verification", () => {
    const result = computePreliminaryExposure([finding(), finding()], "PARTIAL");
    expect(result.modelVersion).toBe(PRELIMINARY_MODEL_VERSION);
    expect(result.qualifier).toContain("Preliminary");
    expect(result.findingsAwaitingVerification).toBe(2);
    expect(result.factors.some((f) => f.key.startsWith("provisional."))).toBe(true);
  });

  it("never reports LOW for zero matched findings", () => {
    const result = computePreliminaryExposure([], "PARTIAL");
    expect(result.band).toBe("INSUFFICIENT_DATA");
  });

  it("never reports a band when coverage is insufficient", () => {
    const result = computePreliminaryExposure([finding()], "INSUFFICIENT");
    expect(result.band).toBe("INSUFFICIENT_DATA");
  });

  it("discloses partial coverage in its qualifier", () => {
    const result = computePreliminaryExposure([finding()], "PARTIAL");
    expect(result.qualifier).toContain("available sources");
  });
});
