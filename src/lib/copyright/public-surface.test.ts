import assert from "node:assert/strict";
import test from "node:test";
import {
  publicCapabilityLabel,
  sanitizeCopyrightStatsForClient,
  sanitizeDiscoveryQueryForClient,
  sanitizeSourceActivityEntryForClient,
} from "./public-surface";

test("publicCapabilityLabel hides vendor names", () => {
  assert.equal(publicCapabilityLabel("firecrawl"), "Public Web");
  assert.equal(publicCapabilityLabel("bright_data"), "Expanded Discovery");
  assert.equal(publicCapabilityLabel("youtube"), "Public Video");
  assert.equal(publicCapabilityLabel("crawl4ai"), "Dynamic Webpage");
  assert.equal(publicCapabilityLabel("serpapi"), "Public Search");
});

test("sanitizeDiscoveryQueryForClient removes internal provider prefixes", () => {
  assert.equal(sanitizeDiscoveryQueryForClient("known_url_seed"), "Submitted URL");
  assert.equal(sanitizeDiscoveryQueryForClient("brightdata:watch movie"), "Expanded discovery");
  assert.equal(sanitizeDiscoveryQueryForClient("serpapi:query"), "Public search");
});

test("sanitizeCopyrightStatsForClient strips internal diagnostics", () => {
  const sanitized = sanitizeCopyrightStatsForClient({
    provider_requests: 9,
    provider_successes: 9,
    firecrawl_requests: 9,
    firecrawl_operator_action: "rotate key",
    brightdata_diagnostic: { endpoint: "secret" },
    source_activity: [
      {
        provider: "firecrawl",
        label: "Firecrawl",
        status: "completed",
        requests: 9,
        candidates: 12,
        failures: 0,
        updated_at: "2026-08-02T18:00:00.000Z",
      },
    ],
    rejection_funnel: ["Providers: 9 requests, check Firecrawl configuration."],
  });

  assert.equal(sanitized.firecrawl_requests, undefined);
  assert.equal(sanitized.brightdata_diagnostic, undefined);
  assert.equal(sanitized.firecrawl_operator_action, undefined);
  assert.equal((sanitized.source_activity as Array<{ label: string }>)[0]?.label, "Public Web");
  const funnel = sanitized.rejection_funnel as string[];
  assert.ok(funnel[0]?.includes("public web discovery"));
  assert.ok(!funnel[0]?.includes("Firecrawl"));
});

test("sanitizeSourceActivityEntryForClient maps provider id to capability", () => {
  const entry = sanitizeSourceActivityEntryForClient({
    provider: "youtube",
    label: "YouTube",
    status: "searching",
    requests: 2,
    candidates: 1,
    failures: 0,
    updated_at: "2026-08-02T18:00:00.000Z",
  });
  assert.equal(entry.label, "Public Video");
  assert.equal(entry.provider, "public_video");
});
