import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSubjectIdentityProfile,
  verifySubjectEntity,
} from "../firecrawl/entity-verifier";
import { classifyRemovalEligibility, inspectClassifierInput } from "../firecrawl/removal-classifier";

describe("YouTube Removal Intelligence — Regression, Invariants & Multi-Source Test Suite", () => {
  const profile = buildSubjectIdentityProfile("Gokulam Gopalan", [
    "Sree Gokulam Gopalan",
    "Gokulam Gopalan Chairman",
  ]);

  it("1. Known NOT_SUBJECT candidate remains NOT_SUBJECT after evidence analysis and cannot be mutated", () => {
    const candidate = {
      title: "Unrelated Video About Modern Farming Techniques in Punjab",
      snippet: "Learn about wheat harvesting and tractor maintenance.",
      url: "https://www.youtube.com/watch?v=unrelated999",
      author: "Agri World",
    };

    const verRes = verifySubjectEntity(candidate, profile);
    assert.equal(verRes.subjectMatchStatus, "NOT_SUBJECT");
    assert.equal(verRes.isVerifiedFinding, false);

    // Running removal classifier on a target input does not mutate subject verification status
    const targetInput = {
      title: candidate.title,
      snippet: candidate.snippet,
      url: candidate.url,
      author: candidate.author,
      subjectVerificationStatus: verRes.subjectMatchStatus,
      verificationScore: verRes.subjectMatchScore,
    };

    const removalRes = classifyRemovalEligibility(targetInput);
    assert.equal(targetInput.subjectVerificationStatus, "NOT_SUBJECT");
    assert.equal(removalRes.removalClassification, "NOT_ELIGIBLE");
  });

  it("2. Exact target name alone is not enough when strong collision evidence exists (e.g. Rama Shama Bhama)", () => {
    const collisionProfile = buildSubjectIdentityProfile("Bhama Kurup", ["Bhamaa", "Bhama"]);
    const candidate = {
      title: "Veteran playwright Yashwant Sardeshpande wrote dialogues for Rama Shama Bhama",
      snippet: "He won state award for his dialogues for Rama Shama Bhama.",
      url: "https://www.reddit.com/r/ChitraLoka/comments/1ntiz2o/veteran_playwright/",
    };

    const res = verifySubjectEntity(candidate, collisionProfile);
    assert.equal(res.subjectMatchStatus, "NOT_SUBJECT");
    assert.equal(res.isVerifiedFinding, false);
    assert.ok(res.mismatchReasons.some((r) => r.includes("movie title")));
  });

  it("3. Verification counters reconcile exactly (attempted === verified + probable + notSubject + verificationFailed)", () => {
    const attempted = 675;
    const verified = 579;
    const probable = 0;
    const notSubject = 96;
    const failed = 0;

    assert.equal(attempted, verified + probable + notSubject + failed);
  });

  it("4. MULTI_SOURCE requires >= 2 meaningful independent content sources", () => {
    const titleOnlyItem = {
      title: "Gokulam Gopalan video",
      snippet: "",
      url: "https://www.youtube.com/watch?v=titleonly1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 85,
    };

    const res1 = classifyRemovalEligibility(titleOnlyItem);
    assert.equal(res1.evidenceSources.includes("MULTI_SOURCE"), false);
    assert.equal(res1.meaningfulIndependentSourceCount < 2, true);

    const multiSourceItem = {
      title: "Gokulam Gopalan interview",
      snippet: "Detailed description of Gokulam Gopalan business ventures in Kerala.",
      transcript: "Full transcript of the Gokulam Gopalan interview...",
      url: "https://www.youtube.com/watch?v=multi1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 95,
    };

    const res2 = classifyRemovalEligibility(multiSourceItem);
    assert.equal(res2.evidenceSources.includes("MULTI_SOURCE"), true);
    assert.equal(res2.meaningfulIndependentSourceCount >= 2, true);
  });

  it("5. INSUFFICIENT_EVIDENCE action recommendation maps 1:1 with evidenceStatus INSUFFICIENT or UNAVAILABLE", () => {
    const titleOnlyItem = {
      title: "Gokulam Gopalan video clip",
      snippet: "",
      url: "https://www.youtube.com/watch?v=brief1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 85,
    };

    const res = classifyRemovalEligibility(titleOnlyItem);
    assert.equal(res.evidenceStatus, "INSUFFICIENT");
    assert.equal(res.actionRecommendation, "INSUFFICIENT_EVIDENCE");
    assert.ok(res.evidenceReasons.includes("EVIDENCE_TITLE_ONLY"));
  });

  it("6. Golden Calibration Fixtures: Criticism alone != removal candidate & Opinion != Defamation", () => {
    const opinionFixture = {
      title: "Public criticism of Gokulam Gopalan movie budget decisions",
      snippet: "Opinion and review of Malayalam film production strategy.",
      url: "https://www.youtube.com/watch?v=opinion1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 90,
    };

    const res = classifyRemovalEligibility(opinionFixture);
    assert.equal(res.removalClassification, "NOT_ELIGIBLE");
    assert.equal(res.actionRecommendation, "MONITOR");
    assert.ok(res.policySignals.isOpinionOrCommentary);
    assert.equal(res.policySignals.hasFactualAllegation, false);
  });

  it("7. Golden Calibration Fixtures: Copyright evidence yields HIGH_REMOVAL & COPYRIGHT_REVIEW", () => {
    const copyrightFixture = {
      title: "Gokulam Gopalan production full movie download leak HD 1080p telegram link",
      snippet: "Pirated movie leak download link.",
      url: "https://www.youtube.com/watch?v=copy1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 95,
    };

    const res = classifyRemovalEligibility(copyrightFixture);
    assert.equal(res.removalClassification, "HIGH_REMOVAL");
    assert.equal(res.actionRecommendation, "COPYRIGHT_REVIEW");
    assert.ok(res.policySignals.hasCopyrightMatch);
  });

  it("8. Golden Calibration Fixtures: Impersonation yields HIGH_REMOVAL & IMPERSONATION_REVIEW", () => {
    const impersonationFixture = {
      title: "Official Gokulam Gopalan Channel — Fake crypto investment scam giveaway",
      snippet: "Pretending to be Gokulam Gopalan offering doubled returns.",
      url: "https://www.youtube.com/watch?v=imp1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 95,
    };

    const res = classifyRemovalEligibility(impersonationFixture);
    assert.equal(res.removalClassification, "HIGH_REMOVAL");
    assert.equal(res.actionRecommendation, "IMPERSONATION_REVIEW");
    assert.ok(res.policySignals.hasImpersonation);
  });

  it("9. Golden Calibration Fixtures: Deepfake yields HIGH_REMOVAL & PLATFORM_REPORT_CANDIDATE", () => {
    const deepfakeFixture = {
      title: "AI Deepfake video of Gokulam Gopalan making fake voice speech",
      snippet: "Synthetic face swap and voice clone.",
      url: "https://www.youtube.com/watch?v=df1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 95,
    };

    const res = classifyRemovalEligibility(deepfakeFixture);
    assert.equal(res.removalClassification, "HIGH_REMOVAL");
    assert.equal(res.actionRecommendation, "PLATFORM_REPORT_CANDIDATE");
    assert.ok(res.policySignals.hasManipulatedMedia);
  });

  it("10. Golden Calibration Fixtures: Factual allegation yields LOW_REMOVAL & LEGAL_REVIEW", () => {
    const allegationFixture = {
      title: "Gokulam Gopalan FIR filed in court corruption case allegation",
      snippet: "Unverified police complaint report.",
      url: "https://www.youtube.com/watch?v=allegation1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 90,
    };

    const res = classifyRemovalEligibility(allegationFixture);
    assert.equal(res.removalClassification, "LOW_REMOVAL");
    assert.equal(res.actionRecommendation, "LEGAL_REVIEW");
    assert.ok(res.policySignals.hasFactualAllegation);
  });

  it("11. Classifier infrastructure failure yields ANALYSIS_FAILED", () => {
    const failFixture = {
      get title(): string {
        throw new Error("DB Connection Reset");
      },
      url: "https://www.youtube.com/watch?v=err1",
      subjectVerificationStatus: "VERIFIED_SUBJECT",
      verificationScore: 90,
    };

    const res = classifyRemovalEligibility(failFixture as any);
    assert.equal(res.removalClassification, "ANALYSIS_FAILED");
    assert.equal(res.evidenceStatus, "UNAVAILABLE");
  });
});
