/**
 * Live scan activity telemetry and presentation helpers.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SCAN_ACTIVITY_MAX_EVENTS,
  ScanActivityRecorder,
  activityCountersFromStats,
  classifyDistributionThreat,
  parseRecentActivity,
  resolveCopyrightThreatBadge,
  resolveNewVerifiedActivityPulse,
  sanitizeActivityHostname,
  sanitizeActivityPageLabel,
  sortActivityNewestFirst,
} from "./scan-activity";
import { sanitizeEvidenceUrl } from "@/lib/deepfake/evidence-url";

test("real events render in newest-first order", () => {
  const stats = {
    recent_activity: [
      {
        id: "a::discovered",
        hostname: "older.example",
        page_label: "/old",
        provider: "firecrawl",
        stage: "discovered",
        stage_label: "Discovered",
        threat: "checking",
        threat_label: "CHECKING",
        occurred_at: "2026-01-01T10:00:00.000Z",
      },
      {
        id: "b::discovered",
        hostname: "newer.example",
        page_label: "/new",
        provider: "serpapi",
        stage: "discovered",
        stage_label: "Discovered",
        threat: "checking",
        threat_label: "CHECKING",
        occurred_at: "2026-01-01T11:00:00.000Z",
      },
    ],
  };
  const sorted = sortActivityNewestFirst(parseRecentActivity(stats));
  assert.equal(sorted[0]?.hostname, "newer.example");
  assert.equal(sorted[1]?.hostname, "older.example");
});

test("no fabricated sites appear without telemetry", () => {
  assert.deepEqual(parseRecentActivity(null), []);
  assert.deepEqual(parseRecentActivity({}), []);
  assert.deepEqual(parseRecentActivity({ recent_activity: "bad" }), []);
});

test("site transitions from checking to rejected", () => {
  const recorder = new ScanActivityRecorder();
  recorder.recordChecking({
    url: "https://forum.example/thread",
    pageTitle: "Discussion thread",
    leadQuery: "firecrawl:q1",
  });
  recorder.recordDistributionOutcome({
    url: "https://forum.example/thread",
    pageTitle: "Discussion thread",
    leadQuery: "firecrawl:q1",
    classification: "SOCIAL_DISCUSSION",
    clientVisible: false,
    strongEvidence: false,
    identityEvidence: [],
  });
  const events = recorder.mergeToStats({}).recent_activity as Array<Record<string, unknown>>;
  const rejected = events.find((e) => e.stage === "excluded_official" || e.threat === "excluded");
  assert.ok(rejected || events.some((e) => e.threat === "no_threat"));
});

test("site transitions from checking to verified finding", () => {
  const recorder = new ScanActivityRecorder();
  recorder.recordChecking({
    url: "https://pirate.example/watch",
    pageTitle: "Watch Movie",
    leadQuery: "known_url_seed",
  });
  recorder.recordDistributionOutcome({
    url: "https://pirate.example/watch",
    pageTitle: "Watch Movie",
    leadQuery: "known_url_seed",
    classification: "VERIFIED_UNAUTHORIZED_STREAM",
    clientVisible: true,
    strongEvidence: true,
    identityEvidence: ["exact title"],
  });
  const events = recorder.mergeToStats({}).recent_activity as Array<Record<string, unknown>>;
  assert.ok(events.some((e) => e.threat === "verified_finding"));
});

test("official/catalog result shows excluded not threatening", () => {
  const { threat, stage } = classifyDistributionThreat({
    classification: "OFFICIAL_OR_AUTHORIZED",
    clientVisible: false,
    strongEvidence: false,
  });
  assert.equal(threat, "excluded");
  assert.equal(stage, "excluded_official");
});

test("provider failure does not hide activity from another provider", () => {
  const stats = {
    provider_failures: 12,
    firecrawl_circuit_opened: true,
    recent_activity: [
      {
        id: "k::discovered",
        hostname: "known.example",
        page_label: "/",
        provider: "known_url",
        stage: "discovered",
        stage_label: "Discovered",
        threat: "checking",
        threat_label: "CHECKING",
        occurred_at: new Date().toISOString(),
      },
    ],
  };
  const events = parseRecentActivity(stats);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.provider, "known_url");
  const badge = resolveCopyrightThreatBadge({ scanStatus: "running", stats });
  assert.equal(badge.tone, "provider_limited");
});

test("one-time new-threat pulse and refresh does not replay", () => {
  const events = [
    {
      id: "u::saved_finding",
      hostname: "x.example",
      page_label: "/",
      provider: "firecrawl" as const,
      stage: "saved_finding" as const,
      stage_label: "Saved",
      threat: "verified_finding" as const,
      threat_label: "VERIFIED",
      occurred_at: new Date().toISOString(),
    },
  ];
  const first = resolveNewVerifiedActivityPulse({
    scanId: "scan-1",
    events,
    previous: null,
  });
  assert.equal(first.isInitialSeed, true);
  assert.deepEqual(first.pulseIds, []);

  const second = resolveNewVerifiedActivityPulse({
    scanId: "scan-1",
    events,
    previous: first.next,
  });
  assert.deepEqual(second.pulseIds, []);

  const third = resolveNewVerifiedActivityPulse({
    scanId: "scan-1",
    events: [
      ...events,
      {
        ...events[0]!,
        id: "u2::saved_finding",
        hostname: "y.example",
      },
    ],
    previous: second.next,
  });
  assert.deepEqual(third.pulseIds, ["u2::saved_finding"]);
});

test("exact same URL and stage is deduplicated", () => {
  const recorder = new ScanActivityRecorder();
  recorder.recordDiscovered({ url: "https://a.example/x", leadQuery: "q" });
  recorder.recordDiscovered({ url: "https://a.example/x", leadQuery: "q" });
  const events = recorder.mergeToStats({}).recent_activity as unknown[];
  assert.equal(events.length, 1);
});

test("bounded activity list limit", () => {
  const recorder = new ScanActivityRecorder();
  for (let i = 0; i < SCAN_ACTIVITY_MAX_EVENTS + 5; i++) {
    recorder.recordDiscovered({
      url: `https://site-${i}.example/page`,
      leadQuery: "q",
    });
  }
  const events = recorder.mergeToStats({}).recent_activity as unknown[];
  assert.equal(events.length, SCAN_ACTIVITY_MAX_EVENTS);
});

test("unsafe URL and raw provider response never reach UI fields", () => {
  const recorder = new ScanActivityRecorder();
  recorder.recordDistributionOutcome({
    url: "javascript:alert(1)",
    pageTitle: "Bearer fc-secret-token",
    leadQuery: "firecrawl:q",
    classification: "UNVERIFIED_LEAD",
    clientVisible: false,
    strongEvidence: false,
  });
  const events = parseRecentActivity(recorder.mergeToStats({}));
  assert.equal(events.length, 1);
  assert.equal(events[0]?.evidence_href, null);
  assert.ok(!events[0]?.page_label.toLowerCase().includes("bearer"));
  assert.equal(sanitizeEvidenceUrl("javascript:alert(1)"), null);
});

test("hostname sanitization strips unsafe values", () => {
  assert.equal(sanitizeActivityHostname("https://WWW.Example.COM/path"), "example.com");
  assert.equal(sanitizeActivityHostname("not a url!"), null);
});

test("page label sanitization caps length", () => {
  const long = "A".repeat(200);
  assert.equal(sanitizeActivityPageLabel(long).length, 120);
});

test("activity counters come from persisted stats only", () => {
  const counters = activityCountersFromStats({
    queries_executed: 4,
    unique_candidate_pages: 9,
    pages_crawled: 3,
    client_visible_findings: 1,
    provider_failures: 2,
  });
  assert.equal(counters.queries_completed, 4);
  assert.equal(counters.candidate_pages, 9);
  assert.equal(counters.websites_checked, 3);
  assert.equal(counters.verified_findings, 1);
  assert.equal(counters.provider_failures, 2);
});

test("checkpoint restore preserves activity without replay as new", () => {
  const recorder = new ScanActivityRecorder();
  const prior = recorder.mergeToStats({});
  const restored = new ScanActivityRecorder();
  restored.restoreFromStats(prior);
  const pulse = resolveNewVerifiedActivityPulse({
    scanId: "s1",
    events: parseRecentActivity(prior),
    previous: null,
  });
  assert.equal(pulse.isInitialSeed, true);
  const merged = restored.mergeToStats({});
  const events = merged.recent_activity as unknown[];
  assert.ok(Array.isArray(events));
});

test("threat badge during scanning shows no verified threat yet", () => {
  const badge = resolveCopyrightThreatBadge({
    scanStatus: "running",
    stats: { client_visible_findings: 0 },
  });
  assert.equal(badge.label, "SCANNING — NO VERIFIED THREAT YET");
});

test("partial scan badge shows verified progress saved", () => {
  const badge = resolveCopyrightThreatBadge({
    scanStatus: "partial",
    stats: {},
  });
  assert.equal(badge.label, "VERIFIED PROGRESS SAVED");
});
