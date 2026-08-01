import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { ResultsIntelligenceConsole } from "@/components/deepfake/results/ResultsIntelligenceConsole";
import {
  decideResultsConsoleMount,
  emptyFindingsStatusMessage,
  explainResultsConsoleMountDecision,
  extractClientVisibleFindings,
  shouldMountResultsIntelligenceConsole,
  shouldRenderLegacyFindingCards,
  type GetDeepfakeScanPayload,
} from "./results-console-mount";
import {
  evidenceLinkProps,
  normalizeClientFindings,
} from "./results-dashboard";
import { shouldShowResultsLoader } from "./scan-ui-state";

const UI_PATH = resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx");

function uiSource(): string {
  return readFileSync(UI_PATH, "utf8");
}

/** Production-shaped getDeepfakeScan payload (snake_case). */
function productionPayload(input: {
  status: "running" | "partial" | "completed" | "failed";
  findings?: number;
  error_message?: string | null;
}): GetDeepfakeScanPayload {
  const findings =
    (input.findings ?? 1) > 0
      ? [
          {
            id: "11111111-1111-1111-1111-111111111111",
            scan_id: "22222222-2222-2222-2222-222222222222",
            url: "https://cdn.example.com/clip",
            source_host: "cdn.example.com",
            page_title: "Probable deepfake page",
            snippet: "Jane Doe deepfake clip",
            query: "Jane Doe deepfake",
            risk_level: "HIGH",
            content_category: "explicit",
            confidence: 0.84,
            is_synthetic: true,
            face_referenced: true,
            takedown_recommended: true,
            ai_reasoning: "synthetic media indicators",
            review_status: "new",
            finding_classification: "PROBABLE_DEEPFAKE",
            page_type: "profile_page",
            identity_confidence: 0.9,
            synthetic_media_confidence: 0.8,
            matched_evidence: ["name_in_title"],
            classification_explanation: "probable deepfake",
            url_verification_status: "URL_VERIFIED",
            final_url: "https://cdn.example.com/clip",
            canonical_url: "https://cdn.example.com/canonical",
            discovered_url: "https://cdn.example.com/discovered",
            verified_domain: "cdn.example.com",
            http_status: 200,
            redirect_chain: ["https://cdn.example.com/clip"],
            crawled_at: "2026-08-01T12:00:00.000Z",
            created_at: "2026-08-01T12:00:00.000Z",
          },
        ]
      : [];

  return {
    scan: {
      id: "22222222-2222-2222-2222-222222222222",
      status: input.status,
      target_name: "Jane Doe",
      profile_id: "33333333-3333-3333-3333-333333333333",
      error_message: input.error_message ?? null,
      total_results: findings.length,
      discovery_metrics: {
        client_visible: findings.length,
        unique_candidates: 6,
        crawl_succeeded: 4,
        identity_rejected: 1,
        url_rejected: 1,
        crawl_failed: 0,
        queries_generated: 12,
        queries_executed: 8,
        stage: "saving",
      },
      scan_checkpoint: {
        stage: "saving",
        planned_query_count: 12,
        next_query_index: 8,
      },
    },
    findings,
    discoveries: [],
  };
}

function renderConsole(payload: GetDeepfakeScanPayload) {
  const findings = extractClientVisibleFindings(payload);
  const html = renderToString(
    React.createElement(ResultsIntelligenceConsole, {
      scanId: payload.scan?.id || "scan",
      scanStatus: payload.scan?.status || "partial",
      targetName: payload.scan?.target_name || "Target",
      findings,
      discoveries: [],
      diagnostics: (payload.scan?.discovery_metrics ?? null) as Record<
        string,
        number
      > | null,
      riskFilter: "ALL" as const,
      onRiskFilterChange: () => {},
      onUpdateFinding: () => {},
      pending: false,
    }),
  );
  return { findings, html };
}

function assertConsoleMounted(html: string) {
  assert.match(html, /data-testid="results-intelligence-console"/);
  assert.match(html, /Verified Threat Intelligence/);
  assert.match(html, /Verified Evidence Network/);
  assert.match(html, /data-testid="intelligence-tables"/);
  assert.match(html, /data-testid="intelligence-finding-cards"/);
  assert.match(html, /Open verified evidence page/);
  assert.doesNotMatch(html, /function FindingCard/);
  assert.doesNotMatch(html, /data-testid="deepfake-legacy-finding-card"/);
}

test("PARTIAL + one probable finding mounts new console sections", () => {
  const payload = productionPayload({ status: "partial", findings: 1 });
  const visible = extractClientVisibleFindings(payload);
  assert.equal(visible.length, 1);
  assert.equal(
    shouldMountResultsIntelligenceConsole({
      selectedScanId: payload.scan!.id!,
      hasScanRow: true,
      visibleFindingCount: visible.length,
      showLoader: false,
    }),
    true,
  );
  const { html } = renderConsole(payload);
  assertConsoleMounted(html);
  assert.match(html, /Continue remains available above/);
});

test("RUNNING + one persisted finding mounts new console", () => {
  const payload = productionPayload({ status: "running", findings: 1 });
  const { html } = renderConsole(payload);
  assertConsoleMounted(html);
  assert.match(html, /Live sweep in progress/);
});

test("COMPLETED + one finding mounts new console", () => {
  const payload = productionPayload({ status: "completed", findings: 1 });
  const { html } = renderConsole(payload);
  assertConsoleMounted(html);
  assert.match(html, /Scan completed/);
});

