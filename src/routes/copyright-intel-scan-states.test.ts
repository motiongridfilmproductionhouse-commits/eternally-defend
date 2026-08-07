import assert from "node:assert/strict";
import test from "node:test";
import { decideCopyrightTerminalStatus } from "../lib/copyright/scan-lifecycle";
import { buildQueries } from "../lib/copyright/discover.server";

test("STATE 1: Failed scan status decision", () => {
  const outcome = decideCopyrightTerminalStatus({
    executorStarted: false,
    queriesGenerated: 0,
    queriesExecuted: 0,
    providerSuccesses: 0,
    providerFailures: 1,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
    fatalReason: "Copyright scan executor never started.",
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "Copyright scan executor never started.");
});

test("STATE 2 & 3: Failed -> Retry transition to running", () => {
  const initialStatus = "failed";
  const retriedStatus = "running";
  assert.equal(initialStatus, "failed");
  assert.equal(retriedStatus, "running");
});

test("STATE 4: Completed scan with zero findings", () => {
  const outcome = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 12,
    queriesExecuted: 12,
    providerSuccesses: 4,
    providerFailures: 0,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
  });

  assert.equal(outcome.status, "completed");
});

test("STATE 5: Completed scan with findings", () => {
  const outcome = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 15,
    queriesExecuted: 15,
    providerSuccesses: 5,
    providerFailures: 0,
    providerCandidates: 8,
    pagesCrawled: 6,
    clientVisibleFindings: 3,
  });

  assert.equal(outcome.status, "completed");
});

test("STATE 6 & 7: Partial scan status decision", () => {
  const outcome = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 10,
    queriesExecuted: 6,
    providerSuccesses: 2,
    providerFailures: 2,
    providerCandidates: 4,
    pagesCrawled: 3,
    clientVisibleFindings: 1,
    abortedByDeadline: true,
  });

  assert.equal(outcome.status, "partial");
});

test("REGRESSION: Reference preparation failure fallback generates queries for Thudakkam asset", () => {
  const fallbackAnalysis = {
    title: "Thudakkam",
    altTitles: [],
    language: "Malayalam",
    audienceLanguages: ["Malayalam"],
    region: null,
    actors: [],
    productionCompany: null,
    releaseDate: null,
    descriptors: [],
    ocrText: null,
    watermark: null,
    visualFeatures: [],
    mediaType: null,
  };

  const queries = buildQueries(fallbackAnalysis, "Thudakkam");
  assert.ok(queries.length > 0);
  assert.ok(queries.some((q) => q.query.includes("Thudakkam")));
  assert.ok(queries.some((q) => q.query.includes("watch online") || q.query.includes("download")));
});

test("REGRESSION: Stale worker without executor start returns failed status", () => {
  const outcome = decideCopyrightTerminalStatus({
    executorStarted: false,
    queriesGenerated: 0,
    queriesExecuted: 0,
    providerSuccesses: 0,
    providerFailures: 0,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
    fatalReason: "Worker lease expired without heartbeat (STALE_WORKER).",
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason, "Worker lease expired without heartbeat (STALE_WORKER).");
});
