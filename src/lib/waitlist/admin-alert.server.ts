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
