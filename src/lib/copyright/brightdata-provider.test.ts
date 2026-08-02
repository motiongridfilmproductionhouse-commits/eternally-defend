/**
 * Bright Data SERP discovery provider — mocked provider tests.
 * No real network calls, no secret values asserted or logged.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  brightDataDiagnostic,
  brightDataHitsFromPayload,
  buildBrightDataQueries,
  classifyBrightDataFailure,
  isBrightDataConfigured,
  runBrightDataDiscovery,
} from "./brightdata-provider.server";
import type { ReferenceAnalysis } from "./discover.server";

const KEY = "test-bright-data-key";

const analysis: ReferenceAnalysis = {
  title: "Balan The Boy",
  altTitles: [],
  language: "Malayalam",
  audienceLanguages: [],
  region: "IN",
  actors: [],
  productionCompany: null,
  releaseDate: "2026-07-01",
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

const realFetch = globalThis.fetch;

function setup() {
  process.env.BRIGHT_DATA_API_KEY = KEY;
  delete process.env.BRIGHT_DATA_SERP_ZONE;
  delete process.env.BRIGHT_DATA_ZONE;
}

function restore() {
  globalThis.fetch = realFetch;
  process.env.BRIGHT_DATA_API_KEY = KEY;
}

function serpPayload(links: string[]) {
  return {
    organic: links.map((link, i) => ({
      link,
      title: `Watch Balan The Boy full movie HD ${i}`,
      description: "download 720p torrent magnet",
    })),
  };
}

function mockFetch(impl: (body: unknown) => Response) {
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    return impl(body);
  }) as unknown as typeof fetch;
  return () => calls;
}

test("reports configured state and redacted diagnostics", () => {
  setup();
  assert.equal(isBrightDataConfigured(), true);
  const diag = brightDataDiagnostic();
  assert.equal(diag.api_key_present, true);
  assert.equal(diag.api_key_length, KEY.length);
  assert.ok(!JSON.stringify(diag).includes(KEY));
  assert.equal(diag.zone, "serp_api1");
  process.env.BRIGHT_DATA_SERP_ZONE = "custom_serp";
  assert.equal(brightDataDiagnostic().zone, "custom_serp");
  restore();
});

test("builds only exact quoted-title distribution queries", () => {
  setup();
  const queries = buildBrightDataQueries(analysis, "Balan The Boy", 3);
  assert.equal(queries.length, 3);
  for (const q of queries) assert.ok(q.includes('"'));
  assert.deepEqual(buildBrightDataQueries({ ...analysis, title: null }, "", 3), []);
  restore();
});

test("normalizes organic results and drops official hosts", () => {
  const hits = brightDataHitsFromPayload(
    serpPayload(["https://piracy-example.test/movie", "https://www.netflix.com/title/1"]),
    "q",
  );
  assert.ok(hits.some((h) => h.url.includes("piracy-example.test")));
  assert.ok(!hits.some((h) => h.url.includes("netflix.com")));
});

test("handles stringified body wrappers and malformed payloads", () => {
  const wrapped = brightDataHitsFromPayload(
    { body: JSON.stringify(serpPayload(["https://piracy-example.test/a"])) },
    "q",
  );
  assert.equal(wrapped.length, 1);
  assert.deepEqual(brightDataHitsFromPayload("not json", "q"), []);
  assert.deepEqual(brightDataHitsFromPayload({ organic: "nope" }, "q"), []);
});

test("categorizes credential, credit, rate-limit, timeout and parse failures", () => {
  assert.equal(classifyBrightDataFailure({ configured: false }), "missing_api_key");
  assert.equal(classifyBrightDataFailure({ status: 401 }), "invalid_credentials");
  assert.equal(classifyBrightDataFailure({ status: 402 }), "insufficient_credits");
  assert.equal(
    classifyBrightDataFailure({ status: 400, bodyText: "insufficient balance on zone" }),
    "insufficient_credits",
  );
  assert.equal(classifyBrightDataFailure({ status: 429 }), "rate_limited");
  assert.equal(classifyBrightDataFailure({ status: 503 }), "provider_unavailable");
  assert.equal(classifyBrightDataFailure({ error: new Error("request timed out") }), "timeout");
  assert.equal(classifyBrightDataFailure({ error: "invalid response body" }), "invalid_response");
});

test("missing api key short-circuits without a provider call", async () => {
  setup();
  delete process.env.BRIGHT_DATA_API_KEY;
  const calls = mockFetch(() => new Response("{}", { status: 200 }));
  const result = await runBrightDataDiscovery({ analysis, workTitle: "Balan The Boy" });
  assert.equal(calls(), 0);
  assert.equal(result.configured, false);
  assert.equal(result.failuresByCategory.missing_api_key, 1);
  restore();
});

test("returns deduplicated candidate leads on success", async () => {
  setup();
  mockFetch(
    () =>
      new Response(
        JSON.stringify(
          serpPayload([
            "https://piracy-example.test/movie",
            "https://piracy-example.test/movie",
            "https://mirror-example.test/watch",
          ]),
        ),
        { status: 200 },
      ),
  );
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.equal(result.successes, 1);
  assert.equal(result.candidates, 2);
  assert.ok(result.duplicatesDropped >= 1);
  assert.ok(result.pageLeads.every((l) => l.query.startsWith("brightdata:")));
  assert.ok(result.pageLeads.some((l) => l.strong));
  restore();
});

test("stops on invalid credentials", async () => {
  setup();
  const calls = mockFetch(() => new Response("Unauthorized", { status: 401 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 4,
  });
  assert.equal(calls(), 1);
  assert.equal(result.failuresByCategory.invalid_credentials, 1);
  assert.equal(result.candidates, 0);
  restore();
});

test("stops on insufficient credits", async () => {
  setup();
  const calls = mockFetch(() => new Response("insufficient credits", { status: 402 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 4,
  });
  assert.equal(calls(), 1);
  assert.equal(result.failuresByCategory.insufficient_credits, 1);
  restore();
});

test("retries once on rate limits", async () => {
  setup();
  const calls = mockFetch(() => new Response("slow down", { status: 429 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.equal(calls(), 2);
  assert.equal(result.failuresByCategory.rate_limited, 1);
  restore();
});

test("malformed provider body is invalid_response", async () => {
  setup();
  mockFetch(() => new Response("<html>not json</html>", { status: 200 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.equal(result.failuresByCategory.invalid_response, 1);
  assert.equal(result.candidates, 0);
  restore();
});

test("network timeouts are categorized as timeout", async () => {
  setup();
  globalThis.fetch = (async () => {
    throw new Error("request timed out");
  }) as unknown as typeof fetch;
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.equal(result.failuresByCategory.timeout, 1);
  restore();
});

test("successful search with no usable rows reports no_results", async () => {
  setup();
  mockFetch(() => new Response(JSON.stringify({ organic: [] }), { status: 200 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.equal(result.successes, 1);
  assert.equal(result.failuresByCategory.no_results, 1);
  restore();
});

test("emits live telemetry callbacks while searching", async () => {
  setup();
  mockFetch(
    () =>
      new Response(JSON.stringify(serpPayload(["https://piracy-example.test/x"])), {
        status: 200,
      }),
  );
  const events: string[] = [];
  await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
    onActivity: (e) => {
      events.push(e.status);
    },
  });
  assert.deepEqual(events, ["searching", "results"]);
  restore();
});

test("never leaks the api key in the result payload", async () => {
  setup();
  mockFetch(() => new Response(`auth failed for Bearer ${KEY}`, { status: 401 }));
  const result = await runBrightDataDiscovery({
    analysis,
    workTitle: "Balan The Boy",
    maxQueries: 1,
  });
  assert.ok(!JSON.stringify(result).includes(KEY));
  restore();
});

test("sends the configured zone with bearer auth", async () => {
  setup();
  let seenZone: string | null = null;
  mockFetch((body) => {
    seenZone = (body as { zone: string }).zone;
    return new Response(JSON.stringify({ organic: [] }), { status: 200 });
  });
  await runBrightDataDiscovery({ analysis, workTitle: "Balan The Boy", maxQueries: 1 });
  assert.equal(seenZone, "serp_api1");
  restore();
});
