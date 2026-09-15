import test from "node:test";
import assert from "node:assert/strict";
import { executeAssessmentScan, type ScanDependencies } from "./scan.ts";
import type { PricingPolicy } from "./policy.ts";

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

function harness(overrides: Partial<ScanDependencies> = {}) {
  const patches: Record<string, unknown>[] = [];
  const deps: ScanDependencies = {
    search: async () => [
      { url: "https://a.com/p", title: "Test Artist", provider: "wikipedia" },
      { url: "https://b.com/p", title: "Test Artist", provider: "wikipedia" },
      { url: "https://c.com/p", title: "Test Artist", provider: "wikipedia" },
    ],
    successfulQueries: () => 2,
    policy: async () => policy,
    persist: async (patch) => {
      patches.push(patch as Record<string, unknown>);
    },
    ...overrides,
  };
  return { deps, patches };
}

test("scan stores a public portrait without affecting signals or pricing", async () => {
  const image = "https://upload.wikimedia.org/wikipedia/commons/a/b/x.jpg";
  const { deps, patches } = harness({ portrait: async () => image });
  await executeAssessmentScan("Test Artist", "https://a.com/p", deps);
  assert.equal(patches.filter((p) => p.image_url === image).length, 1);
  const final = patches.at(-1)!;
  assert.equal(final.status, "READY");
  assert.ok(final.pricing);
  const signals = patches.find((p) => p.signals)!.signals as { matched_pages: number };
  assert.equal(signals.matched_pages, 3);
});

test("a failing or empty portrait lookup never fails the scan", async () => {
  for (const portrait of [
    async () => {
      throw new Error("image lookup down");
    },
    async () => null,
  ] as ScanDependencies["portrait"][]) {
    const { deps, patches } = harness({ portrait });
    await executeAssessmentScan("Test Artist", "https://a.com/p", deps);
    assert.equal(patches.at(-1)!.status, "READY");
    assert.equal(
      patches.some((p) => "image_url" in p),
      false,
    );
  }
});

test("exhausted search providers report capacity, not a generic failure", async () => {
  const { deps, patches } = harness({ search: async () => [], successfulQueries: () => 0 });
  await executeAssessmentScan("Test Artist", "https://a.com/p", deps);
  const final = patches.at(-1)!;
  assert.equal(final.status, "FAILED");
  assert.equal(final.pricing, null);
  assert.match(String(final.reason), /search capacity is currently unavailable/i);
});
