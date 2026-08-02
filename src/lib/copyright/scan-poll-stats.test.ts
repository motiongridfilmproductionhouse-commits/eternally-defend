import assert from "node:assert/strict";
import test from "node:test";

import { mergeCopyrightPollStats } from "./scan-poll-stats";
import { parseSourceActivity } from "./source-activity";

const threeProviders = [
  {
    provider: "bright_data",
    label: "Bright Data",
    status: "queued" as const,
    requests: 0,
    candidates: 0,
    failures: 0,
    updated_at: "2026-08-02T17:05:00.000Z",
  },
  {
    provider: "firecrawl",
    label: "Firecrawl",
    status: "queued" as const,
    requests: 0,
    candidates: 0,
    failures: 0,
    updated_at: "2026-08-02T17:05:00.000Z",
  },
  {
    provider: "youtube",
    label: "YouTube",
    status: "queued" as const,
    requests: 0,
    candidates: 0,
    failures: 0,
    updated_at: "2026-08-02T17:05:00.000Z",
  },
];

test("mergeCopyrightPollStats keeps list providers when detail poll is stale-empty", () => {
  const listStats = {
    source_activity: threeProviders,
    source_activity_count: 3,
    source_activity_updated_at: "2026-08-02T17:05:00.000Z",
    workflow_stage: "preparing_reference",
  };
  const detailStats = {
    source_activity: [],
    workflow_stage: "analyzing_visual",
  };

  const merged = mergeCopyrightPollStats(listStats, detailStats);
  const providers = parseSourceActivity(merged);

  assert.equal(providers.length, 3);
  assert.equal(merged.source_activity_count, 3);
  assert.equal(merged.source_activity_updated_at, "2026-08-02T17:05:00.000Z");
  assert.equal(merged.workflow_stage, "analyzing_visual");
});

test("mergeCopyrightPollStats prefers detail telemetry when list is empty", () => {
  const listStats = { source_activity: [] };
  const detailStats = {
    source_activity: threeProviders,
    source_activity_count: 3,
    source_activity_updated_at: "2026-08-02T17:06:00.000Z",
  };

  const merged = mergeCopyrightPollStats(listStats, detailStats);
  assert.equal(parseSourceActivity(merged).length, 3);
  assert.equal(merged.source_activity_count, 3);
});

test("mergeCopyrightPollStats picks newer telemetry when both polls have providers", () => {
  const older = threeProviders.map((p) => ({ ...p, status: "queued" as const }));
  const newer = threeProviders.map((p) => ({
    ...p,
    status: "searching" as const,
    updated_at: "2026-08-02T17:10:00.000Z",
  }));

  const listStats = {
    source_activity: older,
    source_activity_count: 3,
    source_activity_updated_at: "2026-08-02T17:05:00.000Z",
  };
  const detailStats = {
    source_activity: newer,
    source_activity_count: 3,
    source_activity_updated_at: "2026-08-02T17:10:00.000Z",
  };

  const merged = mergeCopyrightPollStats(listStats, detailStats);
  const providers = parseSourceActivity(merged);
  assert.equal(providers.length, 3);
  assert.equal(providers[0]?.status, "searching");
  assert.equal(merged.source_activity_updated_at, "2026-08-02T17:10:00.000Z");
});
