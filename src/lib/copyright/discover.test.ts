import assert from "node:assert/strict";
import test from "node:test";
import {
  getCopyrightDiscoveryProviders,
  isCopyrightDiscoveryConfigured,
  normalizeProviderFailureCategory,
  firecrawlDiscover,
  CopyrightDiscoveryError,
  USER_DISCOVERY_UNAVAILABLE_MESSAGE,
} from "./discover.server";

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const original = { ...process.env };
  try {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const res = fn();
    if (res instanceof Promise)
      return res.finally(() => {
        process.env = original;
      });
    process.env = original;
  } catch (err) {
    process.env = original;
    throw err;
  }
}

test("1. Missing LOVABLE_API_KEY does not fail discovery configuration check", () => {
  withEnv(
    {
      FIRECRAWL_API_KEY: "fc-valid-direct-key",
      LOVABLE_API_KEY: undefined,
      BRAVE_API_KEY: "brave-key",
      SERPAPI_API_KEY: "serp-key",
    },
    () => {
      const providers = getCopyrightDiscoveryProviders();
      assert.deepEqual(providers, ["firecrawl_direct", "brave_fallback", "serpapi_fallback"]);
      assert.equal(isCopyrightDiscoveryConfigured(), true);
    },
  );
});

test("2. Provider fallback ordering: Firecrawl -> Brave -> SerpAPI", () => {
  withEnv(
    {
      FIRECRAWL_API_KEY: "fc-direct-key",
      BRAVE_API_KEY: "brave-key",
      SERPAPI_API_KEY: "serpapi-key",
      LOVABLE_API_KEY: undefined,
    },
    () => {
      const providers = getCopyrightDiscoveryProviders();
      assert.deepEqual(providers, ["firecrawl_direct", "brave_fallback", "serpapi_fallback"]);
    },
  );
});

test("3. Brave fallback configured when Firecrawl missing", () => {
  withEnv(
    {
      FIRECRAWL_API_KEY: undefined,
      LOVABLE_API_KEY: undefined,
      BRAVE_API_KEY: "brave-valid-key",
      SERPAPI_API_KEY: "serp-key",
    },
    () => {
      const providers = getCopyrightDiscoveryProviders();
      assert.deepEqual(providers, ["brave_fallback", "serpapi_fallback"]);
      assert.equal(isCopyrightDiscoveryConfigured(), true);
    },
  );
});

test("4. SerpAPI fallback configured when Firecrawl and Brave missing", () => {
  withEnv(
    {
      FIRECRAWL_API_KEY: undefined,
      LOVABLE_API_KEY: undefined,
      BRAVE_API_KEY: undefined,
      SERPAPI_API_KEY: "serp-valid-key",
    },
    () => {
      const providers = getCopyrightDiscoveryProviders();
      assert.deepEqual(providers, ["serpapi_fallback"]);
      assert.equal(isCopyrightDiscoveryConfigured(), true);
    },
  );
});

test("5. Authentication and status error category normalization", () => {
  assert.equal(normalizeProviderFailureCategory(401), "provider_authentication_failed");
  assert.equal(normalizeProviderFailureCategory(403), "provider_authentication_failed");
  assert.equal(normalizeProviderFailureCategory(429), "provider_rate_limited");
  assert.equal(normalizeProviderFailureCategory(502), "provider_unavailable");
  assert.equal(
    normalizeProviderFailureCategory(null, new Error("Request timeout")),
    "provider_timeout",
  );
});

test("6. No Copyright discovery providers configured throws CopyrightDiscoveryError", async () => {
  await withEnv(
    {
      FIRECRAWL_API_KEY: undefined,
      LOVABLE_API_KEY: undefined,
      BRAVE_API_KEY: undefined,
      SERPAPI_API_KEY: undefined,
    },
    async () => {
      assert.equal(isCopyrightDiscoveryConfigured(), false);
      await assert.rejects(
        async () => {
          await firecrawlDiscover(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "Test Work",
            0,
          );
        },
        (err: unknown) => {
          assert(err instanceof CopyrightDiscoveryError);
          assert.equal(err.userMessage, USER_DISCOVERY_UNAVAILABLE_MESSAGE);
          assert(err.adminSummary.includes("No Copyright discovery providers are configured"));
          return true;
        },
      );
    },
  );
});

test("7. All configured providers fail throws user-safe error message", async () => {
  await withEnv(
    {
      FIRECRAWL_API_KEY: "fc-invalid-key-will-fail",
      LOVABLE_API_KEY: undefined,
      BRAVE_API_KEY: undefined,
      SERPAPI_API_KEY: undefined,
    },
    async () => {
      try {
        await firecrawlDiscover(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "Bethlehem Kudumba Unit (BKU)",
          0,
        );
        assert.fail("Should have thrown CopyrightDiscoveryError");
      } catch (err: unknown) {
        assert(err instanceof CopyrightDiscoveryError);
        assert.equal(err.userMessage, USER_DISCOVERY_UNAVAILABLE_MESSAGE);
        assert(err.adminSummary.includes("All configured discovery provider requests failed"));
      }
    },
  );
});
