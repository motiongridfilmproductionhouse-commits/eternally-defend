import assert from "node:assert/strict";
import test from "node:test";
import type { ScanHit } from "@/routes/api/scan";
import { classifyWithEvidence } from "./evidence-classifier";
import { splitForPresentation, presentationTabFor } from "./presentation-filter";
import { canonicalCategoryFor, sortScanHitsByThreat } from "./ranking.server";
import { analysisStatusLabel, type HitLike } from "@/components/scan/PersistedResultCard";

/* ------------------------------------------------------------------ *
 * 1-3. Ordinary entertainment content must stay neutral / All Mentions,
 * regardless of how emphatic the title/description is, and must never be
 * force-classified as risk purely from keywords like "review".
 * ------------------------------------------------------------------ */

test("neutral full movie is a neutral mention with no risk evidence", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Shane Nigam Full Movie - Kettiyollaanu Ente Malakha | Full Movie HD",
    description: "Watch the full movie starring Shane Nigam. Comedy scene, climax, best scenes.",
    identityTier: "VERIFIED",
  });
  assert.equal(verdict.tier, "TIER_1_NEUTRAL");
  assert.equal(verdict.evidence.riskEvidenceFound, false);
  assert.equal(verdict.inRiskFeed, false);
  assert.equal(verdict.reputationRisk, 0);
});

test("neutral trailer is a neutral mention with no risk evidence", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Shane Nigam's Next - Official Trailer",
    description: "Trailer launch for the upcoming film starring Shane Nigam.",
    identityTier: "VERIFIED",
  });
  assert.equal(verdict.tier, "TIER_1_NEUTRAL");
  assert.equal(verdict.contentType, "TRAILER");
  assert.equal(verdict.evidence.riskEvidenceFound, false);
  assert.equal(verdict.reputationRisk, 0);
});

test("generic movie review is a neutral mention, not risk, despite the word 'review'", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Shane Nigam Movie Review | Public Review | FDFS",
    description: "Honest review of the new Shane Nigam movie, theatre response and rating.",
    identityTier: "VERIFIED",
  });
  assert.equal(verdict.tier, "TIER_1_NEUTRAL");
  assert.equal(verdict.contentType, "MOVIE_REVIEW");
  assert.equal(verdict.evidence.riskEvidenceFound, false);
});

/* ------------------------------------------------------------------ *
 * 4-5. Evidence-backed findings (full content, subject-directed assertion)
 * clear the confidence threshold and enter the risk feed.
 * ------------------------------------------------------------------ */

test("evidence-backed Reddit-style allegation with full content reaches Reputation Risk", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Discussion thread",
    description: "See thread",
    pageText:
      "A formal complaint was filed against Shane Nigam alleging misconduct on set. The FIR was registered against Shane Nigam this week following the complaint.",
    author: "u/malayalam_movie_fan",
    identityTier: "VERIFIED",
    identityConfidence: 92,
  });
  assert.equal(verdict.evidence.riskEvidenceFound, true);
  assert.ok(verdict.tier === "TIER_3_REPUTATION_RISK" || verdict.tier === "TIER_4_HIGH_RISK");
  assert.equal(verdict.inRiskFeed, true);
  assert.ok(verdict.evidence.confidence >= 0.6);
});

test("evidence-backed news legal dispute with full content reaches Reputation Risk", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Court case update",
    description: "Legal update",
    pageText:
      "A lawsuit was filed against Shane Nigam this week. The court case against Shane Nigam is scheduled for next month after producers filed a legal notice.",
    author: "News Desk",
    identityTier: "VERIFIED",
    identityConfidence: 95,
  });
  assert.equal(verdict.evidence.riskEvidenceFound, true);
  assert.equal(verdict.classification, "REPUTATION_RISK");
  assert.equal(verdict.inRiskFeed, true);
});

/* ------------------------------------------------------------------ *
 * 6. Metadata-only signal (no full content retrieved) is held for human
 * review — it must never jump straight to Reputation Risk.
 * ------------------------------------------------------------------ */

test("metadata-only suspicious title is Needs Review, not Reputation Risk", () => {
  const verdict = classifyWithEvidence({
    target: "Shane Nigam",
    title: "Shane Nigam accused in new controversy — details inside",
    description: "Short teaser description only.",
    identityTier: "PROBABLE",
  });
  assert.equal(verdict.evidence.riskEvidenceFound, false);
  assert.equal(verdict.classification, "NEEDS_REVIEW");
  assert.equal(verdict.tier, "TIER_2_NEEDS_REVIEW");
  assert.equal(verdict.inRiskFeed, false);
  assert.equal(presentationTabForVerdict(verdict), "NEEDS_REVIEW");
});

function presentationTabForVerdict(v: ReturnType<typeof classifyWithEvidence>) {
  return v.tier === "TIER_2_NEEDS_REVIEW"
    ? "NEEDS_REVIEW"
    : v.evidence.riskEvidenceFound
      ? "REPUTATION_RISK"
      : "ALL_MENTIONS";
}

