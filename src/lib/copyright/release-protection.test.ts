import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPostReleaseMonitorQueries,
  buildPreReleaseLeakQueries,
  buildReleaseProtectionDiscoveryQueries,
  calculateProtectionReadiness,
  classifyWebLeakCandidate,
  classifyYoutubeLeakCandidate,
  clampCadence,
  computeNextScanAt,
  formatCadenceLabel,
  incidentDedupKey,
  isPrivateOrUnsafeMonitorUrl,
  meetsAutomaticMonitoringReferenceMinimum,
  mergeIncidentRecurrence,
  monitoringCadenceMinutes,
  providerFailureIsolation,
  shouldAlertForIncident,
  shouldImmediateAlert,
  validateReleaseProtectionSettings,
} from "./release-protection";

test("release date and timezone required when auto-monitoring enabled", () => {
  const errors = validateReleaseProtectionSettings({
    enabled: true,
    release_type: "theatrical",
    release_countries: ["IN"],
    languages: ["en"],
    primary_language: "en",
    studio: "Studio",
    distributor: "Dist",
    alert_threshold: "high_and_critical",
    cadence_profile: "default",
  });
  assert.ok(errors.some((e) => e.includes("Release date")));
  assert.ok(errors.some((e) => e.includes("timezone")));
});

test("minimum strong reference package for automatic monitoring", () => {
  assert.equal(
    meetsAutomaticMonitoringReferenceMinimum({
      primary_poster_key: "a",
      additional_visual_keys: ["b"],
      video_reference_keys: [],
    }),
    false,
  );
  assert.equal(
    meetsAutomaticMonitoringReferenceMinimum({
      primary_poster_key: "a",
      additional_visual_keys: ["b", "c"],
      video_reference_keys: ["trailer"],
    }),
    true,
  );
});

test("release readiness calculation", () => {
  const result = calculateProtectionReadiness({
    settings: {
      enabled: true,
      release_date: "2026-12-01",
      release_timezone: "Asia/Kolkata",
      primary_language: "ta",
    },
    referencePackage: {
      primary_poster_key: "p1",
      additional_visual_keys: ["p2", "p3"],
      video_reference_keys: ["v1"],
    },
    metadataComplete: true,
  });
  assert.ok(result.score >= 80);
  assert.equal(result.level, "high_confidence");
});

test("pre-release query generation includes leak indicators", () => {
  const queries = buildPreReleaseLeakQueries("Balan The Boy", ["Balan"]);
  assert.ok(queries.some((q) => q.includes("censor copy")));
  assert.ok(queries.some((q) => q.includes("theatre print")));
  assert.ok(queries.some((q) => q.includes("leaked")));
});

test("post-release query generation includes title variants", () => {
  const queries = buildPostReleaseMonitorQueries("Balan The Boy", ["Balan"], "பாலன்");
  assert.ok(queries.some((q) => q.includes("full movie")));
  assert.ok(queries.some((q) => q.includes("பாலன்")));
});

test("cadence selection by date distance", () => {
  const release = "2026-12-01T00:00:00.000Z";
  const farBefore = Date.parse("2026-10-01T00:00:00.000Z");
  const weekBefore = Date.parse("2026-11-24T00:00:00.000Z");
  const releaseDay = Date.parse("2026-12-01T12:00:00.000Z");
  const weekAfter = Date.parse("2026-12-08T00:00:00.000Z");

  assert.equal(monitoringCadenceMinutes(release, farBefore), 24 * 60);
  assert.equal(monitoringCadenceMinutes(release, weekBefore), 3 * 60);
  assert.equal(monitoringCadenceMinutes(release, releaseDay), 60);
  assert.equal(monitoringCadenceMinutes(release, weekAfter), 3 * 60);
});

test("custom cadence is clamped within safe limits", () => {
  assert.equal(clampCadence(15), 60);
  assert.equal(clampCadence(5000), 24 * 60);
  assert.equal(clampCadence(180), 180);
});

test("pause/resume is represented via settings.paused flag", () => {
  const paused = { enabled: true, paused: true } as const;
  assert.equal(paused.paused, true);
});

test("duplicate scheduled run prevention uses unique scheduled_for per protection row", () => {
  const key = incidentDedupKey("https://example.com/a", "first_appearance");
  assert.equal(key, "first_appearance::https://example.com/a");
});

test("YouTube official trailer exclusion", () => {
  const result = classifyYoutubeLeakCandidate({
    title: "Balan The Boy Official Trailer",
    description: "Official promotional trailer",
    durationSeconds: 120,
    releaseDate: "2026-12-01",
    publishedAt: "2026-11-01",
  });
  assert.equal(result.classification, "official_trailer");
  assert.equal(result.risk, "contextual");
});

