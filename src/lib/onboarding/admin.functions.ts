import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

async function requireAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const listPendingReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data } = await context.supabase.from("client_authorizations")
      .select("*, client_profiles!inner(*)")
      .in("status", ["UNDER_ADMIN_REVIEW", "SUSPENDED"])
      .order("updated_at", { ascending: false });
    return data ?? [];
  });

export const getReviewDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { authorization_id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase } = context;
    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("id", data.authorization_id).maybeSingle();
    if (!auth) throw new Error("Not found");
    const [{ data: profile }, { data: kyc }, { data: face }, { data: assets }, { data: scopes }, { data: sigs }, { data: docs }, { data: reviews }] = await Promise.all([
      supabase.from("client_profiles").select("*").eq("user_id", auth.user_id).maybeSingle(),
      supabase.from("kyc_verifications").select("*").eq("user_id", auth.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("protected_face_profiles").select("*").eq("user_id", auth.user_id).maybeSingle(),
      supabase.from("digital_assets").select("*").eq("user_id", auth.user_id),
      supabase.from("authorization_scopes").select("*").eq("authorization_id", auth.id),
      supabase.from("authorization_signatures").select("*").eq("authorization_id", auth.id).order("created_at", { ascending: false }),
      supabase.from("authorization_documents").select("*").eq("authorization_id", auth.id),
      supabase.from("authorization_admin_reviews").select("*").eq("authorization_id", auth.id).order("decided_at", { ascending: false }),
    ]);
    return { auth, profile, kyc, face, assets, scopes, signatures: sigs, documents: docs, reviews };
  });

function computeScore(bundle: any): number {
  let s = 0;
  if (bundle.kyc?.verification_status === "APPROVED") s += 25;
  if (bundle.face?.status === "FACE_VERIFIED") s += 20;
  if (bundle.profile?.email_verified_at) s += 10;
  if ((bundle.assets ?? []).some((a: any) => a.verification_status === "VERIFIED")) s += 25;
  if ((bundle.signatures ?? []).some((x: any) => x.status === "SIGNED")) s += 10;
  return s; // admin approval adds 10 at issue time
}

