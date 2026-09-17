/**
 * Internal admin alert for new waitlist registrations.
 * Server-only: RESEND_API_KEY is read inside the sender and never returned.
 */

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface WaitlistAdminAlertPayload {
  waitlistId: string;
  fullName: string;
  email: string;
  phone: string;
  persona: string;
  organization?: string | null;
  source?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}

export async function sendWaitlistAdminAlert(
  payload: WaitlistAdminAlertPayload,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey || apiKey.trim() === "" || apiKey.includes("placeholder")) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const domain = process.env["ONBOARDING_SENDER_DOMAIN"] || "send.eternasentinel.com";
  const fromEmail = process.env["WAITLIST_FROM_EMAIL"] || `access@${domain}`;
  const fromName = process.env["WAITLIST_FROM_NAME"] || "Eterna Sentinel";
  const to = (process.env["WAITLIST_ADMIN_ALERT_EMAIL"] || "partners@eternasentinel.com")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const rows: Array<[string, string]> = [
    ["Waitlist ID", payload.waitlistId],
    ["Name", payload.fullName],
    ["Email", payload.email],
    ["Phone", payload.phone],
    ["Persona", payload.persona],
    ["Organization", payload.organization || "—"],
    ["Source", payload.source || "—"],
    ["UTM source", payload.utmSource || "—"],
    ["UTM medium", payload.utmMedium || "—"],
    ["UTM campaign", payload.utmCampaign || "—"],
    ["Referrer", payload.referrer || "—"],
    ["Received (UTC)", new Date().toUTCString()],
  ];

  const textBody = [
    "New Eterna Priority Access registration",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Review and approve in Admin > Waitlist Review.",
  ].join("\n");

  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
<h2 style="margin:0 0 12px">New Priority Access registration</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="color:#64748b;border-bottom:1px solid #e2e8f0">${esc(k)}</td><td style="border-bottom:1px solid #e2e8f0"><strong>${esc(v)}</strong></td></tr>`,
  )
  .join("")}
</table>
<p style="color:#64748b;font-size:13px;margin-top:16px">Review and approve in Admin &gt; Waitlist Review.</p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to,
        subject: `New waitlist registration: ${payload.fullName} (${payload.waitlistId})`,
        text: textBody,
        html: htmlBody,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Resend HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "network error" };
  }
}

/**
 * Internal admin alert for the universal enquiry modal, reusing the same
 * Resend call, env vars and default admin recipient as the plain waitlist
 * alert above, but with the richer enquiry taxonomy (department, protection
 * service, profile, message, platforms, relevant link, source attribution)
 * an admin needs to triage and route the enquiry to the right team.
 */
export interface EnquiryAdminAlertPayload {
  waitlistId: string;
  fullName: string;
  email: string;
  phone: string;
  organization?: string | null;
  roleTitle?: string | null;
  department: string;
  protectionService?: string | null;
  profileType?: string | null;
  profileName?: string | null;
  securityTopic?: string | null;
  privacyTopic?: string | null;
  partnershipType?: string | null;
  mediaType?: string | null;
  message?: string | null;
  platforms?: string[] | null;
  relevantUrl?: string | null;
  sourcePage?: string | null;
  sourceCta?: string | null;
}

export async function sendEnquiryAdminAlert(
  payload: EnquiryAdminAlertPayload,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey || apiKey.trim() === "" || apiKey.includes("placeholder")) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const domain = process.env["ONBOARDING_SENDER_DOMAIN"] || "send.eternasentinel.com";
  const fromEmail = process.env["WAITLIST_FROM_EMAIL"] || `access@${domain}`;
  const fromName = process.env["WAITLIST_FROM_NAME"] || "Eterna Sentinel";
  const to = (process.env["WAITLIST_ADMIN_ALERT_EMAIL"] || "partners@eternasentinel.com")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const rows: Array<[string, string]> = [
    ["Enquiry ID", payload.waitlistId],
    ["Department", payload.department],
    ["Protection service", payload.protectionService || "—"],
    ["Profile type", payload.profileType || "—"],
    ["Profile / represented name", payload.profileName || "—"],
    ["Security topic", payload.securityTopic || "—"],
    ["Privacy topic", payload.privacyTopic || "—"],
    ["Partnership type", payload.partnershipType || "—"],
    ["Media type", payload.mediaType || "—"],
    ["Name", payload.fullName],
    ["Role / title", payload.roleTitle || "—"],
    ["Email", payload.email],
    ["Phone", payload.phone],
    ["Organization", payload.organization || "—"],
    [
      "Platforms",
      payload.platforms && payload.platforms.length ? payload.platforms.join(", ") : "—",
    ],
    ["Relevant URL", payload.relevantUrl || "—"],
    ["Source page", payload.sourcePage || "—"],
    ["Source CTA", payload.sourceCta || "—"],
    ["Received (UTC)", new Date().toUTCString()],
  ];

  const textBody = [
    "New Eterna enquiry",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Message:",
    payload.message?.trim() || "(no message provided)",
    "",
    "Review in Admin > Waitlist Review.",
  ].join("\n");

  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
<h2 style="margin:0 0 12px">New Eterna enquiry</h2>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="color:#64748b;border-bottom:1px solid #e2e8f0">${esc(k)}</td><td style="border-bottom:1px solid #e2e8f0"><strong>${esc(v)}</strong></td></tr>`,
  )
  .join("")}
</table>
<p style="margin-top:16px"><strong>Message</strong><br/>${esc(payload.message?.trim() || "(no message provided)").replace(/\n/g, "<br/>")}</p>
<p style="color:#64748b;font-size:13px;margin-top:16px">Review in Admin &gt; Waitlist Review.</p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to,
        subject: `New enquiry (${payload.department}): ${payload.fullName} (${payload.waitlistId})`,
        text: textBody,
        html: htmlBody,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Resend HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "network error" };
  }
}
