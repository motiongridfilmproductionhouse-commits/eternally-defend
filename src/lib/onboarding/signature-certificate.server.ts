import { rgb } from "pdf-lib";

export type SignatureAuditRecord = {
  legal_name: string;
  display_name?: string | null;
  signer_email?: string | null;
  email_verified: boolean;
  client_id?: string | null;
  user_id: string;
  auth_number: string;
  authorization_id: string;
  document_version: number;
  signed_at_utc: string;
  signature_method: string;
  consent_accepted: boolean;
  consent_text: string;
  document_sha256: string;
  signature_sha256: string;
  ip_address?: string | null;
  device_metadata?: Record<string, string | null> | null;
};

/**
 * Renders the Signature Certificate / Audit Trail for an electronic (typed-name)
 * signature. Deliberately worded as an "Electronic Signature" — no certificate-based
 * cryptographic signing is performed, so no such claim is made.
 */
export async function renderSignatureCertificatePdf(rec: SignatureAuditRecord): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");

  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);
  const ink = rgb(0.05, 0.09, 0.24);
  const muted = rgb(0.35, 0.4, 0.5);

  let page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const left = 54;
  const right = width - 54;
  let y = height - 62;

  const ensure = (need: number) => {
    if (y - need < 60) {
      page = doc.addPage([612, 792]);
      y = height - 62;
    }
  };

  const text = (
    t: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    drawUnicodeText(page, t, {
      x: opts.x ?? left,
      y,
      size,
      stack: opts.bold ? stack.bold : stack.regular,
      color: opts.color ?? ink,
    });
    y -= size + 7;
  };

  const rule = () => {
    page.drawLine({
      start: { x: left, y: y + 4 },
      end: { x: right, y: y + 4 },
      thickness: 0.7,
      color: rgb(0.8, 0.84, 0.9),
    });
    y -= 12;
  };

  const field = (label: string, value: string) => {
    ensure(24);
    drawUnicodeText(page, label, {
      x: left,
      y,
      size: 9,
      stack: stack.regular,
      color: muted,
    });
    const chunks = wrap(value || "—", 44);
    chunks.forEach((line, i) => {
      drawUnicodeText(page, line, {
        x: left + 190,
        y: y - i * 12,
        size: 9.5,
        stack: stack.bold,
        color: ink,
      });
    });
    y -= Math.max(1, chunks.length) * 12 + 5;
  };

  const heading = (t: string) => {
    ensure(60);
    y -= 6;
    text(t.toUpperCase(), { size: 11, bold: true });
    rule();
  };

  const paragraph = (t: string) => {
    const lines = wrap(t, 96);
    ensure(lines.length * 13 + 8);
    for (const line of lines) {
      text(line, { size: 9, color: muted });
    }
    y -= 4;
  };


  text("ETERNA SENTINEL DEFENCE LLC", { size: 10, bold: true, color: muted });
  y -= 2;
  text("SIGNATURE CERTIFICATE & AUDIT TRAIL", { size: 17, bold: true });
  text("Electronic Signature record for the Digital Identity, Reputation & Content Protection Authorization", {
    size: 9,
    color: muted,
  });
  rule();

  heading("1. Signer");
  field("Full legal name", rec.legal_name);
  if (rec.display_name) field("Professional / display name", rec.display_name);
  field(
    "Email address",
    rec.signer_email ? `${rec.signer_email}${rec.email_verified ? " (verified)" : ""}` : "—",
  );
  if (rec.client_id) field("Client ID", rec.client_id);
  field("User ID", rec.user_id);

  heading("2. Signed document");
  field("Authorization ID", rec.auth_number);
  field("Document version", `v${rec.document_version}`);
  field("Authorization record", rec.authorization_id);
  field("Document status", "DIGITALLY SIGNED — version frozen");

  heading("3. Signature event");
  field("Signature method", rec.signature_method);
  field("Signed at (UTC)", rec.signed_at_utc);
  field("Explicit consent", rec.consent_accepted ? "Accepted by signer" : "Not recorded");
  paragraph(`Consent statement accepted: "${rec.consent_text}"`);

  heading("4. Document integrity");
  field("SHA-256 of signed PDF", rec.document_sha256);
  field("SHA-256 signature evidence", rec.signature_sha256);
  paragraph(
    "The hash above was computed server-side over the exact signed PDF bytes stored by Eterna. Any modification of that document produces a different hash and is therefore detectable.",
  );

  heading("5. Technical metadata");
  field("IP address", rec.ip_address ?? "Not recorded");
  const dm = rec.device_metadata ?? {};
  field("Browser / device", String(dm["user_agent"] ?? "Not recorded"));
  if (dm["platform"]) field("Platform", String(dm["platform"]));
  if (dm["timezone"]) field("Reported time zone", String(dm["timezone"]));
  paragraph(
    "Only the minimum technical metadata required to evidence the signature event is retained. No biometric data, government identifiers or document scans are included in this certificate.",
  );

  heading("6. Legal notice");
  paragraph(
    "This is an electronic signature record (typed-name electronic signature with explicit consent). It is not a certificate-based cryptographic digital signature and does not assert any public-key certificate authority validation.",
  );
  paragraph(
    "The authorization document version referenced above is frozen. If the authorization terms change, a new document version must be generated and separately signed by the Client.",
  );

  return await doc.save();
}

function wrap(input: string, max: number): string[] {
  const words = String(input).split(/\s+/).filter(Boolean);
  if (!words.length) return ["—"];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (w.length > max) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < w.length; i += max) lines.push(w.slice(i, i + max));
      continue;
    }
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
