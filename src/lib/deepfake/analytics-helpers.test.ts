import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDomain,
  buildSourceIntelligenceList,
  buildIntelligenceSummaryMetrics,
  resolveDomainGeo,
} from "./analytics-helpers";
import type { ClientFinding } from "./results-dashboard";

test("normalizes domain variants to standard domain without www", () => {
  assert.equal(normalizeDomain("https://www.example.com/path/page"), "example.com");
  assert.equal(normalizeDomain("http://example.com"), "example.com");
  assert.equal(normalizeDomain("WWW.EXAMPLE.COM"), "example.com");
  assert.equal(normalizeDomain("https://sub.domain.com:8080/foo"), "sub.domain.com");
});

test("aggregates multiple URLs under the same normalized domain", () => {
  const mockFindings: ClientFinding[] = [
    {
      id: "f1",
      final_url: "https://www.example.com/video/1",
      verified_domain: "example.com",
      face_similarity: 90,
      synthetic_media_confidence: 98,
      explicit_media_confirmed: true,
      synthetic_media_confirmed: true,
      hosting_or_distribution_confirmed: true,
      matched_evidence: ["explicit_nudity"],
      risk_level: "CRITICAL",
      review_status: "new",
    },
    {
      id: "f2",
      final_url: "https://example.com/gallery/2",
      source_host: "example.com",
      face_similarity: 92,
      synthetic_media_confidence: 95,
      explicit_media_confirmed: true,
      synthetic_media_confirmed: true,
      hosting_or_distribution_confirmed: true,
      matched_evidence: ["face_swap"],
      risk_level: "HIGH",
      review_status: "queued_takedown",
    },
    {
      id: "f3",
      final_url: "https://another-site.com/image/1",
      source_host: "another-site.com",
      face_similarity: 88,
      synthetic_media_confidence: 96,
      explicit_media_confirmed: true,
      synthetic_media_confirmed: true,
      hosting_or_distribution_confirmed: true,
      matched_evidence: ["deepfake"],
      risk_level: "CRITICAL",
      review_status: "new",
    },
  ];

  const sources = buildSourceIntelligenceList(mockFindings);

  assert.equal(sources.length, 2);
  assert.equal(sources[0].domain, "example.com");
  assert.equal(sources[0].totalFindings, 2);
  assert.equal(sources[0].urls.length, 2);
  assert.equal(sources[1].domain, "another-site.com");
  assert.equal(sources[1].totalFindings, 1);
});

test("calculates truthful metrics from qualified findings", () => {
  const mockFindings: ClientFinding[] = [
    {
      id: "f1",
      final_url: "https://t.me/channel/123",
      source_host: "t.me",
      face_similarity: 95,
      synthetic_media_confidence: 99,
      explicit_media_confirmed: true,
      synthetic_media_confirmed: true,
      hosting_or_distribution_confirmed: true,
      matched_evidence: ["explicit_video"],
      risk_level: "CRITICAL",
      review_status: "queued_takedown",
    },
  ];

  const summary = buildIntelligenceSummaryMetrics(mockFindings);
  assert.equal(summary.verifiedThreats, 1);
  assert.equal(summary.affectedDomains, 1);
  assert.equal(summary.qualifyingUrls, 1);
  assert.equal(summary.countriesCount, 1); // Netherlands for Telegram
  assert.equal(summary.removalQueueCount, 1);
});

test("resolves reliable geolocations for known platforms and TLDs", () => {
  const tgGeo = resolveDomainGeo("t.me");
  assert.equal(tgGeo.country, "NL");
  assert.ok(tgGeo.hostingProvider.includes("Telegram"));

  const deGeo = resolveDomainGeo("site.de");
  assert.equal(deGeo.country, "DE");

  const unknownGeo = resolveDomainGeo("generic-unknown-host.com");
  assert.equal(unknownGeo.country, null);
  assert.equal(unknownGeo.countryFlag, "🌐");
});
