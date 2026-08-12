import assert from "node:assert/strict";
import test from "node:test";
import { reportScanCheckpoint, snapshotCounters } from "./progress.server";
import { coarseProviderNodes, finalProviderNodes } from "./provider-nodes";
import { emptyScanFunnel } from "./pipeline-funnel";

test("snapshotCounters only includes real, currently-known funnel values", () => {
  const funnel = emptyScanFunnel();
  funnel.queries_planned = 10;
  funnel.queries_executed = 8;
  funnel.discovered = 120;
  funnel.unique = 90;
  funnel.extracted = 40;
  funnel.verified = 30;
  funnel.needs_review = 5;

  const snapshot = snapshotCounters(funnel);
  assert.equal(snapshot.queries_planned, 10);
  assert.equal(snapshot.queries_executed, 8);
  assert.equal(snapshot.urls_discovered, 120);
  assert.equal(snapshot.unique_candidates, 90);
  assert.equal(snapshot.pages_extracted, 40);
  assert.equal(snapshot.verified_subjects, 30);
  assert.equal(snapshot.needs_review, 5);
  // ai_expansion_urls was never set on this funnel (no .ai) — must not fabricate a value.
  assert.equal(snapshot.ai_expansion_urls, undefined);
});

test("snapshotCounters returns all-undefined for a missing funnel, never zeros", () => {
  const snapshot = snapshotCounters(undefined);
  assert.equal(snapshot.queries_planned, undefined);
  assert.equal(snapshot.findings, undefined);
});

test("snapshotCounters lets an explicit `extra` override win (caller has fresher data)", () => {
  const funnel = emptyScanFunnel();
  funnel.unique = 5;
  const snapshot = snapshotCounters(funnel, { unique_candidates: 42, findings: 7 });
  assert.equal(snapshot.unique_candidates, 42);
  assert.equal(snapshot.findings, 7);
});

test("reportScanCheckpoint is a safe no-op when scanRunId is absent", () => {
  // Must never throw and must return synchronously (void), regardless of input shape —
  // every call site in scan.ts must remain fully functional for callers that don't
  // opt into live progress.
  assert.doesNotThrow(() => reportScanCheckpoint(null, { stage: "DISCOVERY" }));
  assert.doesNotThrow(() =>
    reportScanCheckpoint(undefined, { stage: "COMPLETE", status: "complete" }),
  );
  assert.doesNotThrow(() => reportScanCheckpoint("", { stage: "FAILED", error: "x" }));
});

test("coarseProviderNodes marks only requested content sources active; infra nodes always active", () => {
  const nodes = coarseProviderNodes(["youtube", "reddit"]);
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n.state]));
  assert.equal(byKey.youtube, "active");
  assert.equal(byKey.reddit, "active");
  assert.equal(byKey.news, "waiting");
  assert.equal(byKey.web, "waiting");
  // Infra providers are always attempted by the pipeline regardless of content-source selection.
  assert.equal(byKey.serpapi, "active");
  assert.equal(byKey.crawl4ai, "active");
});

test("coarseProviderNodes with no requested sources leaves every content node waiting", () => {
  const nodes = coarseProviderNodes([]);
  const contentNodes = nodes.filter((n) =>
    ["youtube", "reddit", "news", "web", "forums", "blogs"].includes(n.key),
  );
  assert.equal(
    contentNodes.every((n) => n.state === "waiting"),
    true,
  );
});

test("finalProviderNodes: requested source with zero matches is complete, not failed", () => {
  const nodes = finalProviderNodes({
    sourcesRequested: ["news"],
    sourcesReturned: [], // zero matches
  });
  const news = nodes.find((n) => n.key === "news");
  assert.equal(news?.state, "complete");
});

test("finalProviderNodes: YouTube quota exhaustion reports degraded, not failed", () => {
  const nodes = finalProviderNodes({
    sourcesRequested: ["youtube"],
    sourcesReturned: [],
    youtube: { status: "quota_exhausted" },
  });
  const yt = nodes.find((n) => n.key === "youtube");
  assert.equal(yt?.state, "degraded");
});

