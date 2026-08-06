import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInvestigationResponse, resolveInvestigationUrl } from "./website-investigation";

test("resolveInvestigationUrl reads source_url from copyright matches", () => {
  const url = resolveInvestigationUrl({
    source_url: "https://pirate.example/watch",
    page_title: "Watch",
  });
  assert.equal(url, "https://pirate.example/watch");
});

test("normalizeInvestigationResponse supports response.investigation shape", () => {
  const outcome = normalizeInvestigationResponse({
    investigation: {
      url: "https://example.com/page",
      domain: "example.com",
      threatScore: 82,
      riskLevel: "High",
      page: { title: "Example", evidence: ["Download links detected"] },
      http: { status: 200 },
      whois: { registrar: "Example Registrar" },
      investigatedAt: "2026-08-02T12:00:00.000Z",
    },
  });
  assert.equal(outcome.kind, "result");
  if (outcome.kind !== "result") return;
  assert.equal(outcome.result.domain, "example.com");
  assert.equal(outcome.result.threatScore, 82);
  assert.equal(outcome.result.whoisRegistrar, "Example Registrar");
});

test("normalizeInvestigationResponse supports response.data shape", () => {
  const outcome = normalizeInvestigationResponse({
    data: {
      url: "https://example.com",
      hostname: "example.com",
      risk: { score: 40, severity: "Medium" },
      page: { title: "Test" },
      http: { status: 200 },
    },
  });
  assert.equal(outcome.kind, "result");
  if (outcome.kind !== "result") return;
  assert.equal(outcome.result.riskLevel, "Medium");
});

test("normalizeInvestigationResponse returns job when jobId present", () => {
  const outcome = normalizeInvestigationResponse({
    jobId: "11111111-1111-1111-1111-111111111111",
    status: "pending",
  });
  assert.deepEqual(outcome, {
    kind: "job",
    jobId: "11111111-1111-1111-1111-111111111111",
  });
});

test("normalizeInvestigationResponse does not complete without investigation payload", () => {
  const outcome = normalizeInvestigationResponse({ status: "completed" });
  assert.equal(outcome.kind, "error");
});
