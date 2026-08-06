import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export const SARAYU_SUPPLIED_EVIDENCE_URLS = [
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3#sv=CAMSZBoyKhBlcENMdFhZcFU5S2tNMg5iVnBDRU1HWHBVOUtrTToOelVPbEY2WGo1QlVvb00gBCokCg5zZ0swX1pkR1dKWElMTRIQZS1iVnBDRU1HWHBVOUtrTRgAMAFKBAgBEAIYByCOycHdCUoIEAIYASACKAE",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3#sv=CAMSZBoyKhBlLUY2YUh0djdKMWptNTRNMg5GNmFIdHY3SjFqbTU0TToOelVPbEY2WGo1QlVvb00gBCokCg5iVnBDRU1HWHBVOUtrTRIQZS1GNmFIdHY3SjFqbTU0TRgAMAFKBAgBEAIYByCSiuy9DUoIEAIYASACKAE",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3#sv=CAMSZBoyKhBlLXkwUXlqclRMd0F5TURNMg55MFF5anJUTHdBeU1ETToOQ3BJZk9CZzJTQWxFbE0gBCokCg5EY2ZFeWpacHI5bFJ2TRIQZS15MFF5anJUTHdBeU1ETRgAMAFKBAgBEAIYByDT7-H1DUoIEAIYASACKAE",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3#sv=CAMSZBoyKhBlLXhUdmZaLWVDTFh2UnBNMg54VHZmWi1lQ0xYdlJwTToOMUFNVmFhc0VDeDVnY00gBCokCg55MFF5anJUTHdBeU1ETRIQZS14VHZmWi1lQ0xYdlJwTRgAMAFKBAgBEAIYByDQo8WGB0oIEAIYASACKAE",
  "https://www.google.com/search?tbnid=_frhBoSjm04CEM&tbnh=0&tbnw=0&cs=0&hl=en-US&rlz=1CDGOYI_enAE1214AE1215&sca_esv=7a01ff41d4f21274&sxsrf=APpeQnsdxs78vW3ijsG8vX-OknOKLX-4JA:1785843431052&udm=2&tbs=rimg:Cf364QaEo5tOYVjJbGx18uyx4AIA&q=sarayu+mohan+nude&sa=X&ved=2ahUKEwiM7tKa8YaWAxXMv4kEHcOuGVUQuIIBegQIFBAA&biw=440&bih=874&dpr=3#sv=CAMSZBoyKhBlLTIzNEVGMXZ1ME5kVlVNMg4yMzRFRjF2dTBOZFZVTToOaHBtN3lWNVNIUkJfRU0gBCokCg5WcXFyRWhrOVJ1NmphTRIQZS0yMzRFRjF2dTBOZFZVTRgAMAFKBAgBEAIYByCAtoCwC0oIEAIYASACKAE",
] as const;

export const SARAYU_SUPPLIED_REPORT_SCOPE = "sarayu_supplied_links_only" as const;
export const SARAYU_SUPPLIED_REPORT_DISCLAIMER =
  "These links were supplied by the investigator for review. Their presence in a Google Images result does not by itself confirm manipulation, identity match, or deepfake status. Each item requires independent verification.";

export type SarayuSuppliedEvidenceReportData = {
  report_scope: typeof SARAYU_SUPPLIED_REPORT_SCOPE;
  identity: "Sarayu Mohan";
  source: "Google Images";
  status: "Pending Verification";
  capture_date: string;
  links: Array<{
    evidence_lead: `Evidence Lead ${1 | 2 | 3 | 4 | 5 | 6}`;
    submitted_url: string;
    protected_identity: "Sarayu Mohan";
    source: "Google Images";
    status: "Pending Verification";
    submitted_by: "Investigator";
    verification_result: "Not yet independently verified";
    capture_date: string;
  }>;
  summary: {
    total_investigator_supplied_links: 6;
    verified_deepfakes: 0;
    confirmed_identity_matches: 0;
    pending_verification: 6;
  };
};

