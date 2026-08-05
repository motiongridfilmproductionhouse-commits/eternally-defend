import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assignVersionForNewAccount, normalizeOnboardingVersion } from "./version.server";

const activation = "2026-08-10T00:00:00.000Z";
const enabledEnv = {
  ACCOUNT_TYPE_ONBOARDING_ENABLED: "true",
  ACCOUNT_TYPE_ONBOARDING_ACTIVATION_AT: activation,
};

test("accounts created before activation remain v1", () => {
  assert.equal(assignVersionForNewAccount("2026-08-09T23:59:59.000Z", enabledEnv), "v1");
});

test("new accounts after activation receive v2", () => {
  assert.equal(assignVersionForNewAccount("2026-08-10T00:00:00.000Z", enabledEnv), "v2");
});

test("disabled or unconfigured activation never assigns v2", () => {
  assert.equal(
    assignVersionForNewAccount("2027-01-01T00:00:00.000Z", {
      ACCOUNT_TYPE_ONBOARDING_ENABLED: "false",
    }),
    "v1",
  );
  assert.equal(
    assignVersionForNewAccount("2027-01-01T00:00:00.000Z", {
      ACCOUNT_TYPE_ONBOARDING_ENABLED: "true",
    }),
    "v1",
  );
});

test("null and unknown versions are legacy, while only explicit v2 is new", () => {
  assert.equal(normalizeOnboardingVersion(null), "v1");
  assert.equal(normalizeOnboardingVersion("v1"), "v1");
  assert.equal(normalizeOnboardingVersion("v2"), "v2");
  assert.equal(normalizeOnboardingVersion("celebrity"), "v1");
});

test("migration does not backfill or default existing onboarding records", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260806100000_account_type_onboarding_v2.sql"),
    "utf8",
  );
  assert.match(migration, /add column if not exists onboarding_version text;/i);
  assert.doesNotMatch(migration, /update\s+public\.(client_profiles|onboarding_progress)/i);
  assert.doesNotMatch(migration, /default\s+'v2'/i);
});

test("legacy code paths do not accept client-controlled onboarding version", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/onboarding.functions.ts"), "utf8");
  assert.match(source, /key !== "onboarding_version"/);
  assert.match(source, /getOrAssignOnboardingVersion/);
  const progress = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/progress.functions.ts"),
    "utf8",
  );
  assert.match(progress, /v2 accounts must complete route-specific onboarding/);
});

test("legacy completion and verification records are not rewritten by the new route", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/progress.functions.ts"),
    "utf8",
  );
  assert.match(source, /onboardingVersion === "v2"/);
  assert.match(source, /completeV2Onboarding/);
  assert.match(source, /verification_status.*APPROVED/);
  assert.doesNotMatch(source, /from\("kyc_verifications"\).*update/);
});
