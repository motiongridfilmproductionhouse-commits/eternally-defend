import assert from "node:assert/strict";
import test from "node:test";
import {
  boundNetworkGraph,
  buildDomainRows,
  buildFunnelChartData,
  buildNetworkGraph,
  buildOverviewMetrics,
  displayableFindings,
  evidenceLinkProps,
  filterFindings,
  isSafeStoredThumbnail,
  resolveSafeFindingThumbnail,
  type ClientFinding,
} from "./results-dashboard";

function finding(partial: Partial<ClientFinding> & { id: string }): ClientFinding {
  return {
    url_verification_status: "URL_VERIFIED",
    finding_classification: "VERIFIED_DEEPFAKE",
    risk_level: "HIGH",
    page_title: "Evidence page",
    final_url: `https://cdn.example.com/${partial.id}`,
    source_host: "cdn.example.com",
    identity_confidence: 90,
    synthetic_media_confidence: 80,
    review_status: "new",
    ...partial,
  };
}

test("summary uses only real metrics and saved findings", () => {
  const findings = [
    finding({ id: "1", finding_classification: "VERIFIED_DEEPFAKE" }),
    finding({
      id: "2",
      finding_classification: "PROBABLE_DEEPFAKE",
      source_host: "clips.example.org",
      final_url: "https://clips.example.org/a",
    }),
  ];
  const metrics = buildOverviewMetrics({
    findings,
    diagnostics: {
      identity_rejected: 4,
      url_rejected: 7,
      crawl_failed: 2,
      client_visible: 2,
    },
  });
  assert.equal(metrics.verified_deepfakes, 1);
  assert.equal(metrics.probable_deepfakes, 1);
  assert.equal(metrics.url_verified_pages, 2);
  assert.equal(metrics.unique_domains, 2);
  assert.equal(metrics.identity_rejected, 4);
  assert.equal(metrics.url_rejected, 7);
  assert.equal(metrics.crawl_failed, 2);
  assert.equal(metrics.client_visible, 2);

  const funnel = buildFunnelChartData({
    findings,
    diagnostics: {
      unique_candidates: 12,
      crawl_succeeded: 8,
      verified: 1,
      probable: 1,
      client_visible: 2,
    },
  });
  assert.deepEqual(
    funnel.map((point) => point.value),
    [12, 8, 2, 2, 2],
  );
});

test("verified and probable findings appear; rejected/raw never appear", () => {
  const findings = [
    finding({ id: "v" }),
    finding({ id: "p", finding_classification: "PROBABLE_DEEPFAKE" }),
    finding({
      id: "rejected",
      finding_classification: "UNVERIFIED_LEAD",
      url_verification_status: "URL_REJECTED",
    }),
    finding({
      id: "raw",
      finding_classification: "NAME_ONLY",
    }),
  ];
  const visible = displayableFindings(findings);
  assert.equal(visible.length, 2);
  assert.ok(visible.every((item) =>
    item.finding_classification === "VERIFIED_DEEPFAKE" ||
    item.finding_classification === "PROBABLE_DEEPFAKE",
  ));
});

test("same-domain distinct verified URLs remain separate", () => {
  const findings = [
    finding({
      id: "a",
      final_url: "https://host.example/one",
      source_host: "host.example",
      page_title: "One",
    }),
    finding({
      id: "b",
      final_url: "https://host.example/two",
      source_host: "host.example",
      page_title: "Two",
    }),
  ];
  const graph = buildNetworkGraph({
    findings,
    centerLabel: "Ada Lovelace",
  });
  assert.equal(graph.domains.length, 1);
  assert.equal(graph.domains[0]?.findings.length, 2);
  assert.equal(graph.domains[0]?.findings[0]?.id, "a");
  assert.equal(graph.domains[0]?.findings[1]?.id, "b");

  const rows = buildDomainRows(findings);
  assert.equal(rows[0]?.verified_pages, 2);
});

