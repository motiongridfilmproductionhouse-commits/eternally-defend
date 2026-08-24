import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyIdentitySimilarity,
  isAutoPromotable,
  isReviewable,
} from "./identity-match.server";

test("classifyIdentitySimilarity applies conservative thresholds", () => {
  assert.equal(classifyIdentitySimilarity(99), "MATCHED_PROTECTED_SUBJECT");
  assert.equal(classifyIdentitySimilarity(95), "MATCHED_PROTECTED_SUBJECT");
  assert.equal(classifyIdentitySimilarity(94.99), "PROBABLE_MATCH");
  assert.equal(classifyIdentitySimilarity(85), "PROBABLE_MATCH");
  assert.equal(classifyIdentitySimilarity(84.99), "AMBIGUOUS");
  assert.equal(classifyIdentitySimilarity(70), "AMBIGUOUS");
  assert.equal(classifyIdentitySimilarity(69.99), "NOT_SUBJECT");
  assert.equal(classifyIdentitySimilarity(0), "NOT_SUBJECT");
  assert.equal(classifyIdentitySimilarity(null), "REQUIRES_HUMAN_REVIEW");
});

test("only MATCHED_PROTECTED_SUBJECT is auto-promotable — never bootstraps trust from a weaker match", () => {
  assert.equal(isAutoPromotable("MATCHED_PROTECTED_SUBJECT"), true);
  for (const status of [
    "PROBABLE_MATCH",
    "AMBIGUOUS",
    "NOT_SUBJECT",
    "REQUIRES_HUMAN_REVIEW",
  ] as const) {
    assert.equal(isAutoPromotable(status), false, `${status} must not be auto-promotable`);
  }
});

test("PROBABLE_MATCH, AMBIGUOUS, and REQUIRES_HUMAN_REVIEW remain reviewable; NOT_SUBJECT and the auto-matched tier do not need review", () => {
  assert.equal(isReviewable("PROBABLE_MATCH"), true);
  assert.equal(isReviewable("AMBIGUOUS"), true);
  assert.equal(isReviewable("REQUIRES_HUMAN_REVIEW"), true);
  assert.equal(isReviewable("NOT_SUBJECT"), false);
  assert.equal(isReviewable("MATCHED_PROTECTED_SUBJECT"), false);
});
