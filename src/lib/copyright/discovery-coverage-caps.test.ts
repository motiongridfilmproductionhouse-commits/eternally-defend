/**
 * Guards against the critical regression where discovery stops after a handful
 * of verified matches (e.g. only dailymotion + archive).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DISCOVERY_EARLY_STOP_UNIQUE_PAGES,
  runBatchedDiscovery,
} from "./discovery-runtime";
import { DEFAULT_PAGE_CAP, SCAN_TOTAL_BUDGET_MS } from "./crawl-budget";
import { prioritizeKnownUrlLeads } from "./known-urls.server";
import { buildQueries, type ReferenceAnalysis } from "./discover.server";

const analysis: ReferenceAnalysis = {
  title: "Chinna Chinna Aasai",
  altTitles: [],
  language: "malayalam",
  audienceLanguages: [],
  region: null,
  actors: [],
  productionCompany: null,
  releaseDate: "2026-01-01",
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

test("discovery early-stop is effectively disabled", () => {
  assert.ok(DISCOVERY_EARLY_STOP_UNIQUE_PAGES >= 10_000);
});

test("page crawl cap allows broad multi-host investigations", () => {
  assert.ok(DEFAULT_PAGE_CAP >= 100);
  assert.ok(SCAN_TOTAL_BUDGET_MS >= 400_000);
});

test("runBatchedDiscovery does not stop after 3 unique pages", async () => {
  let calls = 0;
  const result = await runBatchedDiscovery({
    plans: Array.from({ length: 12 }, (_, i) => `q-${i}`),
    earlyStopUniquePages: DISCOVERY_EARLY_STOP_UNIQUE_PAGES,
    uniquePageCount: (attempts) => attempts.length * 3,
    execute: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(result.stoppedEarly, false);
  assert.equal(calls, 12);
});

test("prioritizeKnownUrlLeads keeps far more than 3 provider candidates", () => {
  const known = [{ url: "https://known.example/a" }];
  const provider = Array.from({ length: 80 }, (_, i) => ({
    url: `https://piracy.example/movie-${i}`,
  }));
  const ordered = prioritizeKnownUrlLeads(known, provider, DEFAULT_PAGE_CAP);
  assert.ok(ordered.length >= 50);
  assert.ok(ordered.some((l) => l.url.includes("piracy.example/movie-40")));
});

test("search expansion includes platform-specific site queries", () => {
  const plans = buildQueries(analysis, "Chinna Chinna Aasai");
  const joined = plans.map((p) => p.query).join("\n");
  assert.match(joined, /site:ogomovies1\.com\.pk/);
  assert.match(joined, /site:bilibili\.tv/);
  assert.match(joined, /site:terabox\.app/);
  assert.match(joined, /site:archive\.org/);
  assert.match(joined, /HDRip|WEBRip|CAM|HDTS|mkv|mp4/i);
});

test("executor has no hard 3-match or 20-lead truncations", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/copyright.functions.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /MAX_RESULTS\s*=\s*3/);
  assert.doesNotMatch(src, /verified\.slice\(0,\s*3\)/);
  assert.doesNotMatch(src, /candidate_limit\s*=\s*20/);
  assert.doesNotMatch(src, /topMatchesOnly/);
  assert.doesNotMatch(src, /firstMatches/);
  assert.doesNotMatch(src, /pageLeads\.slice\(0,\s*20\)/);
  assert.match(src, /detailFollowRecorder\.drain\(80\)/);
});
