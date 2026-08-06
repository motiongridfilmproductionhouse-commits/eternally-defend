import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveIdentityScanVizMode,
  identityScanStatusHeadline,
  activeIdentityScanNodeIds,
} from "../../lib/deepfake/identity-scan-viz";
import {
  shouldAnimateThreatAwareScan,
  shouldShowThreatAwareScanBeam,
  threatAwareStatusCopy,
} from "../../lib/deepfake/threat-alert";

const COMPONENT_PATH = join(
  process.cwd(),
  "src/components/deepfake/IdentityScanVisualization.tsx",
);
const STYLES_PATH = join(process.cwd(), "src/styles.css");

test("1. READY state applies slow rotation animations and status copy", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  const mode = resolveIdentityScanVizMode({ hasSelectedProfile: true, scanStatus: "ready" });
  assert.equal(mode, "idle");

  const statusCopy = threatAwareStatusCopy({ mode: "idle", tone: "cyan" });
  assert.equal(statusCopy, "Identity model ready");

  // Verify slow 14s and 20s rotation animations exist for idle / ready state
  assert.match(code, /animation:\s*"identityRingSpin 14s linear infinite"/);
  assert.match(code, /animation:\s*"identityRingSpinReverse 20s linear infinite"/);
});

test("2. RUNNING state applies faster rotation and scan beam", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  const mode = resolveIdentityScanVizMode({ hasSelectedProfile: true, scanStatus: "running" });
  assert.equal(mode, "running");

  const showBeam = shouldShowThreatAwareScanBeam({
    mode: "running",
    prefersReducedMotion: false,
  });
  assert.equal(showBeam, true);

  // Verify 4s and 7s faster rotation for running state
  assert.match(code, /animation:\s*"identityRingSpin 4s linear infinite"/);
  assert.match(code, /animation:\s*"identityRingSpinReverse 7s linear infinite"/);
  assert.match(code, /data-testid="identity-scan-beam"/);
});

test("3. Portrait container never receives rotation animation classes", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  const portraitBlock = code.slice(
    code.indexOf("showPhoto ?"),
    code.indexOf("data-testid=\"identity-scan-beam\""),
  );

  assert.doesNotMatch(portraitBlock, /identityRingSpin/);
  assert.doesNotMatch(portraitBlock, /identity-radar-spin/);
  assert.doesNotMatch(portraitBlock, /animate-spin/);
});

test("4. COMPLETED state stops active rotation", () => {
  const mode = resolveIdentityScanVizMode({ hasSelectedProfile: true, scanStatus: "completed" });
  assert.equal(mode, "completed");

  const animate = shouldAnimateThreatAwareScan({
    mode: "completed",
    tone: "cyan",
    prefersReducedMotion: false,
  });
  assert.equal(animate, false);

  const activeNodes = activeIdentityScanNodeIds("done", "completed");
  assert.equal(activeNodes.length, 6);
});

test("5. FAILED state stops active rotation and displays failure message", () => {
  const mode = resolveIdentityScanVizMode({ hasSelectedProfile: true, scanStatus: "failed" });
  assert.equal(mode, "failed");

  const animate = shouldAnimateThreatAwareScan({
    mode: "failed",
    tone: "cyan",
    prefersReducedMotion: false,
  });
  assert.equal(animate, false);

  const headline = identityScanStatusHeadline("failed");
  assert.equal(headline, "Scan failed");
});

test("6. Reduced-motion mode disables motion without hiding status information", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  const styles = readFileSync(STYLES_PATH, "utf8");

  const animate = shouldAnimateThreatAwareScan({
    mode: "running",
    tone: "cyan",
    prefersReducedMotion: true,
  });
  assert.equal(animate, false);

  const showBeam = shouldShowThreatAwareScanBeam({
    mode: "running",
    prefersReducedMotion: true,
  });
  assert.equal(showBeam, false);

  assert.match(code, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.identity-radar-ring[\s\S]*animation:\s*none !important/);
});
