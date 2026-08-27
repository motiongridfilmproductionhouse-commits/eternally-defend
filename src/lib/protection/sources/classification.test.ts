import test from "node:test";
import assert from "node:assert/strict";
import {
  decideApprovedSourceClassification,
  classificationRequiresEvidence,
} from "./classification";

test("no reference profile enrolled -> needs_review, regardless of other signals", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: false,
    faceMatch: "matched",
    faceSimilarity: 99,
    synthetic: "synthetic",
    syntheticConfidence: 99,
  });
  assert.equal(result, "needs_review");
});

test("confident non-match -> not_subject (the video doesn't feature the protected person)", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "not_matched",
    faceSimilarity: 10,
    synthetic: "clean",
    syntheticConfidence: 0,
  });
  assert.equal(result, "not_subject");
});

test("REGRESSION: face comparison error (provider failure / no image) -> needs_review, never not_subject", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "error",
    faceSimilarity: 0,
    synthetic: "clean",
    syntheticConfidence: 0,
  });
  assert.equal(
    result,
    "needs_review",
    "a face-comparison failure must never be treated as a confident 'not the subject'",
  );
});

test("face matched, synthetic confirmed clean -> legitimate_appearance (the whole point of an approved source)", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "matched",
    faceSimilarity: 92,
    synthetic: "clean",
    syntheticConfidence: 5,
  });
  assert.equal(result, "legitimate_appearance");
});

test("REGRESSION: face matched but synthetic detection inconclusive (provider failure / no media) -> needs_review, never legitimate_appearance", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "matched",
    faceSimilarity: 92,
    synthetic: "unknown",
    syntheticConfidence: 0,
  });
  assert.equal(
    result,
    "needs_review",
    "an inconclusive synthetic-detection result must never be treated as confirmed clean",
  );
});

test("face matched + synthetic confirmed at high confidence -> verified_deepfake", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "matched",
    faceSimilarity: 96,
    synthetic: "synthetic",
    syntheticConfidence: 95,
  });
  assert.equal(result, "verified_deepfake");
});

test("face matched + synthetic confirmed but below high-confidence thresholds -> probable_deepfake", () => {
  const result = decideApprovedSourceClassification({
    hasReferenceProfile: true,
    faceMatch: "matched",
    faceSimilarity: 80,
    synthetic: "synthetic",
    syntheticConfidence: 91,
  });
  assert.equal(result, "probable_deepfake");
});

test("classificationRequiresEvidence: only synthetic-confirmed classifications create evidence/case-prep", () => {
  assert.equal(classificationRequiresEvidence("legitimate_appearance"), false);
  assert.equal(classificationRequiresEvidence("not_subject"), false);
  assert.equal(classificationRequiresEvidence("needs_review"), false);
  assert.equal(classificationRequiresEvidence("verified_deepfake"), true);
  assert.equal(classificationRequiresEvidence("probable_deepfake"), true);
});
