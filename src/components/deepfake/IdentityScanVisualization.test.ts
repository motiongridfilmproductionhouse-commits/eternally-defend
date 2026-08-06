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
  threatAlertBadgeLabel,
  classifyThreatFinding,
  buildThreatAlertSummary,
  mapFindingToRadarStage,
} from "../../lib/deepfake/threat-alert";
import type { ClientFinding } from "../../lib/deepfake/results-dashboard";

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

test("7. High Alert mode renders HIGH ALERT badge, floating alert banner, and threat pulse", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  const redBadge = threatAlertBadgeLabel({ mode: "running", tone: "red" });
  assert.equal(redBadge, "🚨 HIGH ALERT");

  const completedBadge = threatAlertBadgeLabel({ mode: "completed", tone: "red" });
  assert.equal(completedBadge, "HIGH ALERT · ACTION REQUIRED");

  const cleanBadge = threatAlertBadgeLabel({ mode: "completed", tone: "cyan" });
  assert.equal(cleanBadge, "✓ NO SYNTHETIC MEDIA DETECTED");

  assert.match(code, /data-testid="high-alert-banner"/);
  assert.match(code, /🚨 HIGH RISK SYNTHETIC MEDIA DETECTED/);
  assert.match(code, /data-testid="threat-pulse-badge"/);
});

test("8. classifyThreatFinding triggers High Alert for VERIFIED_EXPLICIT_DEEPFAKE, PROBABLE_FACE_SWAP, and HIGH risk synthetic items", () => {
  const explicitVerified: ClientFinding = {
    id: "f1",
    finding_classification: "VERIFIED_EXPLICIT_DEEPFAKE",
    risk_level: "CRITICAL",
  };
  assert.equal(classifyThreatFinding(explicitVerified), "VERIFIED_DEEPFAKE");

  const faceSwapProbable: ClientFinding = {
    id: "f2",
    finding_classification: "PROBABLE_FACE_SWAP",
    risk_level: "HIGH",
  };
  assert.equal(classifyThreatFinding(faceSwapProbable), "PROBABLE_DEEPFAKE");

  const syntheticHigh: ClientFinding = {
    id: "f3",
    finding_classification: "SYNTHETIC_IMAGE",
    risk_level: "HIGH",
    is_synthetic: true,
  };
  assert.equal(classifyThreatFinding(syntheticHigh), "PROBABLE_DEEPFAKE");

  const summary = buildThreatAlertSummary([explicitVerified, faceSwapProbable, syntheticHigh]);
  assert.equal(summary.tone, "red");
  assert.equal(summary.verified, 1);
  assert.equal(summary.probable, 2);
  assert.equal(summary.total, 3);
});

test("9. Dual status badges separate raw candidate count from verified threats", () => {
  const code = readFileSync(COMPONENT_PATH, "utf8");
  assert.match(code, /data-testid="candidates-count-badge"/);
  assert.match(code, /data-testid="verified-threats-badge"/);
  assert.match(code, /verification pending/);
});

test("10. mapFindingToRadarStage maps finding classifications to exact radar stage nodes", () => {
  assert.equal(
    mapFindingToRadarStage({ id: "1", finding_classification: "VERIFIED_FACE_SWAP" }),
    "identity_match",
  );
  assert.equal(
    mapFindingToRadarStage({ id: "2", finding_classification: "SYNTHETIC_IMAGE", is_synthetic: true }),
    "media_analysis",
  );
  assert.equal(
    mapFindingToRadarStage({ id: "3", finding_classification: "VERIFIED_DEEPFAKE", takedown_recommended: true }),
    "evidence_classification",
  );
});
