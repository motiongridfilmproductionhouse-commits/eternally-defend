import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildDeepfakeReportModel,
  priorityForRisk,
  recommendedNextStepFor,
  selectReportFindings,
  type ReportFindingInput,
} from "./report-model";

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function finding(overrides: Partial<ReportFindingInput> & { id: string }): ReportFindingInput {
  return {
    url: "https://example.com/post/1",
    final_url: "https://example.com/post/1",
    canonical_url: "https://example.com/post/1",
    source_host: "example.com",
    page_title: "Sample deepfake page",
    snippet: "Alleged AI-generated intimate imagery",
    finding_classification: "VERIFIED_DEEPFAKE",
    url_verification_status: "URL_VERIFIED",
    risk_level: "CRITICAL",
    confidence: 91,
    identity_confidence: 88,
    synthetic_media_confidence: 84,
    face_referenced: true,
    target_face_match: true,
    is_synthetic: true,
    matched_evidence: ["face_match", "synthetic_media"],
    classification_explanation: "Face-matched synthetic intimate media indicators.",
    created_at: "2026-08-01T12:00:00.000Z",
    review_status: "open",
    ...overrides,
  };
}

describe("selectReportFindings", () => {
  it("keeps only client-visible classifications and dedupes by evidence URL", () => {
    const selected = selectReportFindings([
      finding({
        id: "a",
        confidence: 70,
        finding_classification: "VERIFIED_DEEPFAKE",
      }),
      finding({
        id: "b",
        confidence: 95,
        finding_classification: "VERIFIED_DEEPFAKE",
      }),
      finding({
        id: "c",
        finding_classification: "UNVERIFIED_LEAD",
        final_url: "https://example.com/other",
        url: "https://example.com/other",
      }),
      finding({
        id: "d",
        finding_classification: "PROBABLE_DEEPFAKE",
        risk_level: "HIGH",
        confidence: 60,
        final_url: "https://other.test/x",
        url: "https://other.test/x",
        source_host: "other.test",
      }),
      finding({
        id: "e",
        review_status: "dismissed",
        final_url: "https://dismissed.test/x",
        url: "https://dismissed.test/x",
      }),
    ]);

    assert.equal(selected.length, 2);
    assert.equal(selected[0]?.id, "b");
    assert.equal(selected[1]?.id, "d");
  });
});

describe("buildDeepfakeReportModel", () => {
  it("projects persisted fields without inventing findings or legal conclusions", () => {
    const model = buildDeepfakeReportModel({
      scan: {
        id: "11111111-1111-1111-1111-111111111111",
        target_name: "Ada Example",
        status: "completed",
        aliases: ["A. Example"],
        handles: ["@ada"],
        profile_id: "22222222-2222-2222-2222-222222222222",
        started_at: "2026-08-01T11:00:00.000Z",
        finished_at: "2026-08-01T11:05:00.000Z",
        total_queries: 12,
        discovery_metrics: {
          queries_generated: 20,
          queries_executed: 12,
          verified: 1,
          client_visible: 1,
          identity_rejected: 4,
          url_rejected: 2,
        },
      },
      findings: [
        finding({ id: "f1" }),
        finding({
          id: "noise",
          finding_classification: "DISCUSSION",
          final_url: "https://noise.test/x",
          url: "https://noise.test/x",
        }),
      ],
      profile: {
        id: "22222222-2222-2222-2222-222222222222",
        target_name: "Ada Example",
        authorization_status: "authorized",
        rekognition_collection_id: "col-1",
        reference_face_count: 4,
      },
      clientName: "Studio Client",
      generatedAt: "2026-08-04T07:00:00.000Z",
      hash,
    });

    assert.equal(model.protectedIdentity, "Ada Example");
    assert.equal(model.findings.length, 1);
    assert.equal(model.findings[0]?.url, "https://example.com/post/1");
    assert.equal(model.findings[0]?.confidence, 91);
    assert.equal(model.summary.verifiedDeepfakes, 1);
    assert.equal(model.summary.queriesExecuted, 12);
    assert.equal(model.summary.identityRejected, 4);
    assert.equal(model.identity.referenceFaceCount, 4);
    assert.equal(model.identity.authorizationStatus, "authorized");
    assert.equal(model.domains[0]?.domain, "example.com");
    assert.match(model.findings[0]?.recommendedNextStep ?? "", /human review/i);
    assert.doesNotMatch(
      model.findings[0]?.recommendedNextStep ?? "",
      /guilty|liable|illegal|criminal/i,
    );
    assert.ok(model.disclaimer.some((line) => /not legal determinations/i.test(line)));
    assert.ok(model.diagnostics.some((d) => d.key === "queries_executed"));
  });

  it("handles zero findings without inventing threats", () => {
    const model = buildDeepfakeReportModel({
      scan: {
        id: "33333333-3333-3333-3333-333333333333",
        target_name: "Bea Example",
        status: "completed",
        discovery_metrics: { queries_executed: 3, client_visible: 0 },
      },
      findings: [],
      profile: null,
      clientName: "Client",
      generatedAt: "2026-08-04T07:00:00.000Z",
      hash,
    });

    assert.equal(model.findings.length, 0);
    assert.equal(model.riskScore, 0);
    assert.equal(model.threatLevel, "LOW");
    assert.match(model.summary.immediateReviewItems[0] ?? "", /No client-visible/i);
  });
  it("marks interim reports distinctly without inventing findings", () => {
    const model = buildDeepfakeReportModel({
      scan: {
        id: "44444444-4444-4444-4444-444444444444",
        target_name: "Ada Example",
        status: "partial",
        discovery_metrics: { queries_executed: 4, client_visible: 0 },
      },
      findings: [],
      profile: null,
      clientName: "Client",
      generatedAt: "2026-08-04T07:00:00.000Z",
      reportMode: "interim",
      hash,
    });

    assert.equal(model.reportMode, "interim");
    assert.match(model.disclaimer[0] ?? "", /INTERIM REPORT/i);
    assert.equal(model.findings.length, 0);
  });
});

describe("priority helpers", () => {
  it("maps risk to operational priorities only", () => {
    assert.equal(priorityForRisk("CRITICAL"), "immediate_review");
    assert.equal(priorityForRisk("LOW"), "no_action");
    assert.match(recommendedNextStepFor("MEDIUM", "PROBABLE_DEEPFAKE"), /monitoring/i);
  });
});
