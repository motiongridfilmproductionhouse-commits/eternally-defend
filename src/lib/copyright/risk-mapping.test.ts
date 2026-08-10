import assert from "node:assert/strict";
import test from "node:test";
import { mapFindingToRiskProps, detectPrintLeakType } from "./risk-mapping";

test("1. Verified CAM copy with no numeric score => HIGH RISK, active distribution, COPY TYPE = CAM PRINT", () => {
  const result = mapFindingToRiskProps({
    id: "cam-no-score",
    confidence: null,
    detection_type: "cam_threat",
    title: "Leaked Movie 2026 CAMRip 720p",
    source_url: "https://example.com/cam-leak",
    source_state: "new_confirmed",
  });

  assert.equal(result.threatLevel, "High");
  assert.equal(result.threatLabel, "HIGH RISK");
  assert.equal(result.copyType, "CAM PRINT");
  assert.equal(result.isLive, true);
  assert.equal(result.isClientThreat, true);
  assert.equal(
    result.distributionActivity === "HIGH" || result.distributionActivity === "MODERATE",
    true,
    "DISTRIBUTION ACTIVITY should be at least MODERATE or HIGH for active source"
  );
});

test("2. WEB-DL active public page => minimum HIGH RISK", () => {
  const result = mapFindingToRiskProps({
    id: "webdl-copy",
    confidence: 30, // low score, but verified WEB-DL
    title: "Movie.2026.1080p.WEB-DL.x264",
    source_url: "https://example.com/webdl",
    source_state: "active",
  });

  assert.equal(result.copyType, "WEB-DL LEAK");
  assert.equal(result.threatLevel, "High");
  assert.equal(result.threatLabel, "HIGH RISK");
});

test("3. Download mirror => minimum MEDIUM RISK", () => {
  const result = mapFindingToRiskProps({
    id: "download-mirror",
    confidence: 20, // low base score
    title: "Download Full Movie Torrent Link",
    source_url: "https://filehost.com/download/123",
    source_state: "active",
  });

  assert.equal(result.copyType, "DOWNLOAD MIRROR");
  assert.equal(result.threatLevel, "Medium");
  assert.equal(result.threatLabel, "MEDIUM RISK");
});

test("4. NOT_SUBJECT => isClientThreat = false (not rendered as client threat card)", () => {
  const result = mapFindingToRiskProps({
    id: "not-subject-item",
    classification: "NOT_SUBJECT",
    review_status: "not_subject",
  });

  assert.equal(result.isClientThreat, false);
  assert.equal(result.copyType, "NOT_SUBJECT");
});

test("5. No exposure evidence => EXPOSURE LEVEL = NOT ESTABLISHED", () => {
  const result = mapFindingToRiskProps({
    id: "no-exposure",
    confidence: 80,
    source_url: "https://example.com/item",
    // No search visibility, no view count, no reachability
  });

  assert.equal(result.exposureLevel, "NOT ESTABLISHED");
  assert.equal(result.exposureLevelFormatted, "Not Established");
  assert.notEqual(result.exposureLevelFormatted, "Unknown");
});

test("6. High piracy risk does not automatically create high distribution activity", () => {
  const result = mapFindingToRiskProps({
    id: "high-score-no-dist",
    confidence: 95,
    source_url: "https://example.com/item",
    // Zero view count, zero links, unconfirmed reachability
  });

  assert.equal(result.piracyRiskScore, 95);
  assert.equal(
    result.distributionActivity === "LOW" || result.distributionActivity === "MODERATE",
    true,
    "DISTRIBUTION ACTIVITY should remain LOW or MODERATE when no real distribution evidence exists"
  );
  assert.notEqual(result.distributionActivity, "VERY HIGH");
});

test("Risk Mapping: handles undefined or null finding without throwing", () => {
  const resUndefined = mapFindingToRiskProps(undefined);
  assert.equal(resUndefined.findingId, "");
  assert.equal(resUndefined.piracyRiskScore, null);
  assert.equal(resUndefined.distributionActivity, "LOW");
  assert.equal(resUndefined.exposureLevel, "NOT ESTABLISHED");
  assert.equal(resUndefined.isLive, false);
  assert.equal(resUndefined.isClientThreat, false);

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
  assert.equal(result.distributionActivity, "LOW");
  assert.equal(result.exposureLevel, "NOT ESTABLISHED");
  assert.equal(result.copyType, "UNKNOWN");
  assert.equal(result.isLive, false);
});

test("Risk Mapping: detectPrintLeakType safely handles null/empty input", () => {
  assert.equal(detectPrintLeakType(null), "UNKNOWN");
  assert.equal(detectPrintLeakType(undefined), "UNKNOWN");
  assert.equal(detectPrintLeakType({ id: "empty" }), "UNKNOWN");
});
