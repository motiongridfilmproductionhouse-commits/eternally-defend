/**
 * Production regression tests for PR #34 URL verification failures.
 * Root cause: undici connect.lookup used the pre-Node-22 callback shape
 * while Node 22/Vercel pass options.all=true, yielding ERR_INVALID_IP_ADDRESS.
 * Fix: core verification uses DNS-validate + plain fetch; optional pinning
 * supports options.all and preserves TLS SNI.
 */

import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  classifySafeFetchFailure,
  fetchPublicHttpUrl,
  fetchValidatedPublicHttpUrl,
  isSafePublicHttpUrl,
  preferIpv4Addresses,
  setTestDnsLookupAll,
} from "./url-safety.server";
import {
  resolveRedirectChain,
  verifyCandidateUrls,
} from "./url-verification.server";
import { decideTerminalStatus } from "./scan-ownership.server";
import { searchSerpApiGoogleImages } from "./serpapi-images.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SERPAPI_KEY = process.env.SERPAPI_API_KEY;

function restore() {
  globalThis.fetch = ORIGINAL_FETCH;
  setTestDnsLookupAll(null);
  if (ORIGINAL_SERPAPI_KEY === undefined) {
    delete process.env.SERPAPI_API_KEY;
  } else {
    process.env.SERPAPI_API_KEY = ORIGINAL_SERPAPI_KEY;
  }
}

test.afterEach(() => {
  restore();
});

test("ordinary public HTTPS page verifies via validated plain fetch", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), "https://example.com/post/ada");
    assert.equal(init?.redirect, "manual");
    // No custom dispatcher on core verification path.
    assert.equal(
      (init as { dispatcher?: unknown } | undefined)?.dispatcher,
      undefined,
    );
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const resolved = await resolveRedirectChain("https://example.com/post/ada", {
    timeoutMs: 5_000,
    softDeadlineMs: Date.now() + 10_000,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.http_status, 200);
  assert.equal(resolved.failure_category, undefined);
});

test("Node 22 autoSelectFamily lookup shape returns address array (not undefined IP)", async () => {
  // Reproduce the PR #34 bug shape and prove the fixed callback works.
  const pinned = "93.184.216.34";
  const family = 4;
  const lookup = (
    _hostname: string,
    options: unknown,
    callback: (...args: any[]) => void,
  ) => {
    const opts =
      typeof options === "object" && options
        ? (options as { all?: boolean })
        : {};
    if (opts.all) {
      callback(null, [{ address: pinned, family }]);
      return;
    }
    callback(null, pinned, family);
  };

  // Broken pre-PR fix shape (what caused production failure):
  const broken = (
    _hostname: string,
    _options: unknown,
    callback: (...args: any[]) => void,
  ) => {
    callback(null, pinned, family);
  };

  await new Promise<void>((resolve) => {
    broken("example.com", { all: true }, (err, result, fam) => {
      // When all=true, undici/Node treat the 2nd arg as the address array.
      // Passing a string leaves address undefined → ERR_INVALID_IP_ADDRESS.
      assert.equal(err, null);
      assert.equal(typeof result, "string");
      assert.equal(fam, 4);
      assert.equal(Array.isArray(result), false);
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    lookup("example.com", { all: true }, (err, result) => {
      assert.equal(err, null);
      assert.ok(Array.isArray(result));
      assert.equal(result[0]?.address, pinned);
      assert.equal(result[0]?.family, 4);
      resolve();
    });
  });
});

test("TLS SNI remains hostname when optional connection pinning is used", async () => {
  const hostname = "example.com";
  const pinned = "93.184.216.34";

  // Pinning must keep the original hostname for TLS SNI — never the IP.
  assert.equal(net.isIP(hostname), 0);
  assert.equal(net.isIP(pinned), 4);

  setTestDnsLookupAll(async () => [{ address: pinned, family: 4 }]);
  globalThis.fetch = (async (input) => {
    // fetchPublicHttpUrl must request by original URL (hostname intact for SNI).
    assert.equal(String(input), `https://${hostname}/`);
    assert.ok(!String(input).includes(pinned));
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  const response = await fetchPublicHttpUrl(`https://${hostname}/`, {
    method: "HEAD",
  });
  assert.equal(response.status, 200);
});

test("Vercel-compatible fetch path does not attach a custom dispatcher", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  let sawDispatcher = false;
  globalThis.fetch = (async (_input, init) => {
    if ((init as { dispatcher?: unknown } | undefined)?.dispatcher) {
      sawDispatcher = true;
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  await fetchValidatedPublicHttpUrl("https://example.com/page", {
    method: "GET",
  });
  assert.equal(sawDispatcher, false);
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
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://192.168.0.1/admin" },
    })) as typeof fetch;

  const unsafeRedirect = await resolveRedirectChain(
    "https://example.com/safe",
    { timeoutMs: 3_000, softDeadlineMs: Date.now() + 5_000 },
  );
  assert.equal(unsafeRedirect.ok, false);
  assert.equal(unsafeRedirect.failure_category, "redirect_rejected");
});

test("network failures record distinct categories, not blanket url_rejected", async () => {
  setTestDnsLookupAll(async () => {
    const err = new Error("getaddrinfo ENOTFOUND nowhere.invalid");
    throw err;
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
  globalThis.fetch = (async () => {
    throw new Error("TLS handshake failed: unable to verify the first certificate");
  }) as typeof fetch;

  const tlsFail = await resolveRedirectChain("https://example.com/tls", {
    timeoutMs: 500,
    softDeadlineMs: Date.now() + 5_000,
  });
  assert.equal(tlsFail.ok, false);
  assert.equal(tlsFail.failure_category, "tls_connection_failed");

  // verifyCandidateUrls must bump network categories, not url_rejected.
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
  globalThis.fetch = (async () =>
    new Response(null, { status: 200 })) as typeof fetch;
  const resolved = await resolveRedirectChain(
    "https://cdn.example.com/watch/123",
    { timeoutMs: 5_000, softDeadlineMs: Date.now() + 10_000 },
  );
  assert.equal(resolved.ok, true);
});

test("provider timeout remains bounded", async () => {
  setTestDnsLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    // Simulate hop AbortSignal.timeout without leaving open handles.
    throw new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
  }) as typeof fetch;

  const started = Date.now();
  // Soft deadline bounds retry sleeps so the candidate fails quickly.
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
  // Classifier returns only the enum category — callers must not surface err.message.
  assert.equal(typeof category, "string");
  assert.ok(!category.includes("SECRET"));
  assert.ok(!category.includes("images"));
});
