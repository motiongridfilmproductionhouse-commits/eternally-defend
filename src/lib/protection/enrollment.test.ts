import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_REGISTRY, computeEnrollmentPatch } from "./module-registry";

const NOW = "2026-08-23T00:00:00.000Z";

test("one activation enrolls all eligible modules", () => {
  // Simulates a customer granted every scope Phase 1's authorization
  // scopes cover — the real activation path (finalizeSignature ->
  // enrollEligibleModules) grants scopes per what the customer selected;
  // this asserts every module whose scopeKey is granted comes back eligible.
  const grantedScopes = new Set(MODULE_REGISTRY.map((m) => m.scopeKey));
  for (const mod of MODULE_REGISTRY) {
    const patch = computeEnrollmentPatch(mod, true, grantedScopes, undefined, NOW);
    assert.equal(patch.eligible, true, mod.key);
  }
});

test("a module whose scope was not granted is not eligible", () => {
  const grantedScopes = new Set(["monitor_public"]); // only Reputation's scope
  const deepfake = MODULE_REGISTRY.find((m) => m.key === "deepfake_intel")!;
  const patch = computeEnrollmentPatch(deepfake, true, grantedScopes, undefined, NOW);
  assert.equal(patch.eligible, false);
});

test("inactive authorization makes every module ineligible regardless of scopes", () => {
  const grantedScopes = new Set(MODULE_REGISTRY.map((m) => m.scopeKey));
  const mod = MODULE_REGISTRY[0];
  const patch = computeEnrollmentPatch(mod, false, grantedScopes, undefined, NOW);
  assert.equal(patch.eligible, false);
});

test("initial scan is queued exactly once: first eligibility sets next_scan_at=now, re-running does not push it again", () => {
  const grantedScopes = new Set(["prepare_copyright"]);
  const mod = MODULE_REGISTRY.find((m) => m.key === "copyright_intel")!;

  // First activation: no existing row -> newly eligible -> queued now.
  const first = computeEnrollmentPatch(mod, true, grantedScopes, undefined, NOW);
  assert.equal(first.next_scan_at, NOW);
  assert.equal(first.current_status, "QUEUED");

  // Second activation (e.g. a retried/duplicate finalizeSignature call, or
  // the backfill re-running): existing row already eligible -> must NOT
  // touch next_scan_at/current_status again, so an in-flight or completed
  // scan's schedule is never disturbed.
  const later = "2026-08-24T00:00:00.000Z";
  const second = computeEnrollmentPatch(
    mod,
    true,
    grantedScopes,
    { module_key: mod.key, eligible: true },
    later,
  );
  assert.equal("next_scan_at" in second, false, "must not re-queue an already-eligible module");
  assert.equal("current_status" in second, false);
});

test("a module that becomes eligible later (e.g. new scope granted) is queued at that point, not before", () => {
  const mod = MODULE_REGISTRY.find((m) => m.key === "youtube_removal")!;

  // Not eligible yet.
  const before = computeEnrollmentPatch(mod, true, new Set(), undefined, NOW);
  assert.equal(before.eligible, false);
  assert.equal("next_scan_at" in before, true);
  assert.equal(before.next_scan_at, null);

  // Scope granted later -> becomes newly eligible -> queued now.
  const later = "2026-08-24T00:00:00.000Z";
  const after = computeEnrollmentPatch(
    mod,
    true,
    new Set(["monitor_verified_assets"]),
    { module_key: mod.key, eligible: false },
    later,
  );
  assert.equal(after.eligible, true);
  assert.equal(after.next_scan_at, later);
  assert.equal(after.current_status, "QUEUED");
});
