import assert from "node:assert/strict";
import test from "node:test";
import {
  activeIdentityScanNodeIds,
  identityModelReadyCopy,
  identityScanProgressMetrics,
  identityScanRingTone,
  identityScanStageMessage,
  identityScanStatusHeadline,
  pickPrimaryReferenceFace,
  resolveIdentityScanVizMode,
  scanBelongsToSelectedProfile,
  shouldAnimateIdentityScan,
} from "./identity-scan-viz";

test("idle mode when profile selected with no scan", () => {
  assert.equal(
    resolveIdentityScanVizMode({ hasSelectedProfile: true, scanStatus: null }),
    "idle",
  );
  assert.equal(identityScanStatusHeadline("idle"), "Ready to scan.");
  assert.equal(identityScanRingTone("idle"), "cyan");
  assert.equal(shouldAnimateIdentityScan("idle", false), true);
  assert.equal(shouldAnimateIdentityScan("idle", true), false);
});

test("empty mode when no profile selected", () => {
  assert.equal(
    resolveIdentityScanVizMode({ hasSelectedProfile: false, scanStatus: "running" }),
    "empty",
  );
  assert.equal(identityScanStatusHeadline("empty"), "");
});

test("running mode activates discovery stage nodes and stage copy", () => {
  assert.equal(
    resolveIdentityScanVizMode({
      hasSelectedProfile: true,
      scanStatus: "running",
    }),
    "running",
  );
  assert.equal(
    identityScanStageMessage("discovering"),
    "Searching public sources",
  );
  assert.equal(
    identityScanStageMessage("verifying"),
    "Validating evidence URLs",
  );
  assert.equal(
    identityScanStageMessage("classifying"),
    "Inspecting media",
  );
  assert.equal(
    identityScanStageMessage("saving"),
    "Saving verified findings",
  );
  const nodes = activeIdentityScanNodeIds("discovering", "running");
  assert.ok(nodes.includes("web_discovery"));
  assert.ok(!nodes.includes("evidence_classification"));
  assert.equal(shouldAnimateIdentityScan("running", false), true);
  assert.equal(shouldAnimateIdentityScan("running", true), false);
});

test("partial mode pauses animation and shows verified progress copy", () => {
  assert.equal(
    resolveIdentityScanVizMode({
      hasSelectedProfile: true,
      scanStatus: "partial",
    }),
    "partial",
  );
  assert.equal(
    identityScanStatusHeadline("partial"),
    "Verified progress saved",
  );
  assert.equal(identityScanRingTone("partial"), "amber");
  assert.equal(shouldAnimateIdentityScan("partial", false), false);
});

test("completed mode uses green verified ring and lights all nodes", () => {
  assert.equal(
    resolveIdentityScanVizMode({
      hasSelectedProfile: true,
      scanStatus: "completed",
    }),
    "completed",
  );
  assert.equal(identityScanRingTone("completed"), "green");
  assert.equal(
    activeIdentityScanNodeIds("done", "completed").length,
    6,
  );
  assert.equal(shouldAnimateIdentityScan("completed", false), false);
});

test("failed mode stops animation and uses red status ring", () => {
  assert.equal(
    resolveIdentityScanVizMode({
      hasSelectedProfile: true,
      scanStatus: "failed",
    }),
    "failed",
  );
  assert.equal(identityScanRingTone("failed"), "red");
  assert.equal(shouldAnimateIdentityScan("failed", false), false);
  assert.deepEqual(activeIdentityScanNodeIds("discovering", "failed"), []);
});

test("missing thumbnail falls back via null primary face", () => {
  assert.equal(pickPrimaryReferenceFace([]), null);
  assert.equal(pickPrimaryReferenceFace(null), null);
  const primary = pickPrimaryReferenceFace([
    { id: "b", created_at: "2026-08-01T12:00:00.000Z" },
    { id: "a", created_at: "2026-07-01T12:00:00.000Z" },
  ]);
  assert.equal(primary?.id, "a");
});

test("enrollment copy and model-ready gate", () => {
  assert.deepEqual(identityModelReadyCopy(0), {
    enrollmentLine: "0 reference photos enrolled",
    modelLine: null,
  });
  assert.deepEqual(identityModelReadyCopy(1), {
    enrollmentLine: "1 reference photo enrolled",
    modelLine: null,
  });
  assert.deepEqual(identityModelReadyCopy(5), {
    enrollmentLine: "5 reference photos enrolled",
    modelLine: "Identity model ready.",
  });
});

test("progress metrics never invent percentages", () => {
  assert.deepEqual(identityScanProgressMetrics({}), []);
  const metrics = identityScanProgressMetrics({
    executedQueries: 12,
    plannedQueries: 40,
    pagesVerified: 3,
    threatsSaved: 1,
  });
  assert.equal(metrics.length, 3);
  assert.ok(metrics.every((item) => !/%/.test(item.label)));
  assert.ok(metrics.some((item) => item.label.includes("12/40")));
});

test("reduced-motion disables animation for idle and running", () => {
  assert.equal(shouldAnimateIdentityScan("idle", true), false);
  assert.equal(shouldAnimateIdentityScan("running", true), false);
  assert.equal(shouldAnimateIdentityScan("partial", true), false);
});

test("scan telemetry binds only to the matching identity profile", () => {
  assert.equal(
    scanBelongsToSelectedProfile({
      scanProfileId: "profile-a",
      selectedProfileId: "profile-a",
      selectedProfileName: "Ada Lovelace",
    }),
    true,
  );
  assert.equal(
    scanBelongsToSelectedProfile({
      scanProfileId: "profile-b",
      selectedProfileId: "profile-a",
      selectedProfileName: "Ada Lovelace",
    }),
    false,
  );
  assert.equal(
    scanBelongsToSelectedProfile({
      scanProfileId: null,
      scanTargetName: "Ada Lovelace",
      selectedProfileId: "profile-a",
      selectedProfileName: "Ada Lovelace",
    }),
    true,
  );
  assert.equal(
    scanBelongsToSelectedProfile({
      scanProfileId: null,
      scanTargetName: "Other Person",
      selectedProfileId: "profile-a",
      selectedProfileName: "Ada Lovelace",
    }),
    false,
  );
});