test("domain filter works on already-saved findings only", () => {
  const findings = [
    finding({
      id: "a",
      source_host: "alpha.example",
      final_url: "https://alpha.example/1",
    }),
    finding({
      id: "b",
      source_host: "beta.example",
      final_url: "https://beta.example/1",
    }),
  ];
  const filtered = filterFindings({
    findings,
    domainFilter: "beta.example",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "b");
});

test("verified evidence link remains clickable; unsafe/missing is not", () => {
  const ok = evidenceLinkProps(
    finding({
      id: "ok",
      final_url: "https://safe.example/page",
      url_verification_status: "URL_VERIFIED",
    }),
  );
  assert.equal(ok.kind, "link");
  if (ok.kind === "link") {
    assert.equal(ok.href, "https://safe.example/page");
    assert.equal(ok.target, "_blank");
    assert.equal(ok.rel, "noopener noreferrer");
    assert.equal(ok.clickable, true);
  }

  const missing = evidenceLinkProps(
    finding({
      id: "missing",
      final_url: null,
      canonical_url: null,
      url: "javascript:alert(1)",
    }),
  );
  assert.equal(missing.kind, "unavailable");
  assert.equal(missing.clickable, false);
});

test("sensitive preview stays blocked for third-party thumbnails", () => {
  assert.equal(
    isSafeStoredThumbnail("https://cdn.evil.example/thumb.jpg"),
    false,
  );
  assert.equal(
    isSafeStoredThumbnail(
      "https://xyz.supabase.co/storage/v1/object/public/thumbs/a.jpg",
    ),
    true,
  );

  const findingRow = finding({
    id: "t",
    final_url: "https://host.example/page",
  });
  assert.equal(
    resolveSafeFindingThumbnail({
      finding: findingRow,
      discoveries: [
        {
          page_url: "https://host.example/page",
          thumbnail_url: "https://third-party.example/x.jpg",
        },
      ],
    }),
    null,
  );
  assert.equal(
    resolveSafeFindingThumbnail({
      finding: findingRow,
      discoveries: [
        {
          page_url: "https://host.example/page",
          thumbnail_url:
            "https://proj.supabase.co/storage/v1/object/sign/evidence/a.jpg",
        },
      ],
    }),
    "https://proj.supabase.co/storage/v1/object/sign/evidence/a.jpg",
  );
});

test("bounded network keeps remaining findings available in counts", () => {
  const findings = Array.from({ length: 20 }, (_, index) =>
    finding({
      id: `f${index}`,
      source_host: `d${index % 10}.example`,
      final_url: `https://d${index % 10}.example/p${index}`,
    }),
  );
  const graph = buildNetworkGraph({
    findings,
    centerLabel: "Target",
  });
  const bounded = boundNetworkGraph(graph, {
    maxDomains: 3,
    maxFindingsPerDomain: 2,
  });
  assert.ok(bounded.visible.domains.length <= 3);
  assert.ok(bounded.hiddenFindingCount > 0);
  assert.equal(graph.totalFindings, 20);
});

test("empty and missing-field states stay dash-safe", () => {
  const metrics = buildOverviewMetrics({ findings: [], diagnostics: null });
  assert.equal(metrics.verified_deepfakes, 0);
  assert.equal(metrics.client_visible, 0);

  const row = buildDomainRows([
    finding({
      id: "sparse",
      crawled_at: null,
      created_at: null,
      risk_level: null,
    }),
  ])[0];
  assert.equal(row?.last_verified, null);
});

test("classification and search filters compose", () => {
  const findings = [
    finding({
      id: "1",
      page_title: "Alpha clip",
      finding_classification: "VERIFIED_DEEPFAKE",
    }),
    finding({
      id: "2",
      page_title: "Beta clip",
      finding_classification: "PROBABLE_DEEPFAKE",
    }),
  ];
  const filtered = filterFindings({
    findings,
    classificationFilter: "PROBABLE_DEEPFAKE",
    search: "beta",
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "2");
});
