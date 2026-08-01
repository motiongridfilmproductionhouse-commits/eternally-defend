/**
 * Production regression tests for PR #34/#36 URL verification.
 *
 * - Node 22 undici lookup shape (options.all → address array)
 * - DNS-rebinding-safe IP pinning with TLS SNI hostname preserved
 * - No custom dispatcher on Firecrawl
 * - Redirect/final probe bodies cancelled under abort/timeout
 */

import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  classifySafeFetchFailure,
  createPinnedLookup,
  fetchPublicHttpUrl,
  fetchValidatedPublicHttpUrl,
  isPrivateOrReservedIpAddress,
  isSafePublicHttpUrl,
  preferIpv4Addresses,
  releaseProbeResponseBody,
  setTestDnsLookupAll,
  setTestPinnedHttpFetch,
} from "./url-safety.server";
import {
  resolveRedirectChain,
  verifyCandidateUrls,
} from "./url-verification.server";
import { decideTerminalStatus } from "./scan-ownership.server";
import { searchSerpApiGoogleImages } from "./serpapi-images.server";
import { firecrawlFetch } from "@/lib/firecrawl-client.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SERPAPI_KEY = process.env.SERPAPI_API_KEY;
const ORIGINAL_FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

function restore() {
  globalThis.fetch = ORIGINAL_FETCH;
  setTestDnsLookupAll(null);
  setTestPinnedHttpFetch(null);
  if (ORIGINAL_SERPAPI_KEY === undefined) {
    delete process.env.SERPAPI_API_KEY;
  } else {
    process.env.SERPAPI_API_KEY = ORIGINAL_SERPAPI_KEY;
  }
  if (ORIGINAL_FIRECRAWL_KEY === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = ORIGINAL_FIRECRAWL_KEY;
  }
}

test.afterEach(() => {
  restore();
});

test("ordinary public HTTPS page verifies via pinned validated fetch", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  let sawPin: string | null = null;
  setTestPinnedHttpFetch(async (url, init, pin) => {
    sawPin = pin.address;
    assert.equal(url, "https://example.com/post/ada");
    assert.equal(init.redirect, "manual");
    assert.equal(pin.servername, "example.com");
    assert.equal(pin.address, "93.184.216.34");
    return new Response(null, { status: 200 });
  });

  const resolved = await resolveRedirectChain("https://example.com/post/ada", {
    timeoutMs: 5_000,
    softDeadlineMs: Date.now() + 10_000,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.http_status, 200);
  assert.equal(sawPin, "93.184.216.34");
});

