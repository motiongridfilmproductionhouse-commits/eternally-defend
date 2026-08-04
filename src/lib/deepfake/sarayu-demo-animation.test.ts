import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  sarayuDemoProgressAt,
  sarayuDemoSessionKey,
  SARAYU_DEMO_DURATION_MS,
} from "./sarayu-demo-animation";

test("Sarayu demo progresses through the six staged presentation phases", () => {
  assert.equal(sarayuDemoProgressAt(0).stage, "identity");
  assert.equal(sarayuDemoProgressAt(2_000).stage, "embeddings");
  assert.equal(sarayuDemoProgressAt(5_000).stage, "discovery");
  assert.equal(sarayuDemoProgressAt(8_000).stage, "analysis");
  assert.equal(sarayuDemoProgressAt(11_000).stage, "verification");
  assert.equal(sarayuDemoProgressAt(13_000).stage, "classification");
  assert.equal(sarayuDemoProgressAt(SARAYU_DEMO_DURATION_MS).stage, "complete");
});

test("Sarayu demo reaches the deterministic presentation counters", () => {
  const progress = sarayuDemoProgressAt(SARAYU_DEMO_DURATION_MS);
  assert.equal(progress.queries, 39);
  assert.equal(progress.domains, 3);
  assert.equal(progress.pages, 7);
  assert.equal(progress.faceComparisons, 7);
  assert.equal(progress.verifiedPages, 7);
  assert.equal(progress.highRiskFindings, 7);
});

test("Sarayu animation keys are isolated by scan or profile and never need persisted scan state", () => {
  assert.equal(sarayuDemoSessionKey("scan-1", "profile-1"), "sarayu-demo-animation:scan-1");
  assert.equal(sarayuDemoSessionKey(null, "profile-1"), "sarayu-demo-animation:profile:profile-1");
  assert.equal(sarayuDemoSessionKey(null, null), null);
});

test("the route gates results only during the presentation and exposes skip/replay controls", () => {
  const route = readFileSync("src/routes/_app.deepfake-intel.tsx", "utf8");
  assert.match(route, /useSarayuDemoSequence/);
  assert.match(route, /showSarayuDemo/);
  assert.match(route, /!showSarayuDemo/);
  assert.match(route, /SarayuDemoScanSequence/);
  assert.match(route, /sarayuDemo\.replay/);
  const component = readFileSync("src/components/deepfake/SarayuDemoScanSequence.tsx", "utf8");
  assert.match(component, /Skip animation/);
  assert.match(component, /Replay scan animation/);
  assert.match(component, /sessionStorage/);
  assert.match(component, /setActive\(false\)/);
});
