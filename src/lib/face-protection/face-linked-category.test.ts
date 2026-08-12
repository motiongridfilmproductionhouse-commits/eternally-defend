import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { classifyFaceLinkedFinding } from "./face-linked-category";

describe("classifyFaceLinkedFinding", () => {
  it("never turns a bare high similarity into a threat", () => {
    const v = classifyFaceLinkedFinding({ similarity: 99, hit: { severity: "low" } });
    assert.equal(v.category, "NORMAL_MENTION");
    assert.equal(v.severity, "Low");
  });

  it("treats a borderline similarity with no evidence as needs review", () => {
    const v = classifyFaceLinkedFinding({ similarity: 84, hit: { severity: "low" } });
    assert.equal(v.category, "NEEDS_REVIEW");
  });

  it("only calls deepfake when the deepfake pipeline produced a finding", () => {
    assert.equal(
      classifyFaceLinkedFinding({ similarity: 97, deepfake: { is_synthetic: false, confidence: 95 } })
        .category,
      "NORMAL_MENTION",
    );
    const real = classifyFaceLinkedFinding({
      similarity: 97,
      deepfake: { is_synthetic: true, confidence: 91, risk_level: "high" },
    });
    assert.equal(real.category, "DEEPFAKE_MEDIA");
    assert.equal(real.severity, "Critical");
  });

  it("only calls reputation risk with existing harmful evidence at real severity", () => {
    const v = classifyFaceLinkedFinding({
      similarity: 96,
      hit: { severity: "high", risk_type: "defamation", threat_score: 72 },
    });
    assert.equal(v.category, "REPUTATION_RISK");
    const soft = classifyFaceLinkedFinding({
      similarity: 96,
      hit: { severity: "low", risk_type: "defamation", threat_score: 10 },
    });
    assert.equal(soft.category, "NEEDS_REVIEW");
  });

  it("requires confirmed impersonation evidence", () => {
    assert.equal(
      classifyFaceLinkedFinding({ similarity: 95, impersonation: { status: "pending" } }).category,
      "NEEDS_REVIEW",
    );
    assert.equal(
      classifyFaceLinkedFinding({ similarity: 95, impersonation: { status: "confirmed" } }).category,
      "IMPERSONATION",
    );
  });

  it("marks campaign-authorized surfaces as legitimate", () => {
    const v = classifyFaceLinkedFinding({
      similarity: 98,
      authorized: true,
      hit: { severity: "high", risk_type: "defamation" },
    });
    assert.equal(v.category, "NORMAL_MENTION");
    assert.equal(v.severity, "Info");
  });
});
