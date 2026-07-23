import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { embedUnicodeFontStack, drawUnicodeText, type UnicodeFontStack } from "@/lib/pdf/unicode-fonts.server";

export interface MouInput {
  partnerCompany: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  country: string;
  address?: string | null;
  repName: string;
  repTitle?: string | null;
  businessEmail: string;
  phone?: string | null;
  territory?: string | null;
  partnershipType: string;
  partnerId: string;
  referralCode: string;
  agreementNumber: string;
  effectiveDate: string; // YYYY-MM-DD
  partnerSignatureText?: string | null;
  partnerSignedAt?: string | null;
  eternaSignerName?: string | null;
  eternaSignedAt?: string | null;
}

const ETERNA_NAME = "Eterna Sentinel Defence LLC";
const ETERNA_ADDR =
  "Meydan Grandstand, 6th Floor, Al Meydan Road, Nad Al Sheba, Nadd Al Shiba First, Dubai, United Arab Emirates";

interface Cursor { page: PDFPage; y: number; stack: UnicodeFontStack; }

function newPage(doc: PDFDocument, stack: UnicodeFontStack): Cursor {
  const page = doc.addPage([612, 792]);
  return { page, y: 750, stack };
}

function ensureRoom(doc: PDFDocument, c: Cursor, needed: number): Cursor {
  if (c.y - needed < 60) return newPage(doc, c.stack);
  return c;
}

function heading(doc: PDFDocument, c: Cursor, text: string): Cursor {
  c = ensureRoom(doc, c, 40);
  drawUnicodeText(c.page, text, { x: 60, y: c.y, size: 13, stack: c.stack.bold, color: rgb(0.04, 0.08, 0.3) });
  c.y -= 20;
  return c;
}

function paragraph(doc: PDFDocument, c: Cursor, text: string, size = 10.5): Cursor {
  const maxWidth = 492;
  const words = text.split(/\s+/);
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = c.stack.regular.font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      c = ensureRoom(doc, c, size + 6);
      drawUnicodeText(c.page, line, { x: 60, y: c.y, size, stack: c.stack.regular, color: rgb(0.1, 0.12, 0.2) });
      c.y -= size + 4;
      line = w;
    } else line = test;
  }
  if (line) {
    c = ensureRoom(doc, c, size + 6);
    drawUnicodeText(c.page, line, { x: 60, y: c.y, size, stack: c.stack.regular, color: rgb(0.1, 0.12, 0.2) });
    c.y -= size + 6;
  }
  c.y -= 4;
  return c;
}

function bullet(doc: PDFDocument, c: Cursor, text: string): Cursor {
  c = ensureRoom(doc, c, 16);
  drawUnicodeText(c.page, "•", { x: 66, y: c.y, size: 10.5, stack: c.stack.bold, color: rgb(0.04, 0.08, 0.3) });
  drawUnicodeText(c.page, text, { x: 82, y: c.y, size: 10.5, stack: c.stack.regular, color: rgb(0.1, 0.12, 0.2) });
  c.y -= 15;
  return c;
}

