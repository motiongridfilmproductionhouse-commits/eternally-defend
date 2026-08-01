import assert from "node:assert/strict";
import test from "node:test";
import {
  filterClientDiscoveries,
  filterClientFindings,
} from "./client-results.server";
import {
  buildSerpApiExactIdentityQueries,
  isSerpApiConfigured,
  isSerpApiFaceIdentityRejectionReason,
  searchSerpApiGoogleImages,
  searchSerpApiQueriesBounded,
  SERPAPI_MAX_CANDIDATES_PER_REQUEST,
  SERPAPI_MAX_REQUESTS_PER_SCAN,
  SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN,
} from "./serpapi-images.server";
import {
  assertSafePublicUrlForFetch,
  isPrivateOrReservedHostname,
  isPrivateOrReservedIpAddress,
  isSafePublicHttpUrl,
  normalizeHostingPageUrl,
  resolvePublicAddresses,
} from "./url-safety.server";
import { createEmptyCheckpoint, parseScanCheckpoint } from "./scan-checkpoint.server";
import { createDiscoveryFunnelMetrics } from "./scan-ownership.server";
import { resolveRedirectChain } from "./url-verification.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.SERPAPI_API_KEY;

function restoreEnv() {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.SERPAPI_API_KEY;
  else process.env.SERPAPI_API_KEY = ORIGINAL_KEY;
}

test("missing key falls back without throwing and uses zero credits", async () => {
  delete process.env.SERPAPI_API_KEY;
  assert.equal(isSerpApiConfigured(), false);
  const result = await searchSerpApiGoogleImages({ query: '"Ada Lovelace" deepfake' });
  assert.equal(result.skipped, true);
  assert.equal(result.creditsUsed, 0);
  assert.equal(result.hits.length, 0);
  assert.match(result.failure ?? "", /SERPAPI_API_KEY/);
  restoreEnv();
});

test("exact-name query construction rejects single-token identities", () => {
  const queries = buildSerpApiExactIdentityQueries({
    name: "Ada Lovelace",
    aliases: ["Ada", "Augusta Ada King"],
  });
  assert.ok(queries.length <= SERPAPI_MAX_REQUESTS_PER_SCAN);
  assert.ok(queries.every((query) => query.includes('"Ada Lovelace"') || query.includes('"Augusta Ada King"')));
  assert.ok(queries.every((query) => !/"Ada"/.test(query) || query.includes("Ada Lovelace") || query.includes("Augusta")));
  assert.ok(!queries.some((query) => query === '"Ada" deepfake'));
  assert.ok(queries.some((query) => /deepfake|face swap|fake nude/.test(query)));
});

test("unsafe URL and SSRF hosts are rejected", () => {
  assert.equal(isSafePublicHttpUrl("https://example.com/a"), true);
  assert.equal(isSafePublicHttpUrl("http://127.0.0.1/x"), false);
  assert.equal(isSafePublicHttpUrl("http://localhost/x"), false);
  assert.equal(isSafePublicHttpUrl("http://10.0.0.5/x"), false);
  assert.equal(isSafePublicHttpUrl("http://192.168.1.1/x"), false);
  assert.equal(isSafePublicHttpUrl("http://169.254.1.1/x"), false);
  assert.equal(isSafePublicHttpUrl("http://172.16.0.1/x"), false);
  assert.equal(isSafePublicHttpUrl("ftp://example.com/a"), false);
  assert.equal(isPrivateOrReservedHostname("metadata.google.internal"), true);
  assert.equal(isPrivateOrReservedHostname("localhost"), true);
  assert.equal(
    normalizeHostingPageUrl("https://example.com/a?utm_source=x#y"),
    "https://example.com/a",
  );
});

test("malformed and non-JSON SerpApi responses are isolated", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.equal(result.hits.length, 0);
  assert.ok(result.failure);
  assert.equal(result.creditsUsed, 0);
  restoreEnv();
});

test("429 retries once then soft-fails without aborting", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "0",
      },
    });
  }) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.equal(calls, 2);
  assert.equal(result.hits.length, 0);
  assert.match(result.failure ?? "", /429|rate|temporary/i);
  restoreEnv();
});

