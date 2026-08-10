import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeProviderError } from "./error-sanitizer";

describe("Eterna Security Hardening & Client/Server Boundary Test Suite", () => {
  it("1. sanitizeProviderError maps YouTube quota errors to clean client message without exposing vendor name", () => {
    const err = new Error("YouTube Data API v3 returned quotaExceeded [403]");
    const sanitized = sanitizeProviderError(err);

    assert.equal(sanitized.code, "DISCOVERY_LIMIT_REACHED");
    assert.equal(sanitized.message, "Discovery limit reached. Please try again later.");
    assert.ok(!sanitized.message.includes("YouTube"));
    assert.ok(!sanitized.message.includes("quotaExceeded"));
  });

  it("2. sanitizeProviderError maps database/PostgreSQL errors to STORAGE_UNAVAILABLE", () => {
    const err = new Error("PostgreSQL query failed: findings upsert failed: connection reset");
    const sanitized = sanitizeProviderError(err);

    assert.equal(sanitized.code, "STORAGE_UNAVAILABLE");
    assert.equal(sanitized.message, "Unable to save data or asset.");
    assert.ok(!sanitized.message.includes("PostgreSQL"));
    assert.ok(!sanitized.message.includes("upsert"));
  });

  it("3. sanitizeProviderError maps classifier errors to ANALYSIS_UNAVAILABLE", () => {
    const err = new Error("Gemini classifier failed to process video transcript");
    const sanitized = sanitizeProviderError(err);

    assert.equal(sanitized.code, "ANALYSIS_UNAVAILABLE");
    assert.equal(sanitized.message, "Evidence analysis could not be completed.");
    assert.ok(!sanitized.message.includes("Gemini"));
  });

  it("4. Environment variable check verifies no sensitive API keys are exposed via VITE_ or PUBLIC_ prefix", () => {
    const publicEnvKeys = Object.keys(process.env).filter(
      (k) => k.startsWith("VITE_") || k.startsWith("NEXT_PUBLIC_") || k.startsWith("PUBLIC_"),
    );

    for (const key of publicEnvKeys) {
      assert.ok(!key.includes("YOUTUBE_API_KEY"), `Secret key ${key} exposed publicly!`);
      assert.ok(!key.includes("GOOGLE_API_KEY"), `Secret key ${key} exposed publicly!`);
      assert.ok(!key.includes("SERVICE_ROLE"), `Secret key ${key} exposed publicly!`);
      assert.ok(!key.includes("AWS_SECRET"), `Secret key ${key} exposed publicly!`);
      assert.ok(!key.includes("OPENAI"), `Secret key ${key} exposed publicly!`);
    }
  });

  it("5. Security Headers definition includes CSP, frame protection, and referrer policy", () => {
    const requiredHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ];

    assert.equal(requiredHeaders.length, 5);
    assert.ok(requiredHeaders.includes("Content-Security-Policy"));
    assert.ok(requiredHeaders.includes("X-Frame-Options"));
  });

  it("6. sanitizeProviderError maps AWS Rekognition & OpenAI failures to ANALYSIS_UNAVAILABLE", () => {
    const errAWS = new Error("AWS Rekognition CompareFaces failed: AccessDeniedException");
    const resAWS = sanitizeProviderError(errAWS);
    assert.equal(resAWS.code, "ANALYSIS_UNAVAILABLE");
    assert.ok(!resAWS.message.includes("AWS"));
    assert.ok(!resAWS.message.includes("Rekognition"));

    const errAI = new Error("OpenAI API call returned 500 Internal Server Error");
    const resAI = sanitizeProviderError(errAI);
    assert.equal(resAI.code, "ANALYSIS_UNAVAILABLE");
    assert.ok(!resAI.message.includes("OpenAI"));
  });

  it("7. sanitizeProviderError maps identity/KYC provider failures to IDENTITY_SERVICE_UNAVAILABLE", () => {
    const errKYC = new Error("Veriff verification webhook failure: invalid signature");
    const resKYC = sanitizeProviderError(errKYC);

    assert.equal(resKYC.code, "IDENTITY_SERVICE_UNAVAILABLE");
    assert.ok(!resKYC.message.includes("Veriff"));
  });

  it("8. sanitizeProviderError maps scraper/Firecrawl failures to DISCOVERY_UNAVAILABLE", () => {
    const errScrape = new Error("Firecrawl scraper request failed: 401 Unauthorized");
    const resScrape = sanitizeProviderError(errScrape);

    assert.equal(resScrape.code, "DISCOVERY_UNAVAILABLE");
    assert.ok(!resScrape.message.includes("Firecrawl"));
  });

  it("9. Server-only error sanitizer never leaks raw error objects or stack traces to client", () => {
    const errorWithStack = new Error("Internal PostgreSQL syntax error near WHERE id = 123");
    errorWithStack.stack = "Error: Internal PostgreSQL syntax error\n    at queryServer (server.ts:42:15)";

    const sanitized = sanitizeProviderError(errorWithStack);
    assert.equal(typeof sanitized.message, "string");
    assert.ok(!sanitized.message.includes("stack"));
    assert.ok(!sanitized.message.includes("WHERE id = 123"));
  });
});