test("Node 22 options.all lookup shape returns address array", async () => {
  const pinned = "93.184.216.34";
  const lookup = createPinnedLookup(pinned, 4);

  await new Promise<void>((resolve) => {
    lookup("example.com", { all: true }, (err, result) => {
      assert.equal(err, null);
      assert.ok(Array.isArray(result));
      assert.equal(result?.[0]?.address, pinned);
      assert.equal(result?.[0]?.family, 4);
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    lookup("example.com", {}, (err, address, family) => {
      assert.equal(err, null);
      assert.equal(address, pinned);
      assert.equal(family, 4);
      resolve();
    });
  });
});

test("TLS SNI uses the original hostname when connection pinning is used", async () => {
  const hostname = "example.com";
  const pinned = "93.184.216.34";
  assert.equal(net.isIP(hostname), 0);
  assert.equal(net.isIP(pinned), 4);

  setTestDnsLookupAll(async () => [{ address: pinned, family: 4 }]);
  setTestPinnedHttpFetch(async (url, _init, pin) => {
    assert.equal(url, `https://${hostname}/`);
    assert.ok(!url.includes(pinned));
    assert.equal(pin.servername, hostname);
    assert.notEqual(net.isIP(pin.servername), 4);
    assert.equal(pin.address, pinned);
    return new Response(null, { status: 200 });
  });

  const response = await fetchPublicHttpUrl(`https://${hostname}/`, {
    method: "HEAD",
  });
  assert.equal(response.status, 200);
});

test("DNS result changes between validation and connection cannot reach a private address", async () => {
  let dnsCalls = 0;
  setTestDnsLookupAll(async () => {
    dnsCalls += 1;
    // First validated lookup is public; any later rebinding attempt is private.
    if (dnsCalls === 1) {
      return [{ address: "93.184.216.34", family: 4 }];
    }
    return [{ address: "127.0.0.1", family: 4 }];
  });

  let connectLookups = 0;
  setTestPinnedHttpFetch(async (_url, _init, pin) => {
    assert.equal(pin.address, "93.184.216.34");
    assert.equal(isPrivateOrReservedIpAddress(pin.address), false);

    // Simulate undici connect.lookup after a rebinding DNS change.
    await new Promise<void>((resolve, reject) => {
      pin.lookup("rebinding.example", { all: true }, (err, result) => {
        connectLookups += 1;
        if (err) {
          reject(err);
          return;
        }
        const addr = Array.isArray(result) ? result[0]?.address : undefined;
        assert.equal(addr, "93.184.216.34");
        assert.notEqual(addr, "127.0.0.1");
        resolve();
      });
    });

    return new Response(null, { status: 200 });
  });

  const response = await fetchValidatedPublicHttpUrl(
    "https://rebinding.example/page",
    { method: "GET" },
  );
  assert.equal(response.status, 200);
  assert.equal(dnsCalls, 1);
  assert.equal(connectLookups, 1);
});

test("mixed/rebinding DNS cannot bypass pinning", async () => {
  setTestDnsLookupAll(async () => [
    { address: "10.0.0.8", family: 4 },
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);

  setTestPinnedHttpFetch(async (_url, _init, pin) => {
    assert.equal(pin.address, "93.184.216.34");
    assert.equal(isPrivateOrReservedIpAddress(pin.address), false);

    await new Promise<void>((resolve) => {
      pin.lookup("mixed.example", { all: true }, (_err, result) => {
        assert.ok(Array.isArray(result));
        assert.equal(result?.length, 1);
        assert.equal(result?.[0]?.address, "93.184.216.34");
        resolve();
      });
    });

    return new Response(null, { status: 200 });
  });

  const response = await fetchValidatedPublicHttpUrl(
    "https://mixed.example/safe",
    { method: "HEAD" },
  );
  assert.equal(response.status, 200);
});

test("no custom dispatcher reaches Firecrawl", async () => {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
  let sawDispatcher = false;
  globalThis.fetch = (async (_input, init) => {
    if ((init as { dispatcher?: unknown } | undefined)?.dispatcher) {
      sawDispatcher = true;
    }
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await firecrawlFetch("/scrape", { url: "https://example.com/x" });
  assert.equal(sawDispatcher, false);
});

test("redirect and final response bodies are cancelled", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  const cancelled: string[] = [];

  setTestPinnedHttpFetch(async (url) => {
    if (url.includes("/hop1")) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("redirect-body"));
        },
      });
      const response = new Response(stream, {
        status: 302,
        headers: { location: "https://example.com/final" },
      });
      const originalCancel = response.body!.cancel.bind(response.body);
      response.body!.cancel = async (reason?: unknown) => {
        cancelled.push("redirect");
        return originalCancel(reason);
      };
      return response;
    }

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("final-body"));
      },
    });
    const response = new Response(stream, { status: 200 });
    const originalCancel = response.body!.cancel.bind(response.body);
    response.body!.cancel = async (reason?: unknown) => {
      cancelled.push("final");
      return originalCancel(reason);
    };
    return response;
  });

  const resolved = await resolveRedirectChain("https://example.com/hop1", {
    timeoutMs: 5_000,
    softDeadlineMs: Date.now() + 10_000,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.final_url, "https://example.com/final");
  assert.deepEqual(cancelled, ["redirect", "final"]);
});

