import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

export const SCOPE_KEYS = [
  "monitor_public",
  "monitor_verified_assets",
  "detect_face_misuse",
  "collect_evidence",
  "monitoring_reports",
  "prepare_copyright",
  "prepare_privacy",
  "prepare_impersonation",
  "prepare_hosting",
  "communicate_platforms",
  "track_enforcement",
  "follow_up_cases",
  "submit_final_after_approval",
] as const;

function authNumber(): string {
  const y = new Date().getUTCFullYear();
  const n = String(Date.now() % 1000000).padStart(6, "0");
  return `AUTH-${y}-${n}`;
}

export const saveScopes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { scopes: Record<string, boolean>; territory?: string; expiry_date?: string }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let { data: auth } = await supabase
      .from("client_authorizations")
      .select("*")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!auth || auth.status === "SIGNED" || auth.status === "ACTIVE") {
      const version = (auth?.version ?? 0) + 1;
      const { data: created, error } = await supabase
        .from("client_authorizations")
        .insert({
          user_id: userId,
          auth_number: auth?.auth_number ?? authNumber(),
          version,
          status: "DRAFT",
          territory: data.territory ?? "Worldwide",
          expiry_date:
            data.expiry_date ?? new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
          effective_date: new Date().toISOString().slice(0, 10),
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      auth = created;
    }
    await supabase.from("authorization_scopes").delete().eq("authorization_id", auth.id);
    const rows = SCOPE_KEYS.map((k) => ({
      authorization_id: auth!.id,
      user_id: userId,
      scope_key: k,
      granted: !!data.scopes[k],
    }));
    await supabase.from("authorization_scopes").insert(rows);
    if (data.territory || data.expiry_date) {
      await supabase
        .from("client_authorizations")
        .update({
          territory: data.territory ?? auth.territory,
          expiry_date: data.expiry_date ?? auth.expiry_date,
        })
        .eq("id", auth.id);
    }
    return auth;
  });

export const getAuthorizationBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: auth } = await supabase
      .from("client_authorizations")
      .select("*")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!auth) return null;
    const [{ data: scopes }, { data: signatures }, { data: docs }, { data: reviews }] =
      await Promise.all([
        supabase.from("authorization_scopes").select("*").eq("authorization_id", auth.id),
        supabase
          .from("authorization_signatures")
          .select("*")
          .eq("authorization_id", auth.id)
          .order("created_at", { ascending: false }),
        supabase.from("authorization_documents").select("*").eq("authorization_id", auth.id),
        supabase
          .from("authorization_admin_reviews")
          .select("*")
          .eq("authorization_id", auth.id)
          .order("decided_at", { ascending: false }),
      ]);
    return {
      auth,
      scopes: scopes ?? [],
      signatures: signatures ?? [],
      documents: docs ?? [],
      reviews: reviews ?? [],
    };
  });

