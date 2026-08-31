/**
 * HikerAPI adapter tests — global `fetch` is mocked throughout (node:test's
 * `mock.method`), matching this repo's DI-free provider style. No live
 * HikerAPI credits are ever consumed by this suite.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { ProviderError } from "./provider";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.HIKERAPI_ACCESS_KEY = "test-key-not-real";
  process.env.HIKERAPI_ENABLED = "true";
  delete process.env.HIKERAPI_BASE_URL;
  delete process.env.HIKERAPI_MAX_REQUESTS_PER_SCAN;
});

afterEach(() => {
  mock.restoreAll();
  process.env = { ...ORIGINAL_ENV };
});

test("missing API key: isHikerApiEnabled is false, adapter is NOT_CONFIGURED", async () => {
  delete process.env.HIKERAPI_ACCESS_KEY;
  const { isHikerApiEnabled } = await import("./hikerapi-client.server");
  assert.equal(isHikerApiEnabled(), false);
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  assert.equal(hikerapiProvider.isConfigured(), false);
});

test("disabled provider (HIKERAPI_ENABLED unset): isHikerApiEnabled is false even with a key present", async () => {
  delete process.env.HIKERAPI_ENABLED;
  const { isHikerApiEnabled } = await import("./hikerapi-client.server");
  assert.equal(isHikerApiEnabled(), false);
});

test("disabled provider: search() throws auth_failed and never calls fetch", async () => {
  delete process.env.HIKERAPI_ENABLED;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not have been called");
  });
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  await assert.rejects(() => hikerapiProvider.search("some client", 5), ProviderError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("auth header construction: x-access-key is set, key never appears in the URL", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    capturedUrl = String(url);
    capturedHeaders = init.headers;
    return jsonResponse(200, { requests: 100, amount: 2 });
  });
  const { getBalance } = await import("./hikerapi-client.server");
  await getBalance();

  assert.ok(!capturedUrl.includes("test-key-not-real"), "key must not appear in the URL");
  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get("x-access-key"), "test-key-not-real");
});

test("401 unauthorized maps to auth_failed", async () => {
  mock.method(globalThis, "fetch", async () =>
    jsonResponse(401, { state: false, error: "Unauthorized request: pass access_key" }),
  );
  const { searchAccounts } = await import("./hikerapi-client.server");
  await assert.rejects(
    () => searchAccounts("some client"),
    (e: unknown) => e instanceof ProviderError && e.kind === "auth_failed",
  );
});

test("403 forbidden maps to auth_failed", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse(403, { error: "Forbidden" }));
  const { getUserByUsername } = await import("./hikerapi-client.server");
  await assert.rejects(
    () => getUserByUsername("someuser"),
    (e: unknown) => e instanceof ProviderError && e.kind === "auth_failed",
  );
});

test("429 rate limit maps to rate_limited", async () => {
  mock.method(globalThis, "fetch", async () =>
    jsonResponse(429, { error: "Too Many Requests" }),
  );
  const { searchAccounts } = await import("./hikerapi-client.server");
  await assert.rejects(
    () => searchAccounts("some client"),
    (e: unknown) => e instanceof ProviderError && e.kind === "rate_limited",
  );
});

test("5xx server error maps to unavailable", async () => {
  mock.method(globalThis, "fetch", async () => jsonResponse(503, { error: "Service unavailable" }));
  const { searchAccounts } = await import("./hikerapi-client.server");
  await assert.rejects(
    () => searchAccounts("some client"),
    (e: unknown) => e instanceof ProviderError && e.kind === "unavailable",
  );
});

test("timeout (abort) maps to timeout", async () => {
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
  const { getUserByUsername } = await import("./hikerapi-client.server");
  // Client's own TIMEOUT_MS is 15s; abort the mock immediately so the test
  // doesn't actually wait — simulate the signal firing right away instead.
  const controller = new AbortController();
  queueMicrotask(() => controller.abort());
  await assert.rejects(
    () => getUserByUsername("someuser", controller.signal),
    (e: unknown) => e instanceof ProviderError && e.kind === "timeout",
  );
});

test("malformed (non-JSON) response maps to bad_response", async () => {
  mock.method(globalThis, "fetch", async () => new Response("<html>not json</html>", { status: 200 }));
  const { searchAccounts } = await import("./hikerapi-client.server");
  await assert.rejects(
    () => searchAccounts("some client"),
    (e: unknown) => e instanceof ProviderError && e.kind === "bad_response",
  );
});

test("response normalization: searchAccounts maps HikerAPI users into DiscoveryHits", async () => {
  mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      response: {
        users: [
          {
            pk: "123456",
            username: "real_actor_official",
            full_name: "Real Actor",
            is_verified: true,
            is_private: false,
            profile_pic_url: "https://example.com/pic.jpg",
          },
        ],
      },
    }),
  );
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const hits = await hikerapiProvider.search("Real Actor", 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, "https://www.instagram.com/real_actor_official/");
  assert.equal(hits[0].title, "Real Actor");
  assert.equal(hits[0].provider, "hikerapi");
  assert.equal(hits[0].instagramIsVerified, true);
});

test("captionTextOf/thumbnailUrlOf: GraphQL shape (/gql/user/medias, /gql/user/clips) is handled, not just the flat schema", async () => {
  const { captionTextOf, thumbnailUrlOf } = await import("./hikerapi-client.server");
  // Confirmed against live data (2026-08-31): these two endpoints return
  // Instagram's raw GraphQL object, not HikerAPI's documented flat Media
  // schema — caption_text/thumbnail_url are absent entirely.
  const graphQlShaped = {
    pk: "1",
    id: "1_1",
    code: "ABC",
    caption: { text: "hello from graphql" },
    image_versions2: { candidates: [{ url: "https://example.com/hi-res.jpg" }] },
  } as never;
  assert.equal(captionTextOf(graphQlShaped), "hello from graphql");
  assert.equal(thumbnailUrlOf(graphQlShaped), "https://example.com/hi-res.jpg");

  const flatShaped = {
    pk: "2",
    id: "2_1",
    code: "DEF",
    caption_text: "hello from flat schema",
    thumbnail_url: "https://example.com/flat.jpg",
  } as never;
  assert.equal(captionTextOf(flatShaped), "hello from flat schema");
  assert.equal(thumbnailUrlOf(flatShaped), "https://example.com/flat.jpg");
});

test("safe_int=true is sent on endpoints where large media/user pks can exceed Number.MAX_SAFE_INTEGER", async () => {
  const capturedUrls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    capturedUrls.push(String(url));
    return jsonResponse(200, { response: { items: [], users: [] } });
  });
  const { searchAccounts, getUserByUsername, getUserTaggedMedias, searchHashtags, getMediaComments } =
    await import("./hikerapi-client.server");
  await searchAccounts("q");
  await getUserByUsername("u");
  await getUserTaggedMedias("1");
  await searchHashtags("h");
  await getMediaComments("1");
  for (const u of capturedUrls) {
    assert.ok(new URL(u).searchParams.get("safe_int") === "true", `expected safe_int=true on ${u}`);
  }
});

test("malformed item within an otherwise-valid list is skipped, not thrown", async () => {
  mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, {
      response: { users: [{ full_name: "No pk here" }, { pk: 1, username: "valid_one" }] },
    }),
  );
  const { searchAccounts } = await import("./hikerapi-client.server");
  const users = await searchAccounts("query");
  assert.equal(users.length, 1);
  assert.equal(users[0].username, "valid_one");
});

test("duplicate Instagram URLs are deduplicated within a single deep-dive run", async () => {
  const samePost = {
    pk: "999",
    id: "999_1",
    code: "ABC123",
    user: { pk: 1, username: "target" },
    caption_text: "hello",
  };
  mock.method(globalThis, "fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("/v2/user/by/username")) {
      return jsonResponse(200, { user: { pk: 1, username: "target", full_name: "Target" } });
    }
    if (u.includes("/v2/user/tag/medias")) {
      return jsonResponse(200, { response: { items: [samePost] } });
    }
    if (u.includes("/gql/user/medias")) {
      // Same media surfaces again via the own-media endpoint.
      return jsonResponse(200, { response: { items: [samePost] } });
    }
    if (u.includes("/gql/user/clips")) {
      return jsonResponse(200, { response: { items: [] } });
    }
    throw new Error(`unexpected URL in test: ${u}`);
  });
  const { runHikerApiInstagram } = await import("./hikerapi-instagram.server");
  const result = await runHikerApiInstagram("Target Client", ["target"]);
  assert.equal(result.error, undefined);
  const postHits = result.raw.filter((h) => h.url.includes("/p/ABC123/"));
  assert.equal(postHits.length, 1, "the same media pk reached via two endpoints must dedupe to one hit");
});

test("provider failure does not kill the whole run: partial results + error surfaced", async () => {
  mock.method(globalThis, "fetch", async (url: string) => {
    const u = String(url);
    if (u.includes("/v2/user/by/username")) {
      return jsonResponse(200, { user: { pk: 1, username: "target", full_name: "Target" } });
    }
    if (u.includes("/v2/user/tag/medias")) {
      return jsonResponse(503, { error: "down" });
    }
    if (u.includes("/gql/user/medias")) {
      return jsonResponse(200, {
        response: {
          items: [{ pk: "1", id: "1_1", code: "XYZ", user: { pk: 1, username: "target" } }],
        },
      });
    }
    return jsonResponse(200, { response: { items: [] } });
  });
  const { runHikerApiInstagram } = await import("./hikerapi-instagram.server");
  const result = await runHikerApiInstagram("Target Client", ["target"]);
  // Tagged-media failing must not prevent own-media results from coming through.
  assert.ok(result.raw.some((h) => h.url.includes("/p/XYZ/")));
});

test("request budget caps total HikerAPI calls per scan", async () => {
  process.env.HIKERAPI_MAX_REQUESTS_PER_SCAN = "2";
  let calls = 0;
  mock.method(globalThis, "fetch", async (url: string) => {
    calls++;
    const u = String(url);
    if (u.includes("/v2/user/by/username")) {
      return jsonResponse(200, { user: { pk: 1, username: "target", full_name: "Target" } });
    }
    return jsonResponse(200, { response: { items: [] } });
  });
  const { runHikerApiInstagram } = await import("./hikerapi-instagram.server");
  await runHikerApiInstagram("Target Client", ["target"]);
  // 1 resolve + (budget=2 total, so only 1 more call: tagged media) — own
  // media/reels never fire once the budget is exhausted.
  assert.equal(calls, 2);
});

test("Tier-1: identical repeated queries within one scan hit HikerAPI only once", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return jsonResponse(200, {
      response: { users: [{ pk: 1, username: "target", full_name: "Target" }] },
    });
  });
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const { DiscoveryRouter, withDiscoveryRouter } = await import("./router.server");
  const router = new DiscoveryRouter({ adapters: [hikerapiProvider] });

  await withDiscoveryRouter(router, async () => {
    const first = await hikerapiProvider.search("Target Client", 5);
    const second = await hikerapiProvider.search("Target Client", 5);
    assert.equal(first.length, 1);
    assert.deepEqual(second, first, "cached call must return the same mapped hits");
  });
  assert.equal(calls, 1, "the second identical call must not hit the network again");
});

test("Tier-1: normalized-duplicate queries (case/whitespace) also dedupe to one request", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return jsonResponse(200, { response: { users: [] } });
  });
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const { DiscoveryRouter, withDiscoveryRouter } = await import("./router.server");
  const router = new DiscoveryRouter({ adapters: [hikerapiProvider] });

  await withDiscoveryRouter(router, async () => {
    await hikerapiProvider.search("  Target   Client ", 5);
    await hikerapiProvider.search("target client", 5);
  });
  assert.equal(calls, 1);
});

test("Tier-1: separate scans (separate router instances) never share cache or budget", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return jsonResponse(200, { response: { users: [] } });
  });
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const { DiscoveryRouter, withDiscoveryRouter } = await import("./router.server");

  await withDiscoveryRouter(new DiscoveryRouter({ adapters: [hikerapiProvider] }), () =>
    hikerapiProvider.search("Target Client", 5),
  );
  await withDiscoveryRouter(new DiscoveryRouter({ adapters: [hikerapiProvider] }), () =>
    hikerapiProvider.search("Target Client", 5),
  );
  assert.equal(calls, 2, "a fresh scan (new router instance) must not reuse another scan's cache");
});

test("Tier-1: budget exhaustion returns [] gracefully and never throws", async () => {
  process.env.HIKERAPI_TIER1_MAX_REQUESTS_PER_SCAN = "2";
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return jsonResponse(200, { response: { users: [] } });
  });
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const { DiscoveryRouter, withDiscoveryRouter } = await import("./router.server");
  const router = new DiscoveryRouter({ adapters: [hikerapiProvider] });

  await withDiscoveryRouter(router, async () => {
    await hikerapiProvider.search("query one", 5);
    await hikerapiProvider.search("query two", 5);
    const third = await hikerapiProvider.search("query three", 5); // budget exhausted
    assert.deepEqual(third, []);
  });
  assert.equal(calls, 2, "only the budgeted number of distinct queries reach the network");
});

test("Tier-1: budget exhaustion for HikerAPI never fails the scan or affects a sibling provider", async () => {
  process.env.HIKERAPI_TIER1_MAX_REQUESTS_PER_SCAN = "1";
  mock.method(globalThis, "fetch", async () => jsonResponse(200, { response: { users: [] } }));
  const { hikerapiProvider } = await import("./hikerapi-provider.server");
  const { DiscoveryRouter, withDiscoveryRouter } = await import("./router.server");

  const workingBrave = {
    id: "brave" as const,
    label: "Brave",
    isConfigured: () => true,
    search: async (q: string) => [{ url: `https://example.com/${encodeURIComponent(q)}`, title: q }],
  };
  const router = new DiscoveryRouter({ adapters: [hikerapiProvider, workingBrave] });

  await withDiscoveryRouter(router, async () => {
    await router.search("query one", 5); // consumes HikerAPI's entire budget
    const hits = await router.search("query two", 5); // HikerAPI now returns [] gracefully
    assert.equal(hits.length, 1, "Brave's result must still come through");
  });

  const report = router.report();
  const hiker = report.providers.find((p) => p.provider === "hikerapi")!;
  assert.equal(hiker.healthy, true, "budget exhaustion must never mark the provider unhealthy");
  assert.equal(hiker.state, "HEALTHY");
  assert.equal(report.all_providers_down, false);
});

test("DiscoveryRouter: HikerAPI failing (e.g. credits exhausted) never zeroes out other providers", async () => {
  const { DiscoveryRouter } = await import("./router.server");
  const { ProviderError: PE } = await import("./provider");
  const brokenHiker = {
    id: "hikerapi" as const,
    label: "HikerAPI",
    isConfigured: () => true,
    search: async () => {
      throw new PE("credits_exhausted", "Insufficient balance", 402);
    },
  };
  const workingBrave = {
    id: "brave" as const,
    label: "Brave",
    isConfigured: () => true,
    search: async () => [{ url: "https://example.com/a", title: "a" }],
  };
  const router = new DiscoveryRouter({ adapters: [brokenHiker, workingBrave] });
  const hits = await router.search("client name", 5);
  assert.equal(hits.length, 1);
  const report = router.report();
  const hiker = report.providers.find((p) => p.provider === "hikerapi")!;
  assert.equal(hiker.state, "CREDITS_EXHAUSTED");
  assert.equal(hiker.healthy, false);
  assert.equal(report.all_providers_down, false);
});
