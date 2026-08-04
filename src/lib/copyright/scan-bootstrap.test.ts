import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapReelOperationalCards,
  bootstrapStatsFromState,
  createScanBootstrap,
  mergeActiveScanStats,
  rememberNonEmptyScanTelemetry,
} from "./scan-bootstrap";
import { parseSourceActivity } from "./source-activity";
import { parseWebsiteActivity } from "./scan-activity";

const configured = ["bright_data", "firecrawl", "youtube"];

function makeBootstrap(scanId = "scan-new") {
  return createScanBootstrap({
    scanId,
    configuredProviderIds: configured,
    createdAt: "2026-08-02T18:00:00.000Z",
  });
}

test("A: bootstrap stats render providers immediately before any poll", () => {
  const bootstrap = makeBootstrap();
  const stats = mergeActiveScanStats({
    listStats: {},
    detailStats: {},
    bootstrap,
    lastKnown: null,
  });

  assert.equal(parseSourceActivity(stats).length, 3);
  assert.equal(parseWebsiteActivity(stats).length, 1);
  assert.equal(stats.scan_bootstrap, true);
  assert.equal(bootstrapReelOperationalCards(bootstrap.providers).length, 3);
});

test("B: first empty poll keeps bootstrap animation cards", () => {
  const bootstrap = makeBootstrap();
  const stats = mergeActiveScanStats({
    listStats: { source_activity: [], website_activity: [] },
    detailStats: { source_activity: [] },
    bootstrap,
    lastKnown: null,
  });

  assert.equal(parseSourceActivity(stats).length, 3);
  assert.equal(parseSourceActivity(stats)[0]?.status, "starting");
  assert.equal(parseWebsiteActivity(stats).length, 1);
});

test("C: real source_activity replaces bootstrap providers in place", () => {
  const bootstrap = makeBootstrap();
  const realProviders = [
    {
      provider: "firecrawl",
      label: "Public Web",
      status: "queued" as const,
      requests: 0,
      candidates: 0,
      failures: 0,
      updated_at: "2026-08-02T18:00:05.000Z",
    },
    {
      provider: "youtube",
      label: "Public Video",
      status: "searching" as const,
      requests: 2,
      candidates: 1,
      failures: 0,
      updated_at: "2026-08-02T18:00:06.000Z",
    },
  ];
  const polled = {
    source_activity: realProviders,
    source_activity_count: 2,
    source_activity_updated_at: "2026-08-02T18:00:06.000Z",
  };
  const lastKnown = rememberNonEmptyScanTelemetry(null, polled);
  const stats = mergeActiveScanStats({
    listStats: polled,
    detailStats: {},
    bootstrap,
    lastKnown,
  });

  const providers = parseSourceActivity(stats);
  assert.equal(providers.length, 3);
  const firecrawl = providers.find((p) => p.provider === "firecrawl");
  const bright = providers.find((p) => p.provider === "bright_data");
  assert.equal(firecrawl?.status, "queued");
  assert.equal(bright?.status, "starting");
  assert.equal(stats.scan_bootstrap, false);
});

test("D: later empty poll does not erase remembered real telemetry", () => {
  const remembered = rememberNonEmptyScanTelemetry(null, {
    source_activity: [
      {
        provider: "firecrawl",
        label: "Public Web",
        status: "searching",
        requests: 3,
        candidates: 2,
        failures: 0,
        updated_at: "2026-08-02T18:00:10.000Z",
      },
    ],
    website_activity: [
      {
        id: "real:example.com:discovered",
        hostname: "example.com",
        page_label: "/watch",
        provider: "firecrawl",
        stage: "discovered",
        stage_label: "Discovered",
        threat: "checking",
        threat_label: "CHECKING",
        occurred_at: "2026-08-02T18:00:11.000Z",
      },
    ],
    recent_activity: [],
  });

  const stats = mergeActiveScanStats({
    listStats: { source_activity: [], website_activity: [] },
    detailStats: { source_activity: [] },
    bootstrap: null,
    lastKnown: remembered,
  });

  assert.equal(parseSourceActivity(stats).length, 1);
  assert.equal(parseSourceActivity(stats)[0]?.status, "searching");
  assert.equal(parseWebsiteActivity(stats)[0]?.hostname, "example.com");
});

test("E: scan creation failure does not leave bootstrap state", () => {
  const bootstrap = makeBootstrap();
  const stats = bootstrapStatsFromState(bootstrap);
  assert.ok(parseSourceActivity(stats).length > 0);
  const afterFailure = mergeActiveScanStats({
    listStats: {},
    detailStats: {},
    bootstrap: null,
    lastKnown: null,
  });
  assert.equal(parseSourceActivity(afterFailure).length, 0);
});

test("createScanBootstrap only includes configured providers", () => {
  const bootstrap = createScanBootstrap({
    scanId: "scan-1",
    configuredProviderIds: ["firecrawl"],
  });
  assert.deepEqual(
    bootstrap.providers.map((p) => p.provider),
    ["firecrawl"],
  );
});
