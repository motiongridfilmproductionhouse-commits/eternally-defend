import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const REMOVAL_FEE = { amount: 1000, currency: "USD" } as const;

function detectPlatform(u: URL) {
  const h = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  const p = u.pathname.toLowerCase();
  const map: [RegExp, string][] = [
    [/instagram\.com$/, "Instagram"], [/(facebook\.com|fb\.watch)$/, "Facebook"],
    [/(youtube\.com|youtu\.be)$/, "YouTube"], [/(x\.com|twitter\.com)$/, "X (Twitter)"],
    [/tiktok\.com$/, "TikTok"], [/reddit\.com$/, "Reddit"], [/linkedin\.com$/, "LinkedIn"],
    [/google\.[a-z.]+$/, "Google"], [/trustpilot\.com$/, "Trustpilot"], [/threads\.net$/, "Threads"],
  ];
  const platform = map.find(([r]) => r.test(h))?.[1] ?? "Website";
  let contentType = "Webpage";
  if (/\/reel|\/share\/r\//.test(p)) contentType = "Reel";
  else if (/\/shorts\//.test(p)) contentType = "Short video";
  else if (/watch|\/video|\/share\/v\/|youtu\.be/.test(p + h)) contentType = "Video";
  else if (/\/p\/|\/posts?\/|\/status\/|\/share\/p\/|\/comments\//.test(p)) contentType = "Post";
  else if (/review/.test(p + h) || platform === "Trustpilot") contentType = "Review";
  return { platform, host: h, contentType };
}

function meta(html: string, key: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i");
  return (html.match(re)?.[1] ?? html.match(re2)?.[1])?.trim();
}

const CATEGORY_HINTS: [RegExp, string][] = [
  [/deepfake|ai[- ]generated|morphed|fake video/i, "Deepfake"],
  [/fraud|scam|cheat|arrest|police|allegation|defam|false/i, "Defamation"],
  [/official|fan page|parody|impersonat/i, "Impersonation"],
  [/leak|address|phone number|private|personal/i, "Privacy"],
  [/full movie|download|torrent|pirat|copyright/i, "Copyright"],
];

export const analyzeRemovalLink = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ url: z.string().trim().url().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const u = new URL(data.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("Only web links are supported.");
    const base = detectPlatform(u);
    let title: string | undefined, publisher: string | undefined, description: string | undefined, thumbnail: string | undefined;
    let reachable = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(u.toString(), {
        signal: ctrl.signal, redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; EternaLinkReview/1.0)", Accept: "text/html" },
      });
      clearTimeout(t);
      reachable = res.ok;
      const html = (await res.text()).slice(0, 400_000);
      title = meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim();
      publisher = meta(html, "og:site_name") ?? meta(html, "author") ?? meta(html, "twitter:site");
      description = meta(html, "og:description") ?? meta(html, "description");
      thumbnail = meta(html, "og:image") ?? meta(html, "twitter:image");
    } catch {
      reachable = false;
    }
    const { scrapeWithFirecrawl, analyzeWithOpenAI, fetchFacebookViaApify } = await import("@/lib/removal-orders/video-insight.server");
    let pageText: string | undefined;
    let frames: string[] = [];
    let durationSec: number | undefined;
    if (base.platform === "Facebook") {
      const fb = await fetchFacebookViaApify(u.toString());
      if (fb) {
        thumbnail = fb.thumbnail ?? thumbnail; frames = fb.frames; durationSec = fb.durationSec;
        if (fb.caption) description = fb.caption;
        if (title === "Facebook") title = undefined;
        reachable = true;
      }
    }
    if (!thumbnail || !description) {
      const fc = await scrapeWithFirecrawl(u.toString());
      if (fc) {
        thumbnail ??= fc.thumbnail; title ??= fc.title; description ??= fc.description;
        publisher ??= fc.publisher; pageText = fc.text; reachable = reachable || Boolean(fc.title || fc.thumbnail);
      }
    }
    if (thumbnail) thumbnail = thumbnail.replace(/&amp;/g, "&");
    if (thumbnail && !/^https:\/\//.test(thumbnail)) thumbnail = undefined;
    if (!publisher) {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && ["Instagram", "TikTok", "X (Twitter)"].includes(base.platform) && !["p", "reel", "share"].includes(seg))
        publisher = seg.startsWith("@") ? seg : `@${seg}`;
      else publisher = base.host;
    }
    const insight = await analyzeWithOpenAI({
      url: u.toString(), platform: base.platform, contentType: base.contentType,
      thumbnail, title, description, text: pageText, frames, durationSec,
    });
    const text = `${title ?? ""} ${description ?? ""}`;
    const hinted = CATEGORY_HINTS.find(([r]) => r.test(text))?.[1];
    const aiCat = insight && !["None evident", "Unclear"].includes(insight.detectedIssue) ? insight.detectedIssue : undefined;
    const potentialCategory = aiCat ?? hinted ?? "To be confirmed from your details";
    return {
      url: u.toString(), platform: base.platform, contentType: base.contentType,
      publisher: publisher?.slice(0, 200) ?? null, title: title?.slice(0, 300) ?? null,
      potentialCategory, reachable, thumbnail: thumbnail ?? null,
      aiSummary: insight?.summary?.slice(0, 1200) ?? null,
      aiIndicators: (insight?.harmIndicators ?? []).slice(0, 5).map((s) => s.slice(0, 160)),
      aiConfidence: insight?.confidence ?? null,
      framesAnalyzed: frames.length > 0, durationSec: durationSec ?? null,
    };
  });

