import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CASE_STATUS_KEYS, FINAL_UNSUCCESSFUL, MATERIAL_STATUSES, REMOVED_CUSTOMER_TEXT, caseLabel } from "./status";

async function staff(context: { supabase: any; userId: string }) {
  const { data: ok } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!ok) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function load(admin: any, caseId: string) {
  const { data } = await admin.from("removal_orders").select("*").eq("case_id", caseId).maybeSingle();
  if (!data) throw new Error("Case not found");
  return data as Record<string, any>;
}

type Ev = { event_type: string; old_value?: string | null; new_value?: string | null; detail?: string | null; customer_visible?: boolean };
async function log(admin: any, orderId: string, actor: string, evs: Ev[]) {
  await admin.from("removal_order_events").insert(evs.map((e) => ({ ...e, order_id: orderId, actor })));
}

async function mailCustomer(row: Record<string, any>, subject: string, lines: string[]) {
  const { sendRemovalMail, trackLink } = await import("./mail.server");
  await sendRemovalMail(row.email, `${subject} · ${row.case_id}`, [`Hello ${row.full_name},`, ...lines, `Track your case: ${trackLink(row.case_id)}`]);
}

export const listRemovalCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await staff(context);
    const { data } = await admin.from("removal_orders")
      .select("case_id,full_name,email,phone,url,platform,issue,fee_amount,currency,payment_status,case_status,staff_attention,info_request,created_at,updated_at,status_changed_at")
      .order("created_at", { ascending: false }).limit(1000);
    return (data ?? []) as Array<Record<string, any>>;
  });

export const getRemovalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ caseId: z.string().max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await staff(context);
    const row = await load(admin, data.caseId);
    const { data: events } = await admin.from("removal_order_events").select("*").eq("order_id", row.id).order("created_at");
    const evidence = await Promise.all(((row.evidence ?? []) as any[]).map(async (f) => {
      const { data: s } = await admin.storage.from("removal-order-evidence").createSignedUrl(f.path, 600);
      return { name: f.name, source: f.source ?? "initial", uploaded_at: f.uploaded_at ?? row.created_at, url: s?.signedUrl ?? null };
    }));
    if (row.staff_attention) await admin.from("removal_orders").update({ staff_attention: false }).eq("id", row.id);
    const { evidence: _e, ...rest } = row;
    return { ...rest, evidence, events: (events ?? []) as any[] } as Record<string, any> & { evidence: Array<{ name: string; source: string; uploaded_at: string; url: string | null }>; events: any[] };
  });

export const updateRemovalPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    caseId: z.string().max(20),
    action: z.enum(["invoice_sent", "payment_pending", "paid", "refunded", "cancelled"]),
    invoiceRef: z.string().trim().max(120).optional(), paymentRef: z.string().trim().max(120).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await staff(context);
    const row = await load(admin, data.caseId);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { payment_status: data.action };
    if (data.invoiceRef) patch.invoice_ref = data.invoiceRef;
    if (data.paymentRef) patch.payment_ref = data.paymentRef;
    const evs: Ev[] = [{ event_type: "payment_status", old_value: row.payment_status, new_value: data.action, detail: data.invoiceRef || data.paymentRef || null, customer_visible: ["invoice_sent", "paid", "refunded"].includes(data.action) }];
    if (data.action === "paid") {
      if (row.payment_status === "paid") throw new Error("Already marked paid");
      patch.paid_at = now;
      if (row.case_status === "awaiting_payment") {
        Object.assign(patch, { case_status: "case_received", status_changed_at: now, status_changed_by: context.userId });
        evs.push({ event_type: "status_change", old_value: "awaiting_payment", new_value: "case_received", customer_visible: true });
      }
    }
    await admin.from("removal_orders").update(patch).eq("id", row.id);
    await log(admin, row.id, context.userId, evs);
    if (data.action === "invoice_sent") await mailCustomer(row, "Your invoice is ready", [
      `Your invoice for ${row.currency} ${row.fee_amount} has been sent${data.invoiceRef ? ` (reference ${data.invoiceRef})` : ""}.`,
      "Removal processing begins after payment is confirmed.",
    ]);
    if (data.action === "paid") {
      await mailCustomer(row, "Payment confirmed", ["Payment is confirmed and your case has entered Eterna's removal workflow."]);
      const { sendRemovalMail, staffRecipients } = await import("./mail.server");
      await sendRemovalMail(staffRecipients(), `Payment confirmed for ${row.case_id}`, [`${row.case_id} is now active.`]);
    }
    return { ok: true };
  });

