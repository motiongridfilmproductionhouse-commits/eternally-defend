import assert from "node:assert/strict";
import test from "node:test";

import { ScanTelemetryWriter } from "./scan-telemetry";

test("ScanTelemetryWriter serializes forced flushes without dropping events", async () => {
  const persisted: Record<string, unknown>[] = [];
  const writer = new ScanTelemetryWriter(async (stats) => {
    persisted.push(stats);
  });

  let counter = 0;
  const build = () => ({ count: ++counter, recent_activity: [{ id: String(counter) }] });

  await Promise.all([
    writer.flush(build, true),
    writer.flush(build, true),
    writer.flush(build, true),
  ]);

  assert.equal(persisted.length, 3);
  assert.ok(Array.isArray(persisted[2]?.website_activity));
});

test("parseWebsiteActivity prefers website_activity field", async () => {
  const { parseWebsiteActivity } = await import("./scan-activity");
  const events = parseWebsiteActivity({
    website_activity: [
      {
        id: "a::discovered",
        hostname: "example.com",
        page_label: "/watch",
        provider: "firecrawl",
        stage: "discovered",
        stage_label: "Discovered",
        threat: "checking",
        threat_label: "CHECKING",
        occurred_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    recent_activity: [],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.hostname, "example.com");
});