const ROUTES: Record<string, string> = {
  Copyright: "Copyright notice to the platform or host",
  Trademark: "Trademark complaint to the platform",
  Impersonation: "Platform impersonation report",
  Privacy: "Privacy and personal-information complaint",
  Deepfake: "Manipulated-media policy report",
  Defamation: "Legal review followed by a defamation complaint",
  Review: "Review-platform policy report",
  Other: "Platform policy review by an Eterna analyst",
};
function routeFor(issue: string) {
  if (/copyright/i.test(issue)) return ROUTES.Copyright;
  if (/trademark/i.test(issue)) return ROUTES.Trademark;
  if (/impersonation/i.test(issue)) return ROUTES.Impersonation;
  if (/privacy|personal information|unauthorized/i.test(issue)) return ROUTES.Privacy;
  if (/deepfake/i.test(issue)) return ROUTES.Deepfake;
  if (/defamation|false/i.test(issue)) return ROUTES.Defamation;
  if (/review/i.test(issue)) return ROUTES.Review;
  return ROUTES.Other;
}

const fileSchema = z.object({
  name: z.string().max(200),
  type: z.enum(["image/jpeg", "image/png", "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  base64: z.string().max(7_000_000),
});

const submitSchema = z.object({
  url: z.string().url().max(2000),
  platform: z.string().max(60), contentType: z.string().max(60),
  publisher: z.string().max(200).nullable(), title: z.string().max(300).nullable(),
  potentialCategory: z.string().max(80),
  affects: z.string().min(1).max(80), issue: z.string().min(1).max(80),
  explanation: z.string().trim().min(10).max(3000),
  fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(255),
  phone: z.string().trim().min(5).max(40), country: z.string().trim().min(2).max(80),
  confirmed: z.literal(true),
  files: z.array(fileSchema).max(3),
});

/** Eligibility assessment + case created as "Awaiting Invoice". Removal processing starts only after staff mark it paid. */
export const submitRemovalOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendRemovalMail, staffRecipients, trackLink } = await import("./removal-orders/mail.server");
    const caseId = `ETR-RM-${Math.floor(100000 + Math.random() * 900000)}`;
    const evidence = await uploadFiles(supabaseAdmin, caseId, data.files, "initial");
    const recommendedRoute = routeFor(data.issue);
    const summary = `Potential ${recommendedRoute.toLowerCase()} pathway identified for this ${data.contentType.toLowerCase()} on ${data.platform}. Final outcome is decided by the platform.`;
    const { data: row, error } = await supabaseAdmin.from("removal_orders").insert({
      case_id: caseId, url: data.url, platform: data.platform, content_type: data.contentType,
      publisher: data.publisher, page_title: data.title, potential_category: data.potentialCategory,
      affects: data.affects, issue: data.issue, explanation: data.explanation, evidence,
      full_name: data.fullName, email: data.email.toLowerCase(), phone: data.phone, country: data.country,
      assessment_summary: summary, recommended_route: recommendedRoute,
      fee_amount: REMOVAL_FEE.amount, currency: REMOVAL_FEE.currency,
      payment_status: "awaiting_invoice", case_status: "awaiting_payment",
    } as never).select("id").single();
    if (error || !row) throw new Error("Could not save your request. Please try again.");
    await supabaseAdmin.from("removal_order_events" as never).insert({
      order_id: (row as { id: string }).id, event_type: "case_created", new_value: "awaiting_payment", customer_visible: true,
    } as never);
    await Promise.all([
      sendRemovalMail(staffRecipients(), `New removal request ${caseId}`, [
        `New pay-per-link removal request ${caseId}.`, `URL: ${data.url}`, `Platform: ${data.platform} · Issue: ${data.issue}`,
        `Customer: ${data.fullName} (${data.email}, ${data.phone}, ${data.country})`, "Open Admin > Removal Cases to send the invoice.",
      ]),
      sendRemovalMail(data.email, `Your Eterna case ${caseId} has been created`, [
        `Hello ${data.fullName},`, `Your removal case ${caseId} has been created.`,
        "Our team will send payment instructions to your registered contact details. Removal processing begins after payment is confirmed.",
        `Track your case: ${trackLink(caseId)}`,
      ]),
    ]);
    return { caseId, eligible: true, summary, recommendedRoute, fee: REMOVAL_FEE };
  });

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
async function uploadFiles(admin: Admin, caseId: string, files: z.infer<typeof fileSchema>[], source: string) {
  const out: { name: string; path: string; source: string; uploaded_at: string }[] = [];
  for (const f of files) {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    if (bytes.length > 5 * 1024 * 1024) throw new Error("Each file must be 5 MB or smaller.");
    const path = `${caseId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await admin.storage.from("removal-order-evidence").upload(path, bytes, { contentType: f.type });
    if (error) throw new Error("Evidence upload failed. Please try again.");
    out.push({ name: f.name, path, source, uploaded_at: new Date().toISOString() });
  }
  return out;
}

const caseKey = z.object({
  caseId: z.string().trim().toUpperCase().regex(/^ETR-RM-\d{6}$/),
  email: z.string().trim().email().max(255),
});

/** Customer requests an invoice with a preferred payment method. No payment is taken on the website. */
export const requestRemovalInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => caseKey.extend({ method: z.enum(["card", "apple_pay", "google_pay"]) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("removal_orders")
      .update({ payment_method: data.method, staff_attention: true } as never)
      .eq("case_id", data.caseId).eq("email", data.email.toLowerCase()).eq("payment_status", "awaiting_invoice")
      .select("id").maybeSingle();
    if (row) await supabaseAdmin.from("removal_order_events" as never).insert({
      order_id: (row as { id: string }).id, event_type: "invoice_requested", new_value: data.method, customer_visible: true,
    } as never);
    return { ok: !!row };
  });

/** Customer-safe tracking view. Never returns internal notes, evidence paths or staff identities. */
export const trackRemovalCase = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => caseKey.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r } = await supabaseAdmin.from("removal_orders")
      .select("id,case_id,url,platform,content_type,issue,recommended_route,fee_amount,currency,payment_status,case_status,customer_message,info_request,outcome_explanation,removal_verification,paid_at,created_at,updated_at")
      .eq("case_id", data.caseId).eq("email", data.email.toLowerCase()).maybeSingle();
    if (!r) return null;
    const row = r as Record<string, any>;
    const { data: ev } = await supabaseAdmin.from("removal_order_events" as never)
      .select("event_type,new_value,created_at").eq("order_id", row.id).eq("customer_visible", true).order("created_at");
    const v = row.removal_verification as { verified_at?: string } | null;
    const ir = row.info_request as Record<string, string> | null;
    return {
      case_id: row.case_id as string, url: row.url as string, platform: row.platform as string | null,
      issue: row.issue as string, recommended_route: row.recommended_route as string | null,
      fee_amount: row.fee_amount as number, currency: row.currency as string,
      payment_status: row.payment_status as string, case_status: row.case_status as string,
      customer_message: row.customer_message as string | null,
      outcome_explanation: row.outcome_explanation as string | null,
      removal_verified_at: v?.verified_at ?? null, paid_at: row.paid_at as string | null,
      info_request: ir && ir.status === "open" ? { title: ir.title, message: ir.message, required: ir.required, deadline: ir.deadline ?? null } : null,
      created_at: row.created_at as string, updated_at: row.updated_at as string,
      events: ((ev ?? []) as { event_type: string; new_value: string | null; created_at: string }[]),
    };
  });

/** Customer answers an information request with files. */
export const submitRequestedInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => caseKey.extend({ note: z.string().trim().max(2000), files: z.array(fileSchema).min(1).max(3) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendRemovalMail, staffRecipients } = await import("./removal-orders/mail.server");
    const { data: r } = await supabaseAdmin.from("removal_orders").select("id,evidence,info_request,case_status")
      .eq("case_id", data.caseId).eq("email", data.email.toLowerCase()).maybeSingle();
    const row = r as Record<string, any> | null;
    if (!row || row.info_request?.status !== "open") throw new Error("There is no open information request for this case.");
    const files = await uploadFiles(supabaseAdmin, data.caseId, data.files, "info_request");
    await supabaseAdmin.from("removal_orders").update({
      evidence: [...(row.evidence ?? []), ...files],
      info_request: { ...row.info_request, status: "answered", answered_at: new Date().toISOString(), customer_note: data.note },
      case_status: "info_submitted", status_changed_at: new Date().toISOString(), staff_attention: true,
    } as never).eq("id", row.id);
    await supabaseAdmin.from("removal_order_events" as never).insert([
      { order_id: row.id, event_type: "info_submitted", detail: `${files.length} file(s)`, customer_visible: true },
      { order_id: row.id, event_type: "status_change", old_value: row.case_status, new_value: "info_submitted", customer_visible: true },
    ] as never);
    await sendRemovalMail(staffRecipients(), `New evidence uploaded for ${data.caseId}`, [
      `The customer uploaded ${files.length} file(s) for ${data.caseId}.`, "Open Admin > Removal Cases to review.",
    ]);
    return { ok: true };
  });
