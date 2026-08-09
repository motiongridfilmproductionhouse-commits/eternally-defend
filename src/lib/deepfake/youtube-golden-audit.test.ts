import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GOLDEN_VALIDATION_DATASET } from "./youtube-golden-dataset";
import {
  runGoldenPipelineAudit,
  calculateSubjectMetrics,
  calculateActionConfusionMatrix,
  evaluateAcceptanceGates,
  freezeProductionBaseline,
} from "./youtube-validation-engine";

describe("YouTube Removal Intelligence — 100-Item Golden Dataset Audit Test Suite", () => {
  const auditResults = runGoldenPipelineAudit();
  const subjectMetrics = calculateSubjectMetrics(auditResults);
  const actionMatrix = calculateActionConfusionMatrix(auditResults);
  const gates = evaluateAcceptanceGates(subjectMetrics, actionMatrix, auditResults);

  it("1. Golden dataset contains at least 100 human-labeled benchmark records", () => {
    assert.equal(GOLDEN_VALIDATION_DATASET.length >= 100, true);
    assert.equal(auditResults.length, 100);
  });

  it("2. Subject Verification Precision >= 95% and Recall >= 90%", () => {
    assert.equal(gates.subject_precision_pass, true);
    assert.equal(gates.subject_recall_pass, true);
    assert.equal(subjectMetrics.precision >= 95.0, true);
    assert.equal(subjectMetrics.recall >= 90.0, true);
  });

  it("3. Actionable recommendation false positive rate <= 5%", () => {
    assert.equal(gates.actionable_fp_rate_pass, true);
  });

  it("4. Insufficient evidence treated as confident actionable = 0%", () => {
    assert.equal(gates.insufficient_treated_actionable_pass, true);
  });

  it("5. Protected opinion/commentary treated as automatic removal candidate = 0%", () => {
    assert.equal(gates.opinion_treated_removal_pass, true);
  });

  it("6. Complaint drafts containing unsupported evidence = 0%", () => {
    assert.equal(gates.unsupported_draft_evidence_pass, true);
  });

  it("7. Automatic complaint submissions = 0%", () => {
    assert.equal(gates.automatic_submissions_pass, true);
  });

  it("8. All engineering acceptance gates passed and readiness decision is READY_FOR_CONTROLLED_PILOT", () => {
    assert.equal(gates.all_gates_passed, true);
    assert.equal(gates.readiness_decision, "READY_FOR_CONTROLLED_PILOT");
  });

  it("9. Freeze production baseline snapshot record created", () => {
    const baseline = freezeProductionBaseline(subjectMetrics, actionMatrix, gates);
    assert.equal(baseline.baseline_version, "youtube-removal-intelligence-v1-production-baseline");
    assert.equal(baseline.dataset_size, 100);
    assert.equal(baseline.subject_metrics.precision >= 95, true);
  });
});
