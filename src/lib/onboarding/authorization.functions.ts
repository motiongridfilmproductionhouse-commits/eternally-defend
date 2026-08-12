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
  const face_reference = await loadFaceReference(supabase, userId);
  return {
    profile,
    kyc,
    face,
    assets,
    scopes,
    auth,
    face_reference,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Client-safe facial reference for the authorization letter: the enrolled
 * portrait bytes plus the enrollment date. No Rekognition IDs, collection
 * names, S3 locations or confidence values leave this function.
 */
async function loadFaceReference(supabase: any, userId: string) {
  const { data: faces } = await supabase
    .from("protected_faces")
    .select("s3_key,s3_bucket,created_at,status")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1);
  const face = faces?.[0];
  if (!face?.s3_key) return null;
  const { data: profileRow } = await supabase
    .from("protected_face_profiles")
    .select("enrollment_date,created_at")
    .eq("user_id", userId)
    .maybeSingle();
  try {
    const { getObjectBytes } = await import("@/lib/aws/s3.server");
    const bytes = await getObjectBytes(face.s3_key, face.s3_bucket ?? undefined);
    if (!bytes) return null;
    return {
      enrolled_at:
        profileRow?.enrollment_date ?? profileRow?.created_at ?? face.created_at ?? null,
      image_base64: Buffer.from(bytes).toString("base64"),
    };
  } catch {
    return null;
  }
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
    const { renderAuthorizationLetterPdf } = await import(
      "@/lib/onboarding/authorization-letter-pdf.server"
    );
    const bytes = await renderAuthorizationLetterPdf(snap, { signed: false });
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
      drawn_signature_svg?: string;
      confirmations: Record<string, boolean>;
    }) =>
      z
        .object({
          typed_name: z.string().min(2),
          role_title: z.string().optional(),
          // Legacy field — electronic signing no longer captures drawn strokes.
          drawn_signature_svg: z.string().optional(),
          confirmations: z.record(z.string(), z.boolean()),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      if (!data.confirmations["reviewed"]) throw new Error("DECL_MISSING:reviewed");


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

      // Typed name must match the client's legal name on record (case/spacing tolerant).
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const legalOnRecord = String(
        snap.profile?.legal_name || snap.profile?.full_name || "",
      ).trim();
      if (legalOnRecord && norm(data.typed_name) !== norm(legalOnRecord)) {
        throw new Error(`NAME_MISMATCH:${legalOnRecord}`);
      }

      const signedAt = new Date().toISOString();

      // Generate BOTH PDFs (letter + certificate) before we touch signatures/certificates rows,
      // so we never leave a partial audit state on failure.
      const { renderAuthorizationLetterPdf } = await import(
        "@/lib/onboarding/authorization-letter-pdf.server"
      );
      const bytes = await renderAuthorizationLetterPdf(snap, {
        signed: true,
        signerName: data.typed_name,
        signedAt,
      });
      const doc_sha = createHash("sha256").update(bytes).digest("hex");
      // Digital signature evidence: typed name + authorization id + version + timestamp.
      const signature_sha = createHash("sha256")
        .update(`${data.typed_name}|${auth.auth_number}|v${auth.version}|${signedAt}`)
        .digest("hex");


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
        drawn_signature_svg: null,
        signature_sha256: signature_sha,
        signed_at: signedAt,

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
  .inputValidator((d: { doc_id: string; disposition?: "inline" | "attachment" }) => d)
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
    return {
      url: await getSignedGetUrl(doc.s3_key, 300, {
        // Inline lets the letter render inside the onboarding step instead of downloading.
        disposition: data.disposition === "attachment" ? "attachment" : "inline",
        filename: "Eterna_Authorization_Letter.pdf",
        contentType: "application/pdf",
      }),
    };
  });
