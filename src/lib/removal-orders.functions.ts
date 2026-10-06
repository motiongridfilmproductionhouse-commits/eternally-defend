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
    let title: string | undefined, publisher: string | undefined, description: string | undefined;
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
    } catch {
      reachable = false;
    }
    if (!publisher) {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg && ["Instagram", "TikTok", "X (Twitter)"].includes(base.platform) && !["p", "reel", "share"].includes(seg))
        publisher = seg.startsWith("@") ? seg : `@${seg}`;
      else publisher = base.host;
    }
    const text = `${title ?? ""} ${description ?? ""}`;
    const potentialCategory = CATEGORY_HINTS.find(([r]) => r.test(text))?.[1] ?? "To be confirmed from your details";
    return {
      url: u.toString(), platform: base.platform, contentType: base.contentType,
      publisher: publisher?.slice(0, 200) ?? null, title: title?.slice(0, 300) ?? null,
      potentialCategory, reachable,
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

/** Eligibility assessment + pending order. Case stays "awaiting_payment" until payment is confirmed. */
export const submitRemovalOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => submitSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const caseId = `ETR-RM-${Math.floor(100000 + Math.random() * 900000)}`;
    const evidence: { name: string; path: string }[] = [];
    for (const f of data.files) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      if (bytes.length > 5 * 1024 * 1024) throw new Error("Each file must be 5 MB or smaller.");
      const path = `${caseId}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabaseAdmin.storage.from("removal-order-evidence").upload(path, bytes, { contentType: f.type });
      if (error) throw new Error("Evidence upload failed. Please try again.");
      evidence.push({ name: f.name, path });
    }
    const recommendedRoute = routeFor(data.issue);
    const summary = `Potential ${recommendedRoute.toLowerCase()} pathway identified for this ${data.contentType.toLowerCase()} on ${data.platform}. Final outcome is decided by the platform.`;
    const { error } = await supabaseAdmin.from("removal_orders").insert({
      case_id: caseId, url: data.url, platform: data.platform, content_type: data.contentType,
      publisher: data.publisher, page_title: data.title, potential_category: data.potentialCategory,
      affects: data.affects, issue: data.issue, explanation: data.explanation, evidence,
      full_name: data.fullName, email: data.email.toLowerCase(), phone: data.phone, country: data.country,
      assessment_summary: summary, recommended_route: recommendedRoute,
      fee_amount: REMOVAL_FEE.amount, currency: REMOVAL_FEE.currency,
    });
    if (error) throw new Error("Could not save your request. Please try again.");
    return { caseId, eligible: true, summary, recommendedRoute, fee: REMOVAL_FEE };
  });

/** Customer chose a payment method; manual invoice is sent by the team. Case stays inactive until paid. */
export const requestRemovalInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().regex(/^ETR-RM-\d{6}$/), email: z.string().email(),
      method: z.enum(["card", "apple_pay", "google_pay"]) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("removal_orders")
      .update({ payment_method: data.method, payment_status: "invoice_requested" })
      .eq("case_id", data.caseId).eq("email", data.email.toLowerCase()).eq("payment_status", "invoice_pending")
      .select("case_id").maybeSingle();
    if (error) throw new Error("Could not update the order.");
    return { ok: !!row };
  });

export const trackRemovalCase = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ caseId: z.string().trim().toUpperCase().regex(/^ETR-RM-\d{6}$/), email: z.string().trim().email() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("removal_orders")
      .select("case_id,url,platform,content_type,issue,recommended_route,fee_amount,currency,payment_status,case_status,status_note,created_at,updated_at")
      .eq("case_id", data.caseId).eq("email", data.email.toLowerCase()).maybeSingle();
    return row ?? null;
  });
