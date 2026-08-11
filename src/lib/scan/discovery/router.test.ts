/**
 * Discovery Router failover contract: a Firecrawl outage (402 credits / 429
 * rate limit) must never zero out discovery while another provider is healthy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError, type SearchProviderAdapter } from "./provider";
import { DiscoveryRouter, canonicalizeUrl, normalizeQuery } from "./router.server";

const brokenFirecrawl: SearchProviderAdapter = {
  id: "firecrawl",
  label: "Firecrawl",
  isConfigured: () => true,
  search: async () => {
    throw new ProviderError("credits_exhausted", "Insufficient credits", 402);
  },
};

const workingSerpApi: SearchProviderAdapter = {
  id: "serpapi",
  label: "SerpApi",
  isConfigured: () => true,
  search: async (q: string) => [
    { url: "https://example.com/a?utm_source=x", title: `a ${q}` },
    { url: "https://www.example.com/a/", title: "dupe" },
  ],
};

const unconfiguredBrave: SearchProviderAdapter = {
  id: "brave",
  label: "Brave",
  isConfigured: () => false,
  search: async () => [],
};

const adapters = [brokenFirecrawl, workingSerpApi, unconfiguredBrave];

test("canonicalizes URLs and queries for dedup", () => {
  assert.equal(canonicalizeUrl("https://www.Example.com/a/?utm_source=x#frag"), "https://example.com/a");
  assert.equal(normalizeQuery("  Shane   Nigam "), "shane nigam");
});

test("keeps discovering when Firecrawl is out of credits", async () => {
  const router = new DiscoveryRouter({ adapters });
  const hits = await router.search("shane nigam controversy", 5);
  assert.equal(hits.length, 1, "canonical dedup collapses the duplicate");

  const report = router.report();
  const fc = report.providers.find((p) => p.provider === "firecrawl")!;
  const sa = report.providers.find((p) => p.provider === "serpapi")!;
  const brave = report.providers.find((p) => p.provider === "brave")!;

  assert.equal(fc.state, "CREDITS_EXHAUSTED");
  assert.equal(fc.healthy, false);
  assert.equal(fc.creditsExhausted, true);
  assert.equal(sa.state, "HEALTHY");
  assert.equal(sa.urlsReturned, 2);
  assert.equal(brave.state, "NOT_CONFIGURED");
  assert.equal(report.duplicates_removed, 1);
  assert.equal(report.all_providers_down, false);
});

test("tracks executed queries and prevents duplicates", async () => {
  const router = new DiscoveryRouter({ adapters });
  await router.search("query one", 3);
  const second = await router.search("Query   One", 3, { skipDuplicates: true });
  assert.deepEqual(second, []);
  assert.deepEqual(router.executed(), ["query one"]);
  assert.equal(router.report().queries.duplicatesPrevented, 1);
});

test("reports all_providers_down when every provider is disabled", async () => {
  const router = new DiscoveryRouter({ adapters, disable: ["firecrawl", "serpapi", "brave"] });
  assert.deepEqual(await router.search("anything", 3), []);
  assert.equal(router.report().all_providers_down, true);
});
