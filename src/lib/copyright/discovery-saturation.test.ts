import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DISCOVERY_CANDIDATES,
  TARGET_DISCOVERY_CANDIDATES,
} from "./discovery-config";
import {
  buildCoverageStateFromPageKeys,
  expandPlansForDiscoveryMode,
  hasBroadDiscoveryCoverage,
  resolveDiscoveryMode,
  shouldIssueDiscoveryPlan,
  shouldSkipStageExpansion,
} from "./discovery-saturation";
import { runBatchedDiscovery } from "./discovery-runtime";
import type { DiscoveryQueryPlan } from "./discovery-query-stages";

function dailymotionUrls(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `https://www.dailymotion.com/video/chinna-${i}`);
}

test("30 candidates from one domain is not broad coverage", () => {
  const state = buildCoverageStateFromPageKeys(dailymotionUrls(30));
  assert.equal(state.uniqueCandidateUrls, 30);
  assert.equal(state.uniqueDomains, 1);
  assert.equal(hasBroadDiscoveryCoverage(state), false);
  assert.equal(shouldSkipStageExpansion(3, state), false);
});

test("broad coverage requires multiple domains and platform categories", () => {
  const urls = [
    ...dailymotionUrls(8),
    ...Array.from({ length: 8 }, (_, i) => `https://archive.org/details/movie-${i}`),
    ...Array.from({ length: 8 }, (_, i) => `https://mega.nz/file/${i}`),
    ...Array.from({ length: 8 }, (_, i) => `https://1337x.to/torrent/${i}`),
  ];
  const state = buildCoverageStateFromPageKeys(urls);
  assert.equal(state.uniqueCandidateUrls, 32);
  assert.ok(state.uniqueDomains >= 4);
  assert.ok(state.platformCategoriesCovered.length >= 3);
  assert.equal(hasBroadDiscoveryCoverage(state), true);
  assert.equal(shouldSkipStageExpansion(2, state), true);
});

test("reaching target switches to coverage mode without blocking high-priority site queries", () => {
  const state = buildCoverageStateFromPageKeys(dailymotionUrls(30));
  assert.equal(resolveDiscoveryMode(state.uniqueCandidateUrls), "coverage");
  const sitePlan: DiscoveryQueryPlan = {
    query: 'site:archive.org "Chinna Chinna Aasai"',
    recent: false,
    priority: true,
    stage: 3,
  };
  const stage2Plan: DiscoveryQueryPlan = {
    query: '"Chinna Chinna Aasai" tamil dubbed watch online',
    recent: false,
    priority: false,
    stage: 2,
  };
  assert.equal(shouldIssueDiscoveryPlan(sitePlan, state).issue, true);
  assert.equal(shouldIssueDiscoveryPlan(stage2Plan, state).issue, true);
});

test("broad coverage at target stops unnecessary stage 2 expansion", () => {
  const urls = [
    ...dailymotionUrls(8),
    ...Array.from({ length: 8 }, (_, i) => `https://archive.org/details/movie-${i}`),
    ...Array.from({ length: 8 }, (_, i) => `https://mega.nz/file/${i}`),
    ...Array.from({ length: 8 }, (_, i) => `https://1337x.to/torrent/${i}`),
  ];
  const state = buildCoverageStateFromPageKeys(urls);
  const stage2Plan: DiscoveryQueryPlan = {
    query: '"Chinna Chinna Aasai" tamil dubbed watch online',
    recent: false,
    priority: false,
    stage: 2,
  };
  assert.equal(shouldSkipStageExpansion(2, state), true);
  assert.equal(shouldIssueDiscoveryPlan(stage2Plan, state).issue, false);
});

test("coverage mode reduces low-priority pagination", () => {
  const plans: DiscoveryQueryPlan[] = [
    { query: '"Title" watch online', recent: false, priority: true, stage: 1 },
  ];
  const full = expandPlansForDiscoveryMode(plans, "full", 2);
  const coverage = expandPlansForDiscoveryMode(plans, "coverage", 2);
  assert.ok(full.length > coverage.length);
  assert.equal(coverage.length, 1);
});

test("MAX_DISCOVERY_CANDIDATES is the only hard stop for unique pages", async () => {
  let issued = 0;
  const result = await runBatchedDiscovery({
    plans: Array.from({ length: 8 }, (_, i) => `plan-${i}`),
    stopWhenUniquePagesAtLeast: MAX_DISCOVERY_CANDIDATES,
    uniquePageCount: () => TARGET_DISCOVERY_CANDIDATES + 5,
    shouldIssuePlan: () => true,
    execute: async () => {
      issued += 1;
      return { ok: true };
    },
  });
  assert.equal(issued, 8);
  assert.equal(result.stoppedEarly, false);
});

test("runBatchedDiscovery finishes active wave after target while skipping new low-priority plans", async () => {
  const executed: string[] = [];
  const result = await runBatchedDiscovery({
    plans: ["high-a", "low-b", "high-c", "low-d"],
    uniquePageCount: () =>
      executed.length >= 2 ? TARGET_DISCOVERY_CANDIDATES : executed.length,
    shouldIssuePlan: (plan) => !String(plan).startsWith("low"),
    execute: async (plan) => {
      executed.push(String(plan));
      return { ok: true };
    },
  });
  assert.deepEqual(executed, ["high-a", "high-c"]);
  assert.equal(result.skippedPlans, 2);
  assert.equal(result.stoppedEarly, false);
});

test("saturation mode above 60 stops non-priority queries", () => {
  const state = buildCoverageStateFromPageKeys(
    Array.from({ length: 65 }, (_, i) => `https://host-${i % 8}.example/movie-${i}`),
  );
  assert.equal(resolveDiscoveryMode(state.uniqueCandidateUrls), "saturation");
  assert.equal(
    shouldIssueDiscoveryPlan(
      { query: '"Title" dubbed watch', recent: false, priority: false, stage: 2 },
      state,
    ).issue,
    false,
  );
});
