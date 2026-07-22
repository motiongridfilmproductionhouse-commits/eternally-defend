import assert from "node:assert/strict";
import test from "node:test";
import {
  inferAutomatedContentPosition,
  validateReview,
  verifiedExportReadiness,
  type EvidenceReview,
} from "./evidence-review";
import { unzipSync } from "fflate";
import {
  buildDeterministicEvidenceZip,
  buildDeterministicManifest,
  sha256Bytes,
} from "./evidence-manifest.server";
import { decodeHtmlEntities, normalizePdfText } from "./scan-report-pdf.server";

const completeReview: EvidenceReview = {
  reviewStatus: "REVIEWED_POTENTIAL_VIOLATION",
  reviewerName: "Reviewer",
  reviewerRole: "Safety analyst",
  reviewedAt: "2026-07-22T00:00:00.000Z",
  exactOriginalStatement: "statement",
  statementLanguage: "ml",
  verifiedEnglishTranslation: "statement",
  videoStartTimestamp: 12,
  videoEndTimestamp: 20,
  speakerIdentity: "speaker",
  contentContext: "full context",
  contentPosition: "HOSTILE",
  statementType: "FACT",
  allegedViolationTypes: ["Targeted harassment"],
  violationReason: "documented reason",
  supportingFacts: "evidence",
  confidenceScore: 80,
  legalReviewRequired: true,
  recommendedAction: "Platform review",
  reviewerDeclarationSigned: true,
};

test("supportive and neutralising language is not automatically hostile", () => {
  assert.equal(
    inferAutomatedContentPosition("Daya speaks out against body shaming", "Stop bullying women"),
    "SUPPORTIVE",
  );
  assert.notEqual(
    inferAutomatedContentPosition("Controversy reaction", "News discussion"),
    "HOSTILE",
  );
});

test("actionable review requires statement, timestamp, context and reason", () => {
  assert.deepEqual(
    validateReview({ ...completeReview, exactOriginalStatement: null, videoStartTimestamp: null }),
    ["Exact original statement", "Exact timestamp"],
  );
});

test("missing transcript and timestamp block verified export", () => {
  const result = verifiedExportReadiness({ ...completeReview, videoStartTimestamp: null }, {});
  assert.equal(result.ready, false);
  assert(result.missing.includes("Exact timestamp"));
  assert(result.missing.includes("Transcript"));
});

test("copyright route requires ownership proof", () => {
  const result = verifiedExportReadiness(
    { ...completeReview, allegedViolationTypes: ["Copyright infringement"] },
    {
      transcriptPreserved: true,
      fullPageScreenshotPreserved: true,
      hashesGenerated: true,
      chainOfCustodyCreated: true,
      channelIdentifiersPreserved: true,
    },
  );
  assert(result.missing.includes("Copyright ownership/authorization proof"));
});

test("Malayalam and HTML entities are preserved correctly", () => {
  const value = "മലയാളം &amp; Women&#39;s Choices &quot;test&quot;";
  assert.equal(decodeHtmlEntities(value), 'മലയാളം & Women\'s Choices "test"');
  assert.equal(normalizePdfText(value).includes("????"), false);
  assert(normalizePdfText(value).includes("മലയാളം"));
});

test("manifest hashes are deterministic and independently recalculable", () => {
  const bytes = new TextEncoder().encode("evidence");
  const a = buildDeterministicManifest("ETR-1", [
    { path: "b.txt", bytes, mimeType: "text/plain", objectType: "transcript" },
  ]);
  const b = buildDeterministicManifest("ETR-1", [
    { path: "b.txt", bytes, mimeType: "text/plain", objectType: "transcript" },
  ]);
  assert.equal(a.canonical, b.canonical);
  assert.equal(a.entries[0].sha256, sha256Bytes(bytes));
  assert.equal(a.sha256, b.sha256);
});

test("verified ZIP contains every supplied artifact and manifest", () => {
  const files = [
    {
      path: "report.pdf",
      bytes: new TextEncoder().encode("pdf"),
      mimeType: "application/pdf",
      objectType: "final_pdf",
    },
    {
      path: "transcripts/item.txt",
      bytes: new TextEncoder().encode("text"),
      mimeType: "text/plain",
      objectType: "transcript",
    },
  ];
  const zip = buildDeterministicEvidenceZip("ETR-1", files);
  const entries = unzipSync(zip.bytes);
  assert.deepEqual(Object.keys(entries).sort(), [
    "manifest.json",
    "report.pdf",
    "transcripts/item.txt",
  ]);
});
