import { createServerFn } from "@tanstack/react-start";

export const getSarayuSuppliedEvidenceReportData = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getSarayuSuppliedEvidenceReportData: buildReportData } = await import("./sarayu-supplied-report.server");
    return buildReportData();
  });

export const downloadSarayuSuppliedEvidenceReport = createServerFn({ method: "GET" })
  .handler(async () => {
    const { buildSarayuSuppliedEvidencePdf, getSarayuSuppliedEvidenceReportData: buildReportData } = await import("./sarayu-supplied-report.server");
    const data = buildReportData();
    const output = await buildSarayuSuppliedEvidencePdf(data);
    return {
      report_scope: data.report_scope,
      fileName: "Sarayu-Mohan-Supplied-Evidence-Report.pdf",
      base64: Buffer.from(output.bytes).toString("base64"),
      reportId: output.reportId,
      sha256: output.hash,
      mimeType: "application/pdf",
      link_count: data.links.length,
    };
  });
