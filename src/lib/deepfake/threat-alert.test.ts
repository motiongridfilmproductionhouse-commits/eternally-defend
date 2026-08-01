import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import { ThreatAlertBanner } from "@/components/deepfake/ThreatAlertBanner";
import { ResultsIntelligenceConsole } from "@/components/deepfake/results/ResultsIntelligenceConsole";
import {
  buildThreatAlertSummary,
  buildThreatDomainLabels,
  resolveNewThreatFindingPulse,
  resolveThreatAlertAnnouncement,
  resolveThreatAwareRingTone,
  shouldAnimateThreatAwareScan,
  shouldShowThreatAwareScanBeam,
  shouldShowThreatAlertBanner,
  threatAlertBadgeLabel,
  threatAlertBannerMessage,
  threatAlertHeadline,
  threatAlertToneFromCounts,
  type ThreatAlertSummary,
} from "./threat-alert";
import type { ClientFinding } from "./results-dashboard";
import { evidenceLinkProps } from "./results-dashboard";

const DOMAINS = [
  "alpha.example.com",
  "bravo.example.net",
  "charlie.example.org",
  "delta.example.io",
] as const;

function finding(
  partial: Partial<ClientFinding> & { id: string },
): ClientFinding {
  return {
    url_verification_status: "URL_VERIFIED",
    finding_classification: "PROBABLE_DEEPFAKE",
    risk_level: "HIGH",
    page_title: "Evidence",
    final_url: `https://cdn.example.com/${partial.id}`,
    source_host: "cdn.example.com",
    review_status: "new",
    ...partial,
  };
}

/** Real production-shaped PARTIAL payload: 12 probable, 4 domains, 0 verified. */
function productionPartialFixture() {
  const findings = Array.from({ length: 12 }, (_, index) => {
    const domain = DOMAINS[index % 4]!;
    const lower = index % 2 === 0;
    return finding({
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      finding_classification: lower ? "probable_deepfake" : "PROBABLE_DEEPFAKE",
      url_verification_status: lower ? "url_verified" : "URL_VERIFIED",
      risk_level: index < 4 ? "CRITICAL" : "HIGH",
      final_url: `https://${domain}/threat-${index}`,
      canonical_url: `https://${domain}/threat-${index}`,
      source_host: domain,
      verified_domain: domain,
      page_title: `Threat page ${index}`,
    });
  });

  return {
    scan: {
      id: "22222222-2222-4222-8222-222222222222",
      status: "partial" as const,
      target_name: "Jane Doe",
      discovery_metrics: {
        client_visible: 12,
        probable: 12,
        verified: 0,
        crawl_succeeded: 20,
        unique_candidates: 40,
      },
      scan_checkpoint: {
        stage: "checkpoint",
        planned_query_count: 24,
        next_query_index: 16,
      },
    },
    findings,
  };
}

test("0 findings → cyan normal state", () => {
  const summary = buildThreatAlertSummary([]);
  assert.equal(summary.tone, "cyan");
  assert.equal(summary.total, 0);
  assert.equal(
    resolveThreatAwareRingTone({ mode: "idle", tone: "cyan" }),
    "cyan",
  );
  assert.equal(threatAlertHeadline("cyan"), null);
});

test("1 qualifying finding → amber", () => {
  const summary = buildThreatAlertSummary([finding({ id: "1" })]);
  assert.equal(summary.tone, "amber");
  assert.equal(summary.total, 1);
  assert.equal(
    resolveThreatAwareRingTone({ mode: "running", tone: "amber" }),
    "amber",
  );
});

test("2–4 threats → orange multiple", () => {
  const summary = buildThreatAlertSummary([
    finding({ id: "1", final_url: "https://a.example/1" }),
    finding({ id: "2", final_url: "https://b.example/2", source_host: "b.example" }),
    finding({ id: "3", final_url: "https://c.example/3", source_host: "c.example" }),
  ]);
  assert.equal(summary.tone, "orange");
  assert.equal(summary.total, 3);
  assert.equal(
    resolveThreatAwareRingTone({ mode: "partial", tone: "orange" }),
    "orange",
  );
  assert.equal(threatAlertHeadline("orange"), "Multiple threats detected");
});

test("5+ threats → red high-volume", () => {
  assert.equal(threatAlertToneFromCounts({ total: 5, verified: 0 }), "red");
  assert.equal(threatAlertToneFromCounts({ total: 12, verified: 0 }), "red");
});

test("any VERIFIED_DEEPFAKE forces red immediately", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "v",
      finding_classification: "verified_deepfake",
      final_url: "https://v.example/1",
      source_host: "v.example",
    }),
  ]);
  assert.equal(summary.tone, "red");
  assert.equal(summary.verified, 1);
  assert.equal(summary.total, 1);
});

