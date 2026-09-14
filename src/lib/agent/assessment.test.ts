import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeArtist,
  validateProfile,
  assertAgentAccess,
  estimateProtection,
  type PricingPolicy,
} from "./policy.ts";
import { executeAssessmentScan } from "./scan.ts";
import { isTerminal } from "./model.ts";
const policy: PricingPolicy = {
  version: 1,
  enabled: true,
  minimum_pages: 3,
  minimum_domains: 2,
  base_annual: 1000,
  annual_per_domain: 100,
  review_minutes_per_page_month: 5,
  hourly_review_rate: 60,
  range_margin: 0.2,
};
test("agent authorization and ownership fail closed", () => {
  assert.throws(() => assertAgentAccess(null, true, false));
  assert.throws(() => assertAgentAccess("client", false, false));
  assert.throws(() => assertAgentAccess("a", true, false, "b"));
  assert.doesNotThrow(() => assertAgentAccess("a", true, false, "a"));
  assert.doesNotThrow(() => assertAgentAccess("admin", false, true, "a"));
  assert.throws(() => assertAgentAccess("disabled", false, false, "disabled"));
});
test("normalizes artist names and rejects invalid input", () => {
  assert.equal(normalizeArtist("  Test   Artist  "), "Test Artist");
  assert.throws(() => normalizeArtist("a"));
  assert.throws(() => normalizeArtist("Test\u0000Artist"));
});
test("rejects SSRF destinations, credentials, ports, malformed URLs", () => {
  for (const raw of [
    "http://example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "https://x.internal",
    "https://user:pass@example.com",
    "https://example.com:8080",
    "file:///etc/passwd",
    "garbage",
  ])
    assert.throws(() => validateProfile(raw), raw);
  assert.equal(
    validateProfile("https://www.instagram.com/artist/#bio"),
    "https://www.instagram.com/artist/",
  );
  assert.equal(validateProfile(""), null);
});
test("commercial range is deterministic and cannot come from scan-supplied pricing", () => {
  const signals = { matched_pages: 3, domains: 2, official_profile_found: true, price: 999999 };
  assert.deepEqual(estimateProtection(signals, policy).pricing, {
    minimum: 1104,
    maximum: 1656,
    currency: "INR",
    period: "YEAR",
    policy_version: 1,
  });
  assert.deepEqual(estimateProtection(signals, policy), estimateProtection(signals, policy));
  assert.equal(estimateProtection(signals, null).pricing, null);
  assert.equal(estimateProtection(signals, { ...policy, enabled: false }).pricing, null);
  assert.equal(estimateProtection({ ...signals, matched_pages: 1 }, policy).pricing, null);
  assert.equal(
    estimateProtection({ ...signals, official_profile_found: false }, policy).pricing,
    null,
  );
  assert.throws(() => estimateProtection(signals, { ...policy, hourly_review_rate: NaN }));
});
async function scan(
  options: {
    fail?: boolean;
    hits?: { url: string; title: string }[];
    successes?: number;
    config?: PricingPolicy | null;
  } = {},
) {
  const patches: Record<string, unknown>[] = [];
  await executeAssessmentScan("Test Artist", "https://artist.com/profile", {
    search: async () => {
      if (options.fail) throw new Error("Provider outage");
      return options.hits ?? [];
    },
    successfulQueries: () => options.successes ?? 1,
    policy: async () => (options.config === undefined ? policy : options.config),
    persist: async (patch) => {
      patches.push(patch);
    },
  });
  return patches;
}
test("scan outage never returns a fabricated price", async () => {
  const patches = await scan({ fail: true });
  assert.equal(patches.at(-1)?.status, "FAILED");
  assert.equal(patches.at(-1)?.pricing, null);
});
test("all providers unavailable is failure, not zero exposure", async () => {
  assert.equal((await scan({ successes: 0 })).at(-1)?.status, "FAILED");
});
test("empty successful search requires manual review", async () => {
  const patches = await scan();
  assert.equal(patches.at(-1)?.status, "REVIEW_REQUIRED");
  assert.equal(patches.at(-1)?.pricing, null);
});
test("real evidence drives stages, deduplication and configured estimate", async () => {
  const patches = await scan({
    hits: [
      { url: "https://artist.com/profile", title: "Test Artist official" },
      { url: "https://news.com/a", title: "Test Artist interview" },
      { url: "https://news.com/b", title: "Test Artist news" },
      { url: "https://news.com/unrelated", title: "Other Person" },
    ],
  });
  assert.equal(patches.at(-1)?.status, "READY");
  const signals = patches.find((p) => p.signals)?.signals as Record<string, unknown>;
  assert.equal(signals.matched_pages, 3);
  assert.equal(signals.domains, 2);
  assert.equal(signals.ai_misuse, null);
  assert.equal(patches[0].status, "SCANNING");
  assert.ok(patches.some((p) => p.status === "ANALYZING"));
});
test("polling ends for every terminal outcome", () => {
  for (const status of ["READY", "FAILED", "REVIEW_REQUIRED", "EXPIRED"] as const)
    assert.equal(isTerminal(status), true);
  assert.equal(isTerminal("SCANNING"), false);
});