/* ------------------------------------------------------------------ *
 * 9. Source type alone must never cause a risk classification — only the
 * retrieved content matters. Identical evidence text must classify the
 * same regardless of which platform / channel style it came from.
 * ------------------------------------------------------------------ */

test("source type alone never causes risk classification", () => {
  const neutralText = {
    title: "Shane Nigam Official Interview - Full Conversation",
    description: "In conversation with Shane Nigam about his upcoming projects.",
  };
  const asYouTubeOfficial = classifyWithEvidence({
    target: "Shane Nigam",
    ...neutralText,
    author: "Manorama Entertainment Official Channel",
    identityTier: "VERIFIED",
  });
  const asRedditUser = classifyWithEvidence({
    target: "Shane Nigam",
    ...neutralText,
    author: "u/randomredditor",
    identityTier: "VERIFIED",
  });
  assert.equal(asYouTubeOfficial.tier, asRedditUser.tier);
  assert.equal(asYouTubeOfficial.evidence.riskEvidenceFound, false);
  assert.equal(asRedditUser.evidence.riskEvidenceFound, false);

  const riskyText = {
    title: "Update on the case",
    pageText:
      "Police booked Shane Nigam for assault after a complaint was lodged against Shane Nigam by a fan outside a cinema hall in Kochi. The case is now under investigation by local authorities.",
  };
  const riskFromYouTubeAuthor = classifyWithEvidence({
    target: "Shane Nigam",
    ...riskyText,
    author: "Manorama Entertainment Official Channel",
    identityTier: "VERIFIED",
    identityConfidence: 92,
  });
  const riskFromRedditAuthor = classifyWithEvidence({
    target: "Shane Nigam",
    ...riskyText,
    author: "u/randomredditor",
    identityTier: "VERIFIED",
    identityConfidence: 92,
  });
  assert.equal(riskFromYouTubeAuthor.tier, riskFromRedditAuthor.tier);
  assert.equal(riskFromYouTubeAuthor.evidence.riskEvidenceFound, true);
  assert.equal(riskFromRedditAuthor.evidence.riskEvidenceFound, true);
});

/* ------------------------------------------------------------------ *
 * 7. Ranking: evidence-backed risk must rank above neutral entertainment,
 * even when the neutral item is a YouTube upload from an "official"-
 * sounding channel and the risk item comes from a non-YouTube source.
 * ------------------------------------------------------------------ */

const baseHit = (overrides: Partial<ScanHit>): ScanHit => ({
  id: overrides.id || `hit-${Math.random()}`,
  title: "Sample title",
  url: "https://example.com/item",
  description: "Sample description",
  platform: "Web",
  source: "Web",
  author: "Author",
  published: "2026-08-05T12:00:00Z",
  discoveredAt: "2026-08-05T12:00:00Z",
  lastChecked: "2026-08-05T12:00:00Z",
  category: "Mention",
  contentLabel: "Neutral mention",
  severity: "Low",
  sentiment: "Neutral",
  confidence: 80,
  threatScore: 10,
  credibilityScore: 70,
  viralityScore: 30,
  copyrightRisk: 0,
  reputationRisk: 0,
  reachEstimate: 1000,
  engagement: 50,
  recommendedAction: "No action indicated; retained for coverage and search",
  keywords: [],
  language: "en",
  freshnessWindow: "7d",
  ...overrides,
});

test("evidence-backed risk ranks above neutral entertainment regardless of source", () => {
  const neutralYouTube = baseHit({
    id: "yt-entertainment",
    title: "Official Trailer - Shane Nigam's Next",
    source: "YouTube",
    author: "Manorama Entertainment Official Channel",
    category: "Mention",
    contentLabel: "Neutral mention",
    severity: "Low",
    threatScore: 8,
    classificationTier: "TIER_1_NEUTRAL",
    riskClassification: "ENTERTAINMENT_MENTION",
    riskEvidence: {
      subjectMatched: true,
      riskEvidenceFound: false,
      riskCategory: null,
      evidenceText: null,
      evidenceSource: "none",
      confidence: 0,
      reason: "Ordinary entertainment content; no reputation-impacting claim found.",
    },
  });

  const evidenceBackedReddit = baseHit({
    id: "reddit-allegation",
    title: "Discussion thread",
    source: "Reddit",
    author: "u/malayalam_movie_fan",
    category: "Allegation",
    contentLabel: "Allegation",
    severity: "High",
    threatScore: 74,
    classificationTier: "TIER_3_REPUTATION_RISK",
    riskClassification: "REPUTATION_RISK",
    riskEvidence: {
      subjectMatched: true,
      riskEvidenceFound: true,
      riskCategory: "ALLEGATION",
      evidenceText: "A complaint was filed against the subject.",
      evidenceSource: "page_content",
      confidence: 0.82,
      reason: "The retrieved page content makes a specific allegation concerning the subject.",
    },
  });

  // canonicalCategoryFor must trust the evidence verdict, not the "Official
  // ... Channel" author text — neither hit should be misclassified as risk.
  assert.equal(canonicalCategoryFor(neutralYouTube), "neutral_mention");
  assert.equal(canonicalCategoryFor(evidenceBackedReddit), "defamation");

  const sorted = sortScanHitsByThreat([neutralYouTube, evidenceBackedReddit]);
  assert.equal(sorted[0].id, "reddit-allegation");
  assert.equal(sorted[1].id, "yt-entertainment");

  // The evidence-backed hit's severity/category must survive ranking intact —
  // it must not be silently demoted because its ranking neighbor is official.
  assert.equal(evidenceBackedReddit.severity, "High");
  assert.equal(evidenceBackedReddit.category, "Allegation");
});