async function buildSnapshot(supabase: any, userId: string, authId: string) {
  const [
    { data: profile },
    { data: kyc },
    { data: face },
    { data: assets },
    { data: scopes },
    { data: auth },
  ] = await Promise.all([
    supabase.from("client_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase
      .from("kyc_verifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("protected_face_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("digital_assets").select("*").eq("user_id", userId),
    supabase.from("authorization_scopes").select("*").eq("authorization_id", authId),
    supabase.from("client_authorizations").select("*").eq("id", authId).maybeSingle(),
  ]);
  return { profile, kyc, face, assets, scopes, auth, generated_at: new Date().toISOString() };
}

async function renderPdf(
  snapshot: any,
  opts: { signed?: boolean; signatureSvg?: string | null; signerName?: string; signedAt?: string },
) {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");
  const {
    SERVICE_PROVIDER_NAME,
    LETTER_TITLE,
    selectedCategories,
    limitationClauses,
    resolveClientParty,
    coveredAssets,
    footerText,
    authorizingParagraph,
    authorizationLevel,
    AUTHORIZATION_LEVEL_LABELS,
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
    ensure(30);
    y -= 6;
    text(t.toUpperCase(), { size: 10, bold: true, color: navy, gap: 4 });
    rule(rgb(0.75, 0.82, 0.94));
  };

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
    drawUnicodeText(page, value || "Not provided", {
      x: MARGIN + 168,
      y,
      size,
      stack: stack.regular,
      color: ink,
    });
    y -= size + 6;
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
  const party = resolveClientParty(snapshot.profile);
  sectionHeading("1. Client and authorization details");
  field("Client Full Legal Name", party.legalName);
  field("Artist / Public Display Name", party.displayName);
  field("Client Type", party.clientType);
  field("Country", party.country);
  field("Authorization ID", authNumber);
  field("Document Version", `v${version}`);
  field("Effective Date", snapshot.auth?.effective_date ?? "");
  field("Expiry Date", snapshot.auth?.expiry_date ?? "");
  field("Territory", snapshot.auth?.territory ?? "");

  // ---- Authorization statement -----------------------------------------
  sectionHeading("2. Authorization");
  paragraph(authorizingParagraph(party), { gap: 6 });

  // ---- Verified assets --------------------------------------------------
  sectionHeading("3. Verified digital assets and accounts covered");
  const assets = coveredAssets(snapshot.assets);
  if (assets.length === 0) {
    paragraph(
      "No verified digital assets are currently covered by this authorization. Coverage applies only to assets verified and listed in a subsequent version of this document.",
      { color: muted },
    );
  } else {
    for (const a of assets) {
      paragraph(`•  ${a.label}`, { indent: 6, gap: 0 });
      if (a.meta) text(a.meta, { size: 8, color: muted, indent: 18, gap: 4 });
    }
    y -= 4;
  }

  // ---- Approved scope ---------------------------------------------------
  const categories = selectedCategories(snapshot.scopes);
  const level = authorizationLevel(snapshot.scopes);
  sectionHeading("4. Approved monitoring scope");
  paragraph(
    "The Client authorizes the Service Provider to perform only the following selected protection services:",
    { gap: 6 },
  );
  if (categories.length === 0) {
    paragraph("No protection services have been selected by the Client.", { color: muted });
  } else {
    categories.forEach((c, i) => {
      paragraph(`${i + 1}.  ${c.title}`, { bold: true, indent: 6, gap: 1 });
      paragraph(c.detail, { size: 8.8, color: muted, indent: 20, gap: 5 });
    });
  }
  field("Authorization Level", AUTHORIZATION_LEVEL_LABELS[level]);

  // ---- Limitations ------------------------------------------------------
  sectionHeading("5. Scope limitations and reservations");
  limitationClauses(snapshot.scopes).forEach((clause, i) => {
    paragraph(`5.${i + 1}  ${clause}`, { gap: 5 });
  });

  // ---- Client declarations ---------------------------------------------
  sectionHeading("6. Client declarations");
  for (const t of [
    "The Client owns the listed rights or is legally authorized to represent the rights owner.",
    "The listed accounts and assets belong to the Client or the Client's organization.",
    "The information supplied in this authorization is accurate and complete.",
    "The Client understands that false or abusive complaints may create legal liability.",
    "The Client authorizes the Service Provider only within the selected scope stated above.",
  ]) {
    paragraph(`•  ${t}`, { indent: 6, gap: 3 });
  }

  // ---- Signatures -------------------------------------------------------
  ensure(230);
  sectionHeading("7. Execution");

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
    field("Date", dateValue);
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


export const generateDraftPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: auth } = await supabase
      .from("client_authorizations")
      .select("*")
      .eq("user_id", userId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!auth) throw new Error("No authorization draft");
    const snap = await buildSnapshot(supabase, userId, auth.id);
    const bytes = await renderPdf(snap, { signed: false });
    const { putObject, getSignedGetUrl } = await import("@/lib/aws/s3.server");
    const key = `clients/${userId}/authorization/${auth.auth_number}-v${auth.version}-draft.pdf`;
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await supabase
      .from("authorization_documents")
      .insert({
        authorization_id: auth.id,
        user_id: userId,
        kind: "draft",
        version: auth.version,
        s3_key: key,
        sha256,
      });
    const url = await getSignedGetUrl(key, 600);
    return { url, sha256 };
  });

/**
 * Sign the authorization letter and immediately activate the account.
 * OTP has been removed. Duplicate submissions are prevented by checking for
 * an existing SIGNED signature at the current auth version; if found, the
 * existing certificate is returned instead of re-signing.
 */
