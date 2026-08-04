import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildQueuedProviderSeedEntries,
  configuredCopyrightScanProviders,
  forcePersistCopyrightScanProviderSeed,
} from "./scan-provider-seed.server";
import { mergeSourceActivityIntoStats, parseSourceActivity } from "./source-activity";

const FUNCTIONS_PATH = resolve(process.cwd(), "src/lib/copyright.functions.ts");

test("buildQueuedProviderSeedEntries returns queued zero-count providers", () => {
  const entries = buildQueuedProviderSeedEntries([
    { provider: "firecrawl", label: "Firecrawl" },
    { provider: "youtube", label: "YouTube" },
  ]);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.status, "queued");
    assert.equal(entry.requests, 0);
    assert.equal(entry.candidates, 0);
    assert.equal(entry.failures, 0);
    assert.ok(entry.updated_at);
    assert.ok(entry.label);
  }
});

test("mergeSourceActivityIntoStats preserves zero-count entries through parseSourceActivity", () => {
  const entries = buildQueuedProviderSeedEntries([
    { provider: "bright_data", label: "Bright Data" },
  ]);
  const merged = mergeSourceActivityIntoStats({ scan_created: "2026-08-01T00:00:00.000Z" }, entries);
  const parsed = parseSourceActivity(merged);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.provider, "bright_data");
  assert.equal(parsed[0]?.candidates, 0);
});

test("forcePersistCopyrightScanProviderSeed awaits write and verifies row count", async () => {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from() {
      return {
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return {
            eq() {
              return this;
            },
            select() {
              return Promise.resolve({
                data: [{ id: "scan-1", status: "running", stats: payload.stats }],
                error: null,
                count: 1,
              });
            },
          };
        },
      };
    },
  };

  const result = await forcePersistCopyrightScanProviderSeed({
    supabase: supabase as never,
    scanId: "scan-1",
    scanStatus: "running",
    priorStats: { scan_created: "2026-08-01T00:00:00.000Z" },
  });

  assert.equal(updates.length, 1);
  assert.equal(result.rowCount, 1);
  assert.ok(Array.isArray(result.stats.source_activity));
  assert.ok(result.providers.length >= 0);
});

test("forcePersistCopyrightScanProviderSeed logs zero-row failure", async () => {
  const supabase = {
    from() {
      return {
        update() {
          return {
            eq() {
              return this;
            },
            select() {
              return Promise.resolve({ data: [], error: null, count: 0 });
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () =>
      forcePersistCopyrightScanProviderSeed({
        supabase: supabase as never,
        scanId: "scan-2",
        scanStatus: "running",
        priorStats: {},
      }),
    /updated zero rows/,
  );
});

test("executor seeds providers immediately after claim before reference analysis", () => {
  const src = readFileSync(FUNCTIONS_PATH, "utf8");
  const claimStart = src.indexOf("copyright_scan_executor_claimed");
  const analyzeStart = src.indexOf("analyzeReference(referenceDataUrl");
  assert.ok(claimStart >= 0);
  assert.ok(analyzeStart > claimStart);
  const block = src.slice(claimStart, analyzeStart);
  assert.match(block, /forcePersistCopyrightScanProviderSeed/);
  assert.doesNotMatch(block, /analyzeReference/);
  assert.doesNotMatch(block, /firecrawlDiscover/);
  assert.doesNotMatch(block, /discoverYoutubeVideos/);
});

test("configuredCopyrightScanProviders only includes configured integrations", () => {
  const providers = configuredCopyrightScanProviders();
  for (const row of providers) {
    assert.ok(row.provider);
    assert.ok(row.label);
  }
});
