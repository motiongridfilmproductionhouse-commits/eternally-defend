import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalHostname, persistQualifiedDomainFinding } from "./high-risk-registry.server";

test("isCanonicalHostname accepts bare hostnames", () => {
  assert.equal(isCanonicalHostname("example.com"), true);
  assert.equal(isCanonicalHostname("subdomain.example.com"), true);
  assert.equal(isCanonicalHostname("desifakes-com.zproxy.org"), true);
  assert.equal(isCanonicalHostname("192.168.1.1"), true);
});

test("isCanonicalHostname rejects a full URL (scheme + path)", () => {
  assert.equal(isCanonicalHostname("https://example.com/page"), false);
});

test("isCanonicalHostname rejects a hostname with a port", () => {
  assert.equal(isCanonicalHostname("example.com:443"), false);
});

test("isCanonicalHostname rejects a bare path", () => {
  assert.equal(isCanonicalHostname("/page"), false);
});

test("isCanonicalHostname rejects empty and whitespace-only values", () => {
  assert.equal(isCanonicalHostname(""), false);
  assert.equal(isCanonicalHostname("   "), false);
  assert.equal(isCanonicalHostname(" example.com"), false);
  assert.equal(isCanonicalHostname("example.com "), false);
});

test("isCanonicalHostname rejects credentials, query strings, and fragments", () => {
  assert.equal(isCanonicalHostname("user:pass@example.com"), false);
  assert.equal(isCanonicalHostname("example.com?q=1"), false);
  assert.equal(isCanonicalHostname("example.com#frag"), false);
  assert.equal(isCanonicalHostname("example.com/page?q=1"), false);
});

test("isCanonicalHostname rejects non-string and malformed inputs", () => {
  assert.equal(isCanonicalHostname(undefined), false);
  assert.equal(isCanonicalHostname(null), false);
  assert.equal(isCanonicalHostname(123 as unknown as string), false);
  assert.equal(isCanonicalHostname("example..com"), false);
  assert.equal(isCanonicalHostname("-example.com"), false);
  assert.equal(isCanonicalHostname("example-.com"), false);
});

test("persistQualifiedDomainFinding skips the RPC (no throw) for a non-canonical hostname", async () => {
  let rpcCalled = false;
  const stubSupabase = {
    rpc: async () => {
      rpcCalled = true;
      return { error: null };
    },
  };

  await persistQualifiedDomainFinding(stubSupabase, {
    hostname: "https://example.com/page",
    discovery_provider: "firecrawl",
  });

  assert.equal(rpcCalled, false);
});

test("persistQualifiedDomainFinding calls the RPC with the hostname unchanged for a canonical hostname", async () => {
  let rpcArgs: unknown = null;
  const stubSupabase = {
    rpc: async (_fn: string, args: unknown) => {
      rpcArgs = args;
      return { error: null };
    },
  };

  await persistQualifiedDomainFinding(stubSupabase, {
    hostname: "subdomain.example.com",
    discovery_provider: "firecrawl",
  });

  assert.deepEqual(rpcArgs, {
    _hostname: "subdomain.example.com",
    _provider: "firecrawl",
  });
});
