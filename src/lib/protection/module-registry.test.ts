import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_REGISTRY, moduleConfig } from "./module-registry";

test("Phase 2: every module has exactly one of the four known drivers", () => {
  const known = new Set(["orchestrator", "self-cron", "not-yet-automated", "reactive"]);
  for (const m of MODULE_REGISTRY) {
    assert.ok(known.has(m.driver), `${m.key} has unknown driver ${m.driver}`);
  }
});

test("Phase 2: no module is left not-yet-automated after Phase 2", () => {
  const stillManual = MODULE_REGISTRY.filter((m) => m.driver === "not-yet-automated");
  assert.deepEqual(stillManual, [], "expected all six Phase 2 modules to have a real driver");
});

test("Phase 2: deepfake/copyright/youtube-removal/narrative are orchestrator-driven", () => {
  for (const key of [
    "deepfake_intel",
    "copyright_intel",
    "youtube_removal",
    "narrative_intelligence",
  ]) {
    assert.equal(moduleConfig(key)?.driver, "orchestrator", key);
  }
});

test("Phase 2: face_protection is self-cron (status mirror, no independent scan)", () => {
  assert.equal(moduleConfig("face_protection")?.driver, "self-cron");
});

test("Phase 2: evidence_prep is reactive (byproduct of other modules, not scheduled itself)", () => {
  assert.equal(moduleConfig("evidence_prep")?.driver, "reactive");
});

test("module_key values are unique", () => {
  const keys = MODULE_REGISTRY.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
});
