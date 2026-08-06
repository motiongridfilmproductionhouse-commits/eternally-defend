import assert from "node:assert/strict";
import test from "node:test";
import { qualifiesForVerifiedExplicitFeed } from "./filter.server";
import { classifyThreatFinding, threatAlertToneFromCounts, threatAlertBadgeLabel } from "./threat-alert";
import type { ClientFinding } from "./results-dashboard";

test("TEST 1: Wikipedia biography -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const wikipedia: ClientFinding = {
    id: "wiki-1",
    url: "https://en.wikipedia.org/wiki/Manju_Pathrose",
    page_title: "Manju Pathrose - Wikipedia",
    snippet: "Manju Pathrose is an Indian actress who works in Malayalam films.",
    face_similarity: 95.0,
    is_synthetic: false,
    finding_classification: "BIOGRAPHY",
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(wikipedia), false);
  assert.equal(classifyThreatFinding(wikipedia), null);
});

test("TEST 2: Ordinary actress image -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const ordinaryPhoto: ClientFinding = {
    id: "photo-1",
    url: "https://example-news.com/photos/actress.jpg",
    page_title: "Manju Pathrose at Movie Event",
    snippet: "Official public photograph at film premiere.",
    face_similarity: 98.0,
    is_synthetic: false,
    takedown_recommended: false,
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(ordinaryPhoto), false);
  assert.equal(classifyThreatFinding(ordinaryPhoto), null);
});

test("TEST 3: News article mentioning deepfake -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const newsArticle: ClientFinding = {
    id: "news-1",
    url: "https://www.asianetnews.com/entertainment/actress-manju-pathrose-deepfake-news",
    page_title: "Actress speaks out against deepfakes",
    snippet: "Asianet News article discussing deepfake awareness.",
    face_similarity: 90.0,
    is_synthetic: false,
    finding_classification: "NEWS",
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(newsArticle), false);
  assert.equal(classifyThreatFinding(newsArticle), null);
});

test("TEST 4: Adult host page without face verification -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const noFaceVerification: ClientFinding = {
    id: "adult-noface",
    url: "https://mrdeepfakes.com/video/unrelated-actor",
    page_title: "Explicit AI video",
    snippet: "Explicit AI video",
    face_similarity: null, // Face comparison did not run
    is_synthetic: true,
    finding_classification: "SYNTHETIC_IMAGE",
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(noFaceVerification), false);
  assert.equal(classifyThreatFinding(noFaceVerification), null);
});

test("TEST 5: Face match 60% -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const lowFaceMatch: ClientFinding = {
    id: "low-face-1",
    url: "https://mrdeepfakes.com/video/other-person",
    page_title: "Explicit AI video",
    snippet: "AI video featuring different individual.",
    face_similarity: 60.0,
    is_synthetic: true,
    finding_classification: "SYNTHETIC_IMAGE",
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(lowFaceMatch), false);
  assert.equal(classifyThreatFinding(lowFaceMatch), null);
});

test("TEST 6: Face match 92% + explicit confirmed + synthetic confirmed + hosting confirmed -> EXPECTED: PROBABLE_EXPLICIT_DEEPFAKE", () => {
  const probableExplicit: ClientFinding = {
    id: "probable-1",
    url: "https://terabox.com/file/manju-pathrose-ai",
    source_host: "terabox.com",
    page_title: "Manju Pathrose AI Nude File",
    snippet: "Explicit AI generated face swap mirror file.",
    face_similarity: 92.0,
    confidence: 92.0,
    is_synthetic: true,
    explicit_media_confirmed: true,
    synthetic_media_confirmed: true,
    hosting_or_distribution_confirmed: true,
    finding_classification: "PROBABLE_EXPLICIT_DEEPFAKE",
    takedown_recommended: true,
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(probableExplicit), true);
  assert.equal(classifyThreatFinding(probableExplicit), "PROBABLE_DEEPFAKE");
});

test("TEST 7: Face match 97% + explicit confirmed + synthetic confirmed + hosting confirmed -> EXPECTED: VERIFIED_EXPLICIT_DEEPFAKE", () => {
  const verifiedExplicit: ClientFinding = {
    id: "verified-1",
    url: "https://mrdeepfakes.com/video/manju-pathrose-ai-nude",
    source_host: "mrdeepfakes.com",
    page_title: "Manju Pathrose AI Nude Video",
    snippet: "Explicit AI generated face swap video.",
    face_similarity: 97.8,
    confidence: 97.8,
    is_synthetic: true,
    explicit_media_confirmed: true,
    synthetic_media_confirmed: true,
    hosting_or_distribution_confirmed: true,
    finding_classification: "VERIFIED_EXPLICIT_DEEPFAKE",
    takedown_recommended: true,
  };
  assert.equal(qualifiesForVerifiedExplicitFeed(verifiedExplicit), true);
  assert.equal(classifyThreatFinding(verifiedExplicit), "VERIFIED_DEEPFAKE");
});

test("TEST 8: Query contains nude/deepfake but analysis not run -> EXPECTED: NOT VISIBLE IN MAIN FEED", () => {
  const unanalyzedQueryHit: ClientFinding = {
    id: "unanalyzed-1",
    url: "https://example.com/page",
    page_title: "Explicit AI image candidate search result",
    snippet: "Snippet text containing keywords",
    face_similarity: null,
    is_synthetic: null,
  };
  assert.equal(unanalyzedQueryHit.face_similarity, null);
  assert.equal(unanalyzedQueryHit.is_synthetic, null);
  assert.equal(qualifiesForVerifiedExplicitFeed(unanalyzedQueryHit), false);
  assert.equal(classifyThreatFinding(unanalyzedQueryHit), null);
});

test("TEST 9: 100 raw candidates, 0 verified explicit findings -> EXPECTED: Primary feed empty, Radar blue", () => {
  const tone = threatAlertToneFromCounts({ total: 0, verified: 0 });
  assert.equal(tone, "cyan");

  const badge = threatAlertBadgeLabel({ mode: "running", tone });
  assert.equal(badge, "SCANNING");
});

test("TEST 10: First verified explicit finding persisted -> EXPECTED: Main feed count = 1, Radar red HIGH ALERT", () => {
  const validThreat: ClientFinding = {
    id: "t10",
    url: "https://mrdeepfakes.com/video/100",
    finding_classification: "VERIFIED_EXPLICIT_DEEPFAKE",
    face_similarity: 96.5,
    is_synthetic: true,
    explicit_media_confirmed: true,
    synthetic_media_confirmed: true,
    hosting_or_distribution_confirmed: true,
    takedown_recommended: true,
  };

  assert.equal(qualifiesForVerifiedExplicitFeed(validThreat), true);
  assert.equal(classifyThreatFinding(validThreat), "VERIFIED_DEEPFAKE");

  const tone = threatAlertToneFromCounts({ total: 1, verified: 1 });
  assert.equal(tone, "red");

  const badge = threatAlertBadgeLabel({ mode: "running", tone });
  assert.equal(badge, "🚨 HIGH ALERT");
});