test("stalled body cleanup respects timeout/abort", async () => {
  const controller = new AbortController();
  let cancelCalled = false;

  const stream = new ReadableStream({
    start() {
      // Never enqueue or close — simulates a stalled body.
    },
    cancel() {
      cancelCalled = true;
    },
  });
  const response = new Response(stream, { status: 200 });

  const pending = releaseProbeResponseBody(response, controller.signal);
  controller.abort(new Error("scan abort during body cleanup"));

  await assert.rejects(() => pending, /scan abort during body cleanup/);
  assert.equal(cancelCalled, true);
});

test("private/reserved DNS and unsafe redirects remain rejected", async () => {
  assert.equal(isSafePublicHttpUrl("http://127.0.0.1/x"), false);
  assert.equal(isSafePublicHttpUrl("http://169.254.169.254/latest"), false);

  setTestDnsLookupAll(async () => [{ address: "10.0.0.9", family: 4 }]);
  const privateDns = await resolveRedirectChain("https://evil.example.test/a", {
    timeoutMs: 3_000,
    softDeadlineMs: Date.now() + 5_000,
  });
  assert.equal(privateDns.ok, false);
  assert.equal(privateDns.failure_category, "private_address_rejected");

  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  setTestPinnedHttpFetch(async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://192.168.0.1/admin" },
    }),
  );

  const unsafeRedirect = await resolveRedirectChain(
    "https://example.com/safe",
    { timeoutMs: 3_000, softDeadlineMs: Date.now() + 5_000 },
  );
  assert.equal(unsafeRedirect.ok, false);
  assert.equal(unsafeRedirect.failure_category, "redirect_rejected");
});

test("HTTP 404 after reachability is url_rejected, not network_failed", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  setTestPinnedHttpFetch(async () => new Response(null, { status: 404 }));

  const { metrics } = await verifyCandidateUrls(
    [
      {
        url: "https://example.com/missing-post",
        query: "Ada Lovelace deepfake",
        source: "firecrawl",
      },
    ],
    { name: "Ada Lovelace" },
    { maxPages: 1, softDeadlineMs: Date.now() + 10_000 },
  );
  assert.equal(metrics.url_rejected, 1);
  assert.equal(metrics.network_failed, 0);
  assert.equal(metrics.crawl_failed, 1);
});

test("network failures record distinct categories, not blanket url_rejected", async () => {
  setTestDnsLookupAll(async () => {
    throw new Error("getaddrinfo ENOTFOUND nowhere.invalid");
  });

  const dnsFail = await resolveRedirectChain("https://nowhere.invalid/x", {
    timeoutMs: 2_000,
    softDeadlineMs: Date.now() + 5_000,
  });
  assert.equal(dnsFail.ok, false);
  assert.equal(dnsFail.failure_category, "dns_resolution_failed");

  assert.equal(
    classifySafeFetchFailure(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    ),
    "request_timeout",
  );

  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  setTestPinnedHttpFetch(async () => {
    throw new Error(
      "TLS handshake failed: unable to verify the first certificate",
    );
  });

  const tlsFail = await resolveRedirectChain("https://example.com/tls", {
    timeoutMs: 500,
    softDeadlineMs: Date.now() + 5_000,
  });
  assert.equal(tlsFail.ok, false);
  assert.equal(tlsFail.failure_category, "tls_connection_failed");

  setTestDnsLookupAll(async () => {
    throw new Error("getaddrinfo ENOTFOUND missing.example");
  });
  const { metrics } = await verifyCandidateUrls(
    [
      {
        url: "https://missing.example/post/1",
        query: "Ada Lovelace deepfake",
        source: "firecrawl",
      },
    ],
    { name: "Ada Lovelace" },
    { maxPages: 1, softDeadlineMs: Date.now() + 10_000 },
  );
  assert.equal(metrics.dns_resolution_failed, 1);
  assert.equal(metrics.crawl_failed, 1);
  assert.equal(metrics.url_rejected, 0);
  assert.equal(metrics.crawl_succeeded, 0);
});

