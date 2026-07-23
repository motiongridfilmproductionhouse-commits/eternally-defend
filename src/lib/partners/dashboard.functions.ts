import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function requirePartner(ctx: { supabase: { from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } }; userId: string }) {
  const { data } = await ctx.supabase.from("partner_profiles").select("*").eq("user_id", ctx.userId).maybeSingle();
  if (!data) throw new Error("Not an active partner");
  return data as { partner_id: string; referral_code: string; legal_company_name: string; territory: string | null; commission_pct: number; status: string };
}

export const getPartnerDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const partner = await requirePartner(context as never);
    const [{ data: leads }, { data: commissions }, { data: agreements }] = await Promise.all([
      supabase.from("partner_referred_clients").select("*").eq("partner_id", partner.partner_id).order("created_at", { ascending: false }),
      supabase.from("partner_commissions").select("*").eq("partner_id", partner.partner_id).order("earned_at", { ascending: false }),
      supabase.from("partner_agreements").select("*").eq("user_id", context.userId).order("version", { ascending: false }),
    ]);
    const totals = (commissions ?? []).reduce(
      (acc, c) => {
        const amt = Number(c.commission_inr ?? 0);
        if (c.status === "PAID") acc.paid += amt;
        else if (c.status === "PAYABLE") acc.payable += amt;
        else if (c.status === "PENDING") acc.pending += amt;
        acc.lifetime += amt;
        return acc;
      },
      { paid: 0, payable: 0, pending: 0, lifetime: 0 },
    );
    return { partner, leads: leads ?? [], commissions: commissions ?? [], agreements: agreements ?? [], totals };
  });

export const registerPartnerLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lead_email: string; lead_name?: string; lead_phone?: string; notes?: string }) =>
    z.object({
      lead_email: z.string().email().max(200),
      lead_name: z.string().max(200).optional(),
      lead_phone: z.string().max(40).optional(),
      notes: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const partner = await requirePartner(context as never);
    const { supabase } = context;
    // Check duplicate globally: is email already a claimed lead under a DIFFERENT partner?
    const { data: existing } = await supabase
      .from("partner_referred_clients")
      .select("id, partner_id, status")
      .ilike("lead_email", data.lead_email)
      .in("status", ["LEAD", "ONBOARDING", "ACTIVE", "PAID"])
      .maybeSingle();
    if (existing && existing.partner_id !== partner.partner_id) {
      throw new Error("This client email is already attributed to another partner and cannot be claimed.");
    }
    const { error } = await supabase.from("partner_referred_clients").insert({
      partner_id: partner.partner_id,
      referral_code: partner.referral_code,
      lead_email: data.lead_email,
      lead_name: data.lead_name ?? null,
      lead_phone: data.lead_phone ?? null,
      notes: data.notes ?? null,
      status: "LEAD",
      sale_amount_inr: 500000,
      commission_amount_inr: 125000,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generatePartnerProposalUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_name: string; client_email?: string }) => d)
  .handler(async ({ data, context }) => {
    const partner = await requirePartner(context as never);
    const { PDFDocument, rgb } = await import("pdf-lib");
    const { embedUnicodeFontStack, drawUnicodeText } = await import("@/lib/pdf/unicode-fonts.server");
    const doc = await PDFDocument.create();
    const stack = await embedUnicodeFontStack(doc);
    const page = doc.addPage([612, 792]);
    let y = 740;
    const line = (t: string, size = 11, bold = false) => {
      drawUnicodeText(page, t, { x: 60, y, size, stack: bold ? stack.bold : stack.regular, color: rgb(0.05, 0.1, 0.35) });
      y -= size + 8;
    };
    line("ETERNA PROTECTION PROPOSAL", 18, true);
    line(`Prepared for: ${data.client_name}`, 12, true);
    if (data.client_email) line(`Contact: ${data.client_email}`);
    line(`Prepared by: ${partner.legal_company_name} (Partner ID ${partner.partner_id})`);
    line(`Date: ${new Date().toISOString().slice(0, 10)}`);
    y -= 6;
    line("Scope", 13, true);
    line("• AI-powered content fingerprinting (SHA-256 + perceptual).");
    line("• Identity + face protection with Amazon Rekognition.");
    line("• 12+ platform monitoring, DMCA drafting and takedown workflows.");
    line("• Persistent Channel Watch for impersonation and harassment.");
    line("• Verification Certificate and enforcement package.");
    y -= 6;
    line("Investment", 13, true);
    line("Eterna Protection Programme — INR 5,00,000 per client (all-inclusive, annual).");
    y -= 6;
    line("Next Steps", 13, true);
    line(`Share this proposal and your referral link with the client:`);
    line(`Referral Code: ${partner.referral_code}`, 11, true);
    const bytes = await doc.save();
    const key = `${context.userId}/proposals/${Date.now()}-${data.client_name.replace(/[^\w]+/g, "_").slice(0, 60)}.pdf`;
    const { supabase } = context;
    const up = await supabase.storage.from("partner-documents").upload(key, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const signed = await supabase.storage.from("partner-documents").createSignedUrl(key, 600);
    if (signed.error || !signed.data) throw new Error(signed.error?.message ?? "signing failed");
    return { url: signed.data.signedUrl };
  });

export const getPartnerUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { filename: string; kind: "trade_licence" | "id_document" }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const safe = data.filename.replace(/[^\w.\-]+/g, "_").slice(0, 120);
    const key = `${userId}/applications/${data.kind}-${Date.now()}-${safe}`;
    const signed = await supabase.storage.from("partner-documents").createSignedUploadUrl(key);
    if (signed.error || !signed.data) throw new Error(signed.error?.message ?? "signing failed");
    return { url: signed.data.signedUrl, token: signed.data.token, path: key };
  });
