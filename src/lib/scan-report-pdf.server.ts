import "regenerator-runtime/runtime.js";
import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { createHash } from "crypto";
import { embedUnicodeFontStack, drawUnicodeText, measureUnicodeText } from "@/lib/pdf/unicode-fonts.server";

export interface ScanReportInput {
  subject: string;
  period: string;
  generatedAt: string;
  reputationScore: number;
  reputationLevel: string;
  headline: string;
  totals: { unique: number; critical: number; high: number; negative: number; viral: number; totalReach: number };
  sources: string[];
  immediateActions: string[];
  longTerm: string[];
  hits: Array<{
    title: string; url: string; description?: string | null; platform: string; source: string;
    author?: string | null; published?: string | null; category: string; contentLabel: string;
    severity: string; sentiment: string; threatScore: number; credibilityScore: number;
    reachEstimate: number; engagement: number; detectionReason?: string | null;
    recommendedAction: string; discoveredAt?: string | null;
  }>;
}

const A4: [number, number] = [595.28, 841.89];
const navy = rgb(0.035, 0.075, 0.15);
const blue = rgb(0.08, 0.36, 0.86);
const ink = rgb(0.08, 0.10, 0.16);
const muted = rgb(0.40, 0.44, 0.52);
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
function wrap(text: string, size: number, fonts: PDFFont[], width: number): string[] {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = []; let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (measureUnicodeText(candidate, size, fonts) <= width) current = candidate;
    else { if (current) out.push(current); current = word; }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}
function addLink(pdf: PDFDocument, page: PDFPage, url: string, x: number, y: number, width: number, height: number) {
  try {
    const annot = pdf.context.register(pdf.context.obj({
      Type: PDFName.of("Annot"), Subtype: PDFName.of("Link"), Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0], A: { Type: PDFName.of("Action"), S: PDFName.of("URI"), URI: PDFString.of(url) },
    }));
    page.node.addAnnot(annot);
  } catch { /* printed URL remains usable */ }
}

