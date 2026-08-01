import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adaptivePerQueryLimit,
  canStartProviderCall,
  canStartVerification,
  CLEANUP_BUDGET_RATIO,
  createScanBudget,
  DISCOVERY_BUDGET_RATIO,
  discoveryBudgetRemaining,
  MIN_PROVIDER_TIME_MS,
  QUERY_BATCH_SIZE,
  recordSpend,
  VERIFICATION_BUDGET_RATIO,
  verificationBudgetRemaining,
} from "./scan-budget.server";
import {
  createDiscoveryFunnelMetrics,
  decideTerminalStatus,
  hasValidScanProgress,
} from "./scan-ownership.server";
import {
  CHECKPOINT_MAX_BYTES,
  CHECKPOINT_MAX_PENDING_URLS,
  createEmptyCheckpoint,
  checkpointHasPendingWork,
  enforceCheckpointBounds,
  estimateCheckpointBytes,
  markQueryCompleted,
  parseScanCheckpoint,
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

const CHECKPOINT_MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260801083000_deepfake_scan_checkpoint_resume.sql",
);

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

test("time budgets reserve discovery, verification, and cleanup shares", () => {
  const now = Date.now();
  const budget = createScanBudget(
    {
      startedAtMs: now,
      softDeadlineMs: now + 100_000,
    } as any,
    now,
  );

  assert.equal(DISCOVERY_BUDGET_RATIO, 0.25);
  assert.equal(VERIFICATION_BUDGET_RATIO, 0.55);
  assert.equal(CLEANUP_BUDGET_RATIO, 0.2);
  assert.equal(budget.discoveryBudgetMs, 25_000);
  assert.equal(budget.verificationBudgetMs, 55_000);
  assert.equal(budget.cleanupBudgetMs, 20_000);

  recordSpend(budget, "verification", budget.verificationBudgetMs);
  assert.equal(canStartVerification(budget, now), false);
  assert.ok(verificationBudgetRemaining(budget, now) < MIN_PROVIDER_TIME_MS);
});

test("timeout without persisted discoveries/findings stays failed", () => {
  assert.equal(
    hasValidScanProgress({
      metrics: createDiscoveryFunnelMetrics(),
      discoveryCount: 0,
      findingCount: 0,
    }),
    false,
  );

  const decision = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: false,
    errorMessage: "The operation was aborted due to timeout",
  });

  assert.equal(decision.status, "failed");
  assert.match(decision.reason ?? "", /before any verified progress/i);
});

test("parseScanCheckpoint rejects hostile payloads and bounds size", () => {
  assert.equal(parseScanCheckpoint(null), null);
  assert.equal(parseScanCheckpoint({ version: 1, queries: "bad" }), null);

  const hostile = parseScanCheckpoint({
    version: 1,
    queries: ["q1", "q2", "q3"],
    next_query_index: 0,
    completed_query_ids: ["q1", "javascript:alert(1)", "q2"],
    pending_candidate_urls: [
      "https://evil.example/pending",
      "not-a-url",
      "ftp://bad.example/x",
    ],
    verified_canonical_urls: [
      "https://evil.example/verified",
      "data:text/html,hi",
    ],
    stage: "verifying",
    youtube_done: false,
    reddit_done: false,
    related_done: false,
    metrics: createDiscoveryFunnelMetrics(),
  });

  assert.ok(hostile);
  assert.equal(hostile.next_query_index, 2, "completed plan ids advance cursor");
  assert.deepEqual(hostile.pending_candidate_urls, [
    "https://evil.example/pending",
  ]);
  assert.deepEqual(hostile.verified_canonical_urls, [
    "https://evil.example/verified",
  ]);
  assert.ok(!hostile.completed_query_ids.includes("javascript:alert(1)"));

  const oversized = createEmptyCheckpoint({
    queries: Array.from({ length: 60 }, (_, i) => `query-${i}`),
    targetName: "Maya Kapoor",
    aliases: [],
    handles: [],
    perQueryLimit: 20,
    maxQueries: 60,
    initialWaveCount: 15,
    metrics: createDiscoveryFunnelMetrics(),
  });
  oversized.pending_candidate_urls = Array.from(
    { length: CHECKPOINT_MAX_PENDING_URLS + 40 },
    (_, i) => `https://example.com/p/${i}/${"x".repeat(200)}`,
  );
  const bounded = enforceCheckpointBounds(oversized);
  assert.ok(bounded.pending_candidate_urls.length <= CHECKPOINT_MAX_PENDING_URLS);
  assert.ok(estimateCheckpointBytes(bounded) <= CHECKPOINT_MAX_BYTES);
});

test("checkpoint migration enforces continue-only partial revive and size bound", () => {
  const sql = readFileSync(CHECKPOINT_MIGRATION, "utf8");
  assert.match(sql, /scan_checkpoint JSONB/);
  assert.match(sql, /deepfake_scans_checkpoint_size_check/);
  assert.match(sql, /pg_column_size\(scan_checkpoint\) <= 262144/);
  assert.match(sql, /acquire_deepfake_scan_continuation/);
  assert.match(sql, /app\.deepfake_allow_partial_continue/);
  assert.match(sql, /partial → running is only allowed through continue_scan/);
  assert.match(sql, /OLD\.status IN \('completed', 'failed'\)/);
  assert.match(sql, /deepfake_scans_protect_runtime_fields/);
  assert.match(sql, /runtime fields are server-managed/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /AND scans\.status = 'partial'/);
});

test("query batch size stays in the 4–6 interleave window", () => {
  assert.ok(QUERY_BATCH_SIZE >= 4 && QUERY_BATCH_SIZE <= 6);
});
