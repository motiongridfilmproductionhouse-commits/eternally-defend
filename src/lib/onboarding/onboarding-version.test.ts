import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assignVersionForNewAccount,
  normalizeOnboardingVersion,
} from "./version.server";
import {
  primaryEvidenceTypeForAccount,
  requiresFaceProtection,
  requiresRepresentative,
  requiresVeriff,
  v2FlowForAccount,
} from "./v2-config";

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

test("v2 flows match the required account-type routes", () => {
  assert.deepEqual(
    v2FlowForAccount("celebrity").map((s) => s.title),
    [
      "Account Type",
      "Celebrity Profile",
      "Official Contact / Evidence",
      "Face Protection",
      "Digital Assets",
      "Authorization Scope",
      "Authorization Review",
      "Electronic Signature",
      "Certificate",
      "Complete",
    ],
  );
  assert.deepEqual(
    v2FlowForAccount("individual").map((s) => s.title),
    [
      "Account Type",
      "Personal Profile",
      "Veriff",
      "Face Protection",
      "Digital Assets",
      "Authorization Scope",
      "Authorization Review",
      "Electronic Signature",
      "Certificate",
      "Complete",
    ],
  );
  assert.deepEqual(
    v2FlowForAccount("enterprise").map((s) => s.title),
    [
      "Account Type",
      "Company Profile",
      "Representative Details",
      "Company Evidence",
      "Digital Assets",
      "Authorization Scope",
      "Authorization Review",
      "Electronic Signature",
      "Certificate",
      "Complete",
    ],
  );
  assert.deepEqual(
    v2FlowForAccount("production_house").map((s) => s.title),
    [
      "Account Type",
      "Production House Profile",
      "Representative Details",
      "Rights Evidence",
      "Film / Media Assets",
      "Authorization Scope",
      "Authorization Review",
      "Electronic Signature",
      "Certificate",
      "Complete",
    ],
  );
});

test("only individuals require Veriff; face and evidence gates match routes", () => {
  assert.equal(requiresVeriff("individual"), true);
  assert.equal(requiresVeriff("celebrity"), false);
  assert.equal(requiresVeriff("enterprise"), false);
  assert.equal(requiresVeriff("production_house"), false);

  assert.equal(requiresFaceProtection("individual"), true);
  assert.equal(requiresFaceProtection("celebrity"), true);
  assert.equal(requiresFaceProtection("enterprise"), false);
  assert.equal(requiresFaceProtection("production_house"), false);

  assert.equal(requiresRepresentative("enterprise"), true);
  assert.equal(requiresRepresentative("production_house"), true);
  assert.equal(primaryEvidenceTypeForAccount("celebrity"), "official_contact");
  assert.equal(primaryEvidenceTypeForAccount("enterprise"), "company");
  assert.equal(primaryEvidenceTypeForAccount("production_house"), "rights");
  assert.equal(primaryEvidenceTypeForAccount("individual"), null);
});

test("legacy code paths do not accept client-controlled onboarding version", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/onboarding.functions.ts"), "utf8");
  assert.match(source, /onboarding_version: _ignored/);
  assert.match(source, /getOrAssignOnboardingVersion/);
  const progress = readFileSync(
    resolve(process.cwd(), "src/lib/onboarding/progress.functions.ts"),
    "utf8",
  );
  assert.match(progress, /v2 accounts must complete route-specific onboarding/);
  assert.match(progress, /completeV2Onboarding/);
  assert.match(progress, /overall_status: "IN_PROGRESS"/);
  assert.match(progress, /onboarding_version: preservedVersion/);
});

test("partner portal child routes are registered for typed navigation", () => {
  const routeTree = readFileSync(resolve(process.cwd(), "src/routeTree.gen.ts"), "utf8");
  for (const path of [
    "/partner/clients",
    "/partner/proposals",
    "/partner/commissions",
    "/partner/payments",
    "/partner/marketing",
  ]) {
    assert.match(routeTree, new RegExp(`'${path}'`));
  }
});
