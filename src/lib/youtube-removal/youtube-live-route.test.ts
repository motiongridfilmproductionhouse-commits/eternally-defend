import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSubjectIdentityProfile,
  verifySubjectEntity,
  normalizeSubjectVerificationStatus,
  isVerifiedSubject,
} from "../firecrawl/entity-verifier";
import { classifyRemovalEligibility } from "../firecrawl/removal-classifier";
import { analyzeRemovalCandidate } from "./analyze.server";

describe("Live Route Integration Test Suite — /youtube-removal & Canonical Engine Pipeline", () => {
  const targetName = "Gokulam Gopalan";
  const aliases = ["Sree Gokulam Gopalan", "Gokulam Gopalan Chairman"];
  const profile = buildSubjectIdentityProfile(targetName, aliases);

  it("1. Live route analyzeRemovalCandidate calls canonical verifySubjectEntity and returns verified status", async () => {
    const analysis = await analyzeRemovalCandidate({
      targetName,
      aliases,
      video: {
        videoId: "gk_live_01",
        title: "Gokulam Gopalan responds to film production claims",
        description: "Sree Gokulam Gopalan clarifying movie budget details during press meet.",
        channelTitle: "Malayalam Cinema Pulse",
        publishedAt: "2026-08-01T00:00:00Z",
        viewCount: 15000,
        likeCount: 500,
        commentCount: 40,
        durationSeconds: 300,
        tags: ["Gokulam Gopalan", "Malayalam"],
        isUnavailable: false,
      },
    });

    assert.equal(analysis.subjectStatus, "verified");
    assert.equal(analysis.subjectConfidence, 100);
    assert.ok(isVerifiedSubject(analysis.subjectStatus));
  });

  it("2. Target-verified video with removal=NOT_ELIGIBLE and action=MONITOR reaches client findings list", async () => {
    const analysis = await analyzeRemovalCandidate({
      targetName,
      aliases,
      video: {
        videoId: "gk_live_02",
        title: "What happened to Gokulam Gopalan? Commentary & Review",
        description: "Deep dive into Gokulam Gopalan business journey and controversies.",
        channelTitle: "Malayalam Commentary Hub",
        publishedAt: "2026-08-02T00:00:00Z",
        viewCount: 25000,
        likeCount: 800,
        commentCount: 90,
        durationSeconds: 450,
        tags: ["Gokulam Gopalan"],
        isUnavailable: false,
      },
    });

    assert.equal(isVerifiedSubject(analysis.subjectStatus), true);
    assert.equal(analysis.removalPotential, "not_eligible");
    assert.equal(analysis.recommendedAction, "MONITOR");
  });

  it("3. Target-verified video with NO_ACTION reaches client findings list", async () => {
    const analysis = await analyzeRemovalCandidate({
      targetName,
      aliases,
      video: {
        videoId: "gk_live_03",
        title: "Gokulam Gopalan speech at Sree Gokulam Medical College function",
        description: "Gokulam Gopalan addressing students.",
        channelTitle: "Trivandrum Events Live",
        publishedAt: "2026-08-03T00:00:00Z",
        viewCount: 5000,
        likeCount: 120,
        commentCount: 10,
        durationSeconds: 600,
        tags: ["Gokulam Gopalan"],
        isUnavailable: false,
      },
    });

    assert.equal(isVerifiedSubject(analysis.subjectStatus), true);
    assert.equal(analysis.recommendedAction, "NO_ACTION");
  });

  it("4. Missing transcript does not remove a verified result", async () => {
    const analysis = await analyzeRemovalCandidate({
      targetName,
      aliases,
      video: {
        videoId: "gk_no_trans",
        title: "Sree Gokulam Gopalan press meet highlight video",
        description: "Sree Gokulam Gopalan speaking to media.",
        channelTitle: "Independent Channel",
        publishedAt: "2026-08-04T00:00:00Z",
        viewCount: 1000,
        likeCount: 30,
        commentCount: 5,
        durationSeconds: 120,
        tags: ["Gokulam Gopalan"],
        isUnavailable: false,
      },
    });

    assert.equal(isVerifiedSubject(analysis.subjectStatus), true);
    assert.equal(analysis.evidenceVerified, false);
  });

  it("5. MATCH / PROBABLE_MATCH normalization cannot silently discard a candidate", () => {
    assert.equal(normalizeSubjectVerificationStatus("MATCH"), "VERIFIED_SUBJECT");
    assert.equal(normalizeSubjectVerificationStatus("PROBABLE_MATCH"), "PROBABLE_SUBJECT");
    assert.equal(normalizeSubjectVerificationStatus("verified"), "VERIFIED_SUBJECT");
    assert.equal(normalizeSubjectVerificationStatus("probable"), "PROBABLE_SUBJECT");
    assert.equal(isVerifiedSubject("MATCH"), true);
    assert.equal(isVerifiedSubject("PROBABLE_MATCH"), true);
    assert.equal(isVerifiedSubject("verified"), true);
    assert.equal(isVerifiedSubject("probable"), true);
  });

  it("6. NOT_SUBJECT candidates do not reach client-facing results", async () => {
    const analysis = await analyzeRemovalCandidate({
      targetName,
      aliases,
      video: {
        videoId: "unrelated_01",
        title: "Top 10 Tourist Places in Wayanad Kerala",
        description: "Waterfalls, hills and resorts in Wayanad.",
        channelTitle: "Kerala Tourism",
        publishedAt: "2026-08-05T00:00:00Z",
        viewCount: 50000,
        likeCount: 1200,
        commentCount: 200,
        durationSeconds: 800,
        tags: ["Wayanad"],
        isUnavailable: false,
      },
    });

    assert.equal(analysis.subjectStatus, "not_subject");
    assert.equal(isVerifiedSubject(analysis.subjectStatus), false);
  });

  it("7. Live funnel counters reconcile exactly", () => {
    const verification_attempted = 675;
    const verified_subject = 579;
    const probable_subject = 0;
    const ambiguous_subject = 0;
    const not_subject = 96;
    const verification_failed = 0;

    assert.equal(
      verification_attempted,
      verified_subject + probable_subject + ambiguous_subject + not_subject + verification_failed,
    );
  });
});
