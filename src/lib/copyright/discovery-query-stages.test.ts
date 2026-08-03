import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStagedDiscoveryQueries,
  flattenStagedQueries,
  hasAdequateDiscoveryCoverage,
} from "./discovery-query-stages";
import { TARGET_DISCOVERY_CANDIDATES } from "./discovery-config";
import type { ReferenceAnalysis } from "./discover.server";

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

test("stage 1 alone is smaller than full staged query union", () => {
  const staged = buildStagedDiscoveryQueries(analysis, "Chinna Chinna Aasai");
  const stage1 = staged.stages.find((s) => s.stage === 1)?.plans.length ?? 0;
  const full = flattenStagedQueries(staged).length;
  assert.ok(stage1 > 0);
  assert.ok(full > stage1);
  assert.ok(full >= 40);
});

test("adequate coverage uses TARGET not a hard minimum", () => {
  assert.equal(TARGET_DISCOVERY_CANDIDATES, 30);
  assert.equal(hasAdequateDiscoveryCoverage(29), false);
  assert.equal(hasAdequateDiscoveryCoverage(30), true);
  assert.equal(hasAdequateDiscoveryCoverage(200), true);
});

test("staged queries include platform registry site: seeds in stage 3", () => {
  const staged = buildStagedDiscoveryQueries(analysis, "Chinna Chinna Aasai");
  const stage3 = staged.stages.find((s) => s.stage === 3)?.plans ?? [];
  const joined = stage3.map((p) => p.query).join("\n");
  assert.match(joined, /site:archive\.org/);
  assert.match(joined, /site:bilibili\.tv/);
});
