/**
 * PDF renderer for the Eterna Sentinel Defence LLC authorization letter.
 * Server-only: pdf-lib + font embedding. Wording/scope logic lives in the pure
 * `authorization-letter` module so it stays unit-testable.
 */
export async function renderAuthorizationLetterPdf(
  snapshot: any,
  opts: { signed?: boolean; signatureSvg?: string | null; signerName?: string; signedAt?: string },
) {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");
  const {
    SERVICE_PROVIDER_NAME,
    LETTER_TITLE,
    limitationClauses,
    resolveClientParty,
    footerText,
    authorizingParagraph,
    selectedServices,
    officialDigitalPresence,
    REMOVAL_AUTHORITY_CLAUSE,
    NO_GUARANTEE_CLAUSE,
    CLIENT_DECLARATIONS,
    partySectionLabel,
    professionalName,
    faceReferenceView,
    FACE_REFERENCE_PURPOSE,
    FACE_REFERENCE_AUTHORIZATION,
  } = await import("@/lib/onboarding/authorization-letter");


  const doc = await PDFDocument.create();
  const stack = await embedUnicodeFontStack(doc);
  const ink = rgb(0.09, 0.11, 0.16);
  const navy = rgb(0.04, 0.11, 0.32);
  const muted = rgb(0.38, 0.42, 0.5);

  const MARGIN = 56;
  const WIDTH = 612;
  const CONTENT = WIDTH - MARGIN * 2;
  const authNumber = snapshot.auth?.auth_number ?? "";
  const version = snapshot.auth?.version ?? 1;
  const footer = footerText(authNumber, version);

  let page = doc.addPage([WIDTH, 792]);
  let y = 0;

  const measure = (t: string, size: number, bold = false) => {
    try {
      return (bold ? stack.bold[0] : stack.regular[0]).widthOfTextAtSize(t, size);
    } catch {
      return t.length * size * 0.5;
    }
  };

  const drawFooter = (p: typeof page) => {
    drawUnicodeText(p, footer, {
      x: MARGIN,
      y: 38,
      size: 7.5,
      stack: stack.regular,
      color: muted,
    });
  };

  const newPage = () => {
    drawFooter(page);
    page = doc.addPage([WIDTH, 792]);
    y = 792 - MARGIN;
  };

  const ensure = (needed: number) => {
    if (y - needed < 70) newPage();
  };

  const text = (
    t: string,
    o: { size?: number; bold?: boolean; color?: any; indent?: number; gap?: number } = {},
  ) => {
    const size = o.size ?? 9.5;
    ensure(size + 6);
    drawUnicodeText(page, t, {
      x: MARGIN + (o.indent ?? 0),
      y,
      size,
      stack: o.bold ? stack.bold : stack.regular,
      color: o.color ?? ink,
    });
    y -= size + (o.gap ?? 5);
  };

  /** Word-wrapped paragraph. */
  const paragraph = (
    t: string,
    o: { size?: number; bold?: boolean; indent?: number; color?: any; gap?: number } = {},
  ) => {
    const size = o.size ?? 9.5;
    const indent = o.indent ?? 0;
    const maxWidth = CONTENT - indent;
    const words = t.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size, o.bold) > maxWidth && line) {
        text(line, { ...o, size, indent });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) text(line, { ...o, size, indent });
    y -= o.gap ?? 4;
  };

  const rule = (color = rgb(0.82, 0.85, 0.9)) => {
    ensure(12);
    page.drawRectangle({ x: MARGIN, y, width: CONTENT, height: 0.8, color });
    y -= 12;
  };

  const sectionHeading = (t: string) => {
    // Reserve room for the heading, its rule and the first lines beneath it so
    // a heading never strands alone at the bottom of a page.
    ensure(78);
    y -= 6;
    text(t.toUpperCase(), { size: 10, bold: true, color: navy, gap: 4 });
    rule(rgb(0.75, 0.82, 0.94));
  };

  const VALUE_X = 168;

  /** Label/value row; long values wrap inside the value column. */
  const field = (label: string, value: string) => {
    const size = 9.5;
    ensure(size + 6);
    drawUnicodeText(page, `${label}:`, {
      x: MARGIN,
      y,
      size,
      stack: stack.bold,
      color: navy,
    });
    const maxWidth = CONTENT - VALUE_X;
    const words = (value || "Not provided").split(/\s+/).filter(Boolean);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    for (const [index, l] of lines.entries()) {
      if (index > 0) {
        ensure(size + 6);
      }
      drawUnicodeText(page, l, {
        x: MARGIN + VALUE_X,
        y,
        size,
        stack: stack.regular,
        color: ink,
      });
      y -= size + (index === lines.length - 1 ? 6 : 3);
    }
  };


  // ---- Letterhead -------------------------------------------------------
  y = 792 - MARGIN;
  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: CONTENT,
    height: 3,
    color: navy,
  });
  y -= 24;
  text(SERVICE_PROVIDER_NAME, { size: 15, bold: true, color: navy, gap: 4 });
  text("Authorized Digital Protection & Monitoring Services", {
    size: 8.5,
    color: muted,
    gap: 14,
  });
  paragraph(LETTER_TITLE, { size: 13, bold: true, color: ink, gap: 6 });
  text(
    `Issued to ${SERVICE_PROVIDER_NAME} by the Client identified below.`,
    { size: 8.5, color: muted, gap: 10 },
  );
  rule();

  // ---- Parties & authorization record ----------------------------------
  // Legal identifiers only — no internal status, classifier or provider fields.
  const party = resolveClientParty(snapshot.profile);
  const partyLabel = partySectionLabel(snapshot.profile);
  const proName = professionalName(snapshot.profile);
  sectionHeading(`1. ${partyLabel} and authorization details`);
  field("Legal Name", party.legalName);
  if (proName) field("Professional / Display Name", proName);
  field("Client ID", snapshot.profile?.client_id ?? "");
  field("Country", party.country);
  field("Authorization ID", authNumber);
  field("Document Version", `v${version}`);
  field("Effective Date", snapshot.auth?.effective_date ?? "");
  field("Expiry Date", snapshot.auth?.expiry_date ?? "");
  field("Territory", snapshot.auth?.territory ?? "");

  // ---- Authorization statement -----------------------------------------
  sectionHeading("2. Authorization");
  paragraph(authorizingParagraph(party), { gap: 6 });

  // ---- Authorized protection services -----------------------------------
  const services = selectedServices(snapshot.scopes);
  sectionHeading("3. Authorized protection services");
  paragraph(
    "The Client authorizes the Service Provider to provide the following protection services, and no others:",
    { gap: 6 },
  );
  if (services.length === 0) {
    paragraph("No protection services have been selected by the Client.", { color: muted });
  } else {
    services.forEach((s, i) => {
      ensure(46); // keep the service title with its opening sentence
      paragraph(`${i + 1}.  ${s.title.toUpperCase()}`, { bold: true, color: navy, indent: 0, gap: 2 });
      paragraph(s.intro, { indent: 10, gap: 3 });
      for (const b of s.bullets) {
        paragraph(`•  ${b}`, { size: 9, indent: 20, gap: 1 });
      }
      if (s.closing) {
        y -= 3;
        paragraph(s.closing, { size: 8.8, color: muted, indent: 10, gap: 6 });
      } else {
        y -= 6;
      }
    });
  }

  // ---- Official digital presence ----------------------------------------
  sectionHeading("4. Official digital presence");
  const presence = officialDigitalPresence(snapshot.profile, snapshot.assets);
  if (presence.length === 0) {
    paragraph(
      "No official profiles have been supplied by the Client. Coverage applies only to profiles supplied and listed in this or a subsequent version of this document.",
      { color: muted },
    );
  } else {
    for (const group of presence) {
      ensure(30);
      paragraph(`${group.platform}:`, { bold: true, color: navy, indent: 6, gap: 2 });
      for (const entry of group.entries) {
        paragraph(entry.label, { indent: 18, gap: 0 });
        if (entry.url && entry.url !== entry.label) {
          text(entry.url, { size: 8, color: muted, indent: 18, gap: 3 });
        }
      }
      y -= 4;
    }
    paragraph("All profiles listed above are client-supplied official profiles.", {
      size: 8.5,
      color: muted,
      gap: 4,
    });
  }

  // ---- Protected likeness & facial reference ----------------------------
  // Presentation only: enrolled portrait plus client-safe descriptors.
  const faceRef = faceReferenceView(snapshot.profile, snapshot.face_reference);
  if (faceRef) {
    sectionHeading("5. Protected likeness & facial reference");
    let portrait: any = null;
    const b64 = snapshot.face_reference?.image_base64;
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      for (const embed of [() => doc.embedJpg(buf), () => doc.embedPng(buf)]) {
        try {
          portrait = await embed();
          break;
        } catch {
          portrait = null;
        }
      }
    }
    // ID-style portrait: modest fixed width, aspect preserved, thin border.
    const PORTRAIT_W = 104;
    if (portrait) {
      const scale = PORTRAIT_W / portrait.width;
      const h = Math.min(portrait.height * scale, 132);
      const w = (h / portrait.height) * portrait.width;
      ensure(h + 16);
      page.drawRectangle({
        x: MARGIN - 2,
        y: y - h - 2,
        width: w + 4,
        height: h + 4,
        borderColor: rgb(0.75, 0.8, 0.88),
        borderWidth: 0.8,
      });
      page.drawImage(portrait, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 14;
    }
    field("Subject", faceRef.subject);
    field("Protection Type", faceRef.protectionType);
    field("Enrollment Status", faceRef.enrollmentStatus);
    field("Enrollment Date", faceRef.enrollmentDate);
    y -= 2;
    paragraph("Purpose:", { bold: true, color: navy, gap: 2 });
    paragraph(FACE_REFERENCE_PURPOSE, { gap: 5 });
    paragraph(FACE_REFERENCE_AUTHORIZATION, { gap: 5 });
  }
  const n = faceRef ? 1 : 0;

  // ---- Removal authority and outcome disclaimer -------------------------
  sectionHeading(`${5 + n}. Removal requests and platform outcomes`);
  paragraph(REMOVAL_AUTHORITY_CLAUSE, { gap: 5 });
  paragraph(NO_GUARANTEE_CLAUSE, { gap: 5 });

  // ---- Limitations ------------------------------------------------------
  sectionHeading(`${6 + n}. Scope limitations and reservations`);
  limitationClauses(snapshot.scopes).forEach((clause, i) => {
    paragraph(`${6 + n}.${i + 1}  ${clause}`, { gap: 5 });
  });

  // ---- Client declarations ---------------------------------------------
  sectionHeading(`${7 + n}. Client declarations`);
  for (const t of CLIENT_DECLARATIONS) {
    paragraph(`•  ${t}`, { indent: 6, gap: 3 });
  }


  // ---- Signatures -------------------------------------------------------
  ensure(180);
  sectionHeading("8. Execution");

  const signatureBlock = (
    heading: string,
    subtitle: string | null,
    name: string,
    dateValue: string,
    drawImage: boolean,
  ) => {
    ensure(120);
    text(heading, { size: 9.5, bold: true, color: navy, gap: 6 });
    if (subtitle) text(subtitle, { size: 9, bold: true, gap: 6 });
    field("Name", name);
    const signatureLineY = y - 34;
    if (drawImage && signaturePng) {
      page.drawImage(signaturePng, {
        x: MARGIN + 168,
        y: signatureLineY + 4,
        width: 140,
        height: 40,
      });
    }
    drawUnicodeText(page, "Signature:", {
      x: MARGIN,
      y: signatureLineY,
      size: 9.5,
      stack: stack.bold,
      color: navy,
    });
    page.drawRectangle({
      x: MARGIN + 168,
      y: signatureLineY - 3,
      width: 240,
      height: 0.7,
      color: rgb(0.6, 0.65, 0.72),
    });
    y = signatureLineY - 18;
    if (dateValue) {
      field("Date", dateValue);
    } else {
      // Unsigned draft: leave a blank rule for a handwritten date.
      drawUnicodeText(page, "Date:", {
        x: MARGIN,
        y,
        size: 9.5,
        stack: stack.bold,
        color: navy,
      });
      page.drawRectangle({
        x: MARGIN + VALUE_X,
        y: y - 3,
        width: 140,
        height: 0.7,
        color: rgb(0.6, 0.65, 0.72),
      });
      y -= 15.5;
    }
    y -= 10;
  };

  let signaturePng: any = null;
  if (opts.signed && opts.signatureSvg?.startsWith("data:image/png;base64,")) {
    try {
      const b64 = opts.signatureSvg.split(",")[1];
      signaturePng = await doc.embedPng(Buffer.from(b64, "base64"));
    } catch {
      signaturePng = null;
    }
  }

  const signedDate = opts.signed ? (opts.signedAt ?? "").slice(0, 10) : "";
  signatureBlock(
    "CLIENT / RIGHTS HOLDER",
    null,
    opts.signed ? (opts.signerName ?? party.legalName) : party.legalName,
    signedDate,
    true,
  );
  signatureBlock(
    "AUTHORIZED SERVICE PROVIDER",
    SERVICE_PROVIDER_NAME,
    "Authorized Representative",
    signedDate,
    false,
  );

  if (!opts.signed) {
    y -= 4;
    paragraph(
      "This document is an unsigned draft prepared for the Client's review. It becomes effective only once executed by both parties.",
      { size: 8.5, color: muted },
    );
  }

  drawFooter(page);
  return await doc.save();
}
