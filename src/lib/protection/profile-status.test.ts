import test from "node:test";
import assert from "node:assert/strict";
import { effectiveProtectionStatus } from "./profile.server";

test("effectiveProtectionStatus: prefers the new protection_status column when populated", () => {
  assert.equal(
    effectiveProtectionStatus({ protection_status: "ACTIVE", status: "PENDING_AUTHORIZATION" }),
    "ACTIVE",
  );
});

test("effectiveProtectionStatus: falls back to the legacy status column for pre-migration rows (protection_status not yet computed)", () => {
  assert.equal(effectiveProtectionStatus({ protection_status: null, status: "ACTIVE" }), "ACTIVE");
  assert.equal(
    effectiveProtectionStatus({ protection_status: null, status: "PENDING_AUTHORIZATION" }),
    "INACTIVE",
  );
});

test("effectiveProtectionStatus: never fabricates a value when neither column has data", () => {
  assert.equal(effectiveProtectionStatus({ protection_status: null, status: null }), null);
  assert.equal(effectiveProtectionStatus(null), null);
  assert.equal(effectiveProtectionStatus(undefined), null);
});