export const updateRemovalCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    caseId: z.string().max(20),
    status: z.enum(CASE_STATUS_KEYS).optional(),
    customerMessage: z.string().trim().max(2000).optional(),
    internalNotes: z.string().max(10000).optional(),
    outcomeExplanation: z.string().trim().max(2000).optional(),
    removal: z.object({ verifiedAt: z.string().min(8), note: z.string().trim().max(2000), inaccessible: z.boolean() }).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await staff(context);
    const row = await load(admin, data.caseId);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    const evs: Ev[] = [];
    if (data.status && data.status !== row.case_status) {
      if (row.payment_status !== "paid" && !["awaiting_payment", "closed"].includes(data.status))
        throw new Error("Mark the case paid before it enters the removal workflow.");
      if (FINAL_UNSUCCESSFUL.includes(data.status) && !data.outcomeExplanation)
        throw new Error("Add a customer-facing explanation for this outcome.");
      if (data.status === "removed" && !data.removal) throw new Error("Removal verification details are required.");
      Object.assign(patch, { case_status: data.status, status_changed_at: now, status_changed_by: context.userId });
      evs.push({ event_type: "status_change", old_value: row.case_status, new_value: data.status, customer_visible: true });
      if (data.status === "removed") {
        patch.removal_verification = { verified_at: data.removal!.verifiedAt, note: data.removal!.note, inaccessible: data.removal!.inaccessible, by: context.userId };
        evs.push({ event_type: "removal_verified", detail: data.removal!.verifiedAt, customer_visible: false });
      }
    }
    if (data.outcomeExplanation !== undefined && data.outcomeExplanation !== (row.outcome_explanation ?? "")) patch.outcome_explanation = data.outcomeExplanation || null;
    if (data.customerMessage !== undefined && data.customerMessage !== (row.customer_message ?? "")) {
      patch.customer_message = data.customerMessage || null;
      evs.push({ event_type: "customer_update", new_value: data.customerMessage, customer_visible: true });
    }
    if (data.internalNotes !== undefined && data.internalNotes !== (row.internal_notes ?? "")) {
      patch.internal_notes = data.internalNotes || null;
      evs.push({ event_type: "internal_note", customer_visible: false });
    }
    if (!Object.keys(patch).length) return { ok: true };
    await admin.from("removal_orders").update(patch).eq("id", row.id);
    await log(admin, row.id, context.userId, evs);
    if (data.status && data.status !== row.case_status && MATERIAL_STATUSES.includes(data.status)) {
      const lines = data.status === "removed"
        ? ["Content Removal Confirmed.", REMOVED_CUSTOMER_TEXT]
        : FINAL_UNSUCCESSFUL.includes(data.status)
          ? [`Your case status is now: ${caseLabel(data.status)}.`, data.outcomeExplanation!]
          : [`Your case status is now: ${caseLabel(data.status)}.`, ...(data.customerMessage ? [data.customerMessage] : [])];
      await mailCustomer(row, data.status === "removed" ? "Content removal confirmed" : "Case update", lines);
    }
    return { ok: true };
  });

export const requestRemovalInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    caseId: z.string().max(20), title: z.string().trim().min(3).max(150), message: z.string().trim().min(5).max(2000),
    required: z.string().trim().min(2).max(500), deadline: z.string().max(20).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const admin = await staff(context);
    const row = await load(admin, data.caseId);
    if (row.payment_status !== "paid") throw new Error("Mark the case paid first.");
    const now = new Date().toISOString();
    await admin.from("removal_orders").update({
      info_request: { status: "open", title: data.title, message: data.message, required: data.required, deadline: data.deadline || null, requested_at: now },
      case_status: "info_required", status_changed_at: now, status_changed_by: context.userId,
    }).eq("id", row.id);
    await log(admin, row.id, context.userId, [
      { event_type: "info_requested", new_value: data.title, customer_visible: true },
      { event_type: "status_change", old_value: row.case_status, new_value: "info_required", customer_visible: true },
    ]);
    await mailCustomer(row, data.title, [data.message, `Required: ${data.required}`, ...(data.deadline ? [`Please respond by ${data.deadline}.`] : []), "Upload it from your case tracking page."]);
    return { ok: true };
  });