export function getSarayuSuppliedEvidenceReportData(
  now = new Date(),
): SarayuSuppliedEvidenceReportData {
  const captureDate = now.toISOString();
  return {
    report_scope: SARAYU_SUPPLIED_REPORT_SCOPE,
    identity: "Sarayu Mohan",
    source: "Google Images",
    status: "Pending Verification",
    capture_date: captureDate,
    links: SARAYU_SUPPLIED_EVIDENCE_URLS.map((submitted_url, index) => ({
      evidence_lead: `Evidence Lead ${(index + 1) as 1 | 2 | 3 | 4 | 5 | 6}`,
      submitted_url,
      protected_identity: "Sarayu Mohan",
      source: "Google Images",
      status: "Pending Verification",
      submitted_by: "Investigator",
      verification_result: "Not yet independently verified",
      capture_date: captureDate,
    })),
    summary: {
      total_investigator_supplied_links: 6,
      verified_deepfakes: 0,
      confirmed_identity_matches: 0,
      pending_verification: 6,
    },
  };
}

const A4: [number, number] = [595.28, 841.89];
const margin = 48;
const contentWidth = A4[0] - margin * 2;
const ink = rgb(0.08, 0.1, 0.16);
const navy = rgb(0.035, 0.075, 0.15);
const blue = rgb(0.08, 0.36, 0.86);
const muted = rgb(0.4, 0.44, 0.52);
const line = rgb(0.84, 0.87, 0.92);

function safeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function measure(value: string, size: number, font: PDFFont): number {
  return font.widthOfTextAtSize(safeText(value), size);
}

export function wrapSarayuReportUrl(
  url: string,
  size: number,
  font: PDFFont,
  width: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const character of safeText(url)) {
    const candidate = current + character;
    if (current && measure(candidate, size, font) > width) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function addLink(
  pdf: PDFDocument,
  page: PDFPage,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Link"),
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      A: { Type: PDFName.of("Action"), S: PDFName.of("URI"), URI: PDFString.of(url) },
    }),
  );
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) existing.push(annotation);
  else page.node.set(PDFName.of("Annots"), pdf.context.obj([annotation]));
}

function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  font: PDFFont,
  color = ink,
  leading = 14,
) {
  const lines = wrapSarayuReportUrl(text, size, font, width);
  for (const lineText of lines) {
    page.drawText(lineText, { x, y, size, font, color });
    y -= leading;
  }
  return y;
}

