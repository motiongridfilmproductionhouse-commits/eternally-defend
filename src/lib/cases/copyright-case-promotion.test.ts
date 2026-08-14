import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaseEvidenceSnapshot,
  caseNoteFor,
  contactState,
  copyrightCasePriority,
  copyrightCaseSubject,
  eligibilityState,
  isPromotable,
  type CopyrightMatchLike,
} from "./copyright-case-promotion";

function match(over: Partial<CopyrightMatchLike> = {}): CopyrightMatchLike {
  return {
    id: "m1",
    scan_id: "s1",
    source_url: "https://www.piratesite.example/watch/123",
    page_title: "Full movie HD",
    platform: "website",
    detection_type: "reupload",
    confidence: 94,
    confidence_band: "confirmed",
    review_status: "pending",
    reason: "frame hash match",
    transformations: ["cropped"],
    ocr_text: null,
    evidence: { phash_distance: 4 },
    contact: { abuseEmail: "abuse@piratesite.example" },
    ...over,
  };
}

test("priority follows confidence band", () => {
  assert.equal(copyrightCasePriority(match()), "Critical");
  assert.equal(copyrightCasePriority(match({ confidence: 75, confidence_band: "probable" })), "High");
  assert.equal(copyrightCasePriority(match({ confidence: 55, confidence_band: "possible" })), "Medium");
  assert.equal(copyrightCasePriority(match({ confidence: 20, confidence_band: "review" })), "Low");
});

test("subject includes work title and domain", () => {
  const subject = copyrightCaseSubject(match(), "Chinna Chinna Aasai");
  assert.match(subject, /Chinna Chinna Aasai/);
  assert.match(subject, /piratesite\.example/);
});

test("discovered contacts are never marked VERIFIED", () => {
  assert.equal(contactState(match()).verification, "UNVERIFIED");
  assert.equal(contactState(match({ contact: {} })).verification, "NONE");
  const snap = buildCaseEvidenceSnapshot(match());
  assert.equal((snap.contact as Record<string, unknown>).verification, "UNVERIFIED");
  assert.notEqual((snap.contact as Record<string, unknown>).verification, "VERIFIED");
});

test("similarity alone never yields an enforcement-ready state", () => {
  assert.equal(eligibilityState(match()), "AWAITING_HUMAN_REVIEW");
  assert.equal(eligibilityState(match({ review_status: "evidence_ready" })), "READY_FOR_ELIGIBILITY_CHECK");
  assert.equal(eligibilityState(match({ evidence: {}, ocr_text: null })), "EVIDENCE_INCOMPLETE");
  assert.equal(eligibilityState(match({ review_status: "dismissed" })), "DISMISSED");
});

test("dismissed findings are not promotable", () => {
  assert.equal(isPromotable(match()), true);
  assert.equal(isPromotable(match({ review_status: "dismissed" })), false);
});

test("evidence snapshot preserves the full handoff context", () => {
  const snap = buildCaseEvidenceSnapshot(match(), { workId: "work-1", workTitle: "My Film" });
  assert.equal(snap.copyright_match_id, "m1");
  assert.equal(snap.protected_work_id, "work-1");
  assert.equal(snap.protected_work_title, "My Film");
  assert.equal(snap.target_url, "https://www.piratesite.example/watch/123");
  assert.equal(snap.domain, "piratesite.example");
  assert.equal(snap.platform, "website");
  assert.deepEqual(snap.evidence_references, { phash_distance: 4 });
  assert.equal((snap.similarity as Record<string, unknown>).confidence, 94);
  assert.equal(snap.similarity_is_not_infringement, true);
  assert.equal(snap.eligibility_state, "AWAITING_HUMAN_REVIEW");
});

test("case note is human readable and states the eligibility state", () => {
  assert.match(caseNoteFor(match()), /confirmed · 94% similarity · AWAITING_HUMAN_REVIEW/);
});
