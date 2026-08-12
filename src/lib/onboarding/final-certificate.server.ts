import type { ProtectionCertificateModel } from "./final-package";

/**
 * Renders the finalized Protection Certificate PDF from real onboarding data.
 * No biometric, AWS or storage internals are drawn on the document.
 */
export async function renderProtectionCertificatePdf(
  model: ProtectionCertificateModel,
): Promise<Uint8Array> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");

  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();
  const ink = rgb(0.05, 0.09, 0.24);
  const muted = rgb(0.35, 0.4, 0.5);
  const accent = rgb(0.05, 0.42, 0.75);
  let y = height - 64;

  const text = (
    t: string,
    o: { size?: number; bold?: boolean; color?: typeof ink; x?: number } = {},
  ) => {
    drawUnicodeText(page, t, {
      x: o.x ?? 56,
      y,
      size: o.size ?? 10.5,
      stack: o.bold ? stack.bold : stack.regular,
      color: o.color ?? ink,
    });
    y -= (o.size ?? 10.5) + 7;
  };

  const rule = () => {
    page.drawLine({
      start: { x: 56, y: y + 6 },
      end: { x: width - 56, y: y + 6 },
      thickness: 0.7,
      color: rgb(0.82, 0.85, 0.9),
    });
    y -= 10;
  };

  const field = (label: string, value: string) => {
    drawUnicodeText(page, label, { x: 56, y, size: 9.5, stack: stack.regular, color: muted });
    drawUnicodeText(page, value || "—", { x: 250, y, size: 9.5, stack: stack.bold, color: ink });
    y -= 18;
  };

  text("ETERNA SENTINEL DEFENCE LLC", { size: 10, bold: true, color: muted });
  text("PROTECTION CERTIFICATE", { size: 20, bold: true });
  text("Digital Identity, Reputation & Content Protection", { size: 9.5, color: muted });
  rule();

  text("CERTIFICATE HOLDER", { size: 11, bold: true });
  rule();
  field("Client name", model.clientName);
  if (model.companyName) field("Company", model.companyName);
  field("Client ID", model.clientId);
  if (model.badge) {
    // Badges are stored as enum values; print a human label on the legal document.
    const badgeLabel = model.badge
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    field("Verification badge", badgeLabel);
  }

  y -= 6;
  text("AUTHORIZATION", { size: 11, bold: true });
  rule();
  field("Certificate number", model.certificateNumber);
  field("Authorization ID", model.authorizationId);
  field("Authorization status", model.authorizationStatus);
  field(
    "Signature status",
    model.signedStatus === "SIGNED"
      ? `ELECTRONICALLY SIGNED${model.signedDate ? ` — ${model.signedDate}` : ""}`
      : "NOT SIGNED",
  );
  field("Effective date", model.effectiveDate ?? "—");
  field("Expiry date", model.expiryDate ?? "—");

  y -= 6;
  text("PROTECTION STATUS", { size: 11, bold: true });
  rule();
  field(
    "Face protection",
    model.faceProtectionStatus === "ACTIVE"
      ? `ACTIVE (${model.protectedFaceCount} reference${model.protectedFaceCount === 1 ? "" : "s"})`
      : "NOT ENROLLED",
  );
  field("Verification score", `${model.score}/100`);

  y -= 10;
  drawUnicodeText(
    page,
    "This certificate confirms an active protection authorization on record with Eterna",
    { x: 56, y, size: 9, stack: stack.regular, color: muted },
  );
  y -= 13;
  drawUnicodeText(
    page,
    "Sentinel Defence LLC. It is not an identity document and does not certify legal identity.",
    { x: 56, y, size: 9, stack: stack.regular, color: muted },
  );

  if (model.verifyUrl) {
    y -= 26;
    drawUnicodeText(page, "Verify this certificate:", {
      x: 56,
      y,
      size: 9,
      stack: stack.regular,
      color: muted,
    });
    y -= 13;
    drawUnicodeText(page, model.verifyUrl, {
      x: 56,
      y,
      size: 9,
      stack: stack.bold,
      color: accent,
    });
    try {
      const QR = await import("qrcode");
      const dataUrl = await QR.toDataURL(model.verifyUrl);
      const png = await doc.embedPng(Buffer.from(dataUrl.split(",")[1] ?? "", "base64"));
      page.drawImage(png, { x: width - 176, y: y - 24, width: 120, height: 120 });
    } catch {
      /* QR is decorative — the printed URL remains authoritative. */
    }
  }

  return doc.save();
}