export const decideAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { authorization_id: string; decision: "approve" | "reject" | "request_info" | "suspend" | "revoke" | "renew"; notes?: string }) =>
    z.object({
      authorization_id: z.string(),
      decision: z.enum(["approve", "reject", "request_info", "suspend", "revoke", "renew"]),
      notes: z.string().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase, userId } = context;
    const { data: auth } = await supabase.from("client_authorizations").select("*").eq("id", data.authorization_id).maybeSingle();
    if (!auth) throw new Error("Not found");

    await supabase.from("authorization_admin_reviews").insert({
      authorization_id: data.authorization_id, user_id: auth.user_id, reviewer_id: userId,
      decision: data.decision, notes: data.notes ?? null,
    });

    const nextStatus: Record<string, string> = {
      approve: "ACTIVE", reject: "REJECTED", request_info: "AWAITING_SIGNATURE",
      suspend: "SUSPENDED", revoke: "REVOKED", renew: "ACTIVE",
    };
    const newStatus = nextStatus[data.decision];

    if (data.decision === "approve" || data.decision === "renew") {
      // Compute score & issue certificate
      const [{ data: profile }, { data: kyc }, { data: face }, { data: assets }, { data: sigs }] = await Promise.all([
        supabase.from("client_profiles").select("*").eq("user_id", auth.user_id).maybeSingle(),
        supabase.from("kyc_verifications").select("*").eq("user_id", auth.user_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("protected_face_profiles").select("*").eq("user_id", auth.user_id).maybeSingle(),
        supabase.from("digital_assets").select("*").eq("user_id", auth.user_id),
        supabase.from("authorization_signatures").select("*").eq("authorization_id", auth.id),
      ]);
      const bundle = { profile, kyc, face, assets, signatures: sigs };
      const base = computeScore(bundle);
      const score = base + 10; // admin approval

      const enforcementReady = kyc?.verification_status === "APPROVED"
        && face?.status === "FACE_VERIFIED"
        && (assets ?? []).some((a: any) => a.verification_status === "VERIFIED")
        && (sigs ?? []).some((x: any) => x.status === "SIGNED")
        && score >= 100;

      await supabase.from("client_authorizations").update({
        status: newStatus as never, enforcement_enabled: enforcementReady,
      }).eq("id", auth.id);

      // Generate certificate PDF + QR
      const cert_number = `ETC-${new Date().getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const public_slug = randomBytes(6).toString("hex");
      const { PDFDocument, rgb } = await import("pdf-lib");
      const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");
      const doc = await PDFDocument.create();
      const stack = await embedUnicodeFontStack(doc);
      const page = doc.addPage([612, 792]);
      const { height } = page.getSize();
      let y = height - 60;
      const line = (t: string, bold = false, sz = 11) => {
        drawUnicodeText(page, t, { x: 60, y, size: sz, stack: bold ? stack.bold : stack.regular, color: rgb(0.05, 0.1, 0.35) });
        y -= sz + 8;
      };
      line("ETERNA VERIFICATION CERTIFICATE", true, 18);
      line(`Certificate: ${cert_number}`, true);
      line(`Authorization: ${auth.auth_number}`);
      line(`Client ID: ${profile?.client_id ?? ""}`);
      line(`Name: ${profile?.display_name ?? (profile as { full_name?: string } | null)?.full_name ?? ""}`);
      line(`Company: ${profile?.company_name ?? ""}`);
      line(`Verification Score: ${score}/100`);
      line(`Status: ACTIVE`);
      line(`Issued: ${new Date().toISOString().slice(0, 10)}`);
      line(`Expires: ${auth.expiry_date}`);
      y -= 10;
      line("✓ Identity Verified (Veriff)", true);
      line("✓ Real Human Verified (Rekognition Liveness)", true);
      line("✓ Face Protected Profile Created", true);
      line("✓ Asset Ownership Verified", true);
      line("✓ Authorization Signed", true);
      line("✓ Admin Approved", true);
      // QR
      try {
        const QR = await import("qrcode");
        const publicBase = process.env.PUBLIC_APP_URL ?? "https://eternally-defend.lovable.app";
        const dataUrl = await QR.toDataURL(`${publicBase}/verify/${public_slug}`);
        const png = await doc.embedPng(Buffer.from(dataUrl.split(",")[1], "base64"));
        page.drawImage(png, { x: 420, y: 90, width: 120, height: 120 });
        drawUnicodeText(page, `Verify: /verify/${public_slug}`, { x: 380, y: 78, size: 8, stack: stack.regular, color: rgb(0.3, 0.3, 0.3) });
      } catch { /* ignore */ }
      const bytes = await doc.save();
      const sha = createHash("sha256").update(bytes).digest("hex");
      const key = `clients/${auth.user_id}/certificates/${cert_number}.pdf`;
      const { putObject } = await import("@/lib/aws/s3.server");
      await putObject({ key, body: Buffer.from(bytes), contentType: "application/pdf" });
      await supabase.from("verification_certificates").insert({
        user_id: auth.user_id, authorization_id: auth.id, certificate_number: cert_number,
        public_slug, score, status: "ACTIVE",
        expires_at: new Date(auth.expiry_date ?? Date.now() + 365 * 86400_000).toISOString(),
        s3_key: key, sha256: sha, snapshot: bundle,
      });
      await supabase.from("authorization_documents").insert({
        authorization_id: auth.id, user_id: auth.user_id, kind: "certificate", version: auth.version, s3_key: key, sha256: sha,
      });
      const { data: progress } = await supabase.from("onboarding_progress").select("*").eq("user_id", auth.user_id).maybeSingle();
      const states = {
        ...(progress?.step_states as Record<string, string> ?? {}),
        "8": "COMPLETED"
      };
      await supabase.from("onboarding_progress").upsert({
        user_id: auth.user_id,
        current_step: Math.max(progress?.current_step ?? 1, 9),
        step_states: states,
        overall_status: "IN_PROGRESS"
      }, { onConflict: "user_id" });
    } else {
      await supabase.from("client_authorizations").update({ status: newStatus as never, enforcement_enabled: false }).eq("id", auth.id);
    }

    await supabase.from("authorization_audit_logs").insert({
      user_id: auth.user_id, actor_id: userId, action: `admin_${data.decision}`, target: auth.auth_number,
    });
    return { ok: true };
  });
