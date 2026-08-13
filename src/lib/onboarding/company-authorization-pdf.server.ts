/**
 * Server-only PDF renderer for the generated company authorization letter.
 * Wording lives in the pure `company-authorization-letter` module.
 */
import type { CompanyLetterDocument } from "./company-authorization-letter";

export async function renderCompanyAuthorizationPdf(
  letter: CompanyLetterDocument,
  signature?: {
    legal_name: string;
    title: string;
    company_name: string;
    signed_at: string;
    letter_sha256: string;
  } | null,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");

  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);
  const ink = rgb(0.09, 0.11, 0.16);
  const navy = rgb(0.04, 0.11, 0.32);
  const muted = rgb(0.38, 0.42, 0.5);

  const MARGIN = 56;
  const WIDTH = 612;
  const CONTENT = WIDTH - MARGIN * 2;

  let page = doc.addPage([WIDTH, 792]);
  let y = 792 - MARGIN;

  const measure = (t: string, size: number, bold = false) => {
    try {
      return (bold ? stack.bold[0] : stack.regular[0]).widthOfTextAtSize(t, size);
    } catch {
      return t.length * size * 0.5;
    }
  };

  const footer = `${letter.provider} — ${letter.version}`;
  const drawFooter = () =>
    drawUnicodeText(page, footer, { x: MARGIN, y: 38, size: 7.5, stack: stack.regular, color: muted });

  const ensure = (needed: number) => {
    if (y - needed < 70) {
      drawFooter();
      page = doc.addPage([WIDTH, 792]);
      y = 792 - MARGIN;
    }
  };

  const line = (t: string, o: { size?: number; bold?: boolean; color?: unknown } = {}) => {
    const size = o.size ?? 9.5;
    ensure(size + 6);
    drawUnicodeText(page, t, {
      x: MARGIN,
      y,
      size,
      stack: o.bold ? stack.bold : stack.regular,
      color: (o.color as never) ?? ink,
    });
    y -= size + 6;
  };

  const paragraph = (t: string, size = 9.5) => {
    const words = t.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (measure(next, size) > CONTENT) {
        line(current, { size });
        current = word;
      } else {
        current = next;
      }
    }
    if (current) line(current, { size });
    y -= 6;
  };

  line(letter.provider.toUpperCase(), { size: 11, bold: true, color: navy });
  y -= 4;
  line(letter.title, { size: 14, bold: true, color: navy });
  y -= 8;

  for (const field of letter.fields) {
    ensure(16);
    drawUnicodeText(page, field.label, {
      x: MARGIN,
      y,
      size: 8.5,
      stack: stack.regular,
      color: muted,
    });
    drawUnicodeText(page, field.value, {
      x: MARGIN + 150,
      y,
      size: 9,
      stack: stack.bold,
      color: ink,
    });
    y -= 15;
  }

  y -= 10;
  for (const p of letter.paragraphs) paragraph(p);

  y -= 10;
  line("ELECTRONIC SIGNATURE", { size: 10, bold: true, color: navy });
  if (signature) {
    line(`Signed by: ${signature.legal_name}`);
    line(`Title / role: ${signature.title}`);
    line(`On behalf of: ${signature.company_name}`);
    line(`Signed at: ${signature.signed_at}`);
    line(`Document version: ${letter.version}`);
    line(`Document SHA-256: ${signature.letter_sha256}`, { size: 7.5, color: muted });
    y -= 4;
    paragraph(
      "The signer confirmed they are authorized to act on behalf of the company and that the information provided is accurate. This record freezes the exact document accepted.",
      8.5,
    );
  } else {
    line("Not yet signed — review copy.", { color: muted });
  }

  drawFooter();
  return await doc.save();
}
