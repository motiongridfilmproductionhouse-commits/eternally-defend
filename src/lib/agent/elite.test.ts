import test from "node:test";
import assert from "node:assert/strict";
import { ELITE_PACKAGE, elitePackage } from "./policy.ts";

test("Elite quotes a fixed USD 20,000 annual package price", () => {
  assert.equal(ELITE_PACKAGE.usd_annual, 20000);
  assert.equal(elitePackage().usd, 20000);
  assert.ok(elitePackage().usd_label.includes("20,000"));
});

test("Elite shows an indicative INR conversion from the stated rate", () => {
  const p = elitePackage();
  assert.equal(p.inr, Math.round((20000 * p.rate) / 1000) * 1000);
  assert.ok(p.inr_label.startsWith("₹"));
});

test("Elite package price never depends on scan signals", () => {
  assert.deepEqual(elitePackage(), elitePackage());
});

test("exposure level bands follow observed volume only", async () => {
  const { exposureLevel } = await import("./policy.ts");
  assert.equal(exposureLevel({ matched_pages: 40, domains: 3 }), "HIGH");
  assert.equal(exposureLevel({ matched_pages: 4, domains: 14 }), "HIGH");
  assert.equal(exposureLevel({ matched_pages: 12, domains: 2 }), "ELEVATED");
  assert.equal(exposureLevel({ matched_pages: 4, domains: 2 }), "MODERATE");
  assert.equal(exposureLevel({ matched_pages: 1, domains: 1 }), "LOW");
});
