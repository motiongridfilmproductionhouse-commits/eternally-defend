import assert from "node:assert/strict";
import test from "node:test";
import { dedupeBusinessResults, normalizeBusinessUrl } from "./url-normalization";
import { capProviderResults, combineBusinessProviderResults } from "./providers";

test("normalizes protocol, www, tracking parameters, fragments, and trailing slashes", () =>
  assert.equal(
    normalizeBusinessUrl("http://www.example.com/path/?utm_source=x&ok=1#section"),
    "https://example.com/path?ok=1",
  ));
test("normalizes YouTube watch, short, and youtu.be URLs", () => {
  assert.equal(
    normalizeBusinessUrl("https://www.youtube.com/watch?v=abc&utm_source=x"),
    "https://youtube.com/watch?v=abc",
  );
  assert.equal(normalizeBusinessUrl("https://youtu.be/abc"), "https://youtube.com/watch?v=abc");
});
test("normalizes X and Twitter hosts", () =>
  assert.equal(
    normalizeBusinessUrl("https://twitter.com/acme/status/1"),
    "https://x.com/acme/status/1",
  ));
test("deduplicates provider URL variants but keeps different posts", () => {
  const rows = dedupeBusinessResults([
    { url: "http://www.example.com/a/?utm_source=x", title: "same" },
    { url: "https://example.com/a", title: "same" },
    { url: "https://example.com/b", title: "same" },
  ]);
  assert.equal(rows.length, 2);
});
test("Firecrawl and YouTube success are combined", () =>
  assert.deepEqual(
    combineBusinessProviderResults([
      { provider: "Firecrawl", status: "fulfilled", results: [1] },
      { provider: "YouTube", status: "fulfilled", results: [2] },
    ]).results,
    [1, 2],
  ));
test("one provider failure produces completed_with_warnings", () => {
  const x = combineBusinessProviderResults([
    { provider: "Firecrawl", status: "fulfilled", results: [1] },
    { provider: "YouTube", status: "rejected", results: [], error: "secret" },
  ]);
  assert.equal(x.status, "completed_with_warnings");
  assert.deepEqual(x.warnings, ["YouTube unavailable"]);
  assert.equal(JSON.stringify(x).includes("secret"), false);
});
test("all provider failures produce a customer-safe failed result", () => {
  const x = combineBusinessProviderResults([
    { provider: "Firecrawl", status: "rejected", results: [], error: "raw upstream" },
    { provider: "YouTube", status: "rejected", results: [], error: "key" },
  ]);
  assert.equal(x.status, "failed");
  assert.equal(
    x.customerError,
    "Business Reputation discovery is temporarily unavailable. Please try again.",
  );
});
test("zero results are successful, not provider failures", () =>
  assert.equal(
    combineBusinessProviderResults([{ provider: "Firecrawl", status: "fulfilled", results: [] }])
      .status,
    "completed",
  ));
test("provider result limits are enforced", () =>
  assert.deepEqual(capProviderResults([1, 2, 3], 2), [1, 2]));
