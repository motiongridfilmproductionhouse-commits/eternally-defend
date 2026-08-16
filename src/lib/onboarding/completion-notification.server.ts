/**
 * Onboarding completion reporting.
 *
 * When a client finishes onboarding (any flow: v1, v2 light, or company), a
 * structured summary of the completed onboarding record is emailed to the
 * Eterna partners inbox.
 *
 * Guarantees:
 *  - Server-only. RESEND_API_KEY is read from process.env inside the sender and
 *    is never returned to the caller or exposed to the browser.
 *  - Exactly-once per client: a unique (user_id, recipient) ledger row is
 *    inserted first; a conflict means the report was already dispatched.
 *  - Never blocks or fails onboarding completion — all errors are captured and
 *    recorded on the ledger row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export const ONBOARDING_REPORT_RECIPIENT = "partners@eternasentinel.com";

function senderConfig() {
  const domain = process.env["ONBOARDING_SENDER_DOMAIN"] || "send.eternasentinel.com";
  const fromEmail = process.env["ONBOARDING_FROM_EMAIL"] || `onboarding@${domain}`;
  const fromName = process.env["ONBOARDING_FROM_NAME"] || "Eterna Sentinel Onboarding";
  const recipient = process.env["ONBOARDING_REPORT_RECIPIENT"] || ONBOARDING_REPORT_RECIPIENT;
  return { fromEmail, fromName, recipient };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface OnboardingCompletionSummary {
  userId: string;
  clientId: string | null;
  accountType: string | null;
  onboardingVersion: string | null;
  displayName: string | null;
  legalName: string | null;
  companyName: string | null;
  brandName: string | null;
  representative: string | null;
  roleTitle: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  businessRegNumber: string | null;
  authorizationLevel: string | null;
  authorizationStatus: string | null;
  verificationBadge: string | null;
  certificateNumber: string | null;
  authorizationNumber: string | null;
  assets: Array<{ platform: string | null; label: string | null; url: string | null; status: string | null }>;
  socialAccounts: Array<{ platform: string | null; handle: string | null; mode: string | null }>;
  protectedFaceCount: number;
  completedAt: string;
}

async function loadSummary(supabase: Db, userId: string): Promise<OnboardingCompletionSummary> {
  const [{ data: profile }, { data: cert }, { data: auth }, assets, socials, faces] =
    await Promise.all([
      supabase.from("client_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("verification_certificates")
        .select("certificate_number,status,issued_at")
        .eq("user_id", userId)
        .order("issued_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("client_authorizations")
        .select("auth_number,status")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("digital_assets").select("*").eq("user_id", userId).limit(50),
      supabase.from("social_accounts").select("*").eq("user_id", userId).limit(50),
      supabase
        .from("protected_faces")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

  const p = (profile ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const v = p[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  };

  const assetRows = (assets.data ?? []) as Array<Record<string, unknown>>;
  const socialRows = (socials.data ?? []) as Array<Record<string, unknown>>;
  const pick = (row: Record<string, unknown>, keys: string[]): string | null => {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return null;
  };

  return {
    userId,
    clientId: str("client_id"),
    accountType: str("onboarding_account_type") ?? str("account_type") ?? str("client_type"),
    onboardingVersion: str("onboarding_version"),
    displayName: str("display_name"),
    legalName: str("legal_name") ?? str("full_name"),
    companyName: str("company_name"),
    brandName: str("company_brand_name"),
    representative: str("contact_person") ?? str("legal_name"),
    roleTitle: str("role_title"),
    country: str("country"),
    website: str("website"),
    email: str("email") ?? str("company_email"),
    emailVerified: !!(str("email_verified_at") ?? str("company_email_verified_at")),
    phone: str("phone"),
    phoneVerified: !!str("phone_verified_at"),
    businessRegNumber: str("business_reg_number"),
    authorizationLevel: str("authorization_level"),
    authorizationStatus: str("authorization_status"),
    verificationBadge: str("verification_badge"),
    certificateNumber: (cert?.certificate_number as string | null) ?? null,
    authorizationNumber: (auth?.auth_number as string | null) ?? null,
    assets: assetRows.map((row) => ({
      platform: pick(row, ["platform", "asset_type", "type"]),
      label: pick(row, ["title", "name", "label", "handle"]),
      url: pick(row, ["url", "asset_url", "channel_url", "profile_url"]),
      status: pick(row, ["verification_status", "status"]),
    })),
    socialAccounts: socialRows.map((row) => ({
      platform: pick(row, ["platform"]),
      handle: pick(row, ["handle", "username", "profile_url"]),
      mode: pick(row, ["mode", "connection_mode", "provenance"]),
    })),
    protectedFaceCount: faces.count ?? 0,
    completedAt: new Date().toISOString(),
  };
}

function buildBodies(s: OnboardingCompletionSummary) {
  const label = s.companyName ?? s.legalName ?? s.displayName ?? s.email ?? s.userId;

  const rows: Array<[string, string]> = [
    ["Client", label],
    ["Client ID", s.clientId ?? "—"],
    ["Account type", s.accountType ?? "—"],
    ["Onboarding version", s.onboardingVersion ?? "—"],
    ["Legal name", s.legalName ?? "—"],
    ["Company", s.companyName ?? "—"],
    ["Brand name", s.brandName ?? "—"],
    ["Representative", s.representative ?? "—"],
    ["Role / title", s.roleTitle ?? "—"],
    ["Country", s.country ?? "—"],
    ["Website", s.website ?? "—"],
    ["Email", s.email ? `${s.email} (${s.emailVerified ? "verified" : "unverified"})` : "—"],
    ["Phone", s.phone ? `${s.phone} (${s.phoneVerified ? "verified" : "unverified"})` : "—"],
    ["Business reg. number", s.businessRegNumber ?? "—"],
    ["Authorization level", s.authorizationLevel ?? "—"],
    ["Authorization status", s.authorizationStatus ?? "—"],
    ["Authorization number", s.authorizationNumber ?? "—"],
    ["Verification badge", s.verificationBadge ?? "—"],
    ["Certificate number", s.certificateNumber ?? "—"],
    ["Enrolled faces", String(s.protectedFaceCount)],
    ["Verified assets", String(s.assets.length)],
    ["Social accounts", String(s.socialAccounts.length)],
    ["Completed at (UTC)", s.completedAt],
  ];

  const assetLines = s.assets.length
    ? s.assets.map(
        (a) =>
          `- ${[a.platform ?? "asset", a.label ?? "", a.url ?? "", a.status ? `[${a.status}]` : ""]
            .filter(Boolean)
            .join(" | ")}`,
      )
    : ["- none recorded"];

  const socialLines = s.socialAccounts.length
    ? s.socialAccounts.map(
        (a) => `- ${[a.platform ?? "social", a.handle ?? "", a.mode ?? ""].filter(Boolean).join(" | ")}`,
      )
    : ["- none recorded"];

  const textBody = [
    "ETERNA SENTINEL — ONBOARDING COMPLETED",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "ASSETS UNDER PROTECTION:",
    ...assetLines,
    "",
    "SOCIAL ACCOUNTS:",
    ...socialLines,
    "",
    "This report was generated automatically by Eterna Sentinel.",
  ].join("\n");

  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
<h2 style="margin:0 0 4px">Onboarding completed</h2>
<p style="margin:0 0 16px;color:#475569">${esc(label)}</p>
<table style="border-collapse:collapse;width:100%;max-width:640px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;white-space:nowrap">${esc(k)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0"><strong>${esc(v)}</strong></td></tr>`,
  )
  .join("")}
</table>
<h3 style="margin:20px 0 6px">Assets under protection</h3>
<ul style="margin:0;padding-left:18px">${s.assets
    .map(
      (a) =>
        `<li>${esc([a.platform ?? "asset", a.label ?? "", a.status ? `[${a.status}]` : ""].filter(Boolean).join(" — "))}${a.url ? ` — <a href="${esc(a.url)}">${esc(a.url)}</a>` : ""}</li>`,
    )
    .join("") || "<li>none recorded</li>"}</ul>
<h3 style="margin:20px 0 6px">Social accounts</h3>
<ul style="margin:0;padding-left:18px">${s.socialAccounts
    .map((a) => `<li>${esc([a.platform ?? "social", a.handle ?? "", a.mode ?? ""].filter(Boolean).join(" — "))}</li>`)
    .join("") || "<li>none recorded</li>"}</ul>
<p style="margin-top:24px;color:#94a3b8;font-size:12px">Generated automatically by Eterna Sentinel.</p>
</div>`;

  return { subject: `Onboarding completed — ${label}`, textBody, htmlBody };
}

async function sendViaResend(args: {
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey || apiKey.trim() === "" || apiKey.includes("placeholder")) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const { fromEmail, fromName } = senderConfig();
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [args.to],
        subject: args.subject,
        text: args.textBody,
        html: args.htmlBody,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: payload.message || `Resend HTTP ${res.status}` };
    }
    return { ok: true, messageId: payload.id };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "network error" };
  }
}

/**
 * Emails the completed onboarding record to the partners inbox exactly once per
 * client. Safe to call from any completion path; never throws.
 */
export async function notifyOnboardingCompletion(
  supabase: Db,
  userId: string,
): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  const { recipient } = senderConfig();
  try {
    const { data: claim, error: claimError } = await supabase
      .from("onboarding_completion_notifications")
      .insert({ user_id: userId, recipient, status: "PENDING" })
      .select("id")
      .maybeSingle();

    if (claimError || !claim) {
      // Unique violation => already reported for this client.
      return { sent: false, skipped: true };
    }

    const summary = await loadSummary(supabase, userId);
    const bodies = buildBodies(summary);
    const result = await sendViaResend({ to: recipient, ...bodies });

    await supabase
      .from("onboarding_completion_notifications")
      .update({
        status: result.ok ? "SENT" : "FAILED",
        provider_message_id: result.messageId ?? null,
        error_message: result.ok ? null : (result.error ?? "unknown error"),
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq("id", claim.id);

    if (!result.ok) {
      console.error("[onboarding-completion-report] send failed", result.error);
      return { sent: false, error: result.error };
    }
    return { sent: true };
  } catch (err) {
    console.error("[onboarding-completion-report] unexpected failure", err);
    return { sent: false, error: (err as Error)?.message };
  }
}
