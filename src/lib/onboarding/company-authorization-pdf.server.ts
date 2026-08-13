/**
 * Server-only PDF renderer for the generated company authorization package.
 *
 * Presentation only — every value comes from the pure
 * `company-authorization-letter` document built from the authenticated
 * company's onboarding record. No internal identifiers (database IDs, storage
 * keys, face IDs, credentials, engine internals) are rendered.
 */
import type {
  CompanyLetterDocument,
  CompanyLetterField,
  CompanyLetterSection,
} from "./company-authorization-letter";

export type CompanyAuthorizationSignature = {
  legal_name: string;
  title: string;
  company_name: string;
  work_email?: string | null;
  signed_at: string;
  letter_sha256: string;
  signature_sha256?: string | null;
};

const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 56;
const CONTENT = WIDTH - MARGIN * 2;
const BOTTOM = 84;

export async function renderCompanyAuthorizationPdf(
  letter: CompanyLetterDocument,
  signature?: CompanyAuthorizationSignature | null,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");

  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);

  const ink = rgb(0.09, 0.11, 0.16);
  const navy = rgb(0.04, 0.11, 0.32);
  const accent = rgb(0.11, 0.42, 0.86);
  const muted = rgb(0.42, 0.46, 0.54);
  const hairline = rgb(0.82, 0.85, 0.9);
  const band = rgb(0.95, 0.97, 1);

  let page = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT;
  let pageNumber = 0;
  let sectionTitle = "";

  const measure = (text: string, size: number, bold = false) => {
    try {
      return (bold ? stack.bold[0] : stack.regular[0]).widthOfTextAtSize(text, size);
    } catch {
      return text.length * size * 0.5;
    }
  };

  const write = (
    text: string,
    opts: { x: number; y: number; size: number; bold?: boolean; color?: unknown },
  ) =>
    drawUnicodeText(page, text, {
      x: opts.x,
      y: opts.y,
      size: opts.size,
      stack: opts.bold ? stack.bold : stack.regular,
      color: (opts.color as never) ?? ink,
    });

  const wrap = (text: string, size: number, width: number, bold = false) => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(next, size, bold) > width) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const drawChrome = () => {
    // Header band
    page.drawRectangle({ x: 0, y: HEIGHT - 66, width: WIDTH, height: 66, color: band });
    page.drawRectangle({ x: 0, y: HEIGHT - 68, width: WIDTH, height: 2, color: accent });
    write(letter.provider.toUpperCase(), {
      x: MARGIN,
      y: HEIGHT - 30,
      size: 9,
      bold: true,
      color: navy,
    });
    write(letter.title, { x: MARGIN, y: HEIGHT - 45, size: 8, color: muted });
    const ref = `REF ${letter.reference_id}`;
    write(ref, {
      x: WIDTH - MARGIN - measure(ref, 8, true),
      y: HEIGHT - 30,
      size: 8,
      bold: true,
      color: navy,
    });
    const meta = `${letter.version} · ${letter.generated_date}`;
    write(meta, { x: WIDTH - MARGIN - measure(meta, 7.5), y: HEIGHT - 45, size: 7.5, color: muted });

    // Footer
    page.drawLine({
      start: { x: MARGIN, y: 62 },
      end: { x: WIDTH - MARGIN, y: 62 },
      thickness: 0.5,
      color: hairline,
    });
    for (const [index, textLine] of wrap(letter.confidentiality, 7, CONTENT - 70).entries()) {
      write(textLine, { x: MARGIN, y: 48 - index * 9, size: 7, color: muted });
    }
    const num = `Page ${pageNumber}`;
    write(num, { x: WIDTH - MARGIN - measure(num, 7.5, true), y: 48, size: 7.5, color: muted });
  };

  const newPage = (title: string) => {
    // The first page was created up-front; reuse it instead of leaving it blank.
    if (pageNumber > 0) page = doc.addPage([WIDTH, HEIGHT]);
    pageNumber += 1;
    sectionTitle = title;
    drawChrome();
    y = HEIGHT - 96;
    if (title) {
      write(title.toUpperCase(), { x: MARGIN, y, size: 12, bold: true, color: navy });
      y -= 8;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: WIDTH - MARGIN, y },
        thickness: 1,
        color: accent,
      });
      y -= 20;
    }
  };

  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage(`${sectionTitle} (continued)`);
  };

  const paragraph = (text: string, size = 9.5, color: unknown = ink) => {
    for (const textLine of wrap(text, size, CONTENT)) {
      ensure(size + 5);
      write(textLine, { x: MARGIN, y, size, color });
      y -= size + 5;
    }
    y -= 7;
  };

  const subheading = (text: string) => {
    ensure(26);
    y -= 2;
    write(text, { x: MARGIN, y, size: 9.5, bold: true, color: navy });
    y -= 16;
  };

  const bullets = (items: string[]) => {
    for (const item of items) {
      const lines = wrap(item, 9, CONTENT - 16);
      ensure(lines.length * 14);
      page.drawCircle({ x: MARGIN + 3, y: y + 3.2, size: 1.6, color: accent });
      for (const [index, textLine] of lines.entries()) {
        write(textLine, { x: MARGIN + 14, y: y - index * 13, size: 9 });
      }
      y -= lines.length * 13 + 4;
    }
    y -= 4;
  };

  const fieldsBlock = (fields: CompanyLetterField[]) => {
    const labelWidth = 168;
    for (const field of fields) {
      const lines = wrap(field.value, 9, CONTENT - labelWidth - 8, true);
      const height = Math.max(16, lines.length * 12 + 5);
      ensure(height);
      page.drawRectangle({
        x: MARGIN,
        y: y - height + 12,
        width: CONTENT,
        height,
        color: band,
        opacity: 0.7,
      });
      write(field.label, { x: MARGIN + 8, y, size: 8.5, color: muted });
      for (const [index, textLine] of lines.entries()) {
        write(textLine, {
          x: MARGIN + labelWidth,
          y: y - index * 12,
          size: 9,
          bold: true,
        });
      }
      y -= height + 3;
    }
    y -= 6;
  };

  const table = (columns: string[], rows: string[][]) => {
    const widths =
      columns.length === 3 ? [130, CONTENT - 130 - 110, 110] : columns.map(() => CONTENT / columns.length);
    const header = () => {
      ensure(24);
      page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT, height: 20, color: navy });
      let x = MARGIN + 8;
      for (const [index, column] of columns.entries()) {
        write(column, { x, y, size: 8, bold: true, color: rgb(1, 1, 1) });
        x += widths[index] ?? 0;
      }
      y -= 26;
    };
    header();
    for (const [rowIndex, row] of rows.entries()) {
      const cellLines = row.map((cell, index) => wrap(cell, 8.5, (widths[index] ?? CONTENT) - 12));
      const lineCount = Math.max(...cellLines.map((lines) => lines.length), 1);
      const height = lineCount * 12 + 6;
      if (y - height < BOTTOM) {
        newPage(`${sectionTitle} (continued)`);
        header();
      }
      if (rowIndex % 2 === 0) {
        page.drawRectangle({
          x: MARGIN,
          y: y - height + 12,
          width: CONTENT,
          height,
          color: band,
          opacity: 0.6,
        });
      }
      let x = MARGIN + 8;
      for (const [index, lines] of cellLines.entries()) {
        for (const [lineIndex, textLine] of lines.entries()) {
          write(textLine, { x, y: y - lineIndex * 12, size: 8.5 });
        }
        x += widths[index] ?? 0;
      }
      y -= height;
      page.drawLine({
        start: { x: MARGIN, y: y + 10 },
        end: { x: WIDTH - MARGIN, y: y + 10 },
        thickness: 0.4,
        color: hairline,
      });
    }
    y -= 12;
  };

  const callout = (text: string) => {
    const lines = wrap(text, 8.8, CONTENT - 26);
    const height = lines.length * 12 + 14;
    ensure(height + 6);
    page.drawRectangle({
      x: MARGIN,
      y: y - height + 14,
      width: CONTENT,
      height,
      color: rgb(1, 0.97, 0.9),
    });
    page.drawRectangle({
      x: MARGIN,
      y: y - height + 14,
      width: 3,
      height,
      color: rgb(0.85, 0.55, 0.1),
    });
    for (const [index, textLine] of lines.entries()) {
      write(textLine, { x: MARGIN + 14, y: y - index * 12, size: 8.8, color: rgb(0.3, 0.2, 0.02) });
    }
    y -= height + 8;
  };

  const renderSection = (section: CompanyLetterSection) => {
    newPage(section.title);
    for (const block of section.blocks) {
      if (block.kind === "paragraph") paragraph(block.text);
      else if (block.kind === "bullets") bullets(block.items);
      else if (block.kind === "fields") fieldsBlock(block.fields);
      else if (block.kind === "table") table(block.columns, block.rows);
      else if (block.kind === "callout") callout(block.text);
      else if (block.kind === "subheading") subheading(block.text);
    }
  };

  // Cover-style title on page 1 above the first section.
  renderSection(letter.sections[0]!);
  for (const section of letter.sections.slice(1, -1)) renderSection(section);

  // Final page: signature & audit record.
  const last = letter.sections[letter.sections.length - 1]!;
  renderSection(last);

  const auditFields: CompanyLetterField[] = signature
    ? [
        { label: "Representative legal name", value: signature.legal_name },
        { label: "Title / role", value: signature.title },
        { label: "Company", value: signature.company_name },
        ...(signature.work_email
          ? [{ label: "Work email", value: signature.work_email }]
          : []),
        { label: "Signature", value: `/s/ ${signature.legal_name}` },
        { label: "Signed date / time (UTC)", value: signature.signed_at },
        { label: "Authorization reference", value: letter.reference_id },
        { label: "Document version", value: letter.version },
        { label: "Document hash (SHA-256)", value: signature.letter_sha256 },
        ...(signature.signature_sha256
          ? [{ label: "Signature hash (SHA-256)", value: signature.signature_sha256 }]
          : []),
      ]
    : [
        { label: "Representative legal name", value: "—" },
        { label: "Title / role", value: "—" },
        { label: "Company", value: "—" },
        { label: "Signature", value: "Not yet signed — review copy" },
        { label: "Authorization reference", value: letter.reference_id },
        { label: "Document version", value: letter.version },
      ];

  subheading(signature ? "Signature & audit record" : "Signature block (unsigned review copy)");
  fieldsBlock(auditFields);
  if (signature) {
    paragraph(
      "Accepted electronically. The document version and hash above identify the exact authorization accepted at the time shown, and the stored copy can be reproduced on request.",
      8.5,
      muted,
    );
  } else {
    callout(
      "This is an unsigned review copy. Explicit consent must be given in the workspace before the authorization is signed and finalized.",
    );
  }

  return await doc.save();
}