test("FAILED + saved finding mounts new console", () => {
  const payload = productionPayload({
    status: "failed",
    findings: 1,
    error_message: "Provider timeout after verified progress",
  });
  const { html } = renderConsole(payload);
  assertConsoleMounted(html);
});

test("zero findings shows scanner/status empty state and does not mount console", () => {
  const payload = productionPayload({ status: "partial", findings: 0 });
  const visible = extractClientVisibleFindings(payload);
  assert.equal(visible.length, 0);
  const decision = decideResultsConsoleMount({
    selectedScanId: payload.scan!.id!,
    hasScanRow: true,
    visibleFindingCount: visible.length,
    showLoader: false,
  });
  assert.equal(decision.mount, false);
  assert.equal(decision.reason, "zero_client_visible_findings");
  assert.match(
    emptyFindingsStatusMessage({ status: "partial" }),
    /Partial scan finished/,
  );
});

test("legacy result cards stay disabled when console mounts", () => {
  assert.equal(
    shouldRenderLegacyFindingCards({ consoleMounted: true }),
    false,
  );
  assert.equal(
    shouldRenderLegacyFindingCards({ consoleMounted: false }),
    false,
  );
});

test("production snake_case fields map into console evidence link", () => {
  const payload = productionPayload({ status: "partial", findings: 1 });
  const [finding] = extractClientVisibleFindings(payload);
  assert.ok(finding);
  assert.equal(finding.finding_classification, "PROBABLE_DEEPFAKE");
  assert.equal(finding.url_verification_status, "URL_VERIFIED");
  assert.equal(finding.final_url, "https://cdn.example.com/clip");
  const evidence = evidenceLinkProps(finding);
  assert.equal(evidence.kind, "link");
  if (evidence.kind === "link") {
    assert.equal(evidence.href, "https://cdn.example.com/clip");
    assert.equal(evidence.target, "_blank");
    assert.equal(evidence.rel, "noopener noreferrer");
    assert.equal(evidence.clickable, true);
  }
  const { html } = renderConsole(payload);
  assert.match(html, /href="https:\/\/cdn\.example\.com\/clip"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("canonical_url is used when final_url is missing; unsafe URLs blocked", () => {
  const normalized = normalizeClientFindings([
    {
      id: "a",
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "URL_VERIFIED",
      final_url: null,
      canonical_url: "https://safe.example/page",
      risk_level: "HIGH",
    },
    {
      id: "b",
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "URL_VERIFIED",
      final_url: "javascript:alert(1)",
      canonical_url: "not-a-url",
      risk_level: "HIGH",
    },
  ]);
  const ok = evidenceLinkProps(normalized[0]!);
  assert.equal(ok.kind, "link");
  if (ok.kind === "link") assert.equal(ok.href, "https://safe.example/page");
  const blocked = evidenceLinkProps(normalized[1]!);
  assert.equal(blocked.kind, "unavailable");
});

test("mount decision ignores completed-only / mutation / diagnostics requirements", () => {
  for (const status of ["running", "partial", "completed", "failed"] as const) {
    const decision = decideResultsConsoleMount({
      selectedScanId: "scan",
      hasScanRow: true,
      visibleFindingCount: 1,
      showLoader: false,
    });
    assert.equal(decision.mount, true, status);
  }
  // Loader only blocks before the scan row exists.
  assert.equal(
    shouldShowResultsLoader({ isLoading: true, hasScan: true }),
    false,
  );
  assert.equal(
    shouldMountResultsIntelligenceConsole({
      selectedScanId: "scan",
      hasScanRow: true,
      visibleFindingCount: 1,
      showLoader: shouldShowResultsLoader({ isLoading: true, hasScan: true }),
    }),
    true,
  );
});

test("dev mount explanation never embeds raw finding bodies", () => {
  const message = explainResultsConsoleMountDecision({
    selectedScanId: "scan",
    hasScanRow: true,
    visibleFindingCount: 0,
    showLoader: false,
    scanStatus: "partial",
  });
  assert.match(message, /mount=false/);
  assert.match(message, /zero_client_visible_findings/);
  assert.doesNotMatch(message, /cdn\.example/);
  assert.doesNotMatch(message, /PROBABLE_DEEPFAKE/);
  assert.doesNotMatch(message, /javascript:/);
});

test("route wires console mount helpers and keeps Continue for PARTIAL", () => {
  const src = uiSource();
  assert.match(src, /ResultsIntelligenceConsole/);
  assert.match(src, /decideResultsConsoleMount/);
  assert.match(src, /extractClientVisibleFindings/);
  assert.match(src, /shouldRenderLegacyFindingCards/);
  assert.match(src, /explainResultsConsoleMountDecision/);
  assert.match(src, /import\.meta\.env\.DEV/);
  assert.doesNotMatch(src, /function FindingCard\s*\(/);
  assert.doesNotMatch(src, /<FindingCard\b/);
  // Continue control for partial scans remains in the status header.
  assert.match(src, /scan\.status === "partial"/);
  assert.match(src, /continueScan\.mutate/);
  assert.match(src, /Continue scan/);
});

test("Evidence Network includes a domain node for a single finding", () => {
  const { html } = renderConsole(
    productionPayload({ status: "partial", findings: 1 }),
  );
  assert.match(html, /cdn\.example\.com/);
  assert.match(html, /Verified Evidence Network/);
});
