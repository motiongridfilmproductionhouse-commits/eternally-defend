import { describe, expect, it } from "vitest";
import {
  buildProtectionInbox,
  classifyInboxFinding,
  isActionableFinding,
  type InboxFindingInput,
} from "./inbox";

function finding(over: Partial<InboxFindingInput> = {}): InboxFindingInput {
  return {
    id: "f1",
    url: "https://www.youtube.com/watch?v=abc",
    title: "Interview",
    channelTitle: "Some Channel",
    channelUrl: "https://youtube.com/@some",
    thumbnailUrl: null,
    publishedAt: "2026-08-01T00:00:00Z",
    subjectStatus: "subject_confirmed",
    subjectConfidence: 95,
    channelClass: "independent",
    riskLevel: "high",
    removalPotential: "high",
    recommendedAction: "Prepare impersonation notice",
    potentialViolation: "Impersonation",
    assessmentReason: "Fabricated statements attributed to the subject",
    evidenceVerified: true,
    transcriptState: "ok",
    priorityScore: 80,
    ...over,
  };
}

describe("protection inbox classification", () => {
  it("puts complete-evidence actionable findings in POSSIBLE_REMOVAL", () => {
    const item = classifyInboxFinding(finding());
    expect(item.bucket).toBe("POSSIBLE_REMOVAL");
    expect(item.userAction).toBe("NONE");
    expect(item.reasons.join(" ")).toMatch(/pre-send gates/i);
  });

  it("never claims a send is allowed", () => {
    const item = classifyInboxFinding(finding({ enforcementCase: { status: "QUEUED", eligibilityStatus: "AUTO_ELIGIBLE", basis: "IMPERSONATION" } }));
    expect(item.bucket).toBe("POSSIBLE_REMOVAL");
    expect(item.reasons.join(" ")).toMatch(/only if every existing gate passes/i);
  });

  it("routes human-gated cases to NEEDS_REVIEW without weakening them", () => {
    for (const status of [
      "UNDER_REVIEW",
      "HUMAN_ACTION_REQUIRED",
      "PRODUCTION_APPROVAL_REQUIRED",
      "ROUTE_DISCOVERY_REQUIRED",
      "QUEUE_FAILED",
    ]) {
      const item = classifyInboxFinding(
        finding({ enforcementCase: { status, eligibilityStatus: "REVIEW_REQUIRED", basis: "IMPERSONATION" } }),
      );
      expect(item.bucket).toBe("NEEDS_REVIEW");
    }
  });

  it("treats NOT_ELIGIBLE cases as review, not removal", () => {
    const item = classifyInboxFinding(
      finding({ enforcementCase: { status: "NOT_ELIGIBLE", eligibilityStatus: "NOT_ELIGIBLE", basis: "IMPERSONATION" } }),
    );
    expect(item.bucket).toBe("NEEDS_REVIEW");
  });

  it("holds incomplete evidence for review", () => {
    const item = classifyInboxFinding(finding({ evidenceVerified: false, removalPotential: "medium" }));
    expect(item.bucket).toBe("NEEDS_REVIEW");
    expect(item.reasons.join(" ")).toMatch(/not yet complete/i);
  });

  it("never auto-marks inconclusive or provider-failed analysis as safe", () => {
    for (const over of [
      { subjectStatus: "inconclusive" },
      { subjectStatus: null },
      { transcriptState: "provider_error" },
      { riskLevel: null },
    ] as Partial<InboxFindingInput>[]) {
      const item = classifyInboxFinding(finding(over));
      expect(item.bucket).toBe("NEEDS_REVIEW");
      expect(item.reasons.join(" ")).toMatch(/never automatically marked safe|inconclusive/i);
    }
  });

  it("treats legitimate appearances as monitoring, not threats", () => {
    expect(classifyInboxFinding(finding({ subjectStatus: "not_subject" })).bucket).toBe("MONITORING");
    expect(classifyInboxFinding(finding({ channelClass: "official_news" })).bucket).toBe("MONITORING");
    expect(classifyInboxFinding(finding({ riskLevel: "low", recommendedAction: null })).bucket).toBe(
      "MONITORING",
    );
  });

  it("mirrors the dispatch actionability gate", () => {
    expect(isActionableFinding(finding({ riskLevel: "medium" }))).toBe(false);
    expect(isActionableFinding(finding({ recommendedAction: null }))).toBe(false);
    expect(isActionableFinding(finding({ channelClass: "official_news" }))).toBe(false);
    expect(isActionableFinding(finding({ subjectStatus: "not_subject" }))).toBe(false);
    expect(isActionableFinding(finding())).toBe(true);
  });

  it("orders POSSIBLE_REMOVAL first, then review, then monitoring", () => {
    const { items, summary } = buildProtectionInbox([
      finding({ id: "low", riskLevel: "low", recommendedAction: null, priorityScore: 99 }),
      finding({ id: "review", evidenceVerified: false, removalPotential: "medium", priorityScore: 50 }),
      finding({ id: "high", priorityScore: 10 }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["high", "review", "low"]);
    expect(summary).toEqual({ analyzed: 3, possibleRemoval: 1, needsReview: 1, monitoring: 1 });
  });
});
