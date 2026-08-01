import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptivePerQueryLimit,
  canStartProviderCall,
  createScanBudget,
  discoveryBudgetRemaining,
  MIN_PROVIDER_TIME_MS,
  QUERY_BATCH_SIZE,
} from "./scan-budget.server";
import {
  createDiscoveryFunnelMetrics,
  decideTerminalStatus,
} from "./scan-ownership.server";
import {
  createEmptyCheckpoint,
  checkpointHasPendingWork,
  markQueryCompleted,
} from "./scan-checkpoint.server";
import { ScanCheckpointPauseError } from "./scan-runtime.server";
import {
  nextQueryBatch,
  prioritizeDeepfakeQueries,
} from "./query-priority.server";
import {
  selectRedundantDiscoveryIds,
  type DiscoveryDedupeRow,
} from "./discovery-dedupe";
import { findingPersistKey } from "./scan-persist.server";

test("verification is scheduled after the first small query batch", () => {
  const queries = Array.from({ length: 12 }, (_, index) => `query-${index + 1}`);
  const events: string[] = [];

  const first = nextQueryBatch(queries, 0, QUERY_BATCH_SIZE);
  for (const query of first.batch) events.push(`search:${query}`);
  events.push("verify:first-batch");

  const second = nextQueryBatch(queries, first.nextIndex, QUERY_BATCH_SIZE);
  for (const query of second.batch) events.push(`search:${query}`);

  assert.equal(first.batch.length, 5);
  assert.equal(second.batch[0], "query-6");
  assert.ok(
    events.indexOf("verify:first-batch") < events.indexOf("search:query-6"),
    "verification must start before all query batches finish",
  );
});

test("prioritizeDeepfakeQueries puts high-signal deepfake terms first", () => {
  const prioritized = prioritizeDeepfakeQueries([
    '"Maya Kapoor" interview photos',
    '"Maya Kapoor" face swap gallery',
    '"Maya Kapoor" fake nude',
    '"Maya Kapoor" deepfake',
  ]);

  assert.deepEqual(prioritized.slice(0, 3), [
    '"Maya Kapoor" deepfake',
    '"Maya Kapoor" face swap gallery',
    '"Maya Kapoor" fake nude',
  ]);
});

test("timeout checkpoint with persisted progress becomes partial with continue messaging", () => {
  const metrics = createDiscoveryFunnelMetrics();
  const checkpoint = createEmptyCheckpoint({
    queries: ["q1", "q2"],
    targetName: "Maya Kapoor",
    aliases: [],
    handles: [],
    perQueryLimit: 20,
    maxQueries: 2,
    initialWaveCount: 1,
    metrics,
  });
  checkpoint.discovery_count = 1;
  checkpoint.next_query_index = 1;
  checkpoint.pending_candidate_urls = ["https://example.com/deepfake"];

  const decision = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: true,
    pendingWork: checkpointHasPendingWork(checkpoint),
    checkpointPause: true,
    errorMessage: null,
  });

  assert.equal(decision.status, "partial");
  assert.match(decision.reason ?? "", /Continue scan/i);
  assert.ok(new ScanCheckpointPauseError() instanceof Error);
});

test("checkpoint resume starts after completed query ids", () => {
  const metrics = createDiscoveryFunnelMetrics();
  const checkpoint = createEmptyCheckpoint({
    queries: ["q1", "q2", "q3", "q4"],
    targetName: "Maya Kapoor",
    aliases: [],
    handles: [],
    perQueryLimit: 20,
    maxQueries: 4,
    initialWaveCount: 2,
    metrics,
  });

  markQueryCompleted(checkpoint, "q1");
  markQueryCompleted(checkpoint, "q2");
  checkpoint.next_query_index = 2;

  const next = nextQueryBatch(
    checkpoint.queries,
    checkpoint.next_query_index,
    QUERY_BATCH_SIZE,
  );

  assert.deepEqual(checkpoint.completed_query_ids, ["q1", "q2"]);
  assert.deepEqual(next.batch, ["q3", "q4"]);
});

test("selectRedundantDiscoveryIds and findingPersistKey still dedupe persisted rows", () => {
  const rows: DiscoveryDedupeRow[] = [
    {
      id: "old",
      scan_id: "scan",
      page_url: "https://example.com/a",
      analysis_status: "discovered",
      discovered_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "verified",
      scan_id: "scan",
      page_url: "https://example.com/a",
      canonical_url: "https://example.com/a",
      analysis_status: "url_verified",
      page_title: "Verified",
      snippet: "Verified exact page",
      discovered_at: "2026-08-01T01:00:00.000Z",
      updated_at: "2026-08-01T01:00:00.000Z",
    },
  ];

  assert.deepEqual(selectRedundantDiscoveryIds(rows), ["old"]);
  assert.equal(
    findingPersistKey({
      canonical_url: "https://example.com/a",
      final_url: "https://example.com/b",
      url: "https://example.com/c",
    }),
    "https://example.com/a",
  );
});

test("no-progress provider error remains failed", () => {
  const decision = decideTerminalStatus({
    abortedByDeadline: false,
    hasValidProgress: false,
    errorMessage: "Firecrawl provider unavailable",
  });

  assert.equal(decision.status, "failed");
  assert.match(decision.reason ?? "", /Firecrawl provider unavailable/);
});

test("adaptivePerQueryLimit reduces provider work when latency is slow", () => {
  assert.equal(
    adaptivePerQueryLimit({
      baseLimit: 20,
      averageProviderLatencyMs: 13_000,
      discoveryRemainingMs: 60_000,
    }),
    10,
  );
  assert.equal(
    adaptivePerQueryLimit({
      baseLimit: 20,
      averageProviderLatencyMs: 2_000,
      discoveryRemainingMs: 15_000,
    }),
    8,
  );
});

test("discoveryBudgetRemaining prevents late expansion", () => {
  const now = Date.now();
  const budget = createScanBudget(
    {
      startedAtMs: now,
      softDeadlineMs: now + 120_000,
    } as any,
    now,
  );
  budget.discoverySpentMs = budget.discoveryBudgetMs;

  assert.equal(discoveryBudgetRemaining(budget, now), 0);
  assert.equal(canStartProviderCall(budget, MIN_PROVIDER_TIME_MS, now), false);
});