export async function buildScanReportPdf(input: ScanReportInput): Promise<{ bytes: Uint8Array; reportId: string; hash: string }> {
  const pdf = await PDFDocument.create();
  const reportId = "ETR-" + new Date(input.generatedAt).getUTCFullYear() + "-" + sha([input.subject, input.generatedAt]).slice(0, 10).toUpperCase();
  pdf.setTitle("Eterna Evidence and Incident Report - " + input.subject);
  pdf.setAuthor("Eterna AI"); pdf.setCreator("Eterna AI Evidence System"); pdf.setProducer("Eterna AI");
  pdf.setSubject("Public-source evidence and incident report " + reportId);
  const stack = await embedUnicodeFontStack(pdf);
  const regular = stack.regular, bold = stack.bold;
  const margin = 46, contentWidth = A4[0] - margin * 2;

  const text = (page: PDFPage, value: string, x: number, y: number, size = 10, isBold = false, color = ink) =>
    drawUnicodeText(page, value, { x, y, size, stack: isBold ? bold : regular, color });
  const paragraph = (page: PDFPage, value: string, x: number, y: number, width: number, size = 9.5, color = ink, leading = 13) => {
    for (const row of wrap(value, size, regular, width)) { text(page, row, x, y, size, false, color); y -= leading; }
    return y;
  };
  const header = (page: PDFPage, section: string) => {
    page.drawRectangle({ x: 0, y: 807, width: A4[0], height: 35, color: navy });
    text(page, "ETERNA AI", margin, 819, 11, true, rgb(1,1,1));
    text(page, section, 330, 819, 8, false, rgb(0.75,0.82,0.95));
  };

  // Cover
  let page = pdf.addPage(A4);
  page.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: navy });
  page.drawRectangle({ x: 0, y: 0, width: 14, height: A4[1], color: blue });
  text(page, "ETERNA AI", 54, 760, 15, true, rgb(0.52,0.72,1));
  text(page, "EVIDENCE & INCIDENT", 54, 650, 28, true, rgb(1,1,1));
  text(page, "REPORT", 54, 612, 28, true, rgb(1,1,1));
  let cy = 555;
  cy = paragraph(page, input.subject, 54, cy, 480, 19, rgb(0.84,0.90,1), 25);
  page.drawLine({ start: { x:54,y:cy-8 }, end:{x:535,y:cy-8}, thickness:1, color:rgb(0.22,0.38,0.62) });
  text(page, "Report ID", 54, cy-42, 9, true, rgb(0.52,0.65,0.82)); text(page, reportId, 170, cy-42, 10, true, rgb(1,1,1));
  text(page, "Scan period", 54, cy-65, 9, true, rgb(0.52,0.65,0.82)); text(page, input.period, 170, cy-65, 10, false, rgb(1,1,1));
  text(page, "Generated", 54, cy-88, 9, true, rgb(0.52,0.65,0.82)); text(page, safeDate(input.generatedAt), 170, cy-88, 10, false, rgb(1,1,1));
  text(page, "Classification", 54, cy-111, 9, true, rgb(0.52,0.65,0.82)); text(page, "CONFIDENTIAL - AUTHORIZED RECIPIENTS", 170, cy-111, 10, true, rgb(1,0.74,0.30));
  text(page, "PUBLIC-SOURCE INTELLIGENCE", 54, 105, 9, true, rgb(0.52,0.65,0.82));
  paragraph(page, "Prepared for review by authorized representatives, platform safety teams, legal advisers, or law-enforcement personnel. Automated classifications are investigative leads and not findings of fact.", 54, 80, 480, 8.5, rgb(0.72,0.78,0.88), 12);

  // Executive summary
  page = pdf.addPage(A4); header(page, "EXECUTIVE SUMMARY");
  text(page, "Executive Incident Summary", margin, 770, 20, true, navy);
  let y = paragraph(page, input.headline, margin, 738, contentWidth, 11, ink, 16) - 10;
  const cards = [
    ["Risk score", input.reputationScore + "/100"], ["Assessment", input.reputationLevel],
    ["Evidence items", String(input.totals.unique)], ["Critical / High", input.totals.critical + " / " + input.totals.high],
  ];
  cards.forEach(([label,value], i) => { const x=margin+(i%2)*250, yy=y-Math.floor(i/2)*66; page.drawRectangle({x,y:yy-46,width:235,height:54,color:rgb(.95,.97,1),borderColor:line,borderWidth:1}); text(page,label.toUpperCase(),x+12,yy-15,7.5,true,muted); text(page,value,x+12,yy-36,15,true,navy); });
  y -= 145;
  text(page, "Immediate actions", margin, y, 12, true, navy); y -= 18;
  for (const action of input.immediateActions) y = paragraph(page, "- " + action, margin+8, y, contentWidth-8, 9.5, ink, 13) - 3;
  y -= 7; text(page, "Recommended monitoring and response", margin, y, 12, true, navy); y -= 18;
  for (const action of input.longTerm) y = paragraph(page, "- " + action, margin+8, y, contentWidth-8, 9.5, ink, 13) - 3;
  y -= 10; text(page, "Sources covered", margin, y, 11, true, navy); y -= 16;
  paragraph(page, input.sources.join(", ") || "No source list supplied", margin, y, contentWidth, 9, muted, 13);

  // Evidence index
  const severityRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const hits = input.hits.slice().sort((a,b) => (severityRank[a.severity] ?? 9)-(severityRank[b.severity] ?? 9) || b.threatScore-a.threatScore);
  page = pdf.addPage(A4); header(page, "EVIDENCE INDEX"); y=770;
  text(page, "Evidence Index", margin, y, 20, true, navy); y-=28;
  for (let i=0;i<hits.length;i++) {
    if (y<70) { page=pdf.addPage(A4); header(page,"EVIDENCE INDEX"); y=770; }
    const h=hits[i], id="EV-"+String(i+1).padStart(3,"0");
    page.drawRectangle({x:margin,y:y-36,width:contentWidth,height:42,color:i%2?rgb(.98,.985,1):rgb(.95,.97,1)});
    text(page,id,margin+8,y-15,9,true,blue); text(page,h.severity,margin+62,y-15,8.5,true,h.severity==="Critical"?red:h.severity==="High"?amber:muted);
    text(page,h.platform,margin+125,y-15,8.5,false,muted);
    const title=wrap(h.title,8.5,regular,300)[0] ?? ""; text(page,title,margin+205,y-15,8.5,true,ink);
    text(page,"Score "+h.threatScore,margin+430,y-15,8,false,muted); text(page,safeDate(h.published).slice(0,10),margin+62,y-29,7.5,false,muted);
    y-=44;
  }

  // One complete record for every item
  for (let i=0;i<hits.length;i++) {
    const h=hits[i], id="EV-"+String(i+1).padStart(3,"0"), evidenceHash=sha(h);
    page=pdf.addPage(A4); header(page,"EVIDENCE RECORD "+id); y=770;
    text(page,id+" - "+h.severity.toUpperCase(),margin,y,11,true,h.severity==="Critical"?red:h.severity==="High"?amber:blue);
    y-=28; y=paragraph(page,h.title,margin,y,contentWidth,16,navy,21)-6;
    page.drawRectangle({x:margin,y:y-54,width:contentWidth,height:58,color:rgb(.95,.97,1),borderColor:line,borderWidth:1});
    text(page,"CATEGORY",margin+10,y-16,7,true,muted); text(page,h.category,margin+10,y-34,9.5,true,ink);
    text(page,"PLATFORM",margin+150,y-16,7,true,muted); text(page,h.platform,margin+150,y-34,9.5,true,ink);
    text(page,"THREAT",margin+285,y-16,7,true,muted); text(page,String(h.threatScore)+"/100",margin+285,y-34,9.5,true,ink);
    text(page,"SENTIMENT",margin+395,y-16,7,true,muted); text(page,h.sentiment,margin+395,y-34,9.5,true,ink); y-=75;
    const fields: Array<[string,string]> = [
      ["Content label",h.contentLabel],["Source",h.source],["Author / account",h.author || "Not supplied"],
      ["Published",safeDate(h.published)],["Collected",safeDate(h.discoveredAt || input.generatedAt)],
      ["Reach / engagement",h.reachEstimate+" / "+h.engagement],["Detection basis",h.detectionReason || "Entity and classification match"],
      ["Recommended action",h.recommendedAction],["Evidence SHA-256",evidenceHash],
    ];
    for (const [label,value] of fields) { text(page,label.toUpperCase(),margin,y,7,true,muted); y-=12; y=paragraph(page,value,margin,y,contentWidth,9.2,ink,13)-7; }
    if (h.description && y>155) { text(page,"PUBLIC DESCRIPTION / EXCERPT",margin,y,7,true,muted); y-=14; y=paragraph(page,h.description,margin,y,contentWidth,9,ink,13)-8; }
    if (y<100) { page=pdf.addPage(A4); header(page,"EVIDENCE RECORD "+id+" CONTINUED"); y=770; }
    text(page,"SOURCE URL",margin,y,7,true,muted); y-=14;
    const urlLines=wrap(h.url,8,regular,contentWidth); for(const row of urlLines){ text(page,row,margin,y,8,false,blue); addLink(pdf,page,h.url,margin,y-2,Math.min(contentWidth,measureUnicodeText(row,8,regular)),11); y-=12; }
    y-=12; page.drawLine({start:{x:margin,y},end:{x:margin+contentWidth,y},thickness:.7,color:line}); y-=18;
    paragraph(page,"Review note: This item was collected from a public source. Its presence in this report does not establish that allegations are true. Preserve original files, screenshots, timestamps, headers, and platform responses separately when available.",margin,y,contentWidth,8.5,muted,12);
  }

  // Submission and methodology
  page=pdf.addPage(A4); header(page,"SUBMISSION & METHODOLOGY"); y=770;
  text(page,"Submission Record",margin,y,20,true,navy); y-=34;
  for(const label of ["Submitting person / organization","Police station / platform","Case or complaint reference","Receiving officer / team","Submission date","Signature"]){ text(page,label,margin,y,9,true,ink); page.drawLine({start:{x:230,y:y-2},end:{x:540,y:y-2},thickness:.6,color:line}); y-=34; }
  text(page,"Methodology and limitations",margin,y,13,true,navy); y-=20;
  y=paragraph(page,"This report organizes public-source search results supplied by the Eterna scanning system. Automated rules estimate category, severity, sentiment, credibility and reach. Results can be incomplete, duplicated, outdated, removed, edited, mistranslated or incorrectly classified. Human review is required before reporting, publication, legal action or law-enforcement submission.",margin,y,contentWidth,9.2,ink,14)-10;
  y=paragraph(page,"This PDF is an index and analytical report, not a substitute for original electronic evidence. Preserve native files, screenshots, metadata, hashes, timestamps, correspondence and access logs in their original form. Evidentiary and admissibility requirements vary by jurisdiction and receiving platform.",margin,y,contentWidth,9.2,ink,14)-16;
  text(page,"Manifest SHA-256",margin,y,8,true,muted); y-=14; paragraph(page,sha(hits),margin,y,contentWidth,8,ink,12);

  const pages=pdf.getPages();
  pages.forEach((p,index)=>{ if(index===0)return; p.drawLine({start:{x:margin,y:34},end:{x:549,y:34},thickness:.5,color:line}); text(p,reportId,margin,20,7,false,muted); text(p,"Page "+(index+1)+" of "+pages.length,485,20,7,false,muted); });
  const bytes=await pdf.save();
  return { bytes, reportId, hash: createHash("sha256").update(bytes).digest("hex") };
}