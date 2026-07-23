import "regenerator-runtime/runtime.js";
import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  type PDFFont,
  type PDFPage,
  type PDFImage,
} from "pdf-lib";
import { createHash } from "crypto";
import {
  embedUnicodeFontStack,
  drawUnicodeText,
  measureUnicodeText as measureUnicodeTextUnsafe,
} from "@/lib/pdf/unicode-fonts.server";
import {
  validateReview,
  verifiedExportReadiness,
  type EvidenceReview,
} from "@/lib/evidence-review";

function fmtTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export interface ScanReportInput {
  subject: string;
  period: string;
  generatedAt: string;
  reputationScore: number;
  reputationLevel: string;
  headline: string;
  totals: {
    unique: number;
    critical: number;
    high: number;
    negative: number;
    viral: number;
    totalReach: number;
  };
  sources: string[];
  immediateActions: string[];
  longTerm: string[];
  exportType?: "PRELIMINARY_INTELLIGENCE" | "VERIFIED_EVIDENCE_PACKAGE";
  hits: Array<{
    title: string;
    url: string;
    description?: string | null;
    platform: string;
    source: string;
    author?: string | null;
    published?: string | null;
    category: string;
    contentLabel: string;
    severity: string;
    sentiment: string;
    threatScore: number;
    credibilityScore: number;
    reachEstimate: number;
    engagement: number;
    detectionReason?: string | null;
    recommendedAction: string;
    discoveredAt?: string | null;
    thumbnailUrl?: string | null;
    videoId?: string | null;
    channelId?: string | null;
    channelUrl?: string | null;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    viewsAvailable?: boolean;
    likesAvailable?: boolean;
    commentsAvailable?: boolean;
    statisticsCapturedAt?: string | null;
    statisticsSource?: string | null;
    transcript?: string | null;
    transcriptSource?: string | null;
    transcriptConfidence?: number | null;
    review?: EvidenceReview | null;
    scoring?: {
      relevance: number;
      harm: number;
      credibility: number;
      virality: number;
      evidenceCompleteness: number;
      legalActionability: number;
      overallPriority: number;
      version: string;
    } | null;
    evidence?: {
      fullPageScreenshotPreserved?: boolean;
      originalMediaPreserved?: boolean;
      hashesGenerated?: boolean;
      chainOfCustodyCreated?: boolean;
      translationRequired?: boolean;
      translationVerified?: boolean;
      channelIdentifiersPreserved?: boolean;
      ownershipProofPreserved?: boolean;
      recordDataHash?: string | null;
      screenshotHash?: string | null;
      transcriptHash?: string | null;
      originalMediaHash?: string | null;
      storageObjectPath?: string | null;
    } | null;
  }>;
}

const A4: [number, number] = [595.28, 841.89];
const navy = rgb(0.035, 0.075, 0.15);
const blue = rgb(0.08, 0.36, 0.86);
const ink = rgb(0.08, 0.1, 0.16);
const muted = rgb(0.4, 0.44, 0.52);
const line = rgb(0.84, 0.87, 0.92);
const red = rgb(0.82, 0.12, 0.16);
const amber = rgb(0.88, 0.48, 0.04);

function sha(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function safeDate(value?: string | null) {
  if (!value) return "Not supplied";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}
export function normalizePdfText(value: unknown): string {
  return Array.from(
    decodeHtmlEntities(String(value ?? ""))
      .normalize("NFC")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\uFE0E\uFE0F]/g, ""),
  )
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
}
const pdfSafe = normalizePdfText;

export function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const cp = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function safeMeasure(value: string, size: number, fonts: PDFFont[]): number {
  const safe = pdfSafe(value);

  try {
    const measured = measureUnicodeTextUnsafe(safe, size, fonts);
    return Number.isFinite(measured) ? measured : safe.length * size * 0.55;
  } catch (error) {
    console.warn(
      "[scan-pdf] Unicode measurement fallback:",
      error instanceof Error ? error.message : String(error),
    );
    return safe.length * size * 0.55;
  }
}

function wrap(text: string, size: number, fonts: PDFFont[], width: number): string[] {
  const words = pdfSafe(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (safeMeasure(candidate, size, fonts) <= width) current = candidate;
    else {
      if (current) out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
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
  try {
    const annot = pdf.context.register(
      pdf.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Link"),
        Rect: [x, y, x + width, y + height],
        Border: [0, 0, 0],
        A: { Type: PDFName.of("Action"), S: PDFName.of("URI"), URI: PDFString.of(url) },
      }),
    );
    page.node.addAnnot(annot);
  } catch {
    /* printed URL remains usable */
  }
}

const TRUSTED_IMAGE_HOSTS = [
  "ytimg.com",
  "googleusercontent.com",
  "ggpht.com",
  "twimg.com",
  "fbcdn.net",
  "cdninstagram.com",
  "redd.it",
  "redditmedia.com",
  "tiktokcdn.com",
  "licdn.com",
];

function trustedImageUrl(value?: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    const trusted = TRUSTED_IMAGE_HOSTS.some(
      (allowed) => host === allowed || host.endsWith("." + allowed),
    );

    return trusted ? url.toString() : null;
  } catch {
    return null;
  }
}

async function loadEvidenceImage(
  pdf: PDFDocument,
  value?: string | null,
): Promise<{ image: PDFImage; hash: string } | null> {
  const url = trustedImageUrl(value);
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Eterna-Evidence-Collector/1.0" },
    });

    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 8 * 1024 * 1024) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null;

    const hash = createHash("sha256").update(bytes).digest("hex");
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";

    try {
      if (contentType.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
        return { image: await pdf.embedPng(bytes), hash };
      }

      if (
        contentType.includes("jpeg") ||
        contentType.includes("jpg") ||
        (bytes[0] === 0xff && bytes[1] === 0xd8)
      ) {
        return { image: await pdf.embedJpg(bytes), hash };
      }
    } catch (error) {
      console.warn(
        "[scan-pdf] Thumbnail embedding failed:",
        error instanceof Error ? error.message : String(error),
      );
    }

    return null;
  } catch (error) {
    console.warn(
      "[scan-pdf] Thumbnail fetch failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildScanReportPdf(
  input: ScanReportInput,
): Promise<{ bytes: Uint8Array; reportId: string; hash: string }> {
  const exportType = input.exportType ?? "PRELIMINARY_INTELLIGENCE";
  if (exportType === "VERIFIED_EVIDENCE_PACKAGE") {
    const failures = input.hits.flatMap((hit, index) => {
      const readiness = verifiedExportReadiness(hit.review, {
        transcriptPreserved: Boolean(hit.transcript),
        translationRequired: hit.evidence?.translationRequired,
        translationVerified: hit.evidence?.translationVerified,
        fullPageScreenshotPreserved: hit.evidence?.fullPageScreenshotPreserved,
        originalMediaPreserved: hit.evidence?.originalMediaPreserved,
        hashesGenerated: hit.evidence?.hashesGenerated,
        chainOfCustodyCreated: hit.evidence?.chainOfCustodyCreated,
        channelIdentifiersPreserved: hit.evidence?.channelIdentifiersPreserved,
        ownershipProofPreserved: hit.evidence?.ownershipProofPreserved,
      });
      return readiness.missing.map((item) => `EV-${String(index + 1).padStart(3, "0")}: ${item}`);
    });
    if (failures.length)
      throw new Error(`Verified evidence export blocked. Missing: ${failures.join("; ")}`);
  }
  const pdf = await PDFDocument.create();
  const reportId =
    "ETR-" +
    new Date(input.generatedAt).getUTCFullYear() +
    "-" +
    sha([input.subject, input.generatedAt]).slice(0, 10).toUpperCase();
  pdf.setTitle("Eterna Evidence and Incident Report - " + input.subject);
  pdf.setAuthor("Eterna AI");
  pdf.setCreator("Eterna AI Evidence System");
  pdf.setProducer("Eterna AI");
  pdf.setSubject("Public-source evidence and incident report " + reportId);
  const stack = await embedUnicodeFontStack(pdf);
  const regular = stack.regular,
    bold = stack.bold;
  const margin = 46,
    contentWidth = A4[0] - margin * 2;

  const text = (
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    size = 10,
    isBold = false,
    color = ink,
  ) => drawUnicodeText(page, pdfSafe(value), { x, y, size, stack: isBold ? bold : regular, color });
  const paragraph = (
    page: PDFPage,
    value: string,
    x: number,
    y: number,
    width: number,
    size = 9.5,
    color = ink,
    leading = 13,
  ) => {
    for (const row of wrap(value, size, regular, width)) {
      text(page, row, x, y, size, false, color);
      y -= leading;
    }
    return y;
  };
  const header = (page: PDFPage, section: string) => {
    page.drawRectangle({ x: 0, y: 807, width: A4[0], height: 35, color: navy });
    text(page, "ETERNA AI", margin, 819, 11, true, rgb(1, 1, 1));
    text(page, section, 330, 819, 8, false, rgb(0.75, 0.82, 0.95));
  };

  // Cover
  let page = pdf.addPage(A4);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: navy });
  page.drawRectangle({ x: 0, y: 0, width: 14, height: A4[1], color: blue });
  text(page, "ETERNA AI", 54, 760, 15, true, rgb(0.52, 0.72, 1));
  text(
    page,
    exportType === "VERIFIED_EVIDENCE_PACKAGE" ? "VERIFIED EVIDENCE" : "PRELIMINARY EVIDENCE",
    54,
    650,
    24,
    true,
    rgb(1, 1, 1),
  );
  text(
    page,
    exportType === "VERIFIED_EVIDENCE_PACKAGE" ? "PACKAGE" : "INTELLIGENCE INDEX",
    54,
    612,
    24,
    true,
    rgb(1, 1, 1),
  );
  let cy = 555;
  cy = paragraph(page, input.subject, 54, cy, 480, 19, rgb(0.84, 0.9, 1), 25);
  page.drawLine({
    start: { x: 54, y: cy - 8 },
    end: { x: 535, y: cy - 8 },
    thickness: 1,
    color: rgb(0.22, 0.38, 0.62),
  });
  text(page, "Report ID", 54, cy - 42, 9, true, rgb(0.52, 0.65, 0.82));
  text(page, reportId, 170, cy - 42, 10, true, rgb(1, 1, 1));
  text(page, "Scan period", 54, cy - 65, 9, true, rgb(0.52, 0.65, 0.82));
  text(page, input.period, 170, cy - 65, 10, false, rgb(1, 1, 1));
  text(page, "Generated", 54, cy - 88, 9, true, rgb(0.52, 0.65, 0.82));
  text(page, safeDate(input.generatedAt), 170, cy - 88, 10, false, rgb(1, 1, 1));
  text(page, "Classification", 54, cy - 111, 9, true, rgb(0.52, 0.65, 0.82));
  paragraph(
    page,
    exportType === "VERIFIED_EVIDENCE_PACKAGE"
      ? "VERIFIED HUMAN-REVIEWED EVIDENCE PACKAGE"
      : "PRELIMINARY PUBLIC-SOURCE INTELLIGENCE AND EVIDENCE INDEX - PENDING HUMAN VERIFICATION",
    170,
    cy - 111,
    365,
    8.5,
    rgb(1, 0.74, 0.3),
    11,
  );
  text(page, "PUBLIC-SOURCE INTELLIGENCE", 54, 120, 9, true, rgb(0.52, 0.65, 0.82));
  paragraph(
    page,
    "This report contains automated investigative leads. It does not independently prove illegality, defamation, copyright infringement or criminal conduct. Human and, where appropriate, legal review is required.",
    54,
    95,
    480,
    8.5,
    rgb(0.72, 0.78, 0.88),
    12,
  );
  paragraph(
    page,
    "Original native evidence files and the signed evidence manifest must accompany this PDF. A thumbnail or URL alone is not a complete evidentiary capture.",
    54,
    55,
    480,
    8.5,
    rgb(0.72, 0.78, 0.88),
    12,
  );

  // Executive summary
  page = pdf.addPage(A4);
  header(page, "EXECUTIVE SUMMARY");
  text(page, "Executive Incident Summary", margin, 770, 20, true, navy);
  let y = paragraph(page, input.headline, margin, 738, contentWidth, 11, ink, 16) - 10;
  const cards = [
    ["Observed priority", input.reputationScore + "/100"],
    ["Assessment", input.reputationLevel],
    ["Evidence items", String(input.totals.unique)],
    ["Critical / High", input.totals.critical + " / " + input.totals.high],
  ];
  cards.forEach(([label, value], i) => {
    const x = margin + (i % 2) * 250,
      yy = y - Math.floor(i / 2) * 66;
    page.drawRectangle({
      x,
      y: yy - 46,
      width: 235,
      height: 54,
      color: rgb(0.95, 0.97, 1),
      borderColor: line,
      borderWidth: 1,
    });
    text(page, label.toUpperCase(), x + 12, yy - 15, 7.5, true, muted);
    text(page, value, x + 12, yy - 36, 15, true, navy);
  });
  y -= 145;
  text(page, "Immediate actions", margin, y, 12, true, navy);
  y -= 18;
  for (const action of input.immediateActions)
    y = paragraph(page, "- " + action, margin + 8, y, contentWidth - 8, 9.5, ink, 13) - 3;
  y -= 7;
  text(page, "Recommended monitoring and response", margin, y, 12, true, navy);
  y -= 18;
  for (const action of input.longTerm)
    y = paragraph(page, "- " + action, margin + 8, y, contentWidth - 8, 9.5, ink, 13) - 3;
  y -= 10;
  text(page, "Sources covered", margin, y, 11, true, navy);
  y -= 16;
  paragraph(
    page,
    input.sources.join(", ") || "No source list supplied",
    margin,
    y,
    contentWidth,
    9,
    muted,
    13,
  );

  // Evidence index
  const severityRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const hits = input.hits
    .slice()
    .sort(
      (a, b) =>
        (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9) ||
        b.threatScore - a.threatScore,
    );
  page = pdf.addPage(A4);
  header(page, "EVIDENCE INDEX");
  y = 770;
  text(page, "Evidence Index", margin, y, 20, true, navy);
  y -= 28;
  for (let i = 0; i < hits.length; i++) {
    if (y < 70) {
      page = pdf.addPage(A4);
      header(page, "EVIDENCE INDEX");
      y = 770;
    }
    const h = hits[i],
      id = "EV-" + String(i + 1).padStart(3, "0");
    page.drawRectangle({
      x: margin,
      y: y - 36,
      width: contentWidth,
      height: 42,
      color: i % 2 ? rgb(0.98, 0.985, 1) : rgb(0.95, 0.97, 1),
    });
    text(page, id, margin + 8, y - 15, 9, true, blue);
    text(
      page,
      h.severity,
      margin + 62,
      y - 15,
      8.5,
      true,
      h.severity === "Critical" ? red : h.severity === "High" ? amber : muted,
    );
    text(page, h.platform, margin + 125, y - 15, 8.5, false, muted);
    const title = wrap(h.title, 8.5, regular, 300)[0] ?? "";
    text(page, title, margin + 205, y - 15, 8.5, true, ink);
    text(page, "Priority " + h.threatScore, margin + 430, y - 15, 8, false, muted);
    text(page, safeDate(h.published).slice(0, 10), margin + 62, y - 29, 7.5, false, muted);
    y -= 44;
  }

  // One complete record for every item
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i],
      id = "EV-" + String(i + 1).padStart(3, "0"),
      evidenceHash = sha(h);
    page = pdf.addPage(A4);
    header(page, "EVIDENCE RECORD " + id);
    y = 770;
    text(
      page,
      id + " - " + h.severity.toUpperCase(),
      margin,
      y,
      11,
      true,
      h.severity === "Critical" ? red : h.severity === "High" ? amber : blue,
    );
    y -= 28;
    y = paragraph(page, h.title, margin, y, contentWidth, 16, navy, 21) - 6;
    page.drawRectangle({
      x: margin,
      y: y - 54,
      width: contentWidth,
      height: 58,
      color: rgb(0.95, 0.97, 1),
      borderColor: line,
      borderWidth: 1,
    });
    text(page, "AUTOMATED CATEGORY - UNVERIFIED", margin + 10, y - 16, 7, true, muted);
    text(page, h.category, margin + 10, y - 34, 9.5, true, ink);
    text(page, "PLATFORM", margin + 150, y - 16, 7, true, muted);
    text(page, h.platform, margin + 150, y - 34, 9.5, true, ink);
    text(page, "THREAT", margin + 285, y - 16, 7, true, muted);
    text(page, String(h.threatScore) + "/100", margin + 285, y - 34, 9.5, true, ink);
    text(page, "SENTIMENT", margin + 395, y - 16, 7, true, muted);
    text(page, h.sentiment, margin + 395, y - 34, 9.5, true, ink);
    y -= 75;
    const fields: Array<[string, string]> = [
      ["Content label", h.contentLabel],
      ["Source", h.source],
      ["Author / account", h.author || "Not supplied"],
      ["Video ID", h.videoId || "Not supplied"],
      ["Channel ID", h.channelId || "Not supplied"],
      ["Channel URL", h.channelUrl || "Not supplied"],
      ["Published", safeDate(h.published)],
      ["Collected", safeDate(h.discoveredAt || input.generatedAt)],
      ["Views", h.viewsAvailable ? String(h.views ?? 0) : "Unavailable"],
      ["Likes", h.likesAvailable ? String(h.likes ?? 0) : "Unavailable"],
      ["Comments", h.commentsAvailable ? String(h.comments ?? 0) : "Unavailable"],
      [
        "Statistics captured at",
        h.statisticsCapturedAt ? safeDate(h.statisticsCapturedAt) : "Not captured",
      ],
      ["Statistics source", h.statisticsSource || "Not supplied"],
      ["Detection basis", h.detectionReason || "Entity and automated classification match"],
      ["Recommended action", h.recommendedAction],
      ["Record data SHA-256", evidenceHash],
    ];
    for (const [label, value] of fields) {
      text(page, label.toUpperCase(), margin, y, 7, true, muted);
      y -= 12;
      y = paragraph(page, value, margin, y, contentWidth, 9.2, ink, 13) - 7;
    }
    if (h.description && y > 155) {
      text(page, "PUBLIC DESCRIPTION / EXCERPT", margin, y, 7, true, muted);
      y -= 14;
      y = paragraph(page, h.description, margin, y, contentWidth, 9, ink, 13) - 8;
    }
    if (y < 160) {
      page = pdf.addPage(A4);
      header(page, "EVIDENCE RECORD " + id + " CONTINUED");
      y = 770;
    }
    text(page, "TRANSCRIPT", margin, y, 7, true, muted);
    y -= 14;
    y =
      paragraph(
        page,
        h.transcript || "TRANSCRIPT UNAVAILABLE - MANUAL REVIEW REQUIRED",
        margin,
        y,
        contentWidth,
        8.8,
        h.transcript ? ink : amber,
        12,
      ) - 8;
    text(page, "TRANSCRIPT SOURCE / CONFIDENCE", margin, y, 7, true, muted);
    y -= 14;
    y =
      paragraph(
        page,
        h.transcript
          ? `${h.transcriptSource || "Not supplied"} / ${h.transcriptConfidence == null ? "Not assessed" : `${h.transcriptConfidence}%`}`
          : "Unavailable",
        margin,
        y,
        contentWidth,
        8.8,
        ink,
        12,
      ) - 8;
    if (h.scoring) {
      if (y < 145) {
        page = pdf.addPage(A4);
        header(page, "EVIDENCE RECORD " + id + " CONTINUED");
        y = 770;
      }
      text(page, "SEPARATE ANALYTICAL SCORES", margin, y, 7, true, muted);
      y -= 14;
      y =
        paragraph(
          page,
          `Relevance ${h.scoring.relevance}/100 | Harm ${h.scoring.harm}/100 | Credibility ${h.scoring.credibility}/100 | Virality ${h.scoring.virality}/100 | Evidence completeness ${h.scoring.evidenceCompleteness}/100 | Legal actionability ${h.scoring.legalActionability}/100 | Overall priority ${h.scoring.overallPriority}/100`,
          margin,
          y,
          contentWidth,
          8.5,
          ink,
          12,
        ) - 5;
      y =
        paragraph(
          page,
          `Scoring version: ${h.scoring.version}. Scores are analytical inputs, not legal findings. High views do not independently increase the violation determination.`,
          margin,
          y,
          contentWidth,
          8.2,
          muted,
          12,
        ) - 8;
    }
    if (y < 100) {
      page = pdf.addPage(A4);
      header(page, "EVIDENCE RECORD " + id + " CONTINUED");
      y = 770;
    }
    text(page, "SOURCE URL", margin, y, 7, true, muted);
    y -= 14;
    const urlLines = wrap(h.url, 8, regular, contentWidth);
    for (const row of urlLines) {
      text(page, row, margin, y, 8, false, blue);
      addLink(
        pdf,
        page,
        h.url,
        margin,
        y - 2,
        Math.min(contentWidth, safeMeasure(row, 8, regular)),
        11,
      );
      y -= 12;
    }
    y -= 12;
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + contentWidth, y },
      thickness: 0.7,
      color: line,
    });
    y -= 18;
    paragraph(
      page,
      "Review note: This item was collected from a public source. Its presence in this report does not establish that allegations are true. Preserve original files, screenshots, timestamps, headers, and platform responses separately when available.",
      margin,
      y,
      contentWidth,
      8.5,
      muted,
      12,
    );

    // Separate visual-evidence page for this record.
    page = pdf.addPage(A4);
    header(page, "VISUAL EVIDENCE " + id);
    y = 770;

    text(page, "Visual Evidence Preview", margin, y, 20, true, navy);
    y -= 28;
    text(page, id + " · " + h.platform + " · " + h.severity, margin, y, 10, true, muted);
    y -= 22;

    const visual = await loadEvidenceImage(pdf, h.thumbnailUrl);

    if (visual) {
      const maxWidth = contentWidth;
      const maxHeight = 350;
      const scale = Math.min(maxWidth / visual.image.width, maxHeight / visual.image.height, 1);
      const imageWidth = visual.image.width * scale;
      const imageHeight = visual.image.height * scale;
      const imageX = margin + (contentWidth - imageWidth) / 2;

      page.drawRectangle({
        x: imageX - 4,
        y: y - imageHeight - 4,
        width: imageWidth + 8,
        height: imageHeight + 8,
        borderColor: line,
        borderWidth: 1,
        color: rgb(0.98, 0.98, 0.99),
      });

      page.drawImage(visual.image, {
        x: imageX,
        y: y - imageHeight,
        width: imageWidth,
        height: imageHeight,
      });

      y -= imageHeight + 28;
      text(page, "IMAGE SHA-256", margin, y, 7, true, muted);
      y -= 13;
      text(page, visual.hash, margin, y, 8, false, ink);
      y -= 24;
    } else {
      page.drawRectangle({
        x: margin,
        y: y - 120,
        width: contentWidth,
        height: 120,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: line,
        borderWidth: 1,
      });
      text(page, "Visual preview unavailable", margin + 18, y - 48, 13, true, muted);
      paragraph(
        page,
        "No trusted JPG/PNG thumbnail was available at report-generation time. Preserve a full-page screenshot separately before submission.",
        margin + 18,
        y - 70,
        contentWidth - 36,
        9,
        muted,
        13,
      );
      y -= 145;
    }

    text(page, "EVIDENCE TITLE", margin, y, 7, true, muted);
    y -= 14;
    y = paragraph(page, h.title, margin, y, contentWidth, 11, ink, 15) - 8;

    text(page, "SOURCE URL", margin, y, 7, true, muted);
    y -= 14;
    for (const row of wrap(h.url, 8, regular, contentWidth)) {
      text(page, row, margin, y, 8, false, blue);
      addLink(
        pdf,
        page,
        h.url,
        margin,
        y - 2,
        Math.min(contentWidth, safeMeasure(row, 8, regular)),
        11,
      );
      y -= 12;
    }

    y -= 12;
    paragraph(
      page,
      "Important: this visual is a platform thumbnail or preview and is not represented as a complete webpage screenshot. The original source must be opened, captured and preserved separately for evidentiary submission.",
      margin,
      y,
      contentWidth,
      8.5,
      muted,
      12,
    );

    // Human-review analysis page. Automated leads remain explicitly unverified.
    const review = h.review;
    page = pdf.addPage(A4);
    header(page, "POTENTIAL VIOLATION ANALYSIS " + id);
    y = 770;
    text(page, "Potential Violation Analysis", margin, y, 19, true, navy);
    y -= 24;
    text(page, "HUMAN REVIEW REQUIRED - NOT A FINDING OF FACT OR LAW", margin, y, 8.5, true, amber);
    y -= 24;
    const analysisFields: Array<[string, string]> = [
      ["Review status", review?.reviewStatus ?? "REVIEW_REQUIRED"],
      ["Content position", review?.contentPosition ?? "UNKNOWN"],
      ["Statement type", review?.statementType ?? "UNKNOWN"],
      [
        "Exact timestamp",
        review?.videoStartTimestamp == null
          ? "Not captured"
          : `${fmtTime(review.videoStartTimestamp)}${review.videoEndTimestamp == null ? "" : `-${fmtTime(review.videoEndTimestamp)}`}`,
      ],
      ["Speaker", review?.speakerIdentity || h.author || "Not verified"],
      [
        "Original statement",
        review?.exactOriginalStatement || "Not captured - manual transcript review required",
      ],
      ["Statement language", review?.statementLanguage || "Not verified"],
      ["Verified English translation", review?.verifiedEnglishTranslation || "Not provided"],
      ["Full context summary", review?.contentContext || "Not reviewed"],
      ["Potential category", review?.allegedViolationTypes?.join(", ") || "Insufficient evidence"],
      [
        "Assessment basis",
        review?.violationReason ||
          "The automated scan identified a relevant URL. Its title, thumbnail, keywords, popularity or sentiment do not independently establish a platform-policy or legal violation.",
      ],
      ["Supporting facts", review?.supportingFacts || "Not provided"],
      ["Falsity basis", review?.falsityBasis || "Not provided or not applicable"],
      [
        "Confidence",
        review?.confidenceScore == null ? "Not assessed" : `${review.confidenceScore}/100`,
      ],
      ["Reviewer conclusion", review?.reviewerNotes || "Human review pending"],
    ];
    for (const [label, value] of analysisFields) {
      if (y < 90) {
        page = pdf.addPage(A4);
        header(page, "POTENTIAL VIOLATION ANALYSIS " + id + " CONTINUED");
        y = 770;
      }
      text(page, label.toUpperCase(), margin, y, 7, true, muted);
      y -= 12;
      y = paragraph(page, value, margin, y, contentWidth, 8.8, ink, 12) - 6;
    }
    if (y < 165) {
      page = pdf.addPage(A4);
      header(page, "POTENTIAL VIOLATION ANALYSIS " + id + " CONTINUED");
      y = 770;
    }
    text(page, "LIMITATIONS / POSSIBLE DEFENCES", margin, y, 7, true, muted);
    y -= 14;
    y =
      paragraph(
        page,
        "Opinion, truth, public-interest reporting, criticism, news reporting, parody, quotation and fair dealing may affect actionability. Copyright action requires verified ownership or authorization and identification of copied protected expression.",
        margin,
        y,
        contentWidth,
        8.8,
        ink,
        12,
      ) - 10;
    text(page, "RECOMMENDED ROUTE", margin, y, 7, true, muted);
    y -= 14;
    paragraph(
      page,
      review?.recommendedAction ||
        "Preserve and monitor. Do not file a platform, police, legal or copyright complaint until a qualified reviewer completes the missing evidence and selects the appropriate ground.",
      margin,
      y,
      contentWidth,
      9,
      ink,
      13,
    );
  }

  // Consolidated human-review findings.
  page = pdf.addPage(A4);
  header(page, "VERIFIED FINDINGS SUMMARY");
  y = 770;
  text(page, "Verified Findings Summary", margin, y, 19, true, navy);
  y -= 28;
  paragraph(
    page,
    "Only human-reviewed conclusions appear as reviewed. Automated leads and incomplete items remain pending or insufficient.",
    margin,
    y,
    contentWidth,
    9,
    muted,
    13,
  );
  y -= 34;
  for (let i = 0; i < hits.length; i++) {
    if (y < 78) {
      page = pdf.addPage(A4);
      header(page, "VERIFIED FINDINGS SUMMARY CONTINUED");
      y = 770;
    }
    const h = hits[i],
      r = h.review,
      id = "EV-" + String(i + 1).padStart(3, "0");
    page.drawRectangle({
      x: margin,
      y: y - 45,
      width: contentWidth,
      height: 51,
      color: i % 2 ? rgb(0.98, 0.985, 1) : rgb(0.95, 0.97, 1),
    });
    text(page, id, margin + 8, y - 12, 8.5, true, blue);
    text(page, r?.reviewStatus ?? "REVIEW_REQUIRED", margin + 58, y - 12, 7.5, true, muted);
    text(page, r?.contentPosition ?? "UNKNOWN", margin + 250, y - 12, 7.5, false, ink);
    text(
      page,
      r?.videoStartTimestamp == null ? "No timestamp" : fmtTime(r.videoStartTimestamp),
      margin + 345,
      y - 12,
      7.5,
      false,
      ink,
    );
    text(
      page,
      r?.confidenceScore == null ? "No confidence" : `${r.confidenceScore}/100`,
      margin + 420,
      y - 12,
      7.5,
      false,
      ink,
    );
    const route = r?.recommendedAction || "Human review required";
    text(page, wrap(route, 7.5, regular, 420)[0] ?? route, margin + 58, y - 31, 7.5, false, ink);
    y -= 54;
  }

  page = pdf.addPage(A4);
  header(page, "POLICY AND LEGAL GROUNDS");
  y = 770;
  text(page, "Possible Policy and Legal Grounds", margin, y, 19, true, navy);
  y -= 30;
  const reviewed = hits.filter(
    (h) => h.review && !["AUTOMATED_LEAD", "REVIEW_REQUIRED"].includes(h.review.reviewStatus),
  );
  if (!reviewed.length)
    y = paragraph(
      page,
      "No item has a completed human review. No policy or legal ground is asserted in this preliminary report.",
      margin,
      y,
      contentWidth,
      10,
      ink,
      14,
    );
  for (const h of reviewed) {
    if (y < 150) {
      page = pdf.addPage(A4);
      header(page, "POLICY AND LEGAL GROUNDS CONTINUED");
      y = 770;
    }
    text(
      page,
      h.review!.allegedViolationTypes.join(", ") || "No apparent violation",
      margin,
      y,
      10,
      true,
      navy,
    );
    y -= 16;
    y =
      paragraph(
        page,
        `Observed conduct: ${h.review!.contentContext || "Not documented"}`,
        margin + 8,
        y,
        contentWidth - 8,
        8.8,
        ink,
        12,
      ) - 4;
    y =
      paragraph(
        page,
        `Assessment: ${h.review!.violationReason || "No ground documented"}`,
        margin + 8,
        y,
        contentWidth - 8,
        8.8,
        ink,
        12,
      ) - 4;
    y =
      paragraph(
        page,
        "Limitations: truth, opinion, public interest, reporting, criticism, parody and fair dealing may apply. Legal review may be required.",
        margin + 8,
        y,
        contentWidth - 8,
        8.5,
        muted,
        12,
      ) - 10;
  }

  page = pdf.addPage(A4);
  header(page, "NON-VIOLATING OR INSUFFICIENT ITEMS");
  y = 770;
  text(page, "Non-Violating or Insufficient Items", margin, y, 19, true, navy);
  y -= 30;
  const insufficient = hits.filter(
    (h) =>
      !h.review ||
      h.review.reviewStatus === "REVIEW_REQUIRED" ||
      h.review.reviewStatus === "AUTOMATED_LEAD" ||
      h.review.reviewStatus === "REVIEWED_NO_VIOLATION" ||
      ["SUPPORTIVE", "NEUTRAL"].includes(h.review.contentPosition),
  );
  for (const h of insufficient) {
    if (y < 72) {
      page = pdf.addPage(A4);
      header(page, "NON-VIOLATING OR INSUFFICIENT ITEMS CONTINUED");
      y = 770;
    }
    y =
      paragraph(
        page,
        `- ${h.title}: ${h.review?.reviewStatus ?? "REVIEW_REQUIRED"}; ${h.review?.contentPosition ?? "UNKNOWN"}.`,
        margin,
        y,
        contentWidth,
        8.8,
        ink,
        12,
      ) - 4;
  }

  page = pdf.addPage(A4);
  header(page, "EVIDENCE GAPS");
  y = 770;
  text(page, "Evidence Gaps", margin, y, 19, true, navy);
  y -= 30;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const gaps = verifiedExportReadiness(h.review, {
      transcriptPreserved: Boolean(h.transcript),
      translationRequired: h.evidence?.translationRequired,
      translationVerified: h.evidence?.translationVerified,
      fullPageScreenshotPreserved: h.evidence?.fullPageScreenshotPreserved,
      originalMediaPreserved: h.evidence?.originalMediaPreserved,
      hashesGenerated: h.evidence?.hashesGenerated,
      chainOfCustodyCreated: h.evidence?.chainOfCustodyCreated,
      channelIdentifiersPreserved: h.evidence?.channelIdentifiersPreserved,
      ownershipProofPreserved: h.evidence?.ownershipProofPreserved,
    }).missing;
    if (y < 100) {
      page = pdf.addPage(A4);
      header(page, "EVIDENCE GAPS CONTINUED");
      y = 770;
    }
    text(page, `EV-${String(i + 1).padStart(3, "0")}`, margin, y, 9, true, blue);
    y -= 14;
    y =
      paragraph(
        page,
        gaps.length ? gaps.join("; ") : "No readiness gaps detected",
        margin + 8,
        y,
        contentWidth - 8,
        8.5,
        ink,
        12,
      ) - 8;
  }

  page = pdf.addPage(A4);
  header(page, "INCIDENT AND VICTIM IMPACT STATEMENT");
  y = 770;
  text(page, "Incident and Victim Impact Statement", margin, y, 19, true, navy);
  y -= 32;
  for (const label of [
    "Complainant's full name",
    "Relationship to target",
    "First date discovered",
    "Repeated conduct",
    "Safety concerns",
    "Reputational impact",
    "Financial / professional impact",
    "Emotional impact",
    "Prior contact with uploader",
    "Prior platform complaints",
    "Requested remedy",
    "Declaration and signature",
  ]) {
    if (y < 70) {
      page = pdf.addPage(A4);
      header(page, "INCIDENT AND VICTIM IMPACT STATEMENT CONTINUED");
      y = 770;
    }
    text(page, label, margin, y, 8.5, true, ink);
    page.drawLine({
      start: { x: 220, y: y - 2 },
      end: { x: 540, y: y - 2 },
      thickness: 0.6,
      color: line,
    });
    y -= 38;
  }

  page = pdf.addPage(A4);
  header(page, "CHAIN OF CUSTODY");
  y = 770;
  text(page, "Chain of Custody", margin, y, 19, true, navy);
  y -= 30;
  paragraph(
    page,
    "No custody event is inferred. Populate this section from append-only custody records accompanying the verified evidence package.",
    margin,
    y,
    contentWidth,
    9,
    muted,
    13,
  );
  y -= 44;
  for (const label of [
    "Event number",
    "Evidence ID",
    "Date/time UTC",
    "Person / system",
    "Action",
    "Source and destination",
    "Hash before",
    "Hash after",
    "Signature / log reference",
  ]) {
    text(page, label, margin, y, 8.5, true, ink);
    page.drawLine({
      start: { x: 220, y: y - 2 },
      end: { x: 540, y: y - 2 },
      thickness: 0.6,
      color: line,
    });
    y -= 36;
  }

  // Submission and methodology
  page = pdf.addPage(A4);
  header(page, "SUBMISSION & METHODOLOGY");
  y = 770;
  text(page, "Submission Record", margin, y, 20, true, navy);
  y -= 34;
  for (const label of [
    "Submitting person / organization",
    "Authorization basis",
    "Receiving authority / platform",
    "Case or complaint reference",
    "Receiving officer / team",
    "Submission date / time",
    "Submitted files",
    "Manifest hash",
    "Signature",
  ]) {
    text(page, label, margin, y, 9, true, ink);
    page.drawLine({
      start: { x: 230, y: y - 2 },
      end: { x: 540, y: y - 2 },
      thickness: 0.6,
      color: line,
    });
    y -= 31;
  }
  text(page, "Methodology and limitations", margin, y, 13, true, navy);
  y -= 20;
  y =
    paragraph(
      page,
      "This report organizes public-source search results supplied by the Eterna scanning system. Automated rules estimate category, severity, sentiment, credibility and reach. Results can be incomplete, duplicated, outdated, removed, edited, mistranslated or incorrectly classified. Human review is required before reporting, publication, legal action or law-enforcement submission.",
      margin,
      y,
      contentWidth,
      9.2,
      ink,
      14,
    ) - 10;
  y =
    paragraph(
      page,
      "This PDF is an index and analytical report, not a substitute for original electronic evidence. Preserve native files, screenshots, metadata, hashes, timestamps, correspondence and access logs in their original form. Evidentiary and admissibility requirements vary by jurisdiction and receiving platform.",
      margin,
      y,
      contentWidth,
      9.2,
      ink,
      14,
    ) - 16;
  text(page, "RECORD MANIFEST SHA-256", margin, y, 8, true, muted);
  y -= 14;
  paragraph(page, sha(hits), margin, y, contentWidth, 8, ink, 12);
  y -= 10;
  paragraph(
    page,
    "This hash covers the canonical report input records, not the final PDF bytes or original media. The final PDF SHA-256 is calculated after generation and returned alongside the exported file.",
    margin,
    y,
    contentWidth,
    8.2,
    muted,
    12,
  );

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    if (index === 0) return;
    p.drawLine({
      start: { x: margin, y: 34 },
      end: { x: 549, y: 34 },
      thickness: 0.5,
      color: line,
    });
    text(p, reportId, margin, 20, 7, false, muted);
    text(p, "Page " + (index + 1) + " of " + pages.length, 485, 20, 7, false, muted);
  });
  const bytes = await pdf.save();
  return { bytes, reportId, hash: createHash("sha256").update(bytes).digest("hex") };
}
