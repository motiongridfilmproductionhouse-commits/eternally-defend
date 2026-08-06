/**
 * Copyright Threat Intelligence dossier renderer.
 *
 * Dark cyber-intelligence styling, A4 portrait, pdf-lib. Consumes the pure
 * `CopyrightReportModel` and optional embedded screenshot bytes.
 */

import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import {
  embedUnicodeFontStack,
  drawUnicodeText,
  measureUnicodeText,
  type UnicodeFontStack,
} from "@/lib/pdf/unicode-fonts.server";
import { PRIORITY_LABEL, type CopyrightReportModel, type ReportThreat } from "./report-model";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 44;
const CONTENT_W = A4[0] - MARGIN * 2;

const BG = rgb(0.027, 0.043, 0.086);
const PANEL = rgb(0.055, 0.082, 0.145);
const PANEL_ALT = rgb(0.071, 0.106, 0.184);
const BORDER = rgb(0.13, 0.19, 0.31);
const TEXT = rgb(0.9, 0.94, 1);
const MUTED = rgb(0.56, 0.63, 0.75);
const ACCENT = rgb(0.16, 0.6, 1);
const CRITICAL = rgb(0.94, 0.27, 0.27);
const HIGH = rgb(0.98, 0.55, 0.16);
const MEDIUM = rgb(0.98, 0.8, 0.18);
const LOW = rgb(0.34, 0.76, 0.55);

function severityColor(severity: string): RGB {
  if (severity === "critical") return CRITICAL;
  if (severity === "high") return HIGH;
  if (severity === "medium") return MEDIUM;
  return LOW;
}

/** Strip glyphs the embedded fonts cannot render. */
export function sanitize(value: unknown): string {
  return Array.from(
    String(value ?? "")
      .normalize("NFC")
      .replace(/\p{Extended_Pictographic}/gu, ""),
  )
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp >= 32 && cp !== 127;
    })
    .join("")
    .trim();
}

function measure(text: string, size: number, fonts: PDFFont[]): number {
  try {
    const width = measureUnicodeText(sanitize(text), size, fonts);
    return Number.isFinite(width) ? width : sanitize(text).length * size * 0.55;
  } catch {
    return sanitize(text).length * size * 0.55;
  }
}

export function wrapText(text: string, size: number, fonts: PDFFont[], width: number): string[] {
  const words = sanitize(text).replace(/\s+/g, " ").split(" ").filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, size, fonts) <= width) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    // hard-break very long tokens (URLs)
    let token = word;
    while (measure(token, size, fonts) > width && token.length > 4) {
      let cut = token.length;
      while (cut > 4 && measure(token.slice(0, cut), size, fonts) > width) cut -= 2;
      out.push(token.slice(0, cut));
      token = token.slice(cut);
    }
    current = token;
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

interface Ctx {
  pdf: PDFDocument;
  stack: UnicodeFontStack;
  page: PDFPage;
  y: number;
  pageNumber: number;
  model: CopyrightReportModel;
  outline: Array<{ title: string; page: number }>;
}

function newPage(ctx: Ctx, withChrome = true): void {
  ctx.page = ctx.pdf.addPage(A4);
  ctx.pageNumber += 1;
  ctx.page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: BG });
  ctx.y = A4[1] - MARGIN;
  if (withChrome) {
    ctx.page.drawRectangle({ x: 0, y: A4[1] - 26, width: A4[0], height: 26, color: PANEL });
    drawUnicodeText(ctx.page, sanitize("ETERNA · COPYRIGHT THREAT INTELLIGENCE"), {
      x: MARGIN,
      y: A4[1] - 18,
      size: 7.5,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    const right = sanitize(`CONFIDENTIAL · ${ctx.model.reportId}`);
    drawUnicodeText(ctx.page, right, {
      x: A4[0] - MARGIN - measure(right, 7.5, ctx.stack.regular),
      y: A4[1] - 18,
      size: 7.5,
      stack: ctx.stack.regular,
      color: MUTED,
    });
    ctx.y = A4[1] - 46;
    drawFooter(ctx);
  }
}

function drawFooter(ctx: Ctx): void {
  ctx.page.drawLine({
    start: { x: MARGIN, y: 34 },
    end: { x: A4[0] - MARGIN, y: 34 },
    thickness: 0.5,
    color: BORDER,
  });
  drawUnicodeText(ctx.page, sanitize("Evidence only — no takedown submitted automatically."), {
    x: MARGIN,
    y: 22,
    size: 7,
    stack: ctx.stack.regular,
    color: MUTED,
  });
  const label = sanitize(`Page ${ctx.pageNumber}`);
  drawUnicodeText(ctx.page, label, {
    x: A4[0] - MARGIN - measure(label, 7, ctx.stack.regular),
    y: 22,
    size: 7,
    stack: ctx.stack.regular,
    color: MUTED,
  });
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < 52) newPage(ctx);
}