test("5xx retries once then soft-fails", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: "upstream" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.equal(calls, 2);
  assert.ok(result.failure);
  restoreEnv();
});

test("request timeout is bounded and soft-fails without abort signal", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal;
    await new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
        30_000,
      );
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });
    return new Response("{}");
  }) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
    softDeadlineMs: Date.now() + 60_000,
  });
  assert.equal(result.hits.length, 0);
  assert.ok(result.failure);
  restoreEnv();
});

test("abort signal is never retried", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  const controller = new AbortController();
  controller.abort(new Error("deadline"));
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  await assert.rejects(
    () =>
      searchSerpApiGoogleImages({
        query: '"Ada Lovelace" deepfake',
        signal: controller.signal,
      }),
    (error: unknown) =>
      error instanceof Error ||
      (typeof DOMException !== "undefined" && error instanceof DOMException),
  );
  restoreEnv();
});

test("candidate caps, dedupe and private URLs are enforced", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  const images = Array.from({ length: 80 }, (_, index) => ({
    link:
      index % 2 === 0
        ? `https://cdn.example.com/page/${Math.floor(index / 2)}`
        : `https://cdn.example.com/page/${Math.floor(index / 2)}?utm_source=x`,
    title: `Ada Lovelace deepfake ${index}`,
    original: `https://cdn.example.com/img/${index}.jpg`,
    thumbnail: `https://cdn.example.com/thumb/${index}.jpg`,
  }));
  images.push({
    link: "http://127.0.0.1/evil",
    title: "loopback",
    original: "http://127.0.0.1/x.jpg",
    thumbnail: "http://127.0.0.1/t.jpg",
  } as any);

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ images_results: images }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.ok(result.hits.length <= SERPAPI_MAX_CANDIDATES_PER_REQUEST);
  assert.ok(result.hits.every((hit) => hit.source === "serpapi_google_images"));
  assert.ok(result.hits.every((hit) => isSafePublicHttpUrl(hit.url)));
  assert.equal(
    new Set(result.hits.map((hit) => hit.url)).size,
    result.hits.length,
  );
  assert.equal(result.creditsUsed, 1);
  restoreEnv();
});

test("provider failure isolation keeps Firecrawl-capable scan progressing", async () => {
  process.env.SERPAPI_API_KEY = "bad";
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const bounded = await searchSerpApiQueriesBounded({
    queries: ['"Ada Lovelace" deepfake', '"Ada Lovelace" face swap'],
    maxRequests: 2,
  });
  assert.equal(bounded.hits.length, 0);
  assert.ok(bounded.failures >= 1);
  // Soft failures must not throw — caller continues with Firecrawl.
  restoreEnv();
});

