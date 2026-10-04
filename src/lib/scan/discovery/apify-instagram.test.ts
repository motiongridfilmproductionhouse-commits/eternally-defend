import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  buildApifyInstagramInput,
  normalizeApifyInstagramItems,
  runApifyInstagram,
} from "./apify-instagram.server";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.LOVABLE_API_KEY = "lovable-test-key";
  process.env.APIFY_API_KEY = "connection-test-key";
});

afterEach(() => {
  mock.restoreAll();
  process.env = { ...ORIGINAL_ENV };
});

test("verified handles build bounded profile inputs and remove invalid values", () => {
  const input = buildApifyInstagramInput("Ignored name", ["@Eterna.Official", "bad handle!", "eterna.official"]);
  assert.deepEqual(input.directUrls, ["https://www.instagram.com/eterna.official/"]);
  assert.equal("search" in input, false);
  assert.equal(input.resultsLimit, 10);
  assert.equal(input.onlyPostsNewerThan, "30 days");
});

test("name-only discovery uses one profile search rather than claiming a verified handle", () => {
  const input = buildApifyInstagramInput("Common Person", []);
  assert.equal(input.search, "Common Person");
  assert.equal(input.searchType, "user");
  assert.equal(input.searchLimit, 1);
  assert.equal("directUrls" in input, false);
});

test("normalization canonicalizes and deduplicates Instagram media", () => {
  const hits = normalizeApifyInstagramItems([
    { id: "1", shortCode: "ABC", type: "Image", caption: "real caption", ownerUsername: "owner", displayUrl: "https://img.test/a.jpg" },
    { id: "1", shortCode: "ABC", caption: "duplicate" },
    { id: "2", shortCode: "REEL", type: "Video", caption: "reel caption", timestamp: "2026-10-01T00:00:00Z" },
    { url: "https://not-instagram.test/post" },
  ]);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.url, "https://www.instagram.com/p/ABC/");
  assert.equal(hits[0]?.provider, "apify_instagram");
  assert.equal(hits[0]?.pageText, "real caption");
  assert.equal(hits[1]?.url, "https://www.instagram.com/reel/REEL/");
});

test("missing credentials does not attempt the provider", async () => {
  delete process.env.APIFY_API_KEY;
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response());
  const result = await runApifyInstagram("Target", []);
  assert.equal(result.attempted, false);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("provider failure degrades to an Instagram error without throwing", async () => {
  mock.method(globalThis, "fetch", async () => new Response("payment required", { status: 402 }));
  const result = await runApifyInstagram("Target", ["target"]);
  assert.equal(result.attempted, true);
  assert.equal(result.raw.length, 0);
  assert.equal(result.error, "Instagram discovery is temporarily unavailable");
});

test("successful async run is polled and its dataset is normalized", async () => {
  let call = 0;
  mock.method(globalThis, "fetch", async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify({ data: { id: "run-1", status: "READY" } }));
    if (call === 2) {
      return new Response(JSON.stringify({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1" } }));
    }
    return new Response(JSON.stringify([{ id: "post-1", shortCode: "FOUND", caption: "found post" }]));
  });
  const result = await runApifyInstagram("Target", ["target"]);
  assert.equal(result.attempted, true);
  assert.equal(result.runStatus, "SUCCEEDED");
  assert.equal(result.raw[0]?.url, "https://www.instagram.com/p/FOUND/");
  assert.equal(call, 3);
});

test("credentials stay in headers and never enter Actor URLs", async () => {
  let capturedUrl = "";
  let capturedHeaders = new Headers();
  mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedHeaders = new Headers(init?.headers);
    return new Response("provider unavailable", { status: 503 });
  });
  await runApifyInstagram("Target", ["target"]);
  assert.equal(capturedUrl.includes("connection-test-key"), false);
  assert.equal(capturedHeaders.get("X-Connection-Api-Key"), "connection-test-key");
  assert.equal(capturedHeaders.get("Authorization"), "Bearer lovable-test-key");
});