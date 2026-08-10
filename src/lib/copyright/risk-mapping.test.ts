import assert from "node:assert/strict";
import test from "node:test";
import { mapFindingToRiskProps, detectPrintLeakType } from "./risk-mapping";

test("Risk Mapping: handles undefined or null finding without throwing", () => {
  const resUndefined = mapFindingToRiskProps(undefined);
  assert.equal(resUndefined.findingId, "");
  assert.equal(resUndefined.piracyRiskScore, null);
  assert.equal(resUndefined.trafficSignal, "Unknown");
  assert.equal(resUndefined.audienceReach, "Unknown");
  assert.equal(resUndefined.isLive, false);

  const resNull = mapFindingToRiskProps(null);
  assert.equal(resNull.findingId, "");
  assert.equal(resNull.piracyRiskScore, null);
});

test("Risk Mapping: handles missing distribution metadata and null values safely", () => {
  const result = mapFindingToRiskProps({
    id: "partial-1",
    confidence: null,
    evidence: null,
    status: null,
    source_state: null,
  });

  assert.equal(result.findingId, "partial-1");
  assert.equal(result.piracyRiskScore, null);
  assert.equal(result.trafficSignal, "Unknown");
  assert.equal(result.audienceReach, "Unknown");
  assert.equal(result.distributionType, "UNKNOWN");
  assert.equal(result.isLive, false);
});

test("Risk Mapping: no risk score => Unknown (piracyRiskScore is null, no fake 50)", () => {
  const result = mapFindingToRiskProps({
    id: "match-no-score",
    confidence: null,
    source_url: "https://example.com/item",
  });

  assert.equal(result.piracyRiskScore, null);
  assert.notEqual(result.piracyRiskScore, 50);
});

test("Risk Mapping: no traffic evidence => Unknown", () => {
  const result = mapFindingToRiskProps({
    id: "match-no-traffic",
    confidence: 60,
    source_url: "https://example.com/item",
  });

  assert.equal(result.trafficSignal, "Unknown");
  assert.equal(result.formattedTraffic, null);
});

test("Risk Mapping: high piracy risk + no traffic evidence => Traffic remains Unknown", () => {
  const result = mapFindingToRiskProps({
    id: "match-high-risk-no-traffic",
    confidence: 95,
    source_url: "https://example.com/item",
    evidence: {
      distribution: {
        piracy_risk_score: 95,
      },
    },
  });

  assert.equal(result.piracyRiskScore, 95);
  assert.equal(result.trafficSignal, "Unknown");
  assert.equal(result.audienceReach, "Unknown");
});

test("Risk Mapping: stale historical finding => not automatically Live", () => {
  const resultPreserved = mapFindingToRiskProps({
    id: "match-stale-preserved",
    confidence: 80,
    source_state: "historical_preserved",
    source_url: "https://example.com/item",
  });

  assert.equal(resultPreserved.isLive, false);

  const resultReview = mapFindingToRiskProps({
    id: "match-stale-review",
    confidence: 75,
    source_state: "historical_requires_review",
    source_url: "https://example.com/item",
  });

  assert.equal(resultReview.isLive, false);

  const resultActive = mapFindingToRiskProps({
    id: "match-active",
    confidence: 75,
    source_state: "new_confirmed",
    source_url: "https://example.com/item",
  });

  assert.equal(resultActive.isLive, true);
});

test("Risk Mapping: real view count => formatted traffic value", () => {
  const result = mapFindingToRiskProps({
    id: "match-with-views",
    confidence: 78,
    source_url: "https://example.com/item",
    evidence: {
      distribution: {
        view_count: 3240,
      },
    },
  });

  assert.equal(result.formattedTraffic, "3.2K views");
  assert.equal(result.trafficSignal, "3.2K views");
});

test("Risk Mapping: known risk score => mapped piracyRiskScore correctly", () => {
  const result = mapFindingToRiskProps({
    id: "match-known-score",
    confidence: 82,
    source_url: "https://example.com/cam-leak",
    detection_type: "cam_threat",
    title: "Movie 2026 CAMRip 720p",
  });

  assert.equal(result.piracyRiskScore, 82);
  assert.equal(result.distributionType, "CAM PRINT");
});

test("Risk Mapping: detectPrintLeakType safely handles null/empty input", () => {
  assert.equal(detectPrintLeakType(null), "UNKNOWN");
  assert.equal(detectPrintLeakType(undefined), "UNKNOWN");
  assert.equal(detectPrintLeakType({ id: "empty" }), "UNKNOWN");
});
