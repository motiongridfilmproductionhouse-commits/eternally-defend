import assert from "node:assert/strict";
import test from "node:test";
import {
  isSarayuMohanIdentity,
  normalizeIdentityName,
  resolveActiveIdentityName,
} from "./identity-state";

test("selected Sarayu scan identity works without a selected profile", () => {
  const active = resolveActiveIdentityName({
    scan: { target_name: "Sarayu Mohan" },
  });
  assert.equal(active, "Sarayu Mohan");
  assert.equal(isSarayuMohanIdentity(active), true);
});

test("active identity source priority prefers profile, scan, selected scan, then input", () => {
  assert.equal(
    resolveActiveIdentityName({
      selectedProfileName: "Sarayu Mohan",
      scan: { target_name: "Other Identity" },
      selectedScan: { target_name: "Another Identity" },
      targetName: "Last Identity",
    }),
    "Sarayu Mohan",
  );
  assert.equal(
    resolveActiveIdentityName({
      scan: { identity_name: "Sarayu Mohan" },
      selectedScan: { target_name: "Other Identity" },
      targetName: "Last Identity",
    }),
    "Sarayu Mohan",
  );
});

test("profile selection and target input identify Sarayu", () => {
  assert.equal(
    isSarayuMohanIdentity(resolveActiveIdentityName({ selectedProfileName: "Sarayu Mohan" })),
    true,
  );
  assert.equal(
    isSarayuMohanIdentity(resolveActiveIdentityName({ targetName: "sarayu mohan" })),
    true,
  );
});

test("Sarayu spacing variants normalize and other identities do not match", () => {
  assert.equal(normalizeIdentityName("Sarayu Mohan"), "sarayumohan");
  assert.equal(normalizeIdentityName("sarayu mohan"), "sarayumohan");
  assert.equal(normalizeIdentityName("S a r a y u   M o h a n"), "sarayumohan");
  assert.equal(isSarayuMohanIdentity("Maya Kapoor"), false);
});
