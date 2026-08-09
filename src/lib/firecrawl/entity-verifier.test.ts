import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSubjectIdentityProfile,
  verifySubjectEntity,
} from "./entity-verifier";

describe("Subject Entity Verification Engine Tests", () => {
  const profile = buildSubjectIdentityProfile("Bhama Kurup", ["Bhamaa", "Bhama"]);

  it("1. Rejects 'Rama Shama Bhama' movie title collision as NOT_SUBJECT", () => {
    const result = verifySubjectEntity(
      {
        title: "Veteran playwright Yashwant Sardeshpande wrote dialogues for Rama Shama Bhama",
        snippet: "He won state award for his dialogues for Rama Shama Bhama.",
        url: "https://www.reddit.com/r/ChitraLoka/comments/1ntiz2o/veteran_playwright/",
      },
      profile,
    );

    assert.equal(result.isVerifiedFinding, false);
    assert.equal(result.subjectMatchStatus, "NOT_SUBJECT");
    assert.ok(result.mismatchReasons.some((r) => r.includes("movie title")));
  });

  it("2. Rejects ''Oh Bhama Ayyo Rama' Movie Review' as NOT_SUBJECT", () => {
    const result = verifySubjectEntity(
      {
        title: "'Oh Bhama Ayyo Rama' Movie Review: An Earnest Suhas in a Charmless Rom-com",
        snippet: "A theatrical review of the movie Oh Bhama Ayyo Rama.",
        url: "https://www.hollywoodreporterindia.com/reviews/theatrical/oh-bhama-ayyo-rama-movie-review",
      },
      profile,
    );

    assert.equal(result.isVerifiedFinding, false);
    assert.equal(result.subjectMatchStatus, "NOT_SUBJECT");
    assert.ok(result.mismatchReasons.some((r) => r.includes("movie title")));
  });

  it("3. Rejects Bhavana / Bhvna name collision as NOT_SUBJECT", () => {
    const result = verifySubjectEntity(
      {
        title: "What exactly went down between PE10 and Bhvna? - Reddit",
        snippet: "Discussion about Bhavana and Dileep in Malayalam cinema.",
        url: "https://www.reddit.com/r/InsideMollywood/comments/1cgmf3c/what_exactly_went_down/",
      },
      profile,
    );

    assert.equal(result.isVerifiedFinding, false);
    assert.equal(result.subjectMatchStatus, "NOT_SUBJECT");
    assert.ok(result.mismatchReasons.some((r) => r.includes("Bhavana")));
  });

  it("4. Correctly verifies 'Bhama Kurup' exact full name in title as MATCH", () => {
    const result = verifySubjectEntity(
      {
        title: "Bhama Kurup Photos Gallery",
        snippet: "Latest photoshoot of Malayalam actress Bhama Kurup.",
        url: "https://www.youtube.com/watch?v=dT4X1JswUOg",
      },
      profile,
    );

    assert.equal(result.isVerifiedFinding, true);
    assert.ok(result.subjectMatchStatus === "VERIFIED_SUBJECT" || result.subjectMatchStatus === "MATCH");
    assert.ok(result.subjectMatchScore >= 70);
    assert.ok(result.matchReasons.some((r) => r.includes("Exact canonical full name")));
  });

  it("5. Correctly verifies Malayalam actress context ('Bhama') as PROBABLE_MATCH or MATCH", () => {
    const result = verifySubjectEntity(
      {
        title: "Malayalam movie actress bhama & singer shwetha singing together",
        snippet: "Famous Malayalam cinema actress Bhama appears in Thrissur fashion show.",
        url: "https://www.youtube.com/watch?v=Iclot6Ru54M",
      },
      profile,
    );

    assert.equal(result.isVerifiedFinding, true);
    assert.ok(
      result.subjectMatchStatus === "MATCH" ||
        result.subjectMatchStatus === "PROBABLE_MATCH" ||
        result.subjectMatchStatus === "VERIFIED_SUBJECT" ||
        result.subjectMatchStatus === "PROBABLE_SUBJECT",
    );
    assert.ok(result.subjectMatchScore >= 45);
  });
});