test("finalProviderNodes: unrequested source stays waiting, never marked complete/failed", () => {
  const nodes = finalProviderNodes({
    sourcesRequested: ["youtube"],
    sourcesReturned: ["youtube"],
  });
  const reddit = nodes.find((n) => n.key === "reddit");
  assert.equal(reddit?.state, "waiting");
});

test("finalProviderNodes: crawl4ai unconfigured is waiting, not failed", () => {
  const nodes = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    extraction: {
      CRAWL4AI_CONFIGURED: false,
      CRAWL4AI_ATTEMPTED: 0,
      CRAWL4AI_SUCCESS: 0,
      CRAWL4AI_FAILED: 0,
      FETCH_FALLBACK_USED: 0,
      FETCH_SUCCESS: 0,
      FETCH_FAILED: 0,
      crawl4ai_failure_samples: [],
    },
  });
  const crawl4ai = nodes.find((n) => n.key === "crawl4ai");
  assert.equal(crawl4ai?.state, "waiting");
});

test("finalProviderNodes: crawl4ai with real failures and zero successes is failed", () => {
  const nodes = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    extraction: {
      CRAWL4AI_CONFIGURED: true,
      CRAWL4AI_ATTEMPTED: 3,
      CRAWL4AI_SUCCESS: 0,
      CRAWL4AI_FAILED: 3,
      FETCH_FALLBACK_USED: 0,
      FETCH_SUCCESS: 0,
      FETCH_FAILED: 0,
      crawl4ai_failure_samples: [],
    },
  });
  const crawl4ai = nodes.find((n) => n.key === "crawl4ai");
  assert.equal(crawl4ai?.state, "failed");
});

test("finalProviderNodes: openai research OK is complete, UNAVAILABLE is degraded (never fails whole scan)", () => {
  const okNodes = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    openai: { research_status: "OK" } as never,
  });
  assert.equal(okNodes.find((n) => n.key === "openai_research")?.state, "complete");

  const degradedNodes = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    openai: { research_status: "OPENAI_RESEARCH_UNAVAILABLE" } as never,
  });
  assert.equal(degradedNodes.find((n) => n.key === "openai_research")?.state, "degraded");
});

test("provider node state is derived from real health, never from source type alone", () => {
  // Same nodeKey ("serpapi"), different health states, must yield different results —
  // proving the mapping isn't hardcoded to a fixed per-provider outcome.
  const healthy = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    providers: {
      providers: [
        {
          provider: "serpapi",
          configured: true,
          healthy: true,
          state: "HEALTHY",
          queriesAttempted: 1,
          queriesSuccessful: 1,
          queriesFailed: 0,
          urlsReturned: 5,
          rateLimited: false,
          creditsExhausted: false,
          latencyMsTotal: 100,
          latencyMsAvg: 100,
        },
      ],
      queries: { attempted: 1, executed: 1, duplicatesPrevented: 0, failed: 0 },
      urls_returned: 5,
      urls_unique: 5,
      duplicates_removed: 0,
      all_providers_down: false,
    },
  });
  const failed = finalProviderNodes({
    sourcesRequested: [],
    sourcesReturned: [],
    providers: {
      providers: [
        {
          provider: "serpapi",
          configured: true,
          healthy: false,
          state: "AUTH_FAILED",
          queriesAttempted: 1,
          queriesSuccessful: 0,
          queriesFailed: 1,
          urlsReturned: 0,
          rateLimited: false,
          creditsExhausted: false,
          latencyMsTotal: 100,
          latencyMsAvg: 100,
          failureReason: "auth",
        },
      ],
      queries: { attempted: 1, executed: 0, duplicatesPrevented: 0, failed: 1 },
      urls_returned: 0,
      urls_unique: 0,
      duplicates_removed: 0,
      all_providers_down: false,
    },
  });
  assert.equal(healthy.find((n) => n.key === "serpapi")?.state, "complete");
  assert.equal(failed.find((n) => n.key === "serpapi")?.state, "failed");
});