export const finalizeSignature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      typed_name: string;
      role_title?: string;
      drawn_signature_svg: string;
      confirmations: Record<string, boolean>;
    }) =>
      z
        .object({
          typed_name: z.string().min(2),
          role_title: z.string().optional(),
          drawn_signature_svg: z.string().min(32, "Drawn signature is required"),
          confirmations: z.record(z.string(), z.boolean()),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const required = [
        "reviewed",
        "owner",
        "assets_mine",
        "accurate",
        "false_claims",
        "scope_only",
        "final_approval",
      ];
      for (const k of required) if (!data.confirmations[k]) throw new Error(`DECL_MISSING:${k}`);

      const { data: auth } = await supabase
        .from("client_authorizations")
        .select("*")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!auth) throw new Error("NO_AUTH_DRAFT");

      // Duplicate submission guard — if already SIGNED at this version, return the current certificate.
      const { data: existingSig } = await supabase
        .from("authorization_signatures")
        .select("*")
        .eq("authorization_id", auth.id)
        .eq("version", auth.version)
        .eq("status", "SIGNED")
        .maybeSingle();
      if (existingSig) {
        const { data: cert } = await supabase
          .from("verification_certificates")
          .select("*")
          .eq("authorization_id", auth.id)
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cert) {
          const { upsertProgressPreservingVersion, normalizeOnboardingVersion } =
            await import("./version.server");
          const { data: prog } = await supabase
            .from("onboarding_progress")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();
          const version = normalizeOnboardingVersion(prog?.onboarding_version);
          if (version === "v1") {
            const states = {
              ...((prog?.step_states as Record<string, string>) ?? {}),
              "7": "COMPLETED",
              "8": "COMPLETED",
            };
            await upsertProgressPreservingVersion(supabase, userId, {
              current_step: Math.max(prog?.current_step ?? 8, 8),
              step_states: states,
              overall_status: "IN_PROGRESS",
            });
          } else {
            await upsertProgressPreservingVersion(supabase, userId, {
              current_step: Math.max(prog?.current_step ?? 9, 9),
              overall_status: "IN_PROGRESS",
            });
          }
          return {
            ok: true,
            duplicate: true,
            certificate_id: cert.id,
            certificate_number: cert.certificate_number,
          };
        }
      }

      const request = (await import("@tanstack/react-start/server")).getRequest();
      const ipAddress = request?.headers?.get("x-forwarded-for") || null;
      const userAgent = request?.headers?.get("user-agent") || null;

      const snap = await buildSnapshot(supabase, userId, auth.id);

      // Generate BOTH PDFs (letter + certificate) before we touch signatures/certificates rows,
      // so we never leave a partial audit state on failure.
      const bytes = await renderPdf(snap, {
        signed: true,
        signerName: data.typed_name,
        signatureSvg: data.drawn_signature_svg,
        signedAt: new Date().toISOString(),
      });
      const doc_sha = createHash("sha256").update(bytes).digest("hex");
      const signature_sha = createHash("sha256").update(data.drawn_signature_svg).digest("hex");

      const { normalizeOnboardingVersion, upsertProgressPreservingVersion } =
        await import("./version.server");
      const { V2_BADGES, V2_VERIFICATION_METHODS, isV2AccountType, requiresVeriff } =
        await import("./v2-config");

      const { data: profileRow } = await supabase
        .from("client_profiles")
        .select("onboarding_version, onboarding_account_type")
        .eq("user_id", userId)
        .maybeSingle();
      const onboardingVersion = normalizeOnboardingVersion(profileRow?.onboarding_version);
      const v2AccountType = isV2AccountType(profileRow?.onboarding_account_type)
        ? profileRow.onboarding_account_type
        : null;
      const allowGovIdClaim =
        onboardingVersion === "v1" || (v2AccountType ? requiresVeriff(v2AccountType) : false);

      const kycOk = allowGovIdClaim && snap.kyc?.verification_status === "APPROVED";
      const faceOk = snap.face?.status === "FACE_VERIFIED";
      const emailOk = !!snap.profile?.email_verified_at;
      const assetOk = (snap.assets ?? []).some(
        (a: { verification_status?: string }) => a.verification_status === "VERIFIED",
      );
      let score = 0;
      if (kycOk) score += 30;
      if (faceOk) score += 25;
      if (emailOk) score += 10;
      if (assetOk) score += 25;
      score += 10;
      // v1 enforcement readiness remains KYC+asset. v2 non-individuals use asset+signature path.
      const enforcementReady =
        onboardingVersion === "v2" && v2AccountType && !requiresVeriff(v2AccountType)
          ? assetOk
          : kycOk && assetOk;

      const cert_number = `ETC-${new Date().getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const public_slug = randomBytes(6).toString("hex");
      const verificationBadge = v2AccountType ? V2_BADGES[v2AccountType] : null;
      const verificationMethod = v2AccountType ? V2_VERIFICATION_METHODS[v2AccountType] : null;

      const { PDFDocument, rgb } = await import("pdf-lib");
      const { embedUnicodeFontStack, drawUnicodeText } =
        await import("@/lib/pdf/unicode-fonts.server");
      const certDoc = await PDFDocument.create();
      const certStack = await embedUnicodeFontStack(certDoc);
      const cPage = certDoc.addPage([612, 792]);
      const { height } = cPage.getSize();
      let cy = height - 60;
      const cline = (t: string, bold = false, sz = 11) => {
        drawUnicodeText(cPage, t, {
          x: 60,
          y: cy,
          size: sz,
          stack: bold ? certStack.bold : certStack.regular,
          color: rgb(0.05, 0.1, 0.35),
        });
        cy -= sz + 8;
      };
      cline("ETERNA VERIFICATION CERTIFICATE", true, 18);
      cline(`Certificate: ${cert_number}`, true);
      cline(`Authorization: ${auth.auth_number}`);
      cline(`Client ID: ${snap.profile?.client_id ?? ""}`);
      cline(
        `Name: ${snap.profile?.display_name ?? snap.profile?.legal_name ?? snap.profile?.full_name ?? ""}`,
      );
      cline(`Company: ${snap.profile?.company_name ?? ""}`);
      if (verificationBadge) cline(`Badge: ${verificationBadge}`, true);
      cline(`Verification Score: ${score}/100`);
      cline(`Status: ACTIVE`);
      cline(`Issued: ${new Date().toISOString().slice(0, 10)}`);
      cline(`Expires: ${auth.expiry_date}`);
      cy -= 10;
      if (kycOk) cline("✓ Identity Verified (Veriff)", true);
      if (kycOk) cline("✓ Government ID Verified", true);
      if (faceOk) cline("✓ Real Human Verified (Rekognition Liveness)", true);
      if (faceOk) cline("✓ Face Protected Profile Created", true);
      if (assetOk) cline("✓ Asset Ownership Verified", true);
      if (v2AccountType === "celebrity") cline("✓ Public Figure Route Verified", true);
      if (v2AccountType === "enterprise") cline("✓ Organization Route Verified", true);
      if (v2AccountType === "production_house") cline("✓ Rights Holder Route Verified", true);
      cline("✓ Authorization Signed", true);
      try {
        const QR = await import("qrcode");
        const publicBase = process.env.PUBLIC_APP_URL ?? "https://eternally-defend.lovable.app";
        const dataUrl = await QR.toDataURL(`${publicBase}/verify/${public_slug}`);
        const png = await certDoc.embedPng(Buffer.from(dataUrl.split(",")[1], "base64"));
        cPage.drawImage(png, { x: 420, y: 90, width: 120, height: 120 });
        drawUnicodeText(cPage, `Verify: /verify/${public_slug}`, {
          x: 380,
          y: 78,
          size: 8,
          stack: certStack.regular,
          color: rgb(0.3, 0.3, 0.3),
        });
      } catch {
        /* ignore */
      }
      const certBytes = await certDoc.save();
      const certSha = createHash("sha256").update(certBytes).digest("hex");

      // Both PDFs generated successfully — now persist everything.
      const { putObject } = await import("@/lib/aws/s3.server");
      const letterKey = `clients/${userId}/authorization/${auth.auth_number}-v${auth.version}-signed.pdf`;
      const certKey = `clients/${userId}/certificates/${cert_number}.pdf`;
      await Promise.all([
        putObject({ key: letterKey, body: Buffer.from(bytes), contentType: "application/pdf" }),
        putObject({ key: certKey, body: Buffer.from(certBytes), contentType: "application/pdf" }),
      ]);

      await supabase
        .from("authorization_documents")
        .insert({
          authorization_id: auth.id,
          user_id: userId,
          kind: "signed",
          version: auth.version,
          s3_key: letterKey,
          sha256: doc_sha,
        });

      // Clean up any stale draft signature rows for this version.
      await supabase
        .from("authorization_signatures")
        .delete()
        .eq("authorization_id", auth.id)
        .eq("version", auth.version)
        .neq("status", "SIGNED");

      await supabase.from("authorization_signatures").insert({
        authorization_id: auth.id,
        user_id: userId,
        version: auth.version,
        status: "SIGNED",
        typed_name: data.typed_name,
        role_title: data.role_title ?? null,
        drawn_signature_svg: data.drawn_signature_svg,
        signed_at: new Date().toISOString(),
        document_sha256: doc_sha,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

      await supabase
        .from("client_authorizations")
        .update({
          status: "ACTIVE",
          enforcement_enabled: enforcementReady,
          snapshot: snap,
        })
        .eq("id", auth.id);

      await supabase.from("authorization_versions").insert({
        authorization_id: auth.id,
        user_id: userId,
        version: auth.version,
        snapshot: snap,
      });

      const { data: insertedCert, error: certErr } = await supabase
        .from("verification_certificates")
        .insert({
          user_id: userId,
          authorization_id: auth.id,
          certificate_number: cert_number,
          public_slug,
          score,
          status: "ACTIVE",
          expires_at: new Date(auth.expiry_date ?? Date.now() + 365 * 86400_000).toISOString(),
          s3_key: certKey,
          sha256: certSha,
          snapshot: snap,
          account_type: v2AccountType,
          verification_method: verificationMethod,
          verification_badge: verificationBadge,
        })
        .select()
        .single();
      if (certErr) throw new Error(`CERT_INSERT:${certErr.message}`);

      await supabase.from("authorization_documents").insert({
        authorization_id: auth.id,
        user_id: userId,
        kind: "certificate",
        version: auth.version,
        s3_key: certKey,
        sha256: certSha,
      });

      await supabase.from("authorization_audit_logs").insert([
        { user_id: userId, actor_id: userId, action: "signed", target: auth.auth_number },
        {
          user_id: userId,
          actor_id: userId,
          action: "authorization_activated",
          target: auth.auth_number,
        },
        { user_id: userId, actor_id: userId, action: "certificate_issued", target: cert_number },
      ]);

      const { data: progress } = await supabase
        .from("onboarding_progress")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (onboardingVersion === "v1") {
        const states = {
          ...((progress?.step_states as Record<string, string>) ?? {}),
          "7": "COMPLETED",
          "8": "COMPLETED",
        };
        await upsertProgressPreservingVersion(supabase, userId, {
          current_step: 8,
          step_states: states,
          overall_status: "IN_PROGRESS",
        });
        // Legacy completion remains available at signature time.
        await supabase
          .from("client_profiles")
          .update({ onboarding_completed: true })
          .eq("user_id", userId);
      } else {
        // v2 must finish via completeV2Onboarding after route requirements pass.
        await upsertProgressPreservingVersion(supabase, userId, {
          current_step: Math.max(progress?.current_step ?? 9, 9),
          overall_status: "IN_PROGRESS",
        });
      }

      return {
        ok: true,
        duplicate: false,
        certificate_id: insertedCert.id,
        certificate_number: cert_number,
        signature_sha256: signature_sha,
        document_sha256: doc_sha,
      };
    } catch (err: any) {
      // Log the real error server-side; surface a safe, user-facing message.
      // Preserved codes let the UI hint at what to retry vs. what to fix.
      console.error("[finalizeSignature] failed", err);
      const raw = String(err?.message ?? err ?? "");
      if (raw.startsWith("DECL_MISSING:")) {
        throw new Error("Please confirm every required declaration before signing.");
      }
      if (raw === "NO_AUTH_DRAFT") {
        throw new Error(
          "Your authorization draft was not found. Please go back and re-open the Authorization Letter step.",
        );
      }
      if (raw.startsWith("CERT_INSERT:")) {
        throw new Error(
          "Your signature was captured but the certificate could not be issued. Please retry — no duplicate will be created.",
        );
      }
      if (raw.startsWith("Font fetch failed")) {
        throw new Error("A required document font could not be loaded. Please retry in a moment.");
      }
      throw new Error(
        "We couldn't finalize your signature. Your entries are preserved — please retry.",
      );
    }
  });

export const getSignedDocUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { doc_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc } = await supabase
      .from("authorization_documents")
      .select("*")
      .eq("id", data.doc_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!doc) throw new Error("Not found");
    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
    return { url: await getSignedGetUrl(doc.s3_key, 300) };
  });