test("splitForPresentation routes evidence-gated hits to the correct tab", () => {
  const neutral = baseHit({
    id: "neutral-1",
    classificationTier: "TIER_1_NEUTRAL",
    riskEvidence: {
      subjectMatched: true,
      riskEvidenceFound: false,
      riskCategory: null,
      evidenceText: null,
      evidenceSource: "none",
      confidence: 0,
      reason: "neutral",
    },
  });
  const needsReview = baseHit({
    id: "review-1",
    classificationTier: "TIER_2_NEEDS_REVIEW",
    riskEvidence: {
      subjectMatched: true,
      riskEvidenceFound: false,
      riskCategory: "ALLEGATION",
      evidenceText: "possible signal",
      evidenceSource: "title",
      confidence: 0.5,
      reason: "metadata only",
    },
  });
  const risk = baseHit({
    id: "risk-1",
    classificationTier: "TIER_3_REPUTATION_RISK",
    riskEvidence: {
      subjectMatched: true,
      riskEvidenceFound: true,
      riskCategory: "ALLEGATION",
      evidenceText: "confirmed",
      evidenceSource: "page_content",
      confidence: 0.8,
      reason: "confirmed allegation",
    },
  });

  const buckets = splitForPresentation([neutral, needsReview, risk]);
  assert.equal(presentationTabFor(neutral), "ALL_MENTIONS");
  assert.equal(presentationTabFor(needsReview), "NEEDS_REVIEW");
  assert.equal(presentationTabFor(risk), "REPUTATION_RISK");
  assert.equal(
    buckets.reputationRisk.some((h) => h.id === "risk-1"),
    true,
  );
  assert.equal(
    buckets.needsReview.some((h) => h.id === "review-1"),
    true,
  );
  // All Mentions is the full corpus view — nothing is ever deleted from it.
  assert.equal(buckets.allMentions.length, 3);
});

/* ------------------------------------------------------------------ *
 * 8. "Evidence analysis pending" must only ever describe a genuinely
 * unrecorded classification, never a completed neutral verdict.
 * ------------------------------------------------------------------ */

const baseCard = (overrides: Partial<HitLike>): HitLike => ({
  id: "card-1",
  title: "Title",
  description: "Description",
  permalink: "https://example.com",
  canonical_url: "https://example.com",
  source: "YouTube",
  source_type: "youtube_video",
  author: "Author",
  thumbnail_url: null,
  published_at: null,
  reach: 0,
  engagement: 0,
  threat_score: 0,
  severity: "Low",
  narrative_claim: null,
  risk_type: null,
  tags: [],
  first_seen_at: "2026-08-01T00:00:00Z",
  last_seen_at: "2026-08-01T00:00:00Z",
  times_detected: 1,
  is_new_since_last_scan: false,
  ...overrides,
});

test("completed neutral analysis shows an accurate final state, not 'pending'", () => {
  const hit = baseCard({ classification_tier: "TIER_1_NEUTRAL", risk_evidence_found: false });
  const label = analysisStatusLabel(hit);
  assert.equal(label, "No reputation-risk evidence detected");
  assert.notEqual(label, "Evidence analysis pending");
});

test("evidence-backed risk shows a risk-recorded state, not 'pending'", () => {
  const hit = baseCard({
    classification_tier: "TIER_3_REPUTATION_RISK",
    risk_evidence_found: true,
  });
  const label = analysisStatusLabel(hit);
  assert.equal(label, "Evidence-backed reputation risk recorded");
  assert.notEqual(label, "Evidence analysis pending");
});

test("needs-review analysis shows a review-flagged state, not 'pending'", () => {
  const hit = baseCard({ classification_tier: "TIER_2_NEEDS_REVIEW", risk_evidence_found: false });
  const label = analysisStatusLabel(hit);
  assert.match(label, /human review/i);
  assert.notEqual(label, "Evidence analysis pending");
});

test("rows with no recorded classification are described as unrecorded, not 'pending'", () => {
  const hit = baseCard({ classification_tier: null, risk_evidence_found: null });
  const label = analysisStatusLabel(hit);
  assert.equal(label, "Analysis not recorded for this result");
  assert.notEqual(label, "Evidence analysis pending");
});
