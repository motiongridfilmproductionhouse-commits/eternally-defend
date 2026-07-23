import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { generatePartnerMou } from "./mou.server";

function meta() {
  const req = getRequest();
  const h = req?.headers;
  const ip =
    h?.get("x-forwarded-for")?.split(",")[0].trim() ||
    h?.get("cf-connecting-ip") ||
    h?.get("x-real-ip") ||
    null;
  return { ip, ua: h?.get("user-agent") ?? null };
}

const ApplicationSchema = z.object({
  legal_company_name: z.string().trim().min(2).max(200),
  trading_name: z.string().trim().max(200).optional().nullable(),
  registration_number: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().min(2).max(80),
  address: z.string().trim().max(500).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  industry: z.string().trim().max(120).optional().nullable(),
  founder_name: z.string().trim().min(2).max(200),
  rep_name: z.string().trim().min(2).max(200),
  rep_title: z.string().trim().max(120).optional().nullable(),
  business_email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  territory: z.string().trim().max(200).optional().nullable(),
  expected_monthly_clients: z.number().int().min(0).max(100000).optional().nullable(),
  partnership_type: z.enum(["referral", "reseller", "agency", "enterprise"]),
  trade_licence_s3_key: z.string().trim().max(500).optional().nullable(),
  id_document_s3_key: z.string().trim().max(500).optional().nullable(),
  declarations: z.object({
    authority: z.literal(true),
    accurate: z.literal(true),
    commercial_terms: z.literal(true),
    no_incentives: z.literal(true),
    data_protection: z.literal(true),
  }),
  signature_text: z.string().trim().min(2).max(200),
});

function fmtAgreementNumber() {
  const y = new Date().getUTCFullYear();
  const r = randomBytes(3).toString("hex").toUpperCase();
  return `ETP-${y}-${r}`;
}

export const getMyPartnerApplication = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: application } = await supabase
      .from("partner_applications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!application) return { application: null, agreement: null, profile: null };
    const [{ data: agreement }, { data: profile }] = await Promise.all([
      supabase
        .from("partner_agreements")
        .select("*")
        .eq("application_id", application.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("partner_profiles").select("*").eq("user_id", userId).maybeSingle(),
    ]);
    return { application, agreement, profile };
  });

export const submitPartnerApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.infer<typeof ApplicationSchema>) => ApplicationSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ip, ua } = meta();

    // Reject duplicate active application
    const { data: existing } = await supabase
      .from("partner_applications")
      .select("id, status")
      .eq("user_id", userId)
      .in("status", ["PENDING_REVIEW", "INFO_REQUESTED", "APPROVED"])
      .maybeSingle();
    if (existing) throw new Error("You already have an active partner application.");

    const signedAt = new Date().toISOString();
    const canonical = JSON.stringify({
      user_id: userId,
      company: data.legal_company_name,
      signer: data.signature_text.trim(),
      declarations: data.declarations,
      signed_at: signedAt,
    });
    const signature_hash = createHash("sha256").update(canonical).digest("hex");

    const { data: app, error } = await supabase
      .from("partner_applications")
      .insert({
        user_id: userId,
        status: "PENDING_REVIEW",
        legal_company_name: data.legal_company_name,
        trading_name: data.trading_name ?? null,
        registration_number: data.registration_number ?? null,
        country: data.country,
        address: data.address ?? null,
        website: data.website ?? null,
        industry: data.industry ?? null,
        founder_name: data.founder_name,
        rep_name: data.rep_name,
        rep_title: data.rep_title ?? null,
        business_email: data.business_email,
        phone: data.phone ?? null,
        whatsapp: data.whatsapp ?? null,
        territory: data.territory ?? null,
        expected_monthly_clients: data.expected_monthly_clients ?? null,
        partnership_type: data.partnership_type,
        trade_licence_s3_key: data.trade_licence_s3_key ?? null,
        id_document_s3_key: data.id_document_s3_key ?? null,
        declarations: data.declarations as never,
        signature_text: data.signature_text.trim(),
        signature_hash,
        signed_at: signedAt,
        ip_address: ip,
        user_agent: ua,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // Generate DRAFT agreement immediately (Awaiting Eterna approval)
    const agreementNumber = fmtAgreementNumber();
    const referralCode = randomBytes(4).toString("hex").toUpperCase();
    const partnerIdPlaceholder = `PENDING-${randomBytes(2).toString("hex").toUpperCase()}`;

    const bytes = await generatePartnerMou({
      partnerCompany: data.legal_company_name,
      tradingName: data.trading_name,
      registrationNumber: data.registration_number,
      country: data.country,
      address: data.address,
      repName: data.rep_name,
      repTitle: data.rep_title,
      businessEmail: data.business_email,
      phone: data.phone,
      territory: data.territory,
      partnershipType: data.partnership_type,
      partnerId: partnerIdPlaceholder,
      referralCode,
      agreementNumber,
      effectiveDate: signedAt.slice(0, 10),
      partnerSignatureText: data.signature_text.trim(),
      partnerSignedAt: signedAt,
    });
    const sha = createHash("sha256").update(bytes).digest("hex");
    const draftPath = `${userId}/agreements/${agreementNumber}-draft.pdf`;

    const uploadRes = await supabase.storage
      .from("partner-documents")
      .upload(draftPath, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadRes.error) throw new Error(`Agreement upload failed: ${uploadRes.error.message}`);

    await supabase.from("partner_agreements").insert({
      application_id: app.id,
      user_id: userId,
      version: 1,
      status: "DRAFT_AWAITING_ETERNA",
      draft_s3_key: draftPath,
      sha256: sha,
    });

    await supabase.from("partner_audit_log").insert({
      actor_id: userId,
      application_id: app.id,
      action: "application_submitted",
      payload: { agreementNumber, signature_hash } as never,
      ip_address: ip,
      user_agent: ua,
    });

    return { application_id: app.id };
  });

