import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENT_PATH = join(
  process.cwd(),
  "src/components/deepfake/ThreatTimeline.tsx",
);

test("1. ThreatTimeline component exports cleanly and includes real-time feed headers", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  assert.match(code, /export function ThreatTimeline/);
  assert.match(code, /Real-Time Threat & Discovery Timeline/);
  assert.match(code, /Live Telemetry Feed/);
});

test("2. ThreatTimeline renders threat events with +1 Threat badges", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  assert.match(code, /\+1 Threat/);
  assert.match(code, /ev\.threat/);
});
