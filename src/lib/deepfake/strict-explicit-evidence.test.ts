import assert from "node:assert/strict";
import test from "node:test";
import { qualifiesForExplicitThreatFeed } from "./filter.server";
import { classifyThreatFinding, threatAlertToneFromCounts, threatAlertBadgeLabel } from "./threat-alert";
import type { ClientFinding } from "./results-dashboard";

test("TEST 1: Query contains 'deepfake' but Result is Wikipedia biography -> EXPECTED: REJECT", () => {
  const candidate: ClientFinding = {
    id: "m-1",
    url: "https://en.wikipedia.org/wiki/Manju_Pathrose",
    page_title: "Manju Pathrose - Wikipedia",
    snippet: "Manju Pathrose is an Indian actress who works in Malayalam films.",
    face_similarity: 95,
    is_synthetic: false,
    finding_classification: "BIOGRAPHY",
  };
  assert.equal(qualifiesForExplicitThreatFeed(candidate), false);
  assert.equal(classifyThreatFinding(candidate), null);
});

test("TEST 2: Query contains 'face swap' but Result is Asianet / Filmibeat normal actress article -> EXPECTED: REJECT / COLLAPSED", () => {
  const asianetArticle: ClientFinding = {
    id: "m-2",
    url: "https://www.asianetnews.com/entertainment/actress-manju-pathrose-interview",
    page_title: "Actress Manju Pathrose open talk about career",
    snippet: "Asianet News article discussing television career and interviews.",
    face_similarity: 90,
    is_synthetic: false,
    finding_classification: "NEWS",
  };
  assert.equal(qualifiesForExplicitThreatFeed(asianetArticle), false);
  assert.equal(classifyThreatFinding(asianetArticle), null);

  const filmibeatArticle: ClientFinding = {
    id: "m-3",
    url: "https://www.filmibeat.com/celebs/manju-pathrose.html",
    page_title: "Manju Pathrose Profile, News, Photos",
    snippet: "Filmibeat celebrity biography and news updates.",
    face_similarity: 92,
    is_synthetic: false,
    finding_classification: "BIOGRAPHY",
  };
  assert.equal(qualifiesForExplicitThreatFeed(filmibeatArticle), false);
  assert.equal(classifyThreatFinding(filmibeatArticle), null);
});

test("TEST 3: Query contains 'explicit ai' but Result is ordinary actress photograph -> EXPECTED: REJECT", () => {
  const ordinaryPhoto: ClientFinding = {
    id: "m-4",
    url: "https://example-news.com/photos/actress.jpg",
    page_title: "Manju Pathrose at Movie Event",
    snippet: "Official public photograph at film premiere.",
    face_similarity: 98,
    is_synthetic: false,
    takedown_recommended: false,
  };
  assert.equal(qualifiesForExplicitThreatFeed(ordinaryPhoto), false);
  assert.equal(classifyThreatFinding(ordinaryPhoto), null);
});

test("TEST 4: Explicit/synthetic host page + target face 97% + media classifier confirms synthetic explicit imagery -> EXPECTED: VERIFIED_EXPLICIT_DEEPFAKE", () => {
  const explicitDeepfake: ClientFinding = {
    id: "f-explicit-1",
    url: "https://mrdeepfakes.com/video/manju-pathrose-ai-nude",
    source_host: "mrdeepfakes.com",
    page_title: "Manju Pathrose AI Nude Face Swap Video",
    snippet: "Explicit AI generated face swap video featuring target face.",
    face_similarity: 97.8,
    confidence: 97.8,
    is_synthetic: true,
    finding_classification: "VERIFIED_EXPLICIT_DEEPFAKE",
    takedown_recommended: true,
  };
  assert.equal(qualifiesForExplicitThreatFeed(explicitDeepfake), true);
  assert.equal(classifyThreatFinding(explicitDeepfake), "VERIFIED_DEEPFAKE");
});

test("TEST 5: Relevant host page but face similarity 60% -> EXPECTED: NOT IN MAIN FEED", () => {
  const lowFaceMatch: ClientFinding = {
    id: "m-5",
    url: "https://mrdeepfakes.com/video/unrelated-person",
    page_title: "Explicit AI video",
    snippet: "AI video of different individual.",
    face_similarity: 60.0,
    confidence: 60.0,
    is_synthetic: true,
    finding_classification: "SYNTHETIC_IMAGE",
  };
  assert.equal(qualifiesForExplicitThreatFeed(lowFaceMatch), false);
  assert.equal(classifyThreatFinding(lowFaceMatch), null);
});

test("TEST 6: Search result title contains explicit keywords but media analysis was never executed -> EXPECTED: synthetic_confidence = null, explicit_detection = null, NOT VERIFIED", () => {
  const unanalyzedCandidate: ClientFinding = {
    id: "raw-1",
    url: "https://example.com/page",
    page_title: "Explicit AI image candidate search result",
    snippet: "Snippet text containing keywords",
    face_similarity: null,
    is_synthetic: null,
  };
  assert.equal(unanalyzedCandidate.face_similarity, null);
  assert.equal(unanalyzedCandidate.is_synthetic, null);
  assert.equal(qualifiesForExplicitThreatFeed(unanalyzedCandidate), false);
  assert.equal(classifyThreatFinding(unanalyzedCandidate), null);
});

test("TEST 7: 64 raw candidates + 0 qualifying findings -> EXPECTED: Candidates = 64, Verified Threats = 0, Radar remains BLUE", () => {
  const tone = threatAlertToneFromCounts({ total: 0, verified: 0 });
  assert.equal(tone, "cyan");

  const badge = threatAlertBadgeLabel({ mode: "running", tone });
  assert.equal(badge, "SCANNING");
});

test("TEST 8: 64 candidates + first qualifying explicit synthetic finding -> EXPECTED: Verified Threats = 1, Radar becomes RED HIGH ALERT", () => {
  const validThreat: ClientFinding = {
    id: "t1",
    url: "https://mrdeepfakes.com/video/123",
    finding_classification: "VERIFIED_EXPLICIT_DEEPFAKE",
    face_similarity: 96.5,
    is_synthetic: true,
    takedown_recommended: true,
  };

  const threatKind = classifyThreatFinding(validThreat);
  assert.equal(threatKind, "VERIFIED_DEEPFAKE");

  const tone = threatAlertToneFromCounts({ total: 1, verified: 1 });
  assert.equal(tone, "red");

  const badge = threatAlertBadgeLabel({ mode: "running", tone });
  assert.equal(badge, "🚨 HIGH ALERT");
});
