import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSuspiciousSourcesFromMatches,
  countSuspiciousSourceStates,
  isSuspiciousSourceForTab,
  mapMatchToSuspiciousSource,
  resolveHistoricalRecheckStatus,
  suspiciousSourcesDiagnosticLine,
} from "./suspicious-sources";

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "match-1",
    source_url: "https://movies.example/watch/title",
    page_title: "Watch Title Online",
    confidence: 82,
    confidence_band: "probable",
    detection_type: "VERIFIED_UNAUTHORIZED_STREAM",
    reason: "Exact title with stream access",
    review_status: "pending",
    contact: {},
    evidence: {},
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("resolveHistoricalRecheckStatus assigns terminal states", () => {
  assert.equal(
    resolveHistoricalRecheckStatus({
      crawlFailed: true,
      clientVisible: false,
      strongEvidence: false,
      suspectedReview: false,
      identityMatched: true,
      accessStrength: "none",
    }),
    "temporarily_unreachable",
  );
  assert.equal(
    resolveHistoricalRecheckStatus({
      crawlFailed: false,
      clientVisible: true,
      strongEvidence: true,
      suspectedReview: false,
      identityMatched: true,
      accessStrength: "strong",
    }),
    "reconfirmed_active",
  );
  assert.equal(
    resolveHistoricalRecheckStatus({
      crawlFailed: false,
      clientVisible: false,
      strongEvidence: false,
      suspectedReview: true,
      identityMatched: true,
      accessStrength: "weak",
    }),
    "requires_review",
  );
});

test("previously confirmed suspicious source appears after successful recheck", () => {
  const row = matchRow({
    evidence: {
      historical_preservation: true,
      prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
      recheck_status: "reconfirmed_active",
      client_visible: true,
      distribution: {
        classification: "VERIFIED_UNAUTHORIZED_STREAM",
        strong_evidence: true,
        client_visible: true,
      },
    },
  });
  const mapped = mapMatchToSuspiciousSource(row);
  assert.ok(mapped);
  assert.equal(mapped?.source_state, "historical_reconfirmed");
  assert.ok(isSuspiciousSourceForTab(row));
});

test("previously confirmed source remains visible when temporarily unreachable", () => {
  const row = matchRow({
    evidence: {
      historical_preservation: true,
      prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
      recheck_status: "temporarily_unreachable",
      client_visible: false,
      crawl_failed: true,
    },
  });
  const mapped = mapMatchToSuspiciousSource(row);
  assert.ok(mapped);
  assert.equal(mapped?.source_state, "historical_unreachable");
  assert.equal(mapped?.current_reachability, "unreachable");
});

test("restored historical source cannot disappear without a terminal recheck state", () => {
  const terminalStates = [
    "reconfirmed_active",
    "temporarily_unreachable",
    "redirected",
    "domain_changed",
    "removed",
    "insufficient_current_evidence",
    "requires_review",
    "pending",
    "active",
  ] as const;
  for (const recheck_status of terminalStates) {
    const row = matchRow({
      source_url: `https://movies.example/${recheck_status}`,
      evidence: {
        historical_preservation: true,
        prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
        recheck_status,
        client_visible: false,
      },
    });
    const mapped = mapMatchToSuspiciousSource(row);
    assert.ok(mapped, `expected visible mapping for ${recheck_status}`);
  }
});

test("Suspicious Sources tab includes preserved historical records without new finding row", () => {
  const rows = [
    matchRow({
      id: "new-1",
      evidence: {
        client_visible: true,
        distribution: {
          classification: "VERIFIED_UNAUTHORIZED_STREAM",
          strong_evidence: true,
          client_visible: true,
        },
      },
    }),
    matchRow({
      id: "hist-1",
      source_url: "https://movies.example/old",
      evidence: {
        historical_preservation: true,
        prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
        recheck_status: "pending",
        client_visible: false,
      },
    }),
  ];
  const sources = buildSuspiciousSourcesFromMatches(rows);
  assert.equal(sources.length, 2);
  assert.ok(sources.some((s) => s.source_state === "new_confirmed"));
  assert.ok(sources.some((s) => s.source_state === "historical_preserved"));
});

