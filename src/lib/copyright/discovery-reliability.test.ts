/**
 * Copyright discovery reliability: circuit breaker, SerpApi fallback,
 * known-URL preflight, Telegram isolation, and gate preservation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runBatchedDiscovery,
  recordCircuitFailure,
  emptyDiscoveryCircuit,
  parseRetryAfterMs,
  FIRECRAWL_CIRCUIT_BREAKER_THRESHOLD,
  isAbortError,
} from "./discovery-runtime";
import {
  buildCopyrightSerpApiQueries,
  createSerpApiHttpBudget,
  claimSerpApiHttpAttempt,
  isCopyrightSerpApiConfigured,
} from "./serpapi-discovery.server";
import {
  firecrawlEnvironmentDiagnostic,
  isFirecrawlConfigured,
} from "../firecrawl-client.server";
import { decideCopyrightTerminalStatus } from "./scan-lifecycle";
import { classifyCopyrightPage } from "./page-classify.server";
import { evaluateTelegramPublicEvidence } from "./telegram-evidence";
import { filterClientVisibleCopyrightMatches } from "./client-filter";
import { dedupeCopyrightMatchRows } from "./match-upsert";
import type { ReferenceAnalysis } from "./discover.server";

const analysis: ReferenceAnalysis = {
  title: "pluto malayalam movie",
  altTitles: ["Pluto"],
  language: "Malayalam",
  audienceLanguages: [],
  region: null,
  actors: [],
  productionCompany: null,
  releaseDate: null,
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

test("429 and provider-unavailable circuit breaker opens after threshold", () => {
  let circuit = emptyDiscoveryCircuit();
  for (let i = 0; i < FIRECRAWL_CIRCUIT_BREAKER_THRESHOLD - 1; i++) {
    circuit = recordCircuitFailure(circuit, "rate_limited");
    assert.equal(circuit.opened, false);
  }
  circuit = recordCircuitFailure(circuit, "provider_unavailable");
  assert.equal(circuit.opened, true);
  assert.match(circuit.openedReason ?? "", /circuit opened/i);
  assert.ok(circuit.operatorAction);
});

test("Retry-After header is parsed into milliseconds", () => {
  assert.equal(parseRetryAfterMs("5"), 5_000);
  const future = new Date(Date.now() + 8_000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed !== null && parsed >= 1_000 && parsed <= 30_000);
});

test("runBatchedDiscovery stops after circuit opens", async () => {
  let calls = 0;
  const result = await runBatchedDiscovery({
    plans: Array.from({ length: 9 }, (_, i) => `q-${i}`),
    earlyStopUniquePages: 100,
    uniquePageCount: () => 0,
    execute: async () => {
      calls += 1;
      return { ok: false, failureCategory: "rate_limited" as const };
    },
  });
  assert.equal(result.circuit.opened, true);
  assert.equal(calls, FIRECRAWL_CIRCUIT_BREAKER_THRESHOLD);
});

test("runBatchedDiscovery respects AbortSignal", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Aborted", "AbortError"));
  await assert.rejects(
    () =>
      runBatchedDiscovery({
        plans: ["a", "b"],
        uniquePageCount: () => 0,
        signal: controller.signal,
        execute: async () => ({ ok: true }),
      }),
    (err: unknown) => isAbortError(err),
  );
});

test("SerpApi queries use exact quoted titles only", () => {
  const queries = buildCopyrightSerpApiQueries(analysis, "pluto malayalam movie", 5);
  assert.ok(queries.length > 0 && queries.length <= 5);
  for (const q of queries) {
    assert.match(q, /".+"/);
    assert.doesNotMatch(q, /^\s*pluto\s*$/i);
  }
});

test("SerpApi HTTP budget caps attempts at five", () => {
  const budget = createSerpApiHttpBudget(5);
  assert.equal(claimSerpApiHttpAttempt(budget), true);
  budget.remaining = 0;
  assert.equal(claimSerpApiHttpAttempt(budget), false);
});

test("Firecrawl configuration reads FIRECRAWL_API_KEY server-side and reports only presence and length", () => {
  const oldFirecrawl = process.env.FIRECRAWL_API_KEY;
  const oldLovable = process.env.LOVABLE_API_KEY;
  try {
    process.env.FIRECRAWL_API_KEY = "fc-test-secret-value";
    delete process.env.LOVABLE_API_KEY;
    const direct = firecrawlEnvironmentDiagnostic();
    assert.equal(direct.firecrawl_api_key_present, true);
    assert.equal(direct.firecrawl_api_key_length, "fc-test-secret-value".length);
    assert.equal(direct.firecrawl_api_key_mode, "direct");
    assert.equal(direct.lovable_api_key_required, false);
    assert.equal(direct.configured, true);
    assert.equal(isFirecrawlConfigured(), true);
    assert.deepEqual(JSON.stringify(direct).includes("fc-test-secret-value"), false);

    process.env.FIRECRAWL_API_KEY = "lovc_connection_key";
    delete process.env.LOVABLE_API_KEY;
    const gatewayMissing = firecrawlEnvironmentDiagnostic();
    assert.equal(gatewayMissing.firecrawl_api_key_present, true);
    assert.equal(gatewayMissing.firecrawl_api_key_length, "lovc_connection_key".length);
    assert.equal(gatewayMissing.firecrawl_api_key_mode, "lovable_gateway");
    assert.equal(gatewayMissing.lovable_api_key_required, true);
    assert.equal(gatewayMissing.lovable_api_key_present, false);
    assert.equal(gatewayMissing.configured, false);
    assert.equal(isFirecrawlConfigured(), false);

    process.env.LOVABLE_API_KEY = "lovable-runtime-key";
    const gatewayConfigured = firecrawlEnvironmentDiagnostic();
    assert.equal(gatewayConfigured.lovable_api_key_present, true);
    assert.equal(gatewayConfigured.lovable_api_key_length, "lovable-runtime-key".length);
    assert.equal(gatewayConfigured.configured, true);
    assert.deepEqual(JSON.stringify(gatewayConfigured).includes("lovable-runtime-key"), false);
  } finally {
    if (oldFirecrawl == null) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = oldFirecrawl;
    if (oldLovable == null) delete process.env.LOVABLE_API_KEY;
    else process.env.LOVABLE_API_KEY = oldLovable;
  }
});

test("known URL path can complete when all discovery providers fail", () => {
  const out = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 35,
    queriesExecuted: 35,
    providerSuccesses: 0,
    providerFailures: 35,
    providerCandidates: 0,
    knownUrlsAttempted: 1,
    knownUrlsAccepted: 1,
    pagesCrawled: 1,
    clientVisibleFindings: 0,
    serpapiSuccesses: 0,
    serpapiCandidates: 0,
    firecrawlCircuitOpened: true,
  });
  assert.equal(out.status, "partial");
});

test("SerpApi fallback after Firecrawl failure can avoid hard fail", () => {
  const out = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 10,
    queriesExecuted: 10,
    providerSuccesses: 0,
    providerFailures: 10,
    providerCandidates: 4,
    knownUrlsAttempted: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
    serpapiSuccesses: 2,
    serpapiCandidates: 4,
    firecrawlCircuitOpened: true,
  });
  assert.equal(out.status, "partial");
});

test("Telegram provider isolation — private join links fail closed", () => {
  const privateFail = evaluateTelegramPublicEvidence({
    url: "https://t.me/joinchat/SECRET",
    pageTitle: "Pluto full movie",
    markdown: "download magnet",
    titles: ["pluto malayalam movie"],
  });
  assert.equal(privateFail.eligible, false);
  const src = readFileSync(resolve(process.cwd(), "src/lib/copyright/discover.server.ts"), "utf8");
  assert.match(src, /telegram_failures/);
  assert.match(src, /runBatchedDiscovery/);
});

test("YouTube/Plex/official rejection preserved", () => {
  const plex = classifyCopyrightPage({
    url: "https://watch.plex.tv/movie/pluto",
    pageTitle: "Pluto on Plex",
    markdown: "Watch Pluto on Plex catalog.",
    titles: ["pluto malayalam movie"],
    pageInspected: true,
  });
  assert.equal(plex.clientVisible, false);
  const trailer = classifyCopyrightPage({
    url: "https://www.youtube.com/watch?v=abc",
    pageTitle: "Pluto Official Trailer",
    markdown: "Official trailer for Pluto.",
    titles: ["pluto malayalam movie"],
    pageInspected: true,
  });
  assert.equal(trailer.clientVisible, false);
});

test("exact-title and exact-page access requirements preserved", () => {
  const long = (s: string) =>
    `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;
  const ok = classifyCopyrightPage({
    url: "https://streamexample.test/watch/pluto",
    pageTitle: "Pluto Malayalam Full Movie",
    markdown: long("Watch full movie Pluto malayalam online free. Streaming server 1."),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe>',
    links: ["https://doodstream.com/e/abc"],
    titles: ["pluto malayalam movie"],
    pageInspected: true,
  });
  assert.equal(ok.clientVisible, true);
});

test("raw provider results never reach the UI", () => {
  const raw = [
    {
      detection_type: "UNVERIFIED_LEAD",
      evidence: { client_visible: false, discovery: "web_lead" },
    },
    {
      detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
      evidence: { client_visible: true, discovery: "distribution_site" },
    },
  ] as Parameters<typeof filterClientVisibleCopyrightMatches>[0];
  const visible = filterClientVisibleCopyrightMatches(raw);
  assert.equal(visible.length, 1);
  assert.equal((visible[0].evidence as Record<string, unknown>).client_visible, true);
});

test("executor uses Firecrawl-only discovery and streams known-URL preflight", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/copyright.functions.ts"), "utf8");
  assert.match(src, /firecrawlDiscover/);
  assert.doesNotMatch(src, /runCopyrightSerpApiDiscovery/);
  assert.doesNotMatch(src, /runBrightDataDiscovery/);
  assert.match(src, /runKnownUrlEarlyPhase/);
  assert.match(src, /onProgress: async \(progress\)/);
  assert.match(src, /ScanTelemetryWriter/);
  assert.doesNotMatch(src, /throw discoverErr/);
});

test("dedupeCopyrightMatchRows prevents duplicate upsert keys", () => {
  const rows = dedupeCopyrightMatchRows([
    {
      source_url: "https://example.com/a",
      detection_type: "UNVERIFIED_LEAD",
      confidence: 20,
      evidence: { client_visible: false },
    },
    {
      source_url: "https://example.com/a/",
      detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
      confidence: 85,
      evidence: { client_visible: true },
    },
    {
      source_url: "https://other.com/b",
      detection_type: "UNVERIFIED_LEAD",
      confidence: 10,
      evidence: { client_visible: false },
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.source_url.includes("example.com"))?.detection_type, "VERIFIED_UNAUTHORIZED_STREAM");
});

test("executor dedupes copyright_matches before upsert", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/copyright.functions.ts"), "utf8");
  assert.match(src, /dedupeCopyrightMatchRows/);
});
