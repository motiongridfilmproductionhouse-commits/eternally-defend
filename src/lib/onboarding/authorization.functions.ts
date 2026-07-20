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
  .inputValidator((d: { scopes: Record<string, boolean>; territory?: string; expiry_date?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let { data: auth } = await supabase.from("client_authorizations").select("*").eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!auth || auth.status === "SIGNED" || auth.status === "ACTIVE") {
      const version = (auth?.version ?? 0) + 1;
      const { data: created, error } = await supabase.from("client_authorizations").insert({
        user_id: userId, auth_number: auth?.auth_number ?? authNumber(), version,
        status: "DRAFT", territory: data.territory ?? "Worldwide",
        expiry_date: data.expiry_date ?? new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10),
        effective_date: new Date().toISOString().slice(0, 10),
      }).select().single();
      if (error) throw new Error(error.message);
      auth = created;
    }
    await supabase.from("authorization_scopes").delete().eq("authorization_id", auth.id);
    const rows = SCOPE_KEYS.map((k) => ({ authorization_id: auth!.id, user_id: userId, scope_key: k, granted: !!data.scopes[k] }));
    await supabase.from("authorization_scopes").insert(rows);
    if (data.territory || data.expiry_date) {
      await supabase.from("client_authorizations").update({
        territory: data.territory ?? auth.territory,
        expiry_date: data.expiry_date ?? auth.expiry_date,
      }).eq("id", auth.id);
    }
    return auth;
  });

export const getAuthorizationBundle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!auth) return null;
    const [{ data: scopes }, { data: signatures }, { data: docs }, { data: reviews }] = await Promise.all([
      supabase.from("authorization_scopes").select("*").eq("authorization_id", auth.id),
      supabase.from("authorization_signatures").select("*").eq("authorization_id", auth.id).order("created_at", { ascending: false }),
      supabase.from("authorization_documents").select("*").eq("authorization_id", auth.id),
      supabase.from("authorization_admin_reviews").select("*").eq("authorization_id", auth.id).order("decided_at", { ascending: false }),
    ]);
    return { auth, scopes: scopes ?? [], signatures: signatures ?? [], documents: docs ?? [], reviews: reviews ?? [] };
  });