test("production PARTIAL fixture with 12 probable findings renders RED", () => {
  const fixture = productionPartialFixture();
  const summary = buildThreatAlertSummary(fixture.findings);
  assert.equal(summary.total, 12);
  assert.equal(summary.probable, 12);
  assert.equal(summary.verified, 0);
  assert.equal(summary.domains, 4);
  assert.equal(summary.tone, "red");
  assert.equal(
    resolveThreatAwareRingTone({ mode: "partial", tone: summary.tone }),
    "red",
  );
  assert.equal(
    threatAlertBadgeLabel({ mode: "partial", tone: "red" }),
    "PAUSED — HIGH THREAT VOLUME",
  );
  assert.equal(
    shouldAnimateThreatAwareScan({
      mode: "partial",
      tone: "red",
      prefersReducedMotion: false,
    }),
    true,
  );
  assert.equal(
    shouldShowThreatAwareScanBeam({
      mode: "partial",
      prefersReducedMotion: false,
    }),
    false,
  );
  assert.equal(
    threatAlertHeadline("red"),
    "HIGH-VOLUME DEEPFAKE THREAT ACTIVITY",
  );
  assert.match(
    threatAlertBannerMessage(summary),
    /Eterna identified 12 distinct client-visible threat pages across 4 verified domains/,
  );
  assert.equal(shouldShowThreatAlertBanner(summary), true);

  const labels = buildThreatDomainLabels(fixture.findings, 3);
  assert.equal(labels.length, 3);
  assert.ok(labels.every((row) => row.threatCount === 3));
  assert.ok(labels.every((row) => DOMAINS.includes(row.domain as (typeof DOMAINS)[number])));

  const vizHtml = renderToString(
    React.createElement(IdentityScanVisualization, {
      artistName: "Jane Doe",
      enrolledCount: 3,
      scanStatus: "partial",
      threatSummary: summary,
      threatFindings: fixture.findings,
      scanId: fixture.scan.id,
    }),
  );
  assert.match(vizHtml, /data-threat-tone="red"/);
  assert.match(vizHtml, /PAUSED — HIGH THREAT VOLUME/);
  assert.match(vizHtml, /HIGH-VOLUME DEEPFAKE THREAT ACTIVITY/);
  assert.match(vizHtml, /Verified progress saved/);
  assert.match(vizHtml, /threat-domain-label/);
  assert.doesNotMatch(vizHtml, /data-testid="identity-scan-beam"/);

  const bannerHtml = renderToString(
    React.createElement(ThreatAlertBanner, {
      summary,
      ariaRole: "status",
      scanStatus: "partial",
      onReviewThreats: () => {},
      onViewAffectedDomains: () => {},
      onContinueScan: () => {},
    }),
  );
  assert.match(bannerHtml, /HIGH-VOLUME DEEPFAKE THREAT ACTIVITY/);
  assert.match(bannerHtml, /Review[\s\S]*?12[\s\S]*?threat/);
  assert.match(bannerHtml, /View[\s\S]*?4[\s\S]*?affected domain/);
  assert.match(bannerHtml, /Continue scan/);
  assert.match(bannerHtml, /0 verified deepfake/);
  assert.match(bannerHtml, /12 probable deepfake/);
  assert.match(bannerHtml, /data-threat-tone="red"/);

  const consoleHtml = renderToString(
    React.createElement(ResultsIntelligenceConsole, {
      scanId: fixture.scan.id,
      scanStatus: "partial",
      targetName: "Jane Doe",
      findings: fixture.findings,
      diagnostics: fixture.scan.discovery_metrics,
      riskFilter: "ALL",
      onRiskFilterChange: () => {},
      onUpdateFinding: () => {},
      pending: false,
      threatTone: "red",
    }),
  );
  assert.match(consoleHtml, /data-threat-tone="red"/);
  assert.match(consoleHtml, /data-high-threat="true"/);
  assert.match(consoleHtml, /Open verified evidence page/);
});

test("new polled finding triggers one animation; later poll does not", () => {
  const ids = ["a", "b"];
  const seed = resolveNewThreatFindingPulse({
    scanId: "scan-1",
    findingIds: ids,
    previous: null,
  });
  assert.equal(seed.isInitialSeed, true);
  assert.deepEqual(seed.newIds, []);

  const live = resolveNewThreatFindingPulse({
    scanId: "scan-1",
    findingIds: ["a", "b", "c"],
    previous: seed.next,
  });
  assert.equal(live.isInitialSeed, false);
  assert.deepEqual(live.newIds, ["c"]);

  const again = resolveNewThreatFindingPulse({
    scanId: "scan-1",
    findingIds: ["a", "b", "c"],
    previous: live.next,
  });
  assert.deepEqual(again.newIds, []);
});

test("reload/history selection restores red without replaying old animations", () => {
  const fixture = productionPartialFixture();
  const summary = buildThreatAlertSummary(fixture.findings);
  const announcement = resolveThreatAlertAnnouncement({
    scanId: fixture.scan.id,
    distinctTotal: summary.total,
    tone: summary.tone,
    previous: null,
  });
  assert.equal(announcement.role, "status");
  const seed = resolveNewThreatFindingPulse({
    scanId: fixture.scan.id,
    findingIds: summary.findingIds,
    previous: null,
  });
  assert.equal(seed.isInitialSeed, true);
  assert.deepEqual(seed.newIds, []);
});