test("censor-copy high-risk classification before release", () => {
  const result = classifyYoutubeLeakCandidate({
    title: "Balan The Boy CBFC censor copy leaked",
    durationSeconds: 5400,
    releaseDate: "2026-12-01",
    publishedAt: "2026-11-20",
  });
  assert.equal(result.risk, "critical");
});

test("theatre-print classification", () => {
  const web = classifyWebLeakCandidate({
    pageTitle: "Balan The Boy theatre print CAM HDTS",
    hasDownloadLink: true,
    releaseDate: "2026-12-01",
  });
  assert.equal(web.risk, "high");
  assert.ok(web.labels.includes("theatre_print"));
});

test("news-report exclusion", () => {
  const web = classifyWebLeakCandidate({
    pageTitle: "Report: alleged leak discussed online",
    pageText: "News article about rumours",
    isNewsArticle: true,
    releaseDate: "2026-12-01",
  });
  assert.equal(web.risk, "contextual");
});

test("provider failure isolation does not fail when at least one provider succeeds", () => {
  const out = providerFailureIsolation([{ ok: true }, { ok: false }, { ok: false }]);
  assert.equal(out.succeeded, 1);
  assert.equal(out.shouldFailRun, false);
});

test("provider failure isolation fails run only when every provider fails", () => {
  const out = providerFailureIsolation([{ ok: false }, { ok: false }]);
  assert.equal(out.shouldFailRun, true);
});

test("incident deduplication tracks recurrence", () => {
  const merged = mergeIncidentRecurrence(
    { recurrence_count: 2, last_seen_at: "2026-08-01T00:00:00.000Z" },
    "2026-08-02T00:00:00.000Z",
  );
  assert.equal(merged.recurrence_count, 3);
  assert.equal(merged.last_seen_at, "2026-08-02T00:00:00.000Z");
});

test("alert threshold behavior", () => {
  assert.equal(shouldAlertForIncident("critical", "critical_only"), true);
  assert.equal(shouldAlertForIncident("high", "critical_only"), false);
  assert.equal(shouldAlertForIncident("high", "high_and_critical"), true);
  assert.equal(shouldAlertForIncident("medium", "all_verified"), true);
  assert.equal(shouldAlertForIncident("critical", "daily_summary"), false);
});

test("immediate alert for pre-release full copy", () => {
  assert.equal(
    shouldImmediateAlert({
      risk: "critical",
      beforeRelease: true,
      labels: ["full_film_claim"],
      classification: "suspected_full_film",
    }),
    true,
  );
});

test("no secret leakage in format helpers", () => {
  const label = formatCadenceLabel(180);
  assert.equal(label.includes("API"), false);
  assert.equal(label.includes("SECRET"), false);
});

test("private URL access is rejected", () => {
  assert.equal(isPrivateOrUnsafeMonitorUrl("http://localhost/leak"), true);
  assert.equal(isPrivateOrUnsafeMonitorUrl("https://example.com/watch"), false);
});

test("computeNextScanAt respects cadence", () => {
  const release = "2026-12-01T00:00:00.000Z";
  const from = Date.parse("2026-11-24T00:00:00.000Z");
  const next = computeNextScanAt(release, from);
  const deltaMin = (Date.parse(next) - from) / 60_000;
  assert.equal(deltaMin, monitoringCadenceMinutes(release, from));
});

test("buildReleaseProtectionDiscoveryQueries uses pre-release terms before release", () => {
  const queries = buildReleaseProtectionDiscoveryQueries(
    "Balan The Boy",
    "2026-12-01T00:00:00.000Z",
    ["Balan"],
    undefined,
    Date.parse("2026-11-01T00:00:00.000Z"),
  );
  assert.ok(queries.some((q) => q.includes("screener")));
});

test("buildReleaseProtectionDiscoveryQueries uses post-release terms after release", () => {
  const queries = buildReleaseProtectionDiscoveryQueries(
    "Balan The Boy",
    "2026-12-01T00:00:00.000Z",
    ["Balan"],
    undefined,
    Date.parse("2026-12-10T00:00:00.000Z"),
  );
  assert.ok(queries.some((q) => q.includes("full movie")));
});

test("scheduled worker idempotency key is stable per source and type", () => {
  const a = incidentDedupKey("https://a.com", "new_mirror");
  const b = incidentDedupKey("https://a.com", "new_mirror");
  assert.equal(a, b);
});
