import assert from "node:assert/strict";
import test from "node:test";

import {
  brightDataTelemetryFromStats,
  resolveActivityProvider,
  providerDisplayLabel,
} from "@/lib/copyright/scan-activity";

test("brightdata lead queries resolve to expanded discovery capability", () => {
  assert.equal(resolveActivityProvider('brightdata:"Superman" full movie'), "brightdata");
  assert.equal(providerDisplayLabel("brightdata"), "Expanded Discovery");
  assert.equal(resolveActivityProvider("serpapi:fallback"), "serpapi");
});

test("running telemetry reports live counters without secrets", () => {
  const t = brightDataTelemetryFromStats(
    {
      brightdata_configured: true,
      brightdata_running: true,
      brightdata_requests: 3,
      brightdata_successes: 2,
      brightdata_failures: 1,
      brightdata_candidates: 12,
      brightdata_unique_urls: 10,
      brightdata_queries_generated: 6,
      brightdata_queries_completed: 3,
      brightdata_elapsed_ms: 4200,
      brightdata_last_query: '"Balan The Boy" full movie download',
      brightdata_failures_by_category: { rate_limited: 1, timeout: 0 },
      brightdata_diagnostic: {
        configured: true,
        api_key_present: true,
        api_key_length: 40,
        zone: "serp_api1",
        endpoint: "https://api.brightdata.com/request",
      },
    },
    "running",
  );
  assert.equal(t.status, "running");
  assert.equal(t.statusLabel, "Running");
  assert.equal(t.requests, 3);
  assert.equal(t.uniqueUrls, 10);
  assert.equal(t.durationMs, 4200);
  assert.deepEqual(t.errors, ["Rate limited (1)"]);
  assert.equal(t.zone, "serp_api1");
  assert.equal(JSON.stringify(t).includes("api_key"), false);
});

test("missing api key surfaces a specific error and not_configured status", () => {
  const t = brightDataTelemetryFromStats({ brightdata_configured: false }, "completed");
  assert.equal(t.status, "not_configured");
  assert.deepEqual(t.errors, ["Missing API key"]);
});

test("all failures with no successes surfaces error status", () => {
  const t = brightDataTelemetryFromStats(
    {
      brightdata_configured: true,
      brightdata_requests: 2,
      brightdata_failures: 2,
      brightdata_successes: 0,
      brightdata_failures_by_category: { invalid_credentials: 2 },
    },
    "completed",
  );
  assert.equal(t.status, "error");
  assert.deepEqual(t.errors, ["Invalid credentials (2)"]);
});

test("no provider stats yet reads as pending, not missing api key", () => {
  const t = brightDataTelemetryFromStats({}, "running");
  assert.equal(t.status, "pending");
  assert.equal(t.statusLabel, "Pending");
  assert.deepEqual(t.errors, []);
});