test("checkpoint resume skips completed SerpApi queries and does not rebill", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(
      JSON.stringify({
        images_results: [
          {
            link: "https://example.com/only-once",
            title: "Ada Lovelace deepfake",
            original: "https://cdn.example.com/a.jpg",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const queries = buildSerpApiExactIdentityQueries({
    name: "Ada Lovelace",
    aliases: [],
  });
  const first = await searchSerpApiQueriesBounded({
    queries,
    maxRequests: 1,
  });
  assert.equal(first.creditsUsed, 1);
  assert.equal(calls, 1);

  const second = await searchSerpApiQueriesBounded({
    queries,
    maxRequests: SERPAPI_MAX_REQUESTS_PER_SCAN,
    alreadyCompletedIds: first.completedQueryIds,
    alreadySeenPages: first.seenPageUrls,
  });
  assert.ok(second.creditsUsed <= SERPAPI_MAX_REQUESTS_PER_SCAN - 1);
  assert.ok(!second.hits.some((hit) => hit.url.includes("only-once")));
  assert.ok(second.uniquePages <= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN);

  const checkpoint = createEmptyCheckpoint({
    queries: ["q1"],
    targetName: "Ada Lovelace",
    aliases: [],
    handles: [],
    perQueryLimit: 20,
    maxQueries: 40,
    initialWaveCount: 12,
    metrics: createDiscoveryFunnelMetrics(),
  });
  checkpoint.serpapi_queries = queries;
  checkpoint.serpapi_completed_query_ids = first.completedQueryIds;
  checkpoint.serpapi_next_query_index = first.completedQueryIds.length;
  checkpoint.serpapi_seen_page_urls = first.seenPageUrls;
  const parsed = parseScanCheckpoint(checkpoint);
  assert.ok(parsed);
  assert.deepEqual(
    parsed!.serpapi_completed_query_ids,
    first.completedQueryIds,
  );
  restoreEnv();
});

test("raw SerpApi candidates cannot reach client findings/discoveries", () => {
  const target = { name: "Ada Lovelace", aliases: [], handles: [] };
  const findings = filterClientFindings(
    [
      {
        scan_id: "s1",
        url: "https://example.com/raw",
        page_title: "raw serpapi hit",
        snippet: "deepfake",
        finding_classification: "UNVERIFIED_LEAD",
        url_verification_status: "URL_REJECTED",
      },
    ],
    target,
    "s1",
  );
  assert.equal(findings.length, 0);

  const discoveries = filterClientDiscoveries(
    [
      {
        scan_id: "s1",
        page_url: "https://example.com/raw",
        page_title: "raw",
        snippet: "Ada Lovelace deepfake",
        analysis_status: "discovered",
        source_host: "example.com",
      },
    ],
    target,
    "s1",
  );
  assert.equal(discoveries.length, 0);
});

test("other-actress and name-only false positives stay out of client results", () => {
  const target = { name: "Honey Rose", aliases: [], handles: [] };
  const findings = filterClientFindings(
    [
      {
        scan_id: "s1",
        url: "https://example.com/other",
        page_title: "Another Actress deepfake gallery",
        snippet: "unrelated celebrity",
        finding_classification: "VERIFIED_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
        canonical_url: "https://example.com/other",
      },
      {
        scan_id: "s1",
        url: "https://example.com/name-only",
        page_title: "Honey",
        snippet: "just a first name mention",
        finding_classification: "VERIFIED_DEEPFAKE",
        url_verification_status: "URL_VERIFIED",
        canonical_url: "https://example.com/name-only",
      },
    ],
    target,
    "s1",
  );
  assert.equal(findings.length, 0);
});

test("unique-page cap drains remaining queries so checkpoints cannot stall", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  globalThis.fetch = (async () => {
    const images = Array.from({ length: 80 }, (_, index) => ({
      link: `https://pages.example.com/${index}`,
      title: `Ada Lovelace deepfake ${index}`,
      original: `https://cdn.example.com/${index}.jpg`,
    }));
    return new Response(JSON.stringify({ images_results: images }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const alreadySeen = Array.from(
    { length: SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN - 1 },
    (_, index) => `https://seen.example.com/${index}`,
  );
  const result = await searchSerpApiQueriesBounded({
    queries: [
      '"Ada Lovelace" deepfake',
      '"Ada Lovelace" face swap',
      '"Ada Lovelace" fake nude',
    ],
    maxRequests: 5,
    alreadySeenPages: alreadySeen,
  });

  assert.equal(result.drained, true);
  assert.equal(result.completedQueryIds.length, 3);
  assert.ok(result.uniquePages <= SERPAPI_MAX_UNIQUE_PAGES_PER_SCAN);
  restoreEnv();
});

test("invalid key authentication soft-fails without credits", async () => {
  process.env.SERPAPI_API_KEY = "invalid";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Invalid API key." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.equal(result.skipped, true);
  assert.equal(result.creditsUsed, 0);
  assert.match(result.failure ?? "", /auth|Invalid/i);
  restoreEnv();
});

test("five-request total cap counts retries as outbound HTTP attempts", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "0",
      },
    });
  }) as typeof fetch;

  const result = await searchSerpApiQueriesBounded({
    queries: [
      '"Ada Lovelace" deepfake',
      '"Ada Lovelace" face swap',
      '"Ada Lovelace" fake nude',
      '"Augusta Ada King" deepfake',
      '"Augusta Ada King" face swap',
      '"Augusta Ada King" fake nude',
    ],
    maxRequests: SERPAPI_MAX_REQUESTS_PER_SCAN,
  });

  assert.equal(calls, 5);
  assert.equal(result.httpAttempts, 5);
  assert.equal(result.requests, 5);
  assert.ok(result.creditsUsed <= 5);
  restoreEnv();
});

test("stalled response body is covered by the per-request timeout", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  globalThis.fetch = (async (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"images_results":['));
        // Intentionally never close — body stalls until request signal aborts.
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            try {
              controller.close();
            } catch {
              /* already closed/cancelled by reader */
            }
          },
          { once: true },
        );
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const started = Date.now();
  const result = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
    softDeadlineMs: Date.now() + 250,
  });
  const elapsed = Date.now() - started;
  assert.equal(result.hits.length, 0);
  assert.match(result.failure ?? "", /timed out|timeout|aborted/i);
  assert.ok(elapsed < 5_000, `expected fast timeout, took ${elapsed}ms`);
  assert.ok(result.httpAttempts >= 1);
  // Drain any late abort microtasks from the stalled stream/timer.
  await new Promise((resolve) => setTimeout(resolve, 50));
  restoreEnv();
});