async function buildSnapshot(supabase: any, userId: string, authId: string) {
  const [{ data: profile }, { data: kyc }, { data: face }, { data: assets }, { data: scopes }, { data: auth }] = await Promise.all([
    supabase.from("client_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("kyc_verifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("protected_face_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("digital_assets").select("*").eq("user_id", userId),
    supabase.from("authorization_scopes").select("*").eq("authorization_id", authId),
    supabase.from("client_authorizations").select("*").eq("id", authId).maybeSingle(),
  ]);
  return { profile, kyc, face, assets, scopes, auth, generated_at: new Date().toISOString() };
}

async function renderPdf(snapshot: any, opts: { signed?: boolean; signatureSvg?: string | null; signerName?: string; signedAt?: string }) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const { height } = page.getSize();
  let y = height - 60;
  const line = (t: string, f = font, size = 10, color = rgb(0.1, 0.1, 0.15)) => {
    page.drawText(t, { x: 50, y, size, font: f, color });
    y -= size + 6;
  };
  line("ETERNA — CLIENT AUTHORIZATION LETTER", bold, 16, rgb(0.05, 0.1, 0.35));
  line(`Authorization ID: ${snapshot.auth?.auth_number}   Version: ${snapshot.auth?.version}`, bold, 10);
  line(`Client ID: ${snapshot.profile?.client_id ?? ""}`);
  line(`Legal Name: ${snapshot.profile?.legal_name ?? snapshot.profile?.full_name ?? ""}`);
  line(`Display Name: ${snapshot.profile?.display_name ?? ""}`);
  line(`Company: ${snapshot.profile?.company_name ?? ""}`);
  line(`Role: ${snapshot.profile?.role_title ?? ""}`);
  line(`Country: ${snapshot.profile?.country ?? ""}`);
  line(`Email verified: ${snapshot.profile?.email_verified_at ? "Yes" : "No"}`);
  line(`Veriff KYC: ${snapshot.kyc?.verification_status ?? "NOT_STARTED"}`);
  line(`Face liveness: ${snapshot.face?.status ?? "NOT_STARTED"}`);
  line(`Effective: ${snapshot.auth?.effective_date}   Expires: ${snapshot.auth?.expiry_date}   Territory: ${snapshot.auth?.territory}`);
  y -= 8;
  line("Verified Assets:", bold, 11);
  for (const a of (snapshot.assets ?? []).filter((x: any) => x.verification_status === "VERIFIED")) {
    line(`  • ${a.kind.toUpperCase()} — ${a.name ?? a.handle ?? a.channel_id} (${a.verification_method})`);
  }
  y -= 8;
  line("Authorized Scopes:", bold, 11);
  for (const s of (snapshot.scopes ?? []).filter((x: any) => x.granted)) {
    line(`  ✓ ${s.scope_key}`);
  }
  y -= 10;
  line("Client Declarations:", bold, 11);
  for (const t of [
    "I own the listed rights or am legally authorized to represent the owner.",
    "The listed accounts and assets belong to me or my organization.",
    "The information supplied is accurate.",
    "I understand that false complaints may create legal liability.",
    "I authorize Eterna only within the selected scope.",
    "I understand final platform submissions may require separate approval.",
    "Final platform decisions remain solely with the relevant platforms and authorities.",
    "Eterna does not guarantee content removal, account suspension, or legal outcomes.",
  ]) line(`  • ${t}`);

  if (opts.signed) {
    y -= 20;
    line("SIGNATURE", bold, 12);
    line(`Signer: ${opts.signerName ?? ""}`);
    line(`Signed at: ${opts.signedAt ?? ""}`);
    if (opts.signatureSvg && opts.signatureSvg.startsWith("data:image/png;base64,")) {
      try {
        const b64 = opts.signatureSvg.split(",")[1];
        const png = await doc.embedPng(Buffer.from(b64, "base64"));
        page.drawImage(png, { x: 50, y: y - 40, width: 160, height: 50 });
      } catch { /* ignore */ }
    }
  }
  return await doc.save();
}

export const generateDraftPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!auth) throw new Error("No authorization draft");
    const snap = await buildSnapshot(supabase, userId, auth.id);
    const bytes = await renderPdf(snap, { signed: false });
    const { putObject, getSignedGetUrl } = await import("@/lib/aws/s3.server");
    const key = `clients/${userId}/authorization/${auth.auth_number}-v${auth.version}-draft.pdf`;
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await supabase.from("authorization_documents").insert({ authorization_id: auth.id, user_id: userId, kind: "draft", version: auth.version, s3_key: key, sha256 });
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
  .inputValidator((d: {
    typed_name: string; role_title?: string; drawn_signature_svg: string;
    confirmations: Record<string, boolean>;
  }) => z.object({
    typed_name: z.string().min(2),
    role_title: z.string().optional(),
    drawn_signature_svg: z.string().min(32, "Drawn signature is required"),
    confirmations: z.record(z.string(), z.boolean()),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const required = ["reviewed", "owner", "assets_mine", "accurate", "false_claims", "scope_only", "final_approval"];
    for (const k of required) if (!data.confirmations[k]) throw new Error(`Confirmation required: ${k}`);

    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("user_id", userId).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!auth) throw new Error("No authorization draft");

    // Duplicate submission guard — if already SIGNED at this version, return the current certificate.
    const { data: existingSig } = await supabase
      .from("authorization_signatures")
      .select("*")
      .eq("authorization_id", auth.id)
      .eq("version", auth.version)
      .eq("status", "SIGNED")
      .maybeSingle();
    if (existingSig && (auth.status === "ACTIVE" || auth.status === "SIGNED" || auth.status === "UNDER_ADMIN_REVIEW")) {
      const { data: cert } = await supabase
        .from("verification_certificates")
        .select("*")
        .eq("authorization_id", auth.id)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cert) return { ok: true, duplicate: true, certificate_id: cert.id, certificate_number: cert.certificate_number };
    }

    const request = (await import("@tanstack/react-start/server")).getRequest();
    const ipAddress = request?.headers?.get("x-forwarded-for") || null;
    const userAgent = request?.headers?.get("user-agent") || null;

    const snap = await buildSnapshot(supabase, userId, auth.id);
    const bytes = await renderPdf(snap, { signed: true, signerName: data.typed_name, signatureSvg: data.drawn_signature_svg, signedAt: new Date().toISOString() });
    const doc_sha = createHash("sha256").update(bytes).digest("hex");
    const signature_sha = createHash("sha256").update(data.drawn_signature_svg).digest("hex");
    const { putObject } = await import("@/lib/aws/s3.server");
    const key = `clients/${userId}/authorization/${auth.auth_number}-v${auth.version}-signed.pdf`;
    await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
    await supabase.from("authorization_documents").insert({ authorization_id: auth.id, user_id: userId, kind: "signed", version: auth.version, s3_key: key, sha256: doc_sha });

    // Clean up any stale draft signature rows for this version.
    await supabase.from("authorization_signatures").delete()
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

    // Score computation (no admin bonus — admin review removed from onboarding).
    const kycOk = snap.kyc?.verification_status === "APPROVED";
    const faceOk = snap.face?.status === "FACE_VERIFIED";
    const emailOk = !!snap.profile?.email_verified_at;
    const assetOk = (snap.assets ?? []).some((a: any) => a.verification_status === "VERIFIED");
    let score = 0;
    if (kycOk) score += 30;
    if (faceOk) score += 25;
    if (emailOk) score += 10;
    if (assetOk) score += 25;
    score += 10; // signed
    const enforcementReady = kycOk && assetOk;

    await supabase.from("client_authorizations").update({
      status: "ACTIVE",
      enforcement_enabled: enforcementReady,
      snapshot: snap,
    }).eq("id", auth.id);

    await supabase.from("authorization_versions").insert({
      authorization_id: auth.id,
      user_id: userId,
      version: auth.version,
      snapshot: snap,
    });

    // Issue verification certificate + QR + S3 PDF.
    const cert_number = `ETC-${new Date().getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const public_slug = randomBytes(6).toString("hex");
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const certDoc = await PDFDocument.create();
    const cFont = await certDoc.embedFont(StandardFonts.Helvetica);
    const cBold = await certDoc.embedFont(StandardFonts.HelveticaBold);
    const cPage = certDoc.addPage([612, 792]);
    const { height } = cPage.getSize();
    let cy = height - 60;
    const cline = (t: string, f = cFont, sz = 11) => { cPage.drawText(t, { x: 60, y: cy, size: sz, font: f, color: rgb(0.05, 0.1, 0.35) }); cy -= sz + 8; };
    cline("ETERNA VERIFICATION CERTIFICATE", cBold, 18);
    cline(`Certificate: ${cert_number}`, cBold);
    cline(`Authorization: ${auth.auth_number}`);
    cline(`Client ID: ${snap.profile?.client_id ?? ""}`);
    cline(`Name: ${snap.profile?.display_name ?? snap.profile?.legal_name ?? snap.profile?.full_name ?? ""}`);
    cline(`Company: ${snap.profile?.company_name ?? ""}`);
    cline(`Verification Score: ${score}/100`);
    cline(`Status: ACTIVE`);
    cline(`Issued: ${new Date().toISOString().slice(0, 10)}`);
    cline(`Expires: ${auth.expiry_date}`);
    cy -= 10;
    if (kycOk) cline("✓ Identity Verified (Veriff)", cBold);
    if (faceOk) cline("✓ Real Human Verified (Rekognition Liveness)", cBold);
    if (faceOk) cline("✓ Face Protected Profile Created", cBold);
    if (assetOk) cline("✓ Asset Ownership Verified", cBold);
    cline("✓ Authorization Signed", cBold);
    try {
      const QR = await import("qrcode");
      const publicBase = process.env.PUBLIC_APP_URL ?? "https://eternally-defend.lovable.app";
      const dataUrl = await QR.toDataURL(`${publicBase}/verify/${public_slug}`);
      const png = await certDoc.embedPng(Buffer.from(dataUrl.split(",")[1], "base64"));
      cPage.drawImage(png, { x: 420, y: 90, width: 120, height: 120 });
      cPage.drawText(`Verify: /verify/${public_slug}`, { x: 380, y: 78, size: 8, font: cFont, color: rgb(0.3, 0.3, 0.3) });
    } catch { /* ignore */ }
    const certBytes = await certDoc.save();
    const certSha = createHash("sha256").update(certBytes).digest("hex");
    const certKey = `clients/${userId}/certificates/${cert_number}.pdf`;
    await putObject({ key: certKey, body: Buffer.from(certBytes), contentType: "application/pdf" });
    const { data: insertedCert, error: certErr } = await supabase.from("verification_certificates").insert({
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
    }).select().single();
    if (certErr) throw new Error(`Failed to issue certificate: ${certErr.message}`);
    await supabase.from("authorization_documents").insert({
      authorization_id: auth.id, user_id: userId, kind: "certificate", version: auth.version, s3_key: certKey, sha256: certSha,
    });

    // Audit trail — one row per action for immutable history.
    await supabase.from("authorization_audit_logs").insert([
      { user_id: userId, actor_id: userId, action: "signed", target: auth.auth_number },
      { user_id: userId, actor_id: userId, action: "authorization_activated", target: auth.auth_number },
      { user_id: userId, actor_id: userId, action: "certificate_issued", target: cert_number },
    ]);

    // Mark onboarding steps 7 (signature) + 8 (certificate) COMPLETED, land on step 8
    // so the user sees the Verification Certificate screen next.
    const { data: progress } = await supabase.from("onboarding_progress").select("*").eq("user_id", userId).maybeSingle();
    const states = {
      ...(progress?.step_states as Record<string, string> ?? {}),
      "7": "COMPLETED",
      "8": "COMPLETED",
    };
    await supabase.from("onboarding_progress").upsert({
      user_id: userId,
      current_step: 8,
      step_states: states,
      overall_status: "IN_PROGRESS",
    }, { onConflict: "user_id" });

    await supabase.from("client_profiles").update({ onboarding_completed: true } as any).eq("user_id", userId);

    return { ok: true, duplicate: false, certificate_id: insertedCert.id, certificate_number: cert_number, signature_sha256: signature_sha, document_sha256: doc_sha };
  });

export const getSignedDocUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { doc_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc } = await supabase.from("authorization_documents").select("*").eq("id", data.doc_id).eq("user_id", userId).maybeSingle();
    if (!doc) throw new Error("Not found");
    const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
    return { url: await getSignedGetUrl(doc.s3_key, 300) };
  });
