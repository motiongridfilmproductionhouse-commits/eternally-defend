import assert from "node:assert/strict";
import test from "node:test";
import {
  isNeverDisplayHost,
  verifyIllegalDistribution,
} from "./verified-distribution";

const verifiedEvidence = {
  client_visible: true,
  distribution: {
    classification: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
    strong_evidence: true,
    client_visible: true,
    identity_evidence: ["exact title"],
    access_evidence: ["download button"],
  },
};

test("mainstream platforms are never displayable", () => {
  for (const host of [
    "instagram.com",
    "www.facebook.com",
    "x.com",
    "reddit.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",
    "linkedin.com",
    "open.spotify.com",
    "imdb.com",
    "en.wikipedia.org",
    "google.com",
    "hotstar.com",
    "ndtv.com",
  ]) {
    assert.equal(isNeverDisplayHost(host), true, host);
  }
  for (const host of ["ogomovies1.com.pk", "t.me", "mega.nz", "1337x.to", "archive.org"]) {
    assert.equal(isNeverDisplayHost(host), false, host);
  }
});

test("verified piracy download page passes the gate", () => {
  const verdict = verifyIllegalDistribution({
    source_url: "https://ogomovies1.com.pk/movie/pluto",
    detection_type: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
    confidence: 92,
    evidence: verifiedEvidence,
  });
  assert.equal(verdict.verified, true);
});

test("searched-only platform is excluded even with high confidence", () => {
  const verdict = verifyIllegalDistribution({
    source_url: "https://www.instagram.com/p/abc",
    detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
    confidence: 99,
    evidence: verifiedEvidence,
  });
  assert.equal(verdict.verified, false);
  assert.equal(verdict.reason, "platform_not_displayable");
});

test("unreachable, low-confidence, official and evidence-free pages are excluded", () => {
  assert.equal(
    verifyIllegalDistribution({
      source_url: "https://movierulz.example/x",
      detection_type: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
      confidence: 95,
      evidence: { ...verifiedEvidence, crawl_failed: true },
    }).reason,
    "not_publicly_accessible",
  );
  assert.equal(
    verifyIllegalDistribution({
      source_url: "https://movierulz.example/x",
      detection_type: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
      confidence: 41,
      evidence: verifiedEvidence,
    }).reason,
    "below_threshold",
  );
  assert.equal(
    verifyIllegalDistribution({
      source_url: "https://studio.example/movie",
      detection_type: "OFFICIAL_OR_AUTHORIZED",
      confidence: 95,
      evidence: { distribution: { classification: "OFFICIAL_OR_AUTHORIZED" } },
    }).reason,
    "official_or_authorized",
  );
  assert.equal(
    verifyIllegalDistribution({
      source_url: "https://blog.example/review",
      detection_type: "REVIEW_OR_NEWS",
      confidence: 95,
      evidence: {},
    }).verified,
    false,
  );
});

test("cloud storage link needs the protected file, not a mention", () => {
  const weak = verifyIllegalDistribution({
    source_url: "https://mega.nz/folder/abc",
    detection_type: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
    confidence: 88,
    evidence: {
      distribution: {
        classification: "VERIFIED_UNAUTHORIZED_DOWNLOAD",
        identity_evidence: ["title mention"],
        access_evidence: ["link"],
      },
    },
  });
  assert.equal(weak.verified, false);
  assert.equal(weak.reason, "no_distribution_evidence");
});