test("official trailer and review historical pages are excluded from suspicious tab", () => {
  for (const classification of [
    "TRAILER_OR_PROMO",
    "REVIEW_OR_NEWS",
    "OFFICIAL_OR_AUTHORIZED_PAGE",
    "CINEMA_OR_SHOWTIME",
  ]) {
    const row = matchRow({
      evidence: {
        historical_preservation: true,
        prior_classification: classification,
        recheck_status: "pending",
      },
    });
    assert.equal(isSuspiciousSourceForTab(row), false);
  }
});

test("historical source linked by prior confirmed classification stays relevant without tracked titles", () => {
  const row = matchRow({
    evidence: {
      historical_preservation: true,
      prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
      recheck_status: "insufficient_current_evidence",
      client_visible: false,
    },
  });
  assert.ok(isSuspiciousSourceForTab(row));
  const mapped = mapMatchToSuspiciousSource(row);
  assert.equal(mapped?.source_state, "historical_requires_review");
});

test("exact-title plus strong access evidence creates new confirmed suspicious source", () => {
  const row = matchRow({
    evidence: {
      client_visible: true,
      distribution: {
        classification: "VERIFIED_UNAUTHORIZED_STREAM",
        strong_evidence: true,
        client_visible: true,
        identity_evidence: ["exact_title"],
        access_evidence: ["embedded_player"],
      },
      page_evidence: {
        titleIdentity: { matched: true, signals: ["exact_title"] },
        accessEvidence: { strength: "strong", confirmed: true, signals: ["embedded_player"] },
      },
    },
  });
  const mapped = mapMatchToSuspiciousSource(row);
  assert.ok(mapped);
  assert.equal(mapped?.source_state, "new_confirmed");
});

test("exact-title with inconclusive player becomes requires_review when preserved", () => {
  const row = matchRow({
    evidence: {
      historical_preservation: true,
      prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
      recheck_status: "requires_review",
      client_visible: false,
      page_evidence: {
        titleIdentity: { matched: true, signals: ["exact_title"] },
        accessEvidence: { strength: "weak", confirmed: false, signals: ["embedded_player"] },
        suspectedReview: true,
      },
    },
  });
  const mapped = mapMatchToSuspiciousSource(row);
  assert.ok(mapped);
  assert.equal(mapped?.source_state, "historical_requires_review");
});

test("counters match rendered suspicious-source records", () => {
  const rows = [
    matchRow({
      id: "a",
      source_url: "https://a.example",
      evidence: {
        client_visible: true,
        distribution: {
          classification: "VERIFIED_UNAUTHORIZED_STREAM",
          strong_evidence: true,
          client_visible: true,
        },
      },
    }),
    matchRow({
      id: "b",
      source_url: "https://b.example",
      evidence: {
        historical_preservation: true,
        prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
        recheck_status: "reconfirmed_active",
        client_visible: false,
      },
    }),
    matchRow({
      id: "c",
      source_url: "https://c.example",
      evidence: {
        historical_preservation: true,
        prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
        recheck_status: "temporarily_unreachable",
        client_visible: false,
      },
    }),
    matchRow({
      id: "d",
      source_url: "https://d.example",
      evidence: {
        historical_preservation: true,
        prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
        recheck_status: "requires_review",
        client_visible: false,
      },
    }),
  ];
  const sources = buildSuspiciousSourcesFromMatches(rows);
  const counts = countSuspiciousSourceStates(sources);
  assert.equal(counts.suspicious_sources_displayed, sources.length);
  assert.equal(counts.new_confirmed, 1);
  assert.equal(counts.historical_reconfirmed, 1);
  assert.equal(counts.historical_unreachable, 1);
  assert.equal(counts.historical_requires_review, 1);
  const line = suspiciousSourcesDiagnosticLine(counts);
  assert.match(line, /1 new confirmed/);
  assert.match(line, /1 historical reconfirmed/);
  assert.match(line, /1 historical unreachable/);
  assert.match(line, /1 requiring review/);
});

test("client-visible-only filter excludes preserved historical rows", () => {
  const preserved = matchRow({
    evidence: {
      historical_preservation: true,
      prior_classification: "VERIFIED_UNAUTHORIZED_STREAM",
      recheck_status: "temporarily_unreachable",
      client_visible: false,
    },
  });
  const sources = buildSuspiciousSourcesFromMatches([preserved]);
  assert.equal(sources.length, 1);
  assert.notEqual(sources[0]?.source_state, "new_confirmed");
});