test("bracketed and IPv4-mapped private IPv6 URLs are rejected", () => {
  assert.equal(isSafePublicHttpUrl("http://[::1]/secret"), false);
  assert.equal(isSafePublicHttpUrl("http://[::ffff:127.0.0.1]/x"), false);
  assert.equal(isSafePublicHttpUrl("http://[::ffff:7f00:1]/x"), false);
  assert.equal(isPrivateOrReservedIpAddress("::1"), true);
  assert.equal(isPrivateOrReservedIpAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIpAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateOrReservedHostname("[::1]"), true);
  assert.equal(isPrivateOrReservedHostname("[::ffff:10.0.0.1]"), true);
});

test("private DNS resolution is rejected before fetch", async () => {
  await assert.rejects(
    () =>
      resolvePublicAddresses("evil.example.test", async () => [
        { address: "10.0.0.8", family: 4 },
      ]),
    /private|reserved/i,
  );
  await assert.rejects(
    () =>
      assertSafePublicUrlForFetch("https://evil.example.test/a", async () => [
        { address: "192.168.1.50", family: 4 },
      ]),
    /private|reserved/i,
  );
  await assert.rejects(
    () =>
      resolvePublicAddresses("loop.example.test", async () => [
        { address: "::1", family: 6 },
      ]),
    /private|reserved/i,
  );
});

