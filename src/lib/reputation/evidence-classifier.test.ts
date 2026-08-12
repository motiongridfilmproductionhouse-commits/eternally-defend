import { describe, expect, it } from "vitest";
import { classifyWithEvidence } from "./evidence-classifier";

const base = {
  target: "Shane Nigam",
  identityTier: "VERIFIED" as const,
  identityConfidence: 92,
};

describe("evidence-gated classifier", () => {
  it("keeps an ordinary movie review neutral", () => {
    const v = classifyWithEvidence({
      ...base,
      title: "Haal Movie Tamil Review | Shane Nigam | Public Review",
      description: "Haal movie review in tamil.",
    });
    expect(v.tier).toBe("TIER_1_NEUTRAL");
    expect(v.contentType).toBe("MOVIE_REVIEW");
    expect(v.evidence.riskEvidenceFound).toBe(false);
    expect(v.reputationRisk).toBe(0);
  });

  it("keeps a promotional trailer neutral instead of a legal dispute", () => {
    const v = classifyWithEvidence({
      ...base,
      title: "Balti Movie Official Trailer | Shane Nigam",
      description: "Releasing on August 15. Book your tickets. Copyright content owner notice.",
    });
    expect(v.tier).toBe("TIER_1_NEUTRAL");
    expect(v.evidence.riskEvidenceFound).toBe(false);
  });

  it("holds metadata-only risk signals for review", () => {
    const v = classifyWithEvidence({
      ...base,
      title: "Shane Nigam deepfake video viral",
      description: "",
    });
    expect(v.tier).toBe("TIER_2_NEEDS_REVIEW");
    expect(v.evidenceLevel).toBe("METADATA_ONLY");
    expect(v.evidence.riskEvidenceFound).toBe(false);
  });

  it("promotes a subject-directed allegation found in retrieved page text", () => {
    const v = classifyWithEvidence({
      ...base,
      title: "Shane Nigam interview about Haal",
      description: "Exclusive interview with Shane Nigam",
      pageText:
        "In the interview the producer accused Shane Nigam of unprofessional behaviour on set. " +
        "FEFKA registered a complaint against Shane Nigam and banned him from films for one year.",
    });
    expect(v.evidence.riskEvidenceFound).toBe(true);
    expect(v.evidence.evidenceText).toContain("Shane Nigam");
    expect(["TIER_3_REPUTATION_RISK", "TIER_4_HIGH_RISK"]).toContain(v.tier);
  });

  it("marks wrong-subject results irrelevant with zero risk", () => {
    const v = classifyWithEvidence({
      ...base,
      identityTier: "NOT_SUBJECT",
      title: "Some other actor accused of assault",
    });
    expect(v.tier).toBe("TIER_0_IRRELEVANT");
    expect(v.reputationRisk).toBe(0);
  });
});