test("changing scan clears prior seen ids", () => {
  const first = resolveNewThreatFindingPulse({
    scanId: "a",
    findingIds: ["1", "2"],
    previous: null,
  });
  const switched = resolveNewThreatFindingPulse({
    scanId: "b",
    findingIds: ["9"],
    previous: first.next,
  });
  assert.equal(switched.isInitialSeed, true);
  assert.deepEqual(switched.newIds, []);
  assert.equal(switched.next.scanId, "b");
});

test("case-insensitive production classifications work", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "1",
      finding_classification: "Probable Deepfake",
      url_verification_status: "url_verified",
      final_url: "https://x.example/1",
      source_host: "x.example",
    }),
    finding({
      id: "2",
      finding_classification: "VERIFIED_DEEPFAKE",
      final_url: "https://y.example/2",
      source_host: "y.example",
    }),
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.verified, 1);
  assert.equal(summary.probable, 1);
  assert.equal(summary.tone, "red");
});

test("filtering/pagination must not reduce alert totals — full findings array", () => {
  const fixture = productionPartialFixture();
  const full = buildThreatAlertSummary(fixture.findings);
  const page = buildThreatAlertSummary(fixture.findings.slice(0, 3));
  assert.equal(full.total, 12);
  assert.equal(page.total, 3);
  const ui = readFileSync(
    resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx"),
    "utf8",
  );
  assert.match(ui, /buildThreatAlertSummary\(\s*findings\s*\)/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*paged/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*filtered/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*scoped/);
});

test("rejected/unverified results do not count", () => {
  const summary = buildThreatAlertSummary([
    finding({ id: "ok", final_url: "https://ok.example/a" }),
    finding({
      id: "rej",
      url_verification_status: "URL_REJECTED",
      final_url: "https://bad.example/a",
    }),
    finding({
      id: "name",
      finding_classification: "NAME_ONLY",
      final_url: "https://adult.example/a",
    }),
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.tone, "amber");
});

test("PARTIAL does not override red threat colour", () => {
  assert.equal(
    resolveThreatAwareRingTone({ mode: "partial", tone: "red" }),
    "red",
  );
  assert.notEqual(
    resolveThreatAwareRingTone({ mode: "partial", tone: "red" }),
    "amber",
  );
});

test("duplicate URLs count once", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "1",
      final_url: "https://cdn.example.com/clip/",
    }),
    finding({
      id: "2",
      final_url: "https://CDN.example.com/clip",
    }),
  ]);
  assert.equal(summary.total, 1);
});

test("reduced-motion disables threat animation helpers", () => {
  assert.equal(
    shouldAnimateThreatAwareScan({
      mode: "partial",
      tone: "red",
      prefersReducedMotion: true,
    }),
    false,
  );
  assert.equal(
    shouldShowThreatAwareScanBeam({
      mode: "running",
      prefersReducedMotion: true,
    }),
    false,
  );
});

test("evidence links remain clickable for counted findings", () => {
  const row = finding({
    id: "e1",
    final_url: "https://safe.example/threat",
  });
  const evidence = evidenceLinkProps(row);
  assert.equal(evidence.kind, "link");
  if (evidence.kind === "link") {
    assert.equal(evidence.target, "_blank");
    assert.equal(evidence.rel, "noopener noreferrer");
  }
});

test("route keeps Continue and wires threatSummary from complete findings", () => {
  const ui = readFileSync(
    resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx"),
    "utf8",
  );
  assert.match(ui, /threatSummary=\{threatSummary\}/);
  assert.match(ui, /threatFindings=\{findings\}/);
  assert.match(ui, /isElevatedThreatTone/);
  assert.match(ui, /Continue scan/);
  assert.match(ui, /continueScan\.mutate/);
  assert.doesNotMatch(ui, /level: "none"/);
});

test("crossing into elevated tone announces once", () => {
  const first = resolveThreatAlertAnnouncement({
    scanId: "s",
    distinctTotal: 1,
    tone: "amber",
    previous: {
      scanId: "s",
      distinctTotal: 0,
      tone: "cyan",
      hasAnnouncedAlert: false,
    },
  });
  assert.equal(first.role, "status");

  const elevated = resolveThreatAlertAnnouncement({
    scanId: "s",
    distinctTotal: 5,
    tone: "red",
    previous: first.next,
  });
  assert.equal(elevated.role, "alert");

  const later = resolveThreatAlertAnnouncement({
    scanId: "s",
    distinctTotal: 12,
    tone: "red",
    previous: elevated.next,
  });
  assert.equal(later.role, "status");
});

test("production fixture summary type includes findingIds", () => {
  const summary: ThreatAlertSummary = buildThreatAlertSummary(
    productionPartialFixture().findings,
  );
  assert.equal(summary.findingIds.length, 12);
});