test("unsafe redirect destinations are rejected without following them", async () => {
  const originalFetch = globalThis.fetch;
  let fetchedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    fetchedUrls.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/internal" },
    });
  }) as typeof fetch;

  try {
    const resolved = await resolveRedirectChain("https://example.com/safe", {
      timeoutMs: 3_000,
      softDeadlineMs: Date.now() + 10_000,
    });
    assert.equal(resolved.ok, false);
    assert.match(resolved.error ?? "", /safety|private|reserved|unsafe|Blocked/i);
    assert.ok(fetchedUrls.every((url) => !url.includes("127.0.0.1")));
    assert.equal(fetchedUrls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("serpapi_face_rejected only attributes explicit face/identity outcomes", () => {
  assert.equal(
    isSerpApiFaceIdentityRejectionReason(
      "Final page title and primary content do not match the selected identity.",
    ),
    true,
  );
  assert.equal(
    isSerpApiFaceIdentityRejectionReason(
      "Protected identity appears only in recommendations, comments, navigation or unrelated neighboring entries.",
    ),
    true,
  );
  assert.equal(
    isSerpApiFaceIdentityRejectionReason("Homepage URLs are not exact evidence pages."),
    false,
  );
  assert.equal(
    isSerpApiFaceIdentityRejectionReason(
      "Exact final URL could not be crawled; search snippets are never used as page evidence.",
    ),
    false,
  );
  assert.equal(
    isSerpApiFaceIdentityRejectionReason(
      "Rejected search results page. Search, tag, category, performer-index and generic listings are not evidence URLs.",
    ),
    false,
  );

  const serpapiUrls = new Set(["https://cdn.example.com/a", "https://cdn.example.com/b"]);
  const rejected = [
    {
      discovered_url: "https://cdn.example.com/a",
      rejection_reason:
        "Final page title and primary content do not match the selected identity.",
    },
    {
      discovered_url: "https://cdn.example.com/b",
      rejection_reason: "Homepage URLs are not exact evidence pages.",
    },
    {
      discovered_url: "https://other.example.com/c",
      rejection_reason:
        "Final page title and primary content do not match the selected identity.",
    },
  ];
  let faceRejected = 0;
  for (const row of rejected) {
    if (!serpapiUrls.has(row.discovered_url)) continue;
    if (isSerpApiFaceIdentityRejectionReason(row.rejection_reason)) {
      faceRejected += 1;
    }
  }
  assert.equal(faceRejected, 1);
});

test("checkpoint Continue preserves actual SerpApi request and credit counts", async () => {
  process.env.SERPAPI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls <= 3) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    }
    return new Response(
      JSON.stringify({
        images_results: [
          {
            link: `https://example.com/page-${calls}`,
            title: "Ada Lovelace deepfake",
            original: `https://cdn.example.com/${calls}.jpg`,
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const queries = buildSerpApiExactIdentityQueries({
    name: "Ada Lovelace",
    aliases: [],
  });

  const first = await searchSerpApiQueriesBounded({
    queries,
    maxRequests: 3,
  });
  assert.equal(first.httpAttempts, 3);
  assert.equal(calls, 3);

  const metrics = createDiscoveryFunnelMetrics();
  metrics.serpapi_requests = first.httpAttempts;
  metrics.serpapi_credits_used = first.creditsUsed;

  const checkpoint = createEmptyCheckpoint({
    queries: ["q1"],
    targetName: "Ada Lovelace",
    aliases: [],
    handles: [],
    perQueryLimit: 20,
    maxQueries: 40,
    initialWaveCount: 12,
    metrics,
  });
  checkpoint.serpapi_queries = queries;
  checkpoint.serpapi_completed_query_ids = first.completedQueryIds;
  checkpoint.serpapi_next_query_index = first.completedQueryIds.length;
  checkpoint.serpapi_seen_page_urls = first.seenPageUrls;
  checkpoint.metrics = { ...metrics };

  const parsed = parseScanCheckpoint(checkpoint);
  assert.ok(parsed);
  assert.equal(parsed!.metrics.serpapi_requests, 3);
  assert.equal(parsed!.metrics.serpapi_credits_used, first.creditsUsed);

  const remaining = Math.max(
    0,
    SERPAPI_MAX_REQUESTS_PER_SCAN - parsed!.metrics.serpapi_requests,
  );
  assert.equal(remaining, 2);

  const continued = await searchSerpApiQueriesBounded({
    queries,
    maxRequests: remaining,
    alreadyCompletedIds: parsed!.serpapi_completed_query_ids,
    alreadySeenPages: parsed!.serpapi_seen_page_urls,
  });

  assert.ok(continued.httpAttempts <= remaining);
  assert.equal(calls, 3 + continued.httpAttempts);
  assert.ok(3 + continued.httpAttempts <= SERPAPI_MAX_REQUESTS_PER_SCAN);

  parsed!.metrics.serpapi_requests += continued.httpAttempts;
  parsed!.metrics.serpapi_credits_used += continued.creditsUsed;
  const roundTrip = parseScanCheckpoint(parsed!);
  assert.equal(
    roundTrip!.metrics.serpapi_requests,
    3 + continued.httpAttempts,
  );
  assert.equal(
    roundTrip!.metrics.serpapi_credits_used,
    first.creditsUsed + continued.creditsUsed,
  );
  restoreEnv();
});
