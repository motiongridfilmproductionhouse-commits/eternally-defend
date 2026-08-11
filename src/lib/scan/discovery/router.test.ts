import { describe, expect, it, vi, beforeEach } from "vitest";

/*
 * Failover contract: a Firecrawl outage (402 credits / 429 rate limit) must
 * never zero out discovery while another provider is configured.
 */
vi.mock("@/lib/scan/discovery/firecrawl-provider.server", () => {
  const { ProviderError } = require("@/lib/scan/discovery/provider");
  return {
    firecrawlProvider: {
      id: "firecrawl",
      label: "Firecrawl",
      isConfigured: () => true,
      search: async () => {
        throw new ProviderError("credits_exhausted", "Insufficient credits", 402);
      },
    },
  };
});

vi.mock("@/lib/scan/discovery/serpapi-provider.server", () => ({
  serpapiProvider: {
    id: "serpapi",
    label: "SerpApi",
    isConfigured: () => true,
    search: async (q: string) => [
      { url: "https://example.com/a?utm_source=x", title: `a ${q}` },
      { url: "https://www.example.com/a/", title: "dupe" },
    ],
  },
}));

vi.mock("@/lib/scan/discovery/brave-provider.server", () => ({
  braveProvider: {
    id: "brave",
    label: "Brave",
    isConfigured: () => false,
    search: async () => [],
  },
}));

const { DiscoveryRouter, canonicalizeUrl, normalizeQuery } = await import(
  "@/lib/scan/discovery/router.server"
);

describe("DiscoveryRouter", () => {
  beforeEach(() => {
    delete process.env.SCAN_DISABLE_PROVIDERS;
  });

  it("canonicalizes URLs for dedup", () => {
    expect(canonicalizeUrl("https://www.Example.com/a/?utm_source=x#frag")).toBe(
      "https://example.com/a",
    );
    expect(normalizeQuery("  Shane   Nigam ")).toBe("shane nigam");
  });

  it("keeps discovering when Firecrawl is out of credits", async () => {
    const router = new DiscoveryRouter();
    const hits = await router.search("shane nigam controversy", 5);

    expect(hits.length).toBe(1); // canonical dedup collapsed the duplicate
    const report = router.report();
    const fc = report.providers.find((p) => p.provider === "firecrawl")!;
    const sa = report.providers.find((p) => p.provider === "serpapi")!;
    const brave = report.providers.find((p) => p.provider === "brave")!;

    expect(fc.state).toBe("CREDITS_EXHAUSTED");
    expect(fc.healthy).toBe(false);
    expect(fc.creditsExhausted).toBe(true);
    expect(sa.state).toBe("HEALTHY");
    expect(sa.urlsReturned).toBe(2);
    expect(brave.state).toBe("NOT_CONFIGURED");
    expect(report.duplicates_removed).toBe(1);
    expect(report.all_providers_down).toBe(false);
  });

  it("tracks executed queries and prevents duplicates", async () => {
    const router = new DiscoveryRouter();
    await router.search("query one", 3);
    const second = await router.search("Query   One", 3, { skipDuplicates: true });

    expect(second).toEqual([]);
    expect(router.executed()).toEqual(["query one"]);
    expect(router.report().queries.duplicatesPrevented).toBe(1);
  });

  it("reports all_providers_down when every provider is disabled", async () => {
    const router = new DiscoveryRouter({ disable: ["firecrawl", "serpapi", "brave"] });
    expect(await router.search("anything", 3)).toEqual([]);
    expect(router.report().all_providers_down).toBe(true);
  });
});
