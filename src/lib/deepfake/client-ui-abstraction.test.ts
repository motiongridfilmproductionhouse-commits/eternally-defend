import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDiscoveryQueryForClient } from "../copyright/public-surface";
import { sanitizeProviderError } from "../security/error-sanitizer";

const PROHIBITED_TERMS = [
  "Firecrawl",
  "SerpAPI",
  "Brave",
  "Google API",
  "Google Images",
  "site:reddit.com",
  "site:t.me",
  "site:x.com",
  "API key",
  "providerUsed",
];

test("1. Acceptance Test: Normal user query sanitization has ZERO prohibited terms", () => {
  const testQueries = [
    'site:desifakes.com "TARGET"',
    "site:reddit.com target deepfake",
    "site:t.me channel link",
    "site:x.com post deepfake",
    '"TARGET" deepfake',
    '"TARGET" nude',
    "firecrawl_direct_search",
  ];

  for (const rawQuery of testQueries) {
    const sanitized = sanitizeDiscoveryQueryForClient(rawQuery);
    for (const term of PROHIBITED_TERMS) {
      assert.equal(
        sanitized?.toLowerCase().includes(term.toLowerCase()),
        false,
        `Sanitized query "${sanitized}" contained prohibited term "${term}" (raw: "${rawQuery}")`
      );
    }
  }
});

test("2. Acceptance Test: Normal user error sanitization has ZERO prohibited terms", () => {
  const testErrors = [
    new Error("HTTP 402 Payment Required for Firecrawl API"),
    new Error("SerpAPI quota exhausted [429]"),
    new Error("Brave Search API key invalid"),
    new Error("Google Images browser HTTP 503 provider timeout"),
    new Error("providerUsed parameter error: missing credentials"),
  ];

  for (const err of testErrors) {
    const response = sanitizeProviderError(err);
    for (const term of PROHIBITED_TERMS) {
      assert.equal(
        response.message.toLowerCase().includes(term.toLowerCase()),
        false,
        `Sanitized error message "${response.message}" contained prohibited term "${term}"`
      );
    }
  }
});