test("SerpApi failure does not affect Firecrawl verification path", async () => {
  process.env.SERPAPI_API_KEY = "test-key-not-used-for-real";
  globalThis.fetch = (async (input) => {
    if (String(input).includes("serpapi.com")) {
      throw new Error("SerpApi upstream unavailable");
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const serp = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
    softDeadlineMs: Date.now() + 10_000,
  });
  assert.ok(serp.failure);
  assert.equal(serp.hits.length, 0);
  assert.equal(serp.creditsUsed, 0);

  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  setTestPinnedHttpFetch(async () => new Response(null, { status: 200 }));
  const firecrawlPath = await resolveRedirectChain(
    "https://example.com/post/ada-deepfake",
    { timeoutMs: 5_000, softDeadlineMs: Date.now() + 10_000 },
  );
  assert.equal(firecrawlPath.ok, true);
  assert.equal(firecrawlPath.http_status, 200);
});

test("Firecrawl-only scan unchanged when SerpApi is absent", async () => {
  delete process.env.SERPAPI_API_KEY;
  const serp = await searchSerpApiGoogleImages({
    query: '"Ada Lovelace" deepfake',
  });
  assert.equal(serp.skipped, true);
  assert.equal(serp.creditsUsed, 0);

  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  setTestPinnedHttpFetch(async () => new Response(null, { status: 200 }));
  const resolved = await resolveRedirectChain(
    "https://cdn.example.com/watch/123",
    { timeoutMs: 5_000, softDeadlineMs: Date.now() + 10_000 },
  );
  assert.equal(resolved.ok, true);
});

test("provider timeout remains bounded", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  let attempts = 0;
  setTestPinnedHttpFetch(async () => {
    attempts += 1;
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  });

  const started = Date.now();
  const resolved = await resolveRedirectChain("https://example.com/hang", {
    timeoutMs: 200,
    softDeadlineMs: Date.now() + 800,
  });
  const elapsed = Date.now() - started;
  assert.equal(resolved.ok, false);
  assert.equal(resolved.failure_category, "request_timeout");
  assert.ok(attempts >= 1 && attempts <= 12, `unexpected attempts: ${attempts}`);
  assert.ok(elapsed < 5_000, `timeout not bounded: ${elapsed}ms`);
});

test("prefer IPv4 for dual-stack hosts (Vercel-friendly)", () => {
  assert.deepEqual(
    preferIpv4Addresses(["2001:db8::1", "93.184.216.34", "2001:db8::2"]),
    ["93.184.216.34", "2001:db8::1", "2001:db8::2"],
  );
});

test("zero verified progress still ends FAILED; saved progress ends PARTIAL", () => {
  const failed = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: false,
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.reason ?? "", /before any verified progress/i);

  const partial = decideTerminalStatus({
    abortedByDeadline: true,
    hasValidProgress: true,
    pendingWork: true,
    checkpointPause: true,
  });
  assert.equal(partial.status, "partial");
  assert.match(partial.reason ?? "", /Continue scan|verified progress/i);
});

test("classifySafeFetchFailure never leaks raw provider payloads", () => {
  const err = new Error(
    'certificate altname mismatch for host "example.com" api_key=SECRET_TOKEN body={"images":[]}',
  );
  const category = classifySafeFetchFailure(err);
  assert.equal(category, "tls_connection_failed");
  assert.equal(typeof category, "string");
  assert.ok(!category.includes("SECRET"));
  assert.ok(!category.includes("images"));
});

test("createPinnedLookup refuses private addresses", () => {
  assert.throws(
    () => createPinnedLookup("127.0.0.1", 4),
    /private|reserved/i,
  );
});
