import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateInvite, isRateLimited, normalizeInviteCode, type InviteRow } from "./evaluate";

const base: InviteRow = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "active",
  expires_at: null,
  max_uses: 1,
  use_count: 0,
  assigned_email: null,
  account_type: null,
};

describe("invite evaluation rules", () => {
  test("valid code → signup allowed", () => {
    const r = evaluateInvite(base, "new@user.com");
    assert.equal(r.ok, true);
  });

  test("invalid / unknown code → blocked", () => {
    assert.deepEqual(evaluateInvite(null, "new@user.com"), { ok: false, reason: "not_found" });
  });

  test("expired code → blocked", () => {
    const r = evaluateInvite(
      { ...base, expires_at: new Date(Date.now() - 1000).toISOString() },
      "new@user.com",
    );
    assert.deepEqual(r, { ok: false, reason: "expired" });
  });

  test("revoked and inactive codes → blocked", () => {
    assert.equal(evaluateInvite({ ...base, status: "revoked" }, "a@b.com").ok, false);
    assert.equal(evaluateInvite({ ...base, status: "inactive" }, "a@b.com").ok, false);
  });

  test("max-use code → blocked after limit", () => {
    assert.equal(evaluateInvite({ ...base, max_uses: 2, use_count: 1 }, "a@b.com").ok, true);
    assert.deepEqual(evaluateInvite({ ...base, max_uses: 2, use_count: 2 }, "a@b.com"), {
      ok: false,
      reason: "exhausted",
    });
  });

  test("email-bound code rejects another email, accepts its own (case/space-insensitive)", () => {
    const bound = { ...base, assigned_email: "Star@Eterna.com" };
    assert.deepEqual(evaluateInvite(bound, "someone@else.com"), {
      ok: false,
      reason: "email_mismatch",
    });
    assert.equal(evaluateInvite(bound, " star@eterna.com ").ok, true);
    // Pre-signup check (no email yet) must not reveal the mismatch.
    assert.equal(evaluateInvite(bound, "").ok, true);
  });

  test("code normalization is stable for hashing", () => {
    assert.equal(normalizeInviteCode(" etrn-ab cd "), "ETRN-ABCD");
  });

  test("invalid-attempt rate limit trips at the threshold", () => {
    assert.equal(isRateLimited(9), false);
    assert.equal(isRateLimited(10), true);
  });
});
