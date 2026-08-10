import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MovieReferenceIdentity,
  CandidateContentItem,
  verifyTargetReferenceIdentity,
  computePerceptualHashSimilarity,
} from "./reference-verifier";

describe("Copyright Intelligence — Reference-Verified Movie Detection Test Suite", () => {
  const protectedMovie: MovieReferenceIdentity = {
    assetId: "movie-asset-dc-2026",
    canonicalTitle: "DC Tamil Movie 2026",
    alternateTitles: ["DC Tamil", "DC 2026 Tamil"],
    year: 2026,
    language: "Tamil",
    cast: ["Actor Vijay", "Actress Trisha"],
    characters: ["Hero", "Heroine"],
    posterImages: [
      { url: "https://eterna.ai/posters/dc_poster.jpg", pHash: "f0f0a5a512345678" },
    ],
    referenceVideoFrames: [
      { url: "https://eterna.ai/frames/scene1.jpg", pHash: "1122334455667788" },
      { url: "https://eterna.ai/frames/scene2.jpg", pHash: "8877665544332211" },
    ],
  };

  it("Test A: Correct title + correct poster yields VERIFIED_TARGET", () => {
    const candidate: CandidateContentItem = {
      candidateId: "cand-1",
      url: "https://piracy.com/dc-tamil-movie",
      title: "DC Tamil Movie 2026 Full HD Stream",
      candidateHash: "f0f0a5a512345678", // Exact poster pHash
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, candidate);
    assert.equal(outcome.targetStatus, "VERIFIED_TARGET");
    assert.ok(outcome.targetIdentityScore >= 75);
    assert.ok(outcome.matchedSignals.includes("VISUAL_POSTER_MATCH"));
  });

  it("Test B (Spider-Man Problem): Similar title + Spider-Man poster yields NOT_SUBJECT", () => {
    const spiderManCandidate: CandidateContentItem = {
      candidateId: "cand-spiderman",
      url: "https://dailymotion.com/video/x9999",
      title: "dc tamil movie 2026 - Spiderman scene upload",
      candidateHash: "0000ffff0000ffff", // Conflicting Spider-Man poster pHash!
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, spiderManCandidate);
    assert.equal(outcome.targetStatus, "NOT_SUBJECT");
    assert.ok(outcome.targetIdentityScore < 35);
    assert.ok(outcome.matchedSignals.includes("VISUAL_IDENTITY_CONFLICT"));
  });

  it("Test C (Renamed Title): Completely renamed title + exact movie poster yields VERIFIED_TARGET", () => {
    const renamedCandidate: CandidateContentItem = {
      candidateId: "cand-renamed",
      url: "https://piracy.com/watch?v=123",
      title: "New Tamil Full Movie HD 2026 Watch Online", // Title match low
      candidateHash: "f0f0a5a512345678", // Exact poster pHash match!
      isPiracyDomain: true,
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, renamedCandidate);
    assert.equal(outcome.targetStatus, "VERIFIED_TARGET");
    assert.ok(outcome.targetIdentityScore >= 75);
    assert.ok(outcome.matchedSignals.includes("VISUAL_POSTER_MATCH"));
  });

  it("Test D (Renamed Title + Frame Match): Renamed title + matching video frames yields VERIFIED_TARGET", () => {
    const frameCandidate: CandidateContentItem = {
      candidateId: "cand-frame",
      url: "https://stream.com/v/99",
      title: "Blockbuster Action Movie Tamil 2026",
      extractedFrameHashes: ["1122334455667788"], // Matches scene1 frame pHash!
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, frameCandidate);
    assert.equal(outcome.targetStatus, "VERIFIED_TARGET");
    assert.ok(outcome.targetIdentityScore >= 75);
    assert.ok(outcome.matchedSignals.includes("VISUAL_FRAME_MATCH"));
  });

  it("Test E (Same Actor in Different Movie): Cast face match alone does NOT verify wrong movie", () => {
    const otherMovieCandidate: CandidateContentItem = {
      candidateId: "cand-other-movie",
      url: "https://piracy.com/leo-movie",
      title: "Leo Tamil Movie Full HD 2023",
      candidateHash: "aaaa5555bbbb6666", // Conflicting poster hash
      detectedCast: ["Actor Vijay"], // Same actor, different movie
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, otherMovieCandidate);
    assert.equal(outcome.targetStatus, "NOT_SUBJECT");
    assert.ok(outcome.targetIdentityScore < 35);
  });

  it("Test F (Piracy Domain Reputation): Piracy domain increases PIRACY_RISK_SCORE, NOT TARGET_IDENTITY_SCORE", () => {
    const unrelatedPiracyCandidate: CandidateContentItem = {
      candidateId: "cand-piracy-unrelated",
      url: "https://known-piracy-site.org/movie/123",
      title: "Unrelated Horror Movie 2025",
      candidateHash: "9999888877776666",
      isPiracyDomain: true,
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, unrelatedPiracyCandidate);
    assert.equal(outcome.targetStatus, "NOT_SUBJECT");
    assert.ok(outcome.piracyRiskScore >= 75); // Piracy risk is high
    assert.ok(outcome.targetIdentityScore < 35); // Target identity is NOT inflated!
  });

  it("Test G (Cropped / Watermarked Poster): pHash similarity detects match despite watermark", () => {
    // 14/16 chars match = 87.5% similarity
    const watermarkedHash = "f0f0a5a512345600";
    const sim = computePerceptualHashSimilarity("f0f0a5a512345678", watermarkedHash);
    assert.ok(sim >= 85);

    const candidate: CandidateContentItem = {
      candidateId: "cand-watermarked",
      url: "https://piracy.com/dc-watermarked",
      title: "DC Tamil Movie 2026",
      candidateHash: watermarkedHash,
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, candidate);
    assert.equal(outcome.targetStatus, "VERIFIED_TARGET");
  });

  it("Test H (Historical Seed Re-verification): Historical URL belonging to another movie is rejected", () => {
    const historicalSeed: CandidateContentItem = {
      candidateId: "hist-seed-1",
      url: "https://piracy.com/old-seed",
      title: "Spider-Man No Way Home Stream",
      candidateHash: "1111222233334444",
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, historicalSeed);
    assert.equal(outcome.targetStatus, "NOT_SUBJECT");
  });

  it("Test I (No Visual Reference Available): Records VISUAL_REFERENCE_UNAVAILABLE signal and falls back to metadata", () => {
    const movieWithoutVisuals: MovieReferenceIdentity = {
      assetId: "movie-no-visuals",
      canonicalTitle: "DC Tamil Movie 2026",
      alternateTitles: [],
      cast: [],
      characters: [],
      posterImages: [],
    };

    const candidate: CandidateContentItem = {
      candidateId: "cand-no-vis",
      url: "https://piracy.com/dc-tamil-movie",
      title: "DC Tamil Movie 2026 Full Stream",
    };

    const outcome = verifyTargetReferenceIdentity(movieWithoutVisuals, candidate);
    assert.ok(outcome.matchedSignals.includes("VISUAL_REFERENCE_UNAVAILABLE"));
    assert.ok(outcome.targetIdentityScore >= 75);
  });

  it("Test J (Tiered Visual Verification): Secondary verification boosts ambiguous pHash range (40..74%)", () => {
    // Hash with 10 matching characters out of 16 => base pHash 62.5% -> boosted by 10 to 72.5%
    const ambiguousHash = "f0f0a5a512340000";
    const candidate: CandidateContentItem = {
      candidateId: "cand-ambiguous",
      url: "https://piracy.com/dc-ambiguous",
      title: "DC Tamil Movie 2026 HD",
      candidateHash: ambiguousHash,
    };

    const outcome = verifyTargetReferenceIdentity(protectedMovie, candidate);
    assert.ok(outcome.posterSimilarity >= 70);
  });
});

