import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import {
  SARAYU_SUPPLIED_EVIDENCE_URLS,
  SARAYU_SUPPLIED_REPORT_SCOPE,
  buildSarayuSuppliedEvidencePdf,
  getSarayuSuppliedEvidenceReportData,
} from "./sarayu-supplied-report.server";

test("Sarayu supplied report data is exactly six immutable links", () => {
  const data = getSarayuSuppliedEvidenceReportData(new Date("2026-08-04T15:00:00.000Z"));
  assert.equal(data.report_scope, SARAYU_SUPPLIED_REPORT_SCOPE);
  assert.equal(data.links.length, 6);
  assert.equal(new Set(data.links.map((link) => link.submitted_url)).size, 6);
  assert.deepEqual(
    data.links.map((link) => link.submitted_url),
    [...SARAYU_SUPPLIED_EVIDENCE_URLS],
  );
  assert.equal(data.links.filter((link) => link.submitted_url.includes("#sv=")).length, 5);
  assert.equal(
    data.links.some((link) => link.submitted_url.endsWith("#sv=")),
    false,
  );
  assert.equal(data.summary.verified_deepfakes, 0);
  assert.equal(data.summary.confirmed_identity_matches, 0);
  assert.equal(data.summary.pending_verification, 6);
});

test("Sarayu supplied PDF contains one clickable annotation per supplied URL", async () => {
  const output = await buildSarayuSuppliedEvidencePdf(
    getSarayuSuppliedEvidenceReportData(new Date("2026-08-04T15:00:00.000Z")),
  );
  assert.ok(output.bytes.length > 1000);
  const pdf = await PDFDocument.load(output.bytes);
  let annotationCount = 0;
  for (const page of pdf.getPages()) {
    const annotations = page.node.lookup(PDFName.of("Annots"));
    if (annotations instanceof PDFArray) annotationCount += annotations.size();
  }
  assert.equal(annotationCount, 6);
});