export const getPartnerAgreementUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { agreement_id: string; kind: "draft" | "signed" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: ag } = await supabase
      .from("partner_agreements")
      .select("*")
      .eq("id", data.agreement_id)
      .maybeSingle();
    if (!ag) throw new Error("Not found");
    const isOwner = ag.user_id === userId;
    const { data: adminOk } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isOwner && !adminOk) throw new Error("Forbidden");
    const key = data.kind === "signed" ? ag.signed_s3_key : ag.draft_s3_key;
    if (!key) throw new Error("Not available");
    const signed = await supabase.storage.from("partner-documents").createSignedUrl(key, 300);
    if (signed.error || !signed.data) throw new Error(signed.error?.message ?? "signing failed");
    return { url: signed.data.signedUrl };
  });

// ================== Admin ==================
async function requireAdmin(ctx: { supabase: { rpc: (n: string, a: unknown) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

export const listPartnerApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { data } = await context.supabase
      .from("partner_applications")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const decidePartnerApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    application_id: string;
    decision: "approve" | "reject" | "request_info";
    territory?: string | null;
    notes?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { supabase, userId } = context;
    const { data: app } = await supabase
      .from("partner_applications")
      .select("*")
      .eq("id", data.application_id)
      .maybeSingle();
    if (!app) throw new Error("Not found");

    const nextStatus =
      data.decision === "approve" ? "APPROVED" :
      data.decision === "reject" ? "REJECTED" : "INFO_REQUESTED";

    await supabase.from("partner_applications").update({
      status: nextStatus,
      review_notes: data.notes ?? null,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      territory: data.territory ?? app.territory,
    } as never).eq("id", app.id);

    if (data.decision === "approve") {
      // Provision partner_profile + sign agreement + activate
      const partnerId = `EP-${new Date().getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
      const referralCode = randomBytes(4).toString("hex").toUpperCase();

      await supabase.from("partner_profiles").insert({
        user_id: app.user_id,
        partner_id: partnerId,
        referral_code: referralCode,
        legal_company_name: app.legal_company_name,
        territory: data.territory ?? app.territory,
        commission_pct: 25,
        status: "ACTIVE",
      });

      await supabase.from("partner_applications").update({
        assigned_partner_id: partnerId,
      } as never).eq("id", app.id);

      // Countersign the draft agreement
      const { data: agreement } = await supabase
        .from("partner_agreements")
        .select("*")
        .eq("application_id", app.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (agreement) {
        const signedAt = new Date().toISOString();
        const bytes = await generatePartnerMou({
          partnerCompany: app.legal_company_name,
          tradingName: app.trading_name,
          registrationNumber: app.registration_number,
          country: app.country,
          address: app.address,
          repName: app.rep_name,
          repTitle: app.rep_title,
          businessEmail: app.business_email,
          phone: app.phone,
          territory: data.territory ?? app.territory,
          partnershipType: app.partnership_type,
          partnerId,
          referralCode,
          agreementNumber: agreement.draft_s3_key.split("/").pop()!.replace("-draft.pdf", ""),
          effectiveDate: signedAt.slice(0, 10),
          partnerSignatureText: app.signature_text,
          partnerSignedAt: app.signed_at,
          eternaSignerName: "Eterna Sentinel Defence LLC — Authorized Signatory",
          eternaSignedAt: signedAt,
        });
        const sha = createHash("sha256").update(bytes).digest("hex");
        const signedKey = agreement.draft_s3_key.replace("-draft.pdf", "-signed.pdf");
        const up = await supabase.storage
          .from("partner-documents")
          .upload(signedKey, bytes, { contentType: "application/pdf", upsert: true });
        if (up.error) throw new Error(up.error.message);
        await supabase.from("partner_agreements").update({
          status: "ACTIVE",
          signed_s3_key: signedKey,
          sha256: sha,
          eterna_signer_id: userId,
          eterna_signed_at: signedAt,
        } as never).eq("id", agreement.id);
      }

      // Grant partner role
      await supabase.from("user_roles").insert({
        user_id: app.user_id,
        role: "partner",
      } as never).select().maybeSingle().then(() => undefined).catch(() => undefined);
    }

    await supabase.from("partner_audit_log").insert({
      actor_id: userId,
      application_id: app.id,
      action: `admin_${data.decision}`,
      payload: { notes: data.notes ?? null } as never,
    });

    return { ok: true };
  });
