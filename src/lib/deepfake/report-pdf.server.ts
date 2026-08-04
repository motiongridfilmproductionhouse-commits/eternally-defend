/**
 * Deepfake Threat Report PDF renderer.
 *
 * Dark cyber-intelligence styling, A4 portrait, pdf-lib. Consumes the pure
 * `DeepfakeReportModel` only — never invents findings or evidence.
 */

import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import {
  embedUnicodeFontStack,
  drawUnicodeText,
  measureUnicodeText,
  type UnicodeFontStack,
} from "@/lib/pdf/unicode-fonts.server";
import {
  PRIORITY_LABEL,
  type DeepfakeReportFinding,
  type DeepfakeReportModel,
} from "./report-model";

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
  const key = severity.toLowerCase();
  if (key === "critical") return CRITICAL;
  if (key === "high") return HIGH;
  if (key === "medium") return MEDIUM;
  return LOW;
}

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

export function wrapText(
  text: string,
  size: number,
  fonts: PDFFont[],
  width: number,
): string[] {
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
  model: DeepfakeReportModel;
}

function newPage(ctx: Ctx, withChrome = true): void {
  ctx.page = ctx.pdf.addPage(A4);
  ctx.pageNumber += 1;
  ctx.page.drawRectangle({
    x: 0,
    y: 0,
    width: A4[0],
    height: A4[1],
    color: BG,
  });
  ctx.y = A4[1] - MARGIN;
  if (withChrome) {
    ctx.page.drawRectangle({
      x: 0,
      y: A4[1] - 26,
      width: A4[0],
      height: 26,
      color: PANEL,
    });
    drawUnicodeText(
      ctx.page,
      sanitize("ETERNA · DEEPFAKE THREAT INTELLIGENCE"),
      {
        x: MARGIN,
        y: A4[1] - 18,
        size: 7.5,
        stack: ctx.stack.bold,
        color: MUTED,
      },
    );
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
  drawUnicodeText(
    ctx.page,
    sanitize("Evidence only — no takedown submitted automatically."),
    {
      x: MARGIN,
      y: 22,
      size: 7,
      stack: ctx.stack.regular,
      color: MUTED,
    },
  );
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
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 22,
    width: 3,
    height: 20,
    color: ACCENT,
  });
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
        A: {
          Type: PDFName.of("Action"),
          S: PDFName.of("URI"),
          URI: PDFString.of(url),
        },
      }),
    );
    ctx.page.node.addAnnot(annot);
  } catch {
    /* printed URL stays usable */
  }
}

function bulletList(ctx: Ctx, items: string[]): void {
  for (const item of items) {
    ensure(ctx, 14);
    ctx.page.drawCircle({
      x: MARGIN + 4,
      y: ctx.y - 6,
      size: 1.6,
      color: ACCENT,
    });
    text(ctx, item, { x: MARGIN + 14, size: 8.5 });
  }
}

function shown(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not available";
  return String(value);
}

