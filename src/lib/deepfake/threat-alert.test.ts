import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildThreatAlertSummary,
  resolveThreatAlertAnnouncement,
  resolveThreatAwareRingTone,
  shouldAnimateThreatAwareScan,
  shouldShowThreatAwareScanBeam,
  threatAlertBannerMessage,
  threatAlertCountLines,
  threatAlertHeadline,
  threatDedupKey,
  type ThreatAlertSummary,
} from "./threat-alert";
import type { ClientFinding } from "./results-dashboard";
import { evidenceLinkProps } from "./results-dashboard";

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

test("0 findings → none/blue normal state", () => {
  const summary = buildThreatAlertSummary([]);
  assert.equal(summary.level, "none");
  assert.equal(summary.total, 0);
  assert.equal(resolveThreatAwareRingTone({ mode: "running", threatLevel: "none" }), "cyan");
  assert.equal(threatAlertHeadline("none"), null);
});

test("1 qualifying finding → amber single threat", () => {
  const summary = buildThreatAlertSummary([
    finding({ id: "1", finding_classification: "PROBABLE_DEEPFAKE" }),
  ]);
  assert.equal(summary.level, "single");
  assert.equal(summary.total, 1);
  assert.equal(summary.probable, 1);
  assert.equal(resolveThreatAwareRingTone({ mode: "running", threatLevel: "single" }), "amber");
  assert.equal(threatAlertHeadline("single"), "Threat detected");
});

test("2 qualifying findings → red multiple alert", () => {
  const summary = buildThreatAlertSummary([
    finding({ id: "1", final_url: "https://a.example/1" }),
    finding({
      id: "2",
      finding_classification: "VERIFIED_DEEPFAKE",
      final_url: "https://b.example/2",
      source_host: "b.example",
    }),
  ]);
  assert.equal(summary.level, "multiple");
  assert.equal(summary.total, 2);
  assert.equal(summary.verified, 1);
  assert.equal(summary.probable, 1);
  assert.equal(summary.domains, 2);
  assert.equal(
    resolveThreatAwareRingTone({ mode: "running", threatLevel: "multiple" }),
    "red",
  );
  assert.equal(
    threatAlertHeadline("multiple"),
    "MULTIPLE DEEPFAKE THREATS DETECTED",
  );
  assert.match(threatAlertBannerMessage(summary), /Eterna detected 2 distinct/);
  assert.deepEqual(threatAlertCountLines(summary), [
    "2 verified/probable threats",
    "1 verified",
    "1 probable",
    "2 affected domains",
  ]);
});

test("second live-polled finding triggers alert without scan completion", () => {
  const first = buildThreatAlertSummary([finding({ id: "1" })]);
  assert.equal(first.level, "single");

  const second = buildThreatAlertSummary([
    finding({ id: "1" }),
    finding({ id: "2", final_url: "https://cdn.example.com/2" }),
  ]);
  assert.equal(second.level, "multiple");

  const announcement = resolveThreatAlertAnnouncement({
    scanId: "scan-1",
    distinctTotal: second.total,
    previous: {
      scanId: "scan-1",
      distinctTotal: first.total,
      hasAnnouncedMultiple: false,
    },
  });
  assert.equal(announcement.role, "alert");
  assert.equal(announcement.announceMultiple, true);
});

test("same two findings on later polls do not re-announce", () => {
  const firstCross = resolveThreatAlertAnnouncement({
    scanId: "scan-1",
    distinctTotal: 2,
    previous: {
      scanId: "scan-1",
      distinctTotal: 1,
      hasAnnouncedMultiple: false,
    },
  });
  assert.equal(firstCross.role, "alert");

  const laterPoll = resolveThreatAlertAnnouncement({
    scanId: "scan-1",
    distinctTotal: 2,
    previous: firstCross.next,
  });
  assert.equal(laterPoll.role, "status");
  assert.equal(laterPoll.announceMultiple, false);
});

test("duplicate URLs count once", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "1",
      final_url: "https://cdn.example.com/clip/",
      finding_classification: "VERIFIED_DEEPFAKE",
    }),
    finding({
      id: "2",
      final_url: "https://CDN.example.com/clip",
      finding_classification: "PROBABLE_DEEPFAKE",
    }),
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.level, "single");
  assert.equal(
    threatDedupKey(
      finding({ id: "x", final_url: "https://cdn.example.com/clip/" }),
    ),
    threatDedupKey(
      finding({ id: "y", final_url: "https://CDN.example.com/clip" }),
    ),
  );
});