export async function buildSarayuSuppliedEvidencePdf(
  data = getSarayuSuppliedEvidenceReportData(),
): Promise<{ bytes: Uint8Array; reportId: string; hash: string }> {
  if (data.report_scope !== SARAYU_SUPPLIED_REPORT_SCOPE || data.links.length !== 6) {
    throw new Error("Invalid Sarayu supplied-links-only report data.");
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reportId =
    "ETR-SARAYU-SUPPLIED-" +
    createHash("sha256")
      .update(JSON.stringify(data.links))
      .digest("hex")
      .slice(0, 12)
      .toUpperCase();
  pdf.setTitle("Sarayu Mohan Investigator-Supplied Google Images Evidence Links");
  pdf.setSubject(SARAYU_SUPPLIED_REPORT_SCOPE);

  let page = pdf.addPage(A4);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: navy });
  page.drawText("ETERNA AI", {
    x: margin,
    y: 770,
    size: 15,
    font: boldFont,
    color: rgb(0.52, 0.72, 1),
  });
  page.drawText("INVESTIGATOR-SUPPLIED GOOGLE IMAGES EVIDENCE LINKS", {
    x: margin,
    y: 690,
    size: 20,
    font: boldFont,
    color: rgb(1, 1, 1),
  });
  page.drawText("Sarayu Mohan - 6 Links - Pending Verification", {
    x: margin,
    y: 652,
    size: 12,
    font,
    color: rgb(0.84, 0.9, 1),
  });
  let y = 600;
  y =
    drawWrapped(
      page,
      SARAYU_SUPPLIED_REPORT_DISCLAIMER,
      margin,
      y,
      contentWidth,
      10,
      font,
      rgb(0.78, 0.84, 0.94),
      15,
    ) - 20;
  page.drawText("Report scope", { x: margin, y, size: 8, font, color: rgb(0.52, 0.65, 0.82) });
  page.drawText(SARAYU_SUPPLIED_REPORT_SCOPE, {
    x: margin,
    y: y - 16,
    size: 10,
    font,
    color: rgb(1, 1, 1),
  });
  page.drawText("Report ID", { x: margin, y: y - 52, size: 8, font, color: rgb(0.52, 0.65, 0.82) });
  page.drawText(reportId, { x: margin, y: y - 68, size: 10, font, color: rgb(1, 1, 1) });
  page.drawText("Capture date", {
    x: margin,
    y: y - 104,
    size: 8,
    font,
    color: rgb(0.52, 0.65, 0.82),
  });
  page.drawText(data.capture_date.slice(0, 10), {
    x: margin,
    y: y - 120,
    size: 10,
    font,
    color: rgb(1, 1, 1),
  });

  page = pdf.addPage(A4);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(0.98, 0.99, 1) });
  page.drawText("INVESTIGATOR-SUPPLIED GOOGLE IMAGES EVIDENCE LINKS", {
    x: margin,
    y: 780,
    size: 15,
    font: boldFont,
    color: navy,
  });
  y = 748;
  const summary = [
    "Total investigator-supplied links: 6",
    "Verified deepfakes: 0",
    "Confirmed identity matches: 0",
    "Pending verification: 6",
  ];
  for (const item of summary) {
    page.drawText(item, { x: margin, y, size: 11, font, color: ink });
    y -= 20;
  }
  y -= 12;
  for (const lead of data.links) {
    const urlLines = wrapSarayuReportUrl(lead.submitted_url, 7.2, font, contentWidth - 18);
    const blockHeight = 128 + urlLines.length * 11;
    if (y - blockHeight < 46) {
      page = pdf.addPage(A4);
      page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(0.98, 0.99, 1) });
      page.drawText("INVESTIGATOR-SUPPLIED GOOGLE IMAGES EVIDENCE LINKS", {
        x: margin,
        y: 780,
        size: 15,
        font: boldFont,
        color: navy,
      });
      y = 748;
    }
    page.drawRectangle({
      x: margin,
      y: y - blockHeight + 12,
      width: contentWidth,
      height: blockHeight,
      color: rgb(1, 1, 1),
      borderColor: line,
      borderWidth: 1,
    });
    page.drawText(lead.evidence_lead, { x: margin + 10, y, size: 11, font: boldFont, color: blue });
    y -= 18;
    const fields = [
      ["Protected identity", lead.protected_identity],
      ["Source", lead.source],
      ["Status", lead.status],
      ["Capture date", lead.capture_date.slice(0, 10)],
      ["Submitted by", lead.submitted_by],
      ["Verification result", lead.verification_result],
    ] as const;
    for (const [label, value] of fields) {
      page.drawText(`${label}: ${value}`, { x: margin + 10, y, size: 8.5, font, color: ink });
      y -= 12;
    }
    page.drawText("Exact submitted URL:", { x: margin + 10, y, size: 8.5, font, color: muted });
    y -= 12;
    const urlStart = y;
    for (const lineText of urlLines) {
      page.drawText(lineText, { x: margin + 10, y, size: 7.2, font, color: blue });
      y -= 11;
    }
    addLink(pdf, page, lead.submitted_url, margin + 10, y, contentWidth - 20, urlStart - y + 4);
    y -= 18;
  }

  const bytes = await pdf.save();
  return { bytes, reportId, hash: createHash("sha256").update(bytes).digest("hex") };
}