function drawCover(ctx: Ctx): void {
  const model = ctx.model;
  ctx.page.drawRectangle({
    x: 0,
    y: 0,
    width: A4[0],
    height: A4[1],
    color: BG,
  });
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
  ctx.page.drawRectangle({
    x: 0,
    y: A4[1] - 6,
    width: A4[0],
    height: 6,
    color: ACCENT,
  });

  drawUnicodeText(ctx.page, sanitize("ETERNA"), {
    x: MARGIN,
    y: A4[1] - 110,
    size: 34,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  drawUnicodeText(
    ctx.page,
    sanitize("CYBER INTELLIGENCE & REPUTATION PROTECTION"),
    {
      x: MARGIN,
      y: A4[1] - 128,
      size: 8,
      stack: ctx.stack.regular,
      color: ACCENT,
    },
  );

  drawUnicodeText(ctx.page, sanitize("DEEPFAKE THREAT"), {
    x: MARGIN,
    y: A4[1] - 220,
    size: 26,
    stack: ctx.stack.bold,
    color: TEXT,
  });
  drawUnicodeText(
    ctx.page,
    sanitize(model.reportMode === "interim" ? "INTERIM REPORT" : "REPORT"),
    {
      x: MARGIN,
      y: A4[1] - 252,
      size: 26,
      stack: ctx.stack.bold,
      color: ACCENT,
    },
  );

  const sev = severityColor(model.threatLevel);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: A4[1] - 300,
    width: 210,
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
    ["Protected identity", model.protectedIdentity],
    ["Authorization", model.authorizationStatus ?? "Not recorded"],
    ["Report type", model.reportMode === "interim" ? "Interim" : "Final"],
    ["Report ID", model.reportId],
    ["Scan ID", model.scanId],
    ["Generated (UTC)", model.generatedAt.replace("T", " ").slice(0, 19)],
    ["Client-visible findings", String(model.summary.clientVisibleFindings)],
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
    const wrapped =
      wrapText(value, 9, ctx.stack.regular, CONTENT_W - 190)[0] ?? "";
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
  drawUnicodeText(
    ctx.page,
    sanitize("CONFIDENTIAL — AUTHORIZED REVIEW USE ONLY"),
    {
      x: MARGIN + 14,
      y: 100,
      size: 9,
      stack: ctx.stack.bold,
      color: CRITICAL,
    },
  );
  drawUnicodeText(
    ctx.page,
    sanitize(
      "Compiled from persisted Deepfake Intelligence evidence. No automated takedown was submitted.",
    ),
    {
      x: MARGIN + 14,
      y: 86,
      size: 7.5,
      stack: ctx.stack.regular,
      color: MUTED,
    },
  );
}

function drawExecutiveSummary(ctx: Ctx): void {
  const s = ctx.model.summary;
  sectionTitle(ctx, "Executive Summary", { newPage: true });

  keyValueGrid(
    ctx,
    [
      ["Scan status", s.scanStatus],
      ["Investigation duration", s.investigationDuration],
      ["Queries executed", shown(s.queriesExecuted)],
      ["Pages verified", shown(s.pagesVerified)],
      ["Verified deepfakes", String(s.verifiedDeepfakes)],
      ["Probable deepfakes", String(s.probableDeepfakes)],
      ["Unique domains", String(s.uniqueDomains)],
      ["Critical / High", `${s.criticalCount} / ${s.highCount}`],
      ["Identity rejected", shown(s.identityRejected)],
      ["URL rejected", shown(s.urlRejected)],
      ["Crawl failed", shown(s.crawlFailed)],
      ["Risk score", `${ctx.model.riskScore}/100`],
    ],
    3,
  );

  text(ctx, "Immediate review items", {
    size: 9,
    bold: true,
    gap: 4,
  });
  bulletList(ctx, s.immediateReviewItems);
}

function drawIdentity(ctx: Ctx): void {
  sectionTitle(ctx, "Protected Identity");
  const id = ctx.model.identity;
  keyValueGrid(
    ctx,
    [
      ["Target name", id.targetName],
      ["Authorization status", shown(id.authorizationStatus)],
      ["Reference faces enrolled", String(id.referenceFaceCount)],
      [
        "Face collection",
        id.faceCollectionConfigured ? "Configured" : "Not configured",
      ],
      ["Aliases", id.aliases.length ? id.aliases.join(", ") : "None recorded"],
      ["Handles", id.handles.length ? id.handles.join(", ") : "None recorded"],
    ],
    2,
  );
  text(
    ctx,
    "Identity details are copied from the Deepfake Intelligence profile and scan target fields. This section does not invent aliases, handles, or authorization claims.",
    { size: 8, color: MUTED, gap: 6 },
  );
}

function drawDiagnostics(ctx: Ctx): void {
  sectionTitle(ctx, "Scan Diagnostics");
  if (!ctx.model.diagnostics.length) {
    text(ctx, "No numeric discovery diagnostics were persisted on this scan.", {
      size: 8.5,
      color: MUTED,
      gap: 6,
    });
    return;
  }
  keyValueGrid(
    ctx,
    ctx.model.diagnostics.map((row) => [row.label, String(row.value)]),
    3,
  );
  text(
    ctx,
    "Diagnostics reflect recorded funnel metrics only. Missing keys are omitted rather than invented.",
    { size: 8, color: MUTED, gap: 6 },
  );
}

function drawFindingsTable(ctx: Ctx): void {
  sectionTitle(ctx, "Client-Visible Findings");
  if (!ctx.model.findings.length) {
    text(
      ctx,
      "No client-visible verified or probable deepfake findings were available for this scan.",
      { size: 8.5, color: MUTED, gap: 6 },
    );
    return;
  }

  for (const finding of ctx.model.findings) {
    ensure(ctx, 46);
    const box = panel(ctx, 40);
    drawUnicodeText(ctx.page, sanitize(`#${finding.index}  ${finding.domain}`), {
      x: box.x + 10,
      y: ctx.y - 14,
      size: 9,
      stack: ctx.stack.bold,
      color: TEXT,
    });
    let bx = box.x + 10;
    bx += badge(
      ctx,
      finding.riskLevel,
      severityColor(finding.riskLevel),
      bx,
      ctx.y - 30,
    );
    bx += badge(
      ctx,
      finding.classificationLabel.toUpperCase(),
      finding.classification === "VERIFIED_DEEPFAKE" ? CRITICAL : HIGH,
      bx,
      ctx.y - 30,
    );
    const conf =
      finding.confidence === null ? "n/a" : `${finding.confidence}%`;
    drawUnicodeText(ctx.page, sanitize(conf), {
      x: box.x + CONTENT_W - 54,
      y: ctx.y - 14,
      size: 9,
      stack: ctx.stack.regular,
      color: MUTED,
    });
    ctx.y = box.y - 8;
  }
}

function drawFindingDetail(ctx: Ctx, finding: DeepfakeReportFinding): void {
  sectionTitle(ctx, `Finding ${finding.index}: ${finding.domain}`);

  keyValueGrid(
    ctx,
    [
      ["Classification", finding.classificationLabel],
      ["Risk level", finding.riskLevel],
      ["Confidence", shown(finding.confidence === null ? null : `${finding.confidence}%`)],
      [
        "Identity confidence",
        shown(
          finding.identityConfidence === null
            ? null
            : `${finding.identityConfidence}%`,
        ),
      ],
      [
        "Synthetic confidence",
        shown(
          finding.syntheticMediaConfidence === null
            ? null
            : `${finding.syntheticMediaConfidence}%`,
        ),
      ],
      ["URL verification", shown(finding.urlVerificationStatus)],
      ["HTTP status", shown(finding.httpStatus)],
      ["Content category", shown(finding.contentCategory)],
      ["Page type", shown(finding.pageType)],
      ["Face referenced", finding.faceReferenced ? "Yes" : "No"],
      [
        "Target face match",
        finding.targetFaceMatch === null
          ? "Not available"
          : finding.targetFaceMatch
            ? "Yes"
            : "No",
      ],
      [
        "Face similarity",
        shown(
          finding.faceSimilarity === null ? null : `${finding.faceSimilarity}`,
        ),
      ],
      ["Detected at", finding.detectedAt],
      ["Crawled at", shown(finding.crawledAt)],
      ["Review status", shown(finding.reviewStatus)],
      ["Priority", PRIORITY_LABEL[finding.priority]],
    ],
    2,
  );

  if (finding.pageTitle) {
    text(ctx, "Page title", { size: 8, bold: true, color: MUTED, gap: 2 });
    text(ctx, finding.pageTitle, { size: 9, gap: 6 });
  }

  if (finding.url) {
    text(ctx, "Verified evidence URL", {
      size: 8,
      bold: true,
      color: MUTED,
      gap: 2,
    });
    ensure(ctx, 14);
    const lines = wrapText(finding.url, 8.5, ctx.stack.regular, CONTENT_W);
    for (const line of lines) {
      ensure(ctx, 12);
      drawUnicodeText(ctx.page, line, {
        x: MARGIN,
        y: ctx.y - 9,
        size: 8.5,
        stack: ctx.stack.regular,
        color: ACCENT,
      });
      link(ctx, finding.url, MARGIN, ctx.y - 12, CONTENT_W, 12);
      ctx.y -= 12;
    }
    ctx.y -= 6;
  } else {
    text(ctx, "Verified evidence URL: Not available", {
      size: 8.5,
      color: MUTED,
      gap: 6,
    });
  }

  if (finding.snippet) {
    text(ctx, "Snippet", { size: 8, bold: true, color: MUTED, gap: 2 });
    text(ctx, finding.snippet, { size: 8.5, gap: 6 });
  }

  if (finding.matchedEvidence.length) {
    text(ctx, "Matched evidence tags", {
      size: 8,
      bold: true,
      color: MUTED,
      gap: 2,
    });
    bulletList(ctx, finding.matchedEvidence);
    ctx.y -= 4;
  }

  if (finding.redirectChain.length) {
    text(ctx, "Redirect chain", { size: 8, bold: true, color: MUTED, gap: 2 });
    bulletList(ctx, finding.redirectChain);
    ctx.y -= 4;
  }

  text(ctx, "Analyst summary (from persisted fields)", {
    size: 8,
    bold: true,
    color: MUTED,
    gap: 2,
  });
  text(ctx, finding.analystSummary, { size: 8.5, gap: 6 });

  text(ctx, "Recommended next step", {
    size: 8,
    bold: true,
    color: MUTED,
    gap: 2,
  });
  text(ctx, finding.recommendedNextStep, { size: 8.5, gap: 8 });
}

function drawDomains(ctx: Ctx): void {
  sectionTitle(ctx, "Affected Domains");
  if (!ctx.model.domains.length) {
    text(ctx, "No domains were derived from client-visible findings.", {
      size: 8.5,
      color: MUTED,
      gap: 6,
    });
    return;
  }

  for (const domain of ctx.model.domains) {
    ensure(ctx, 28);
    const box = panel(ctx, 24);
    drawUnicodeText(ctx.page, sanitize(domain.domain), {
      x: box.x + 10,
      y: ctx.y - 15,
      size: 9,
      stack: ctx.stack.bold,
      color: TEXT,
    });
    badge(
      ctx,
      domain.highestRisk,
      severityColor(domain.highestRisk),
      box.x + 220,
      ctx.y - 16,
    );
    drawUnicodeText(
      ctx.page,
      sanitize(
        `${domain.findingCount} finding(s) · ${domain.verified} verified · ${domain.probable} probable`,
      ),
      {
        x: box.x + 300,
        y: ctx.y - 15,
        size: 7.5,
        stack: ctx.stack.regular,
        color: MUTED,
      },
    );
    ctx.y = box.y - 6;
  }
}

function drawTimeline(ctx: Ctx): void {
  sectionTitle(ctx, "Investigation Timeline");
  for (const entry of ctx.model.timeline) {
    ensure(ctx, 18);
    drawUnicodeText(ctx.page, sanitize(entry.time), {
      x: MARGIN,
      y: ctx.y - 10,
      size: 7.5,
      stack: ctx.stack.bold,
      color: MUTED,
    });
    text(ctx, entry.label, { x: MARGIN + 150, size: 8.5, width: CONTENT_W - 150 });
  }
}

function drawDisclaimer(ctx: Ctx): void {
  sectionTitle(ctx, "Disclaimer & Integrity", { newPage: true });
  const box = panel(ctx, 110, PANEL_ALT);
  drawUnicodeText(ctx.page, sanitize("EVIDENCE-ONLY REPORT"), {
    x: box.x + 12,
    y: ctx.y - 18,
    size: 9,
    stack: ctx.stack.bold,
    color: CRITICAL,
  });
  let dy = ctx.y - 34;
  for (const line of ctx.model.disclaimer) {
    for (const wrapped of wrapText(line, 7.5, ctx.stack.regular, CONTENT_W - 24)) {
      drawUnicodeText(ctx.page, wrapped, {
        x: box.x + 12,
        y: dy,
        size: 7.5,
        stack: ctx.stack.regular,
        color: MUTED,
      });
      dy -= 10;
    }
    dy -= 4;
  }
  ctx.y = box.y - 12;

  keyValueGrid(
    ctx,
    [
      ["Report version", ctx.model.version],
      ["Report ID", ctx.model.reportId],
      ["Scan ID", ctx.model.scanId],
      ["Profile ID", shown(ctx.model.profileId)],
      ["Generated at", ctx.model.generatedAt.replace("T", " ").slice(0, 19) + " UTC"],
      ["Findings included", String(ctx.model.findings.length)],
    ],
    2,
  );
}

export async function renderDeepfakeReportPdf(
  model: DeepfakeReportModel,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    `Eterna Deepfake Threat ${model.reportMode === "interim" ? "Interim " : ""}Report — ${sanitize(model.protectedIdentity)}`,
  );
  pdf.setSubject("Deepfake and synthetic media threat intelligence dossier");
  pdf.setProducer("Eterna Cyber Intelligence");
  pdf.setCreator("Eterna Deepfake Intelligence Center");

  const stack = await embedUnicodeFontStack(pdf);
  const ctx: Ctx = {
    pdf,
    stack,
    page: pdf.addPage(A4),
    y: A4[1] - MARGIN,
    pageNumber: 1,
    model,
  };

  drawCover(ctx);
  drawExecutiveSummary(ctx);
  drawIdentity(ctx);
  drawDiagnostics(ctx);
  drawFindingsTable(ctx);
  for (const finding of model.findings) {
    drawFindingDetail(ctx, finding);
  }
  drawDomains(ctx);
  drawTimeline(ctx);
  drawDisclaimer(ctx);

  return pdf.save();
}