test("rejected / unrelated / unverified results do not count", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "ok",
      finding_classification: "PROBABLE_DEEPFAKE",
      final_url: "https://ok.example/a",
    }),
    finding({
      id: "rejected",
      finding_classification: "PROBABLE_DEEPFAKE",
      url_verification_status: "URL_REJECTED",
      final_url: "https://bad.example/a",
    }),
    finding({
      id: "name",
      finding_classification: "NAME_ONLY",
      final_url: "https://adult.example/a",
    }),
    finding({
      id: "lead",
      finding_classification: "UNVERIFIED_LEAD",
      final_url: "https://lead.example/a",
    }),
  ]);
  assert.equal(summary.total, 1);
  assert.equal(summary.level, "single");
});

test("alert level survives PARTIAL, COMPLETED and FAILED states", () => {
  const summary: ThreatAlertSummary = {
    level: "multiple",
    total: 2,
    verified: 1,
    probable: 1,
    domains: 2,
  };
  for (const mode of ["partial", "completed", "failed"] as const) {
    assert.equal(
      resolveThreatAwareRingTone({ mode, threatLevel: summary.level }),
      "red",
    );
  }
  assert.equal(
    shouldAnimateThreatAwareScan({
      mode: "partial",
      threatLevel: "multiple",
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
    shouldAnimateThreatAwareScan({
      mode: "completed",
      threatLevel: "multiple",
      prefersReducedMotion: false,
    }),
    false,
  );
  assert.equal(
    shouldAnimateThreatAwareScan({
      mode: "failed",
      threatLevel: "multiple",
      prefersReducedMotion: false,
    }),
    false,
  );
});

test("page reload / history selection uses status role", () => {
  const reload = resolveThreatAlertAnnouncement({
    scanId: "scan-history",
    distinctTotal: 2,
    previous: null,
  });
  assert.equal(reload.role, "status");
  assert.equal(reload.announceMultiple, false);
  assert.equal(reload.next.hasAnnouncedMultiple, true);
});

test("changing selected scans recalculates and does not reuse prior alert announcement", () => {
  const scanA = resolveThreatAlertAnnouncement({
    scanId: "a",
    distinctTotal: 2,
    previous: {
      scanId: "a",
      distinctTotal: 1,
      hasAnnouncedMultiple: false,
    },
  });
  assert.equal(scanA.role, "alert");

  const scanB = resolveThreatAlertAnnouncement({
    scanId: "b",
    distinctTotal: 0,
    previous: scanA.next,
  });
  assert.equal(scanB.role, "status");
  assert.equal(scanB.next.distinctTotal, 0);
  assert.equal(scanB.next.hasAnnouncedMultiple, false);

  const scanBLater = resolveThreatAlertAnnouncement({
    scanId: "b",
    distinctTotal: 2,
    previous: scanB.next,
  });
  assert.equal(scanBLater.role, "alert");
});

test("filtered/paginated rows must not be used — full findings array drives total", () => {
  const all = [
    finding({ id: "1", final_url: "https://a.example/1" }),
    finding({ id: "2", final_url: "https://b.example/2" }),
    finding({ id: "3", final_url: "https://c.example/3" }),
  ];
  const filteredPage = all.slice(0, 1);
  assert.equal(buildThreatAlertSummary(all).total, 3);
  assert.equal(buildThreatAlertSummary(filteredPage).total, 1);
  // Route must pass the complete findings array (asserted via source below).
});

test("reduced-motion disables threat animation", () => {
  assert.equal(
    shouldAnimateThreatAwareScan({
      mode: "running",
      threatLevel: "multiple",
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
    canonical_url: "https://safe.example/canonical",
  });
  const evidence = evidenceLinkProps(row);
  assert.equal(evidence.kind, "link");
  if (evidence.kind === "link") {
    assert.equal(evidence.href, "https://safe.example/threat");
    assert.equal(evidence.target, "_blank");
    assert.equal(evidence.rel, "noopener noreferrer");
  }
});

test("route wires threat alert from complete findings and keeps Continue", () => {
  const ui = readFileSync(
    resolve(process.cwd(), "src/routes/_app.deepfake-intel.tsx"),
    "utf8",
  );
  assert.match(ui, /buildThreatAlertSummary\(\s*findings\s*\)/);
  assert.match(ui, /ThreatAlertBanner/);
  assert.match(ui, /threatSummary/);
  assert.match(ui, /vizThreatSummary/);
  assert.match(ui, /useLayoutEffect/);
  assert.match(ui, /finding-cards-heading/);
  assert.match(ui, /results-intelligence-console/);
  assert.match(ui, /Continue scan/);
  assert.match(ui, /continueScan\.mutate/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*paged/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*filtered/);
  assert.doesNotMatch(ui, /buildThreatAlertSummary\(\s*scoped/);
});

test("canonical_url used when final_url missing for dedupe", () => {
  const summary = buildThreatAlertSummary([
    finding({
      id: "1",
      final_url: null,
      canonical_url: "https://same.example/page",
    }),
    finding({
      id: "2",
      final_url: null,
      canonical_url: "https://same.example/page",
    }),
  ]);
  assert.equal(summary.total, 1);
});