export async function generatePartnerMou(input: MouInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);
  let c = newPage(doc, stack);

  drawUnicodeText(c.page, "ETERNA PARTNER AGREEMENT / MOU", {
    x: 60, y: c.y, size: 18, stack: stack.bold, color: rgb(0.04, 0.08, 0.3),
  });
  c.y -= 22;
  drawUnicodeText(c.page, `Agreement No: ${input.agreementNumber}   |   Effective: ${input.effectiveDate}`, {
    x: 60, y: c.y, size: 9.5, stack: stack.regular, color: rgb(0.3, 0.35, 0.5),
  });
  c.y -= 22;

  c = heading(doc, c, "1. Parties");
  c = paragraph(doc, c,
    `This Memorandum of Understanding ("Agreement") is entered into between ${ETERNA_NAME}, having its registered office at ${ETERNA_ADDR} ("Eterna"), and ${input.partnerCompany}${input.tradingName ? ` (trading as ${input.tradingName})` : ""}, a company registered in ${input.country}${input.registrationNumber ? ` under registration number ${input.registrationNumber}` : ""}${input.address ? `, having its address at ${input.address}` : ""} ("Partner"), represented by ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""} (${input.businessEmail}${input.phone ? `, ${input.phone}` : ""}).`
  );

  c = heading(doc, c, "2. Purpose");
  c = paragraph(doc, c,
    `The Partner will refer eligible clients to Eterna for its digital reputation and content protection services under the partnership type "${input.partnershipType}"${input.territory ? ` within the territory of ${input.territory}` : ""}. Each Partner is issued a unique Partner ID and referral link used to attribute every client onboarded through the Partner.`
  );
  c = bullet(doc, c, `Partner ID: ${input.partnerId}`);
  c = bullet(doc, c, `Referral Code: ${input.referralCode}`);

  c = heading(doc, c, "3. Commercial Terms");
  c = bullet(doc, c, "Eterna service price per client: INR 5,00,000 (Indian Rupees Five Lakhs).");
  c = bullet(doc, c, "Partner commission: 25% of the Eterna service price for each qualifying paid client.");
  c = bullet(doc, c, "Partner earning per qualifying sale: INR 1,25,000.");
  c = bullet(doc, c, "Eterna gross balance per qualifying sale: INR 3,75,000.");

  c = heading(doc, c, "4. Commission Payability");
  c = paragraph(doc, c,
    "Commission is earned and payable only after Eterna has received the client's cleared payment in full. Taxes, statutory deductions, negotiated discounts, promotional credits, refunds, cancellations and chargebacks are excluded from the commissionable base. If a client is refunded or a payment is reversed after commission has been paid, the corresponding commission becomes recoverable and may be adjusted against future payouts."
  );

  c = heading(doc, c, "5. Attribution & Duplicate Prevention");
  c = paragraph(doc, c,
    "Every referred client must be registered against the Partner's unique Partner ID or referral link before the client completes onboarding. Eterna's platform prevents duplicate claims: only one active Partner attribution per client email or client account is permitted. Clients already present in Eterna's system, or referred earlier by a different Partner, are not attributable."
  );

  c = heading(doc, c, "6. Partner Obligations");
  c = bullet(doc, c, "Represent Eterna truthfully; do not overstate results or make guarantees.");
  c = bullet(doc, c, "Comply with all applicable laws in the Partner's country of operation.");
  c = bullet(doc, c, "Protect Eterna and client confidential information.");
  c = bullet(doc, c, "Do not incentivise sign-ups with cashbacks, kickbacks or payments to prospects.");

  c = heading(doc, c, "7. Eterna Obligations");
  c = bullet(doc, c, "Provide the Partner Dashboard, referral links and marketing materials.");
  c = bullet(doc, c, "Onboard, deliver services to and support referred clients.");
  c = bullet(doc, c, "Report commissions accurately and settle payable commissions in the agreed cycle.");

  c = heading(doc, c, "8. Term & Termination");
  c = paragraph(doc, c,
    "This Agreement is effective from the Effective Date and continues until terminated by either party with thirty (30) days' written notice. Eterna may suspend or terminate the Partner immediately for breach, fraud, misrepresentation or reputational risk. Accrued and cleared commissions for genuine, non-refunded clients survive termination."
  );

  c = heading(doc, c, "9. Confidentiality, Data Protection & Non-Solicitation");
  c = paragraph(doc, c,
    "Both parties will keep confidential information secret, use it only for this Agreement, and process personal data in compliance with applicable data protection laws. The Partner shall not directly solicit Eterna's existing clients outside of this Agreement."
  );

  c = heading(doc, c, "10. Governing Law & Jurisdiction");
  c = paragraph(doc, c,
    "This Agreement is governed by the laws of the United Arab Emirates, and the courts of Dubai shall have exclusive jurisdiction over any dispute arising out of or in connection with it."
  );

  // Signature block
  c = ensureRoom(doc, c, 160);
  c.y -= 10;
  drawUnicodeText(c.page, "Signed for and on behalf of:", { x: 60, y: c.y, size: 10.5, stack: stack.bold, color: rgb(0.04, 0.08, 0.3) });
  c.y -= 22;
  const colY = c.y;
  // Eterna column
  drawUnicodeText(c.page, ETERNA_NAME, { x: 60, y: colY, size: 10.5, stack: stack.bold, color: rgb(0.04, 0.08, 0.3) });
  drawUnicodeText(c.page, `Signatory: ${input.eternaSignerName ?? "____________________________"}`, {
    x: 60, y: colY - 18, size: 10, stack: stack.regular, color: rgb(0.1, 0.12, 0.2),
  });
  drawUnicodeText(c.page, `Date: ${input.eternaSignedAt ? input.eternaSignedAt.slice(0, 10) : "____________"}`, {
    x: 60, y: colY - 34, size: 10, stack: stack.regular, color: rgb(0.1, 0.12, 0.2),
  });
  drawUnicodeText(c.page, "Status: " + (input.eternaSignedAt ? "SIGNED" : "AWAITING ETERNA APPROVAL"), {
    x: 60, y: colY - 50, size: 9.5, stack: stack.bold,
    color: input.eternaSignedAt ? rgb(0.05, 0.4, 0.15) : rgb(0.55, 0.35, 0.05),
  });

  // Partner column
  drawUnicodeText(c.page, input.partnerCompany, { x: 320, y: colY, size: 10.5, stack: stack.bold, color: rgb(0.04, 0.08, 0.3) });
  drawUnicodeText(c.page, `Signatory: ${input.partnerSignatureText ?? input.repName}`, {
    x: 320, y: colY - 18, size: 10, stack: stack.regular, color: rgb(0.1, 0.12, 0.2),
  });
  drawUnicodeText(c.page, `Date: ${input.partnerSignedAt ? input.partnerSignedAt.slice(0, 10) : input.effectiveDate}`, {
    x: 320, y: colY - 34, size: 10, stack: stack.regular, color: rgb(0.1, 0.12, 0.2),
  });
  drawUnicodeText(c.page, "Status: SIGNED (Electronic)", {
    x: 320, y: colY - 50, size: 9.5, stack: stack.bold, color: rgb(0.05, 0.4, 0.15),
  });

  return await doc.save();
}