function text(
  ctx: Ctx,
  value: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: RGB;
    x?: number;
    width?: number;
    gap?: number;
  } = {},
): void {
  const size = opts.size ?? 9;
  const fonts = opts.bold ? ctx.stack.bold : ctx.stack.regular;
  const x = opts.x ?? MARGIN;
  const width = opts.width ?? CONTENT_W - (x - MARGIN);
  for (const line of wrapText(value, size, fonts, width)) {
    ensure(ctx, size + 4);
    drawUnicodeText(ctx.page, line, {
      x,
      y: ctx.y - size,
      size,
      stack: fonts,
      color: opts.color ?? TEXT,
    });
    ctx.y -= size + 3;
  }
  ctx.y -= opts.gap ?? 0;
}

function sectionTitle(ctx: Ctx, title: string, opts: { newPage?: boolean } = {}): void {
  if (opts.newPage || ctx.y < 180) newPage(ctx);
  ctx.outline.push({ title, page: ctx.pageNumber });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 22, width: 3, height: 20, color: ACCENT });
  drawUnicodeText(ctx.page, sanitize(title.toUpperCase()), {
    x: MARGIN + 10,
    y: ctx.y - 17,
    size: 12,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  ctx.y -= 34;
}

function panel(ctx: Ctx, height: number, color: RGB = PANEL): { x: number; y: number } {
  ensure(ctx, height + 8);
  const y = ctx.y - height;
  ctx.page.drawRectangle({
    x: MARGIN,
    y,
    width: CONTENT_W,
    height,
    color,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  return { x: MARGIN, y };
}

function keyValueGrid(ctx: Ctx, rows: Array<[string, string]>, columns = 2): void {
  const colW = CONTENT_W / columns;
  const rowH = 26;
  const lines = Math.ceil(rows.length / columns);
  const box = panel(ctx, lines * rowH + 8);
  rows.forEach((row, i) => {
    const col = i % columns;
    const rowIndex = Math.floor(i / columns);
    const x = box.x + col * colW + 10;
    const y = ctx.y - 16 - rowIndex * rowH;
    drawUnicodeText(ctx.page, sanitize(row[0].toUpperCase()), {
      x,
      y,
      size: 6.5,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    const value = wrapText(row[1], 8.5, ctx.stack.regular, colW - 20)[0] ?? "";
    drawUnicodeText(ctx.page, value, {
      x,
      y: y - 11,
      size: 8.5,
      stack: ctx.stack.regular,
      color: TEXT,
    });
  });
  ctx.y = box.y - 12;
}

function badge(ctx: Ctx, label: string, color: RGB, x: number, y: number): number {
  const w = measure(label, 7, ctx.stack.bold) + 14;
  ctx.page.drawRectangle({
    x,
    y: y - 3,
    width: w,
    height: 14,
    color,
    opacity: 0.18,
    borderColor: color,
    borderWidth: 0.6,
  });
  drawUnicodeText(ctx.page, sanitize(label), {
    x: x + 7,
    y: y + 1,
    size: 7,
    stack: ctx.stack.bold,
    color,
  });
  return w + 6;
}

function link(ctx: Ctx, url: string, x: number, y: number, width: number, height: number): void {
  try {
    const annot = ctx.pdf.context.register(
      ctx.pdf.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Link"),
        Rect: [x, y, x + width, y + height],
        Border: [0, 0, 0],
        A: { Type: PDFName.of("Action"), S: PDFName.of("URI"), URI: PDFString.of(url) },
      }),
    );
    ctx.page.node.addAnnot(annot);
  } catch {
    /* printed URL stays usable */
  }
}

function bulletList(ctx: Ctx, items: string[], color: RGB = TEXT): void {
  for (const item of items) {
    ensure(ctx, 14);
    ctx.page.drawCircle({ x: MARGIN + 4, y: ctx.y - 6, size: 1.6, color: ACCENT });
    text(ctx, item, { x: MARGIN + 14, size: 8.5, color });
  }
}

/* --------------------------------------------------------------- sections */

function drawCover(ctx: Ctx): void {
  const model = ctx.model;
  ctx.page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: BG });
  // grid backdrop
  for (let gy = 0; gy < A4[1]; gy += 28) {
    ctx.page.drawLine({
      start: { x: 0, y: gy },
      end: { x: A4[0], y: gy },
      thickness: 0.2,
      color: PANEL_ALT,
    });
  }
  for (let gx = 0; gx < A4[0]; gx += 28) {
    ctx.page.drawLine({
      start: { x: gx, y: 0 },
      end: { x: gx, y: A4[1] },
      thickness: 0.2,
      color: PANEL_ALT,
    });
  }
  ctx.page.drawRectangle({ x: 0, y: A4[1] - 6, width: A4[0], height: 6, color: ACCENT });

  drawUnicodeText(ctx.page, sanitize("ETERNA"), {
    x: MARGIN,
    y: A4[1] - 110,
    size: 34,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  drawUnicodeText(ctx.page, sanitize("CYBER INTELLIGENCE & REPUTATION PROTECTION"), {
    x: MARGIN,
    y: A4[1] - 128,
    size: 8,
    stack: ctx.stack.regular,
    color: ACCENT,
  });

  drawUnicodeText(ctx.page, sanitize("THREAT INTELLIGENCE"), {
    x: MARGIN,
    y: A4[1] - 220,
    size: 26,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  drawUnicodeText(ctx.page, sanitize("REPORT"), {
    x: MARGIN,
    y: A4[1] - 252,
    size: 26,
    stack: ctx.stack.bold,
    color: ACCENT,
  });

  const sev = severityColor(model.threatLevel.toLowerCase());
  ctx.page.drawRectangle({
    x: MARGIN,
    y: A4[1] - 300,
    width: 190,
    height: 30,
    color: sev,
    opacity: 0.2,
    borderColor: sev,
    borderWidth: 1,
  });
  drawUnicodeText(ctx.page, sanitize(`THREAT LEVEL: ${model.threatLevel}`), {
    x: MARGIN + 14,
    y: A4[1] - 290,
    size: 11,
    stack: ctx.stack.bold,
    color: sev,
  });

  const rows: Array<[string, string]> = [
    ["Client", model.clientName],
    ["Protected asset", model.protectedAsset],
    ["Asset type", model.assetKind],
    ["Report ID", model.reportId],
    ["Investigation ID", model.investigationId],
    ["Generated (UTC)", model.generatedAt.replace("T", " ").slice(0, 19)],
    ["Verified threats", String(model.summary.threatsDetected)],
    ["Risk score", `${model.riskScore}/100`],
  ];
  let y = A4[1] - 360;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: y - rows.length * 22 - 4,
    width: CONTENT_W,
    height: rows.length * 22 + 16,
    color: PANEL,
    borderColor: BORDER,
    borderWidth: 0.6,
  });
  for (const [label, value] of rows) {
    drawUnicodeText(ctx.page, sanitize(label.toUpperCase()), {
      x: MARGIN + 14,
      y,
      size: 7,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    const wrapped = wrapText(value, 9, ctx.stack.regular, CONTENT_W - 190)[0] ?? "";
    drawUnicodeText(ctx.page, wrapped, {
      x: MARGIN + 170,
      y,
      size: 9,
      stack: ctx.stack.regular,
      color: TEXT,
    });
    y -= 22;
  }

  ctx.page.drawRectangle({
    x: MARGIN,
    y: 74,
    width: CONTENT_W,
    height: 44,
    color: PANEL_ALT,
    borderColor: CRITICAL,
    borderWidth: 0.7,
  });
  drawUnicodeText(ctx.page, sanitize("CONFIDENTIAL — LEGAL & ENFORCEMENT USE ONLY"), {
    x: MARGIN + 14,
    y: 100,
    size: 9,
    stack: ctx.stack.bold,
    color: CRITICAL,
  });
  drawUnicodeText(
    ctx.page,
    sanitize("Evidence collected for copyright enforcement. No automated takedown was submitted."),
    { x: MARGIN + 14, y: 86, size: 7.5, stack: ctx.stack.regular, color: MUTED },
  );
}

function drawExecutiveSummary(ctx: Ctx): void {
  const s = ctx.model.summary;
  sectionTitle(ctx, "Executive Summary", { newPage: true });

  keyValueGrid(
    ctx,
    [
      ["Investigation duration", s.investigationDuration],
      ["Websites scanned", String(s.websitesScanned)],
      ["Verified threats detected", String(s.threatsDetected)],
      ["High-risk domains", String(s.highRiskDomains)],
      ["Active threats", String(s.activeThreats)],
      ["Removed / offline", String(s.removedThreats)],
    ],
    3,
  );

  // risk meter
  const box = panel(ctx, 52);
  drawUnicodeText(ctx.page, sanitize("OVERALL RISK SCORE"), {
    x: box.x + 12,
    y: ctx.y - 18,
    size: 7,
    stack: ctx.stack.bold,
    color: MUTED,
  });
  const barW = CONTENT_W - 120;
  ctx.page.drawRectangle({
    x: box.x + 12,
    y: box.y + 14,
    width: barW,
    height: 10,
    color: PANEL_ALT,
  });
  ctx.page.drawRectangle({
    x: box.x + 12,
    y: box.y + 14,
    width: Math.max(4, (barW * ctx.model.riskScore) / 100),
    height: 10,
    color: severityColor(ctx.model.threatLevel.toLowerCase()),
  });
  drawUnicodeText(ctx.page, sanitize(`${ctx.model.riskScore}/100`), {
    x: box.x + CONTENT_W - 90,
    y: box.y + 15,
    size: 12,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  ctx.y = box.y - 14;

  text(ctx, "Immediate actions required", { size: 10, bold: true, color: ACCENT, gap: 4 });
  bulletList(ctx, s.immediateActions);
}

function drawThreatTable(ctx: Ctx): void {
  sectionTitle(ctx, "Threat Overview", { newPage: true });
  const cols = [26, 168, 96, 62, 58, 60];
  const headers = ["#", "Website", "Type", "Severity", "Conf.", "Status"];

  const header = () => {
    ensure(ctx, 24);
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - 18,
      width: CONTENT_W,
      height: 18,
      color: PANEL_ALT,
    });
    let x = MARGIN + 6;
    headers.forEach((label, i) => {
      drawUnicodeText(ctx.page, sanitize(label.toUpperCase()), {
        x,
        y: ctx.y - 13,
        size: 6.8,
        stack: ctx.stack.bold,
        color: MUTED,
      });
      x += cols[i];
    });
    ctx.y -= 22;
  };
  header();

  if (!ctx.model.threats.length) {
    text(
      ctx,
      "No verified unauthorized distribution sources were confirmed in this investigation.",
      {
        size: 9,
        color: MUTED,
      },
    );
    return;
  }

  ctx.model.threats.forEach((threat, index) => {
    if (ctx.y < 70) {
      newPage(ctx);
      header();
    }
    if (index % 2 === 1) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - 15,
        width: CONTENT_W,
        height: 17,
        color: PANEL,
        opacity: 0.7,
      });
    }
    const baseY = ctx.y - 11;
    let x = MARGIN + 6;
    const cells = [
      String(threat.index),
      threat.website,
      threat.classificationLabel,
      "",
      `${threat.confidence}%`,
      threat.status.toUpperCase(),
    ];
    cells.forEach((cell, i) => {
      if (i === 3) {
        badge(ctx, threat.severity.toUpperCase(), severityColor(threat.severity), x, baseY - 3);
      } else {
        const value = wrapText(cell, 7.6, ctx.stack.regular, cols[i] - 6)[0] ?? "";
        drawUnicodeText(ctx.page, value, {
          x,
          y: baseY,
          size: 7.6,
          stack: i === 1 ? ctx.stack.bold : ctx.stack.regular,
          color: i === 5 && threat.status === "active" ? CRITICAL : TEXT,
        });
      }
      x += cols[i];
    });
    ctx.y -= 17;
  });
  ctx.y -= 6;
}

function drawThreatDetail(ctx: Ctx, threat: ReportThreat): void {
  sectionTitle(ctx, `Threat ${threat.index} — ${threat.website}`, { newPage: true });

  const sev = severityColor(threat.severity);
  let bx = MARGIN;
  bx += badge(ctx, threat.severity.toUpperCase(), sev, bx, ctx.y - 10);
  bx += badge(ctx, `${threat.confidence}% CONFIDENCE`, ACCENT, bx, ctx.y - 10);
  bx += badge(
    ctx,
    threat.status.toUpperCase(),
    threat.status === "active" ? CRITICAL : LOW,
    bx,
    ctx.y - 10,
  );
  badge(ctx, PRIORITY_LABEL[threat.enforcement.priority].toUpperCase(), MEDIUM, bx, ctx.y - 10);
  ctx.y -= 26;

  keyValueGrid(
    ctx,
    [
      ["Website", threat.website],
      ["Content type", threat.classificationLabel],
      ["Category", threat.categoryLabel],
      ["Detected", threat.detectedAt],
      ["Last verified", threat.lastVerifiedAt],
      ["Evidence ID", threat.evidenceId],
    ],
    3,
  );

  text(ctx, "Source URL", { size: 7, bold: true, color: MUTED });
  const urlLines = wrapText(threat.url, 8, ctx.stack.regular, CONTENT_W);
  for (const lineText of urlLines) {
    ensure(ctx, 12);
    drawUnicodeText(ctx.page, lineText, {
      x: MARGIN,
      y: ctx.y - 8,
      size: 8,
      stack: ctx.stack.regular,
      color: ACCENT,
    });
    link(ctx, threat.url, MARGIN, ctx.y - 10, measure(lineText, 8, ctx.stack.regular), 11);
    ctx.y -= 11;
  }
  ctx.y -= 6;

  text(ctx, "Evidence findings", { size: 10, bold: true, color: ACCENT, gap: 4 });
  const findings: string[] = [
    `Title detected on page: ${threat.evidence.titleDetected ?? "Not available"}`,
    `Download action detected: ${threat.evidence.downloadButtonDetected ? "Yes" : "No"}`,
    `Embedded player detected: ${threat.evidence.embeddedPlayerDetected ? "Yes" : "No"}`,
    `Streaming player detected: ${threat.evidence.streamingPlayerDetected ? "Yes" : "No"}`,
  ];
  if (threat.evidence.qualityTags.length) {
    findings.push(`Release quality markers: ${threat.evidence.qualityTags.join(", ")}`);
  }
  if (threat.evidence.visualFingerprintScore !== null) {
    findings.push(
      `Visual fingerprint similarity: ${Math.round(threat.evidence.visualFingerprintScore)}%`,
    );
  }
  if (threat.evidence.videoFingerprintScore !== null) {
    findings.push(`Face / actor similarity: ${Math.round(threat.evidence.videoFingerprintScore)}%`);
  }
  findings.push(...threat.evidence.indicators);
  bulletList(ctx, findings);
  ctx.y -= 4;

  if (threat.evidence.downloadLinks.length || threat.evidence.directFileUrls.length) {
    text(ctx, "Distribution links captured", { size: 10, bold: true, color: ACCENT, gap: 4 });
    bulletList(
      ctx,
      [...new Set([...threat.evidence.directFileUrls, ...threat.evidence.downloadLinks])].slice(
        0,
        8,
      ),
      MUTED,
    );
    ctx.y -= 4;
  }

  if (threat.evidence.ocrResult) {
    text(ctx, "OCR / text extraction", { size: 10, bold: true, color: ACCENT, gap: 4 });
    text(ctx, threat.evidence.ocrResult.slice(0, 700), { size: 8, color: MUTED, gap: 6 });
  }

  if (threat.evidence.htmlEvidence) {
    text(ctx, "Page excerpt", { size: 10, bold: true, color: ACCENT, gap: 4 });
    text(ctx, threat.evidence.htmlEvidence.slice(0, 700), { size: 8, color: MUTED, gap: 6 });
  }

  text(ctx, "Page metadata", { size: 10, bold: true, color: ACCENT, gap: 4 });
  keyValueGrid(ctx, threat.evidence.metadata, 3);

  text(ctx, "AI analysis summary", { size: 10, bold: true, color: ACCENT, gap: 4 });
  text(ctx, threat.aiSummary, { size: 8.5, gap: 8 });

  text(ctx, "Evidence links", { size: 10, bold: true, color: ACCENT, gap: 4 });
  for (const entry of threat.links.slice(0, 10)) {
    ensure(ctx, 22);
    drawUnicodeText(ctx.page, sanitize(`${entry.label} · ${entry.httpStatus} · ${entry.live}`), {
      x: MARGIN,
      y: ctx.y - 8,
      size: 7,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    ctx.y -= 11;
    const lineText = wrapText(entry.url, 7.6, ctx.stack.regular, CONTENT_W)[0] ?? "";
    drawUnicodeText(ctx.page, lineText, {
      x: MARGIN,
      y: ctx.y - 8,
      size: 7.6,
      stack: ctx.stack.regular,
      color: ACCENT,
    });
    link(ctx, entry.url, MARGIN, ctx.y - 10, measure(lineText, 7.6, ctx.stack.regular), 11);
    ctx.y -= 14;
  }
  ctx.y -= 4;

  text(ctx, "Domain intelligence", { size: 10, bold: true, color: ACCENT, gap: 4 });
  keyValueGrid(
    ctx,
    [
      ["Domain", threat.domainIntel.domain],
      ["Registrar", threat.domainIntel.registrar],
      ["Registered", threat.domainIntel.registrationDate],
      ["Expiry", threat.domainIntel.expiryDate],
      ["Hosting provider", threat.domainIntel.hostingProvider],
      ["Hosting country", threat.domainIntel.hostingCountry],
      ["IP address", threat.domainIntel.ipAddress],
      ["Network / ASN", threat.domainIntel.asn],
      ["CDN / WAF", threat.domainIntel.cloudProvider],
      ["SSL", threat.domainIntel.ssl],
      ["Nameservers", threat.domainIntel.nameservers],
      ["WHOIS", threat.domainIntel.whoisStatus],
    ],
    3,
  );

  text(ctx, "Enforcement information", { size: 10, bold: true, color: ACCENT, gap: 4 });
  keyValueGrid(
    ctx,
    [
      ["Hosting abuse email", threat.enforcement.hostingAbuseEmail],
      ["Hosting complaint form", threat.enforcement.hostingComplaintUrl],
      ["Registrar abuse email", threat.enforcement.registrarAbuseEmail],
      ["Registrar complaint", threat.enforcement.registrarComplaintUrl],
      ["DMCA contact", threat.enforcement.dmcaContact],
      ["Legal contact", threat.enforcement.legalContact],
      ["Jurisdiction", threat.enforcement.jurisdiction],
      ["Priority", PRIORITY_LABEL[threat.enforcement.priority]],
    ],
    2,
  );
  text(ctx, threat.enforcement.recommendedAction, { size: 8.5, color: MUTED, gap: 8 });

  text(ctx, "Relationship map", { size: 10, bold: true, color: ACCENT, gap: 4 });
  const relations: Array<[string, string[]]> = [
    ["Mirror domains", threat.relationships.mirrorDomains],
    ["Redirects / history", threat.relationships.redirects],
    ["Embedded players", threat.relationships.embeddedPlayers],
    ["Download servers", threat.relationships.downloadServers],
    ["Related infrastructure", threat.relationships.relatedInfrastructure],
  ];
  for (const [label, values] of relations) {
    text(ctx, `${label}: ${values.length ? values.join(", ") : "None identified"}`, {
      size: 8,
      color: MUTED,
    });
  }
  ctx.y -= 6;

  text(ctx, "Evidence integrity", { size: 10, bold: true, color: ACCENT, gap: 4 });
  keyValueGrid(
    ctx,
    [
      ["Evidence ID", threat.integrity.evidenceId],
      ["Collected", threat.integrity.collectionTime],
      ["Verified", threat.integrity.verificationTime],
      ["Status", threat.integrity.status],
    ],
    2,
  );
  text(ctx, `SHA-256: ${threat.integrity.sha256}`, { size: 7.5, color: MUTED, gap: 4 });
  bulletList(ctx, threat.integrity.chainOfCustody, MUTED);
}

function drawTimeline(ctx: Ctx): void {
  sectionTitle(ctx, "Investigation Timeline", { newPage: true });
  for (const entry of ctx.model.timeline) {
    ensure(ctx, 22);
    ctx.page.drawCircle({ x: MARGIN + 5, y: ctx.y - 7, size: 3, color: ACCENT });
    ctx.page.drawLine({
      start: { x: MARGIN + 5, y: ctx.y - 10 },
      end: { x: MARGIN + 5, y: ctx.y - 22 },
      thickness: 0.6,
      color: BORDER,
    });
    drawUnicodeText(ctx.page, sanitize(entry.time), {
      x: MARGIN + 16,
      y: ctx.y - 10,
      size: 7,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    drawUnicodeText(
      ctx.page,
      wrapText(entry.label, 8.5, ctx.stack.regular, CONTENT_W - 160)[0] ?? "",
      {
        x: MARGIN + 150,
        y: ctx.y - 10,
        size: 8.5,
        stack: ctx.stack.regular,
        color: TEXT,
      },
    );
    ctx.y -= 22;
  }
}

function drawGeography(ctx: Ctx): void {
  sectionTitle(ctx, "Geographic Distribution", { newPage: false });
  if (!ctx.model.geography.length) {
    text(ctx, "No geographic hosting data available for the verified sources.", {
      size: 9,
      color: MUTED,
    });
    return;
  }
  const max = Math.max(...ctx.model.geography.map((g) => g.sources));
  for (const geo of ctx.model.geography) {
    ensure(ctx, 22);
    drawUnicodeText(ctx.page, sanitize(geo.country), {
      x: MARGIN,
      y: ctx.y - 10,
      size: 8.5,
      stack: ctx.stack.bold,
      color: TEXT,
    });
    const barX = MARGIN + 160;
    const barW = CONTENT_W - 220;
    ctx.page.drawRectangle({ x: barX, y: ctx.y - 12, width: barW, height: 9, color: PANEL_ALT });
    ctx.page.drawRectangle({
      x: barX,
      y: ctx.y - 12,
      width: Math.max(4, (barW * geo.sources) / max),
      height: 9,
      color: ACCENT,
    });
    drawUnicodeText(ctx.page, sanitize(`${geo.sources} source(s)`), {
      x: barX + barW + 10,
      y: ctx.y - 10,
      size: 7.5,
      stack: ctx.stack.regular,
      color: MUTED,
    });
    ctx.y -= 22;
  }
}

function drawActions(ctx: Ctx): void {
  sectionTitle(ctx, "Recommended Actions", { newPage: false });
  const groups: Array<[string, RGB]> = [
    ["immediate", CRITICAL],
    ["24_hours", HIGH],
    ["monitor", MEDIUM],
    ["no_action", LOW],
  ];
  for (const [priority, color] of groups) {
    const items = ctx.model.actions.filter((a) => a.priority === priority);
    if (!items.length) continue;
    ensure(ctx, 24);
    badge(
      ctx,
      PRIORITY_LABEL[priority as keyof typeof PRIORITY_LABEL].toUpperCase(),
      color,
      MARGIN,
      ctx.y - 12,
    );
    ctx.y -= 22;
    for (const item of items) {
      text(ctx, `${item.target} — ${item.action} · Route: ${item.route}`, {
        x: MARGIN + 10,
        size: 8.5,
        color: TEXT,
      });
    }
    ctx.y -= 6;
  }
}

function drawFinalSummary(ctx: Ctx): void {
  sectionTitle(ctx, "Summary & Statistics", { newPage: true });
  const f = ctx.model.finalSummary;
  keyValueGrid(
    ctx,
    [
      ["Total verified threats", String(f.totalThreats)],
      ["Critical threats", String(f.criticalThreats)],
      ["High-risk domains", String(f.highRiskDomains)],
      ["Active sources", String(f.activeSources)],
      ["Removed sources", String(f.removedSources)],
      ["Enforcement workload", f.enforcementWorkload],
    ],
    3,
  );

  text(ctx, "Top enforcement targets", { size: 10, bold: true, color: ACCENT, gap: 6 });
  for (const target of f.topTargets) {
    ensure(ctx, 18);
    drawUnicodeText(ctx.page, sanitize(`${target.rank}.`), {
      x: MARGIN,
      y: ctx.y - 9,
      size: 8.5,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    drawUnicodeText(ctx.page, sanitize(target.domain), {
      x: MARGIN + 20,
      y: ctx.y - 9,
      size: 8.5,
      stack: ctx.stack.bold,
      color: TEXT,
    });
    badge(
      ctx,
      target.severity.toUpperCase(),
      severityColor(target.severity),
      MARGIN + 230,
      ctx.y - 12,
    );
    drawUnicodeText(ctx.page, sanitize(`${target.confidence}%`), {
      x: MARGIN + 320,
      y: ctx.y - 9,
      size: 8.5,
      stack: ctx.stack.regular,
      color: TEXT,
    });
    drawUnicodeText(ctx.page, sanitize(target.action), {
      x: MARGIN + 370,
      y: ctx.y - 9,
      size: 8,
      stack: ctx.stack.regular,
      color: MUTED,
    });
    ctx.y -= 18;
  }

  ctx.y -= 10;
  const box = panel(ctx, 56, PANEL_ALT);
  drawUnicodeText(ctx.page, sanitize("EVIDENCE-ONLY REPORT"), {
    x: box.x + 12,
    y: ctx.y - 18,
    size: 9,
    stack: ctx.stack.bold,
    color: CRITICAL,
  });
  const disclaimer =
    "This dossier documents verified unauthorized distribution of the protected asset. All findings were collected through automated investigation and preserved with SHA-256 integrity hashes. No takedown notices were submitted automatically; enforcement decisions remain with the rights holder and their legal counsel.";
  let dy = ctx.y - 30;
  for (const lineText of wrapText(disclaimer, 7.5, ctx.stack.regular, CONTENT_W - 24).slice(0, 4)) {
    drawUnicodeText(ctx.page, lineText, {
      x: box.x + 12,
      y: dy,
      size: 7.5,
      stack: ctx.stack.regular,
      color: MUTED,
    });
    dy -= 10;
  }
  ctx.y = box.y - 12;
}

/* ------------------------------------------------------------ entrypoint */

export interface ThreatScreenshot {
  matchId: string;
  bytes: Uint8Array;
  contentType: string;
}

export async function renderCopyrightReportPdf(
  model: CopyrightReportModel,
  screenshots: ThreatScreenshot[] = [],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Eterna Threat Intelligence Report — ${sanitize(model.protectedAsset)}`);
  pdf.setSubject("Copyright infringement threat intelligence dossier");
  pdf.setProducer("Eterna Cyber Intelligence");
  pdf.setCreator("Eterna Copyright Investigation Center");

  const stack = await embedUnicodeFontStack(pdf);
  const ctx: Ctx = {
    pdf,
    stack,
    page: pdf.addPage(A4),
    y: A4[1] - MARGIN,
    pageNumber: 1,
    model,
    outline: [],
  };
  drawCover(ctx);

  drawExecutiveSummary(ctx);
  drawThreatTable(ctx);

  const byMatch = new Map(screenshots.map((shot) => [shot.matchId, shot]));
  for (const threat of model.threats) {
    drawThreatDetail(ctx, threat);
    const shot = byMatch.get(threat.matchId);
    if (!shot) continue;
    try {
      const isPng =
        shot.contentType.includes("png") || (shot.bytes[0] === 0x89 && shot.bytes[1] === 0x50);
      const image = isPng ? await pdf.embedPng(shot.bytes) : await pdf.embedJpg(shot.bytes);
      const maxW = CONTENT_W;
      const scale = Math.min(maxW / image.width, 320 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ensure(ctx, h + 30);
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - h - 8,
        width: CONTENT_W,
        height: h + 8,
        color: PANEL,
        borderColor: BORDER,
        borderWidth: 0.6,
      });
      ctx.page.drawImage(image, {
        x: MARGIN + (CONTENT_W - w) / 2,
        y: ctx.y - h - 4,
        width: w,
        height: h,
      });
      ctx.y -= h + 14;
      text(ctx, threat.evidence.screenshotCaption, { size: 7.5, color: MUTED, gap: 6 });
    } catch (error) {
      console.warn(
        "[copyright-report] screenshot embed failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  drawTimeline(ctx);
  drawGeography(ctx);
  drawActions(ctx);
  drawFinalSummary(ctx);

  return pdf.save();
}
