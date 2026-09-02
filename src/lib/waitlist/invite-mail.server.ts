/**
 * Waitlist approval email — sends the approved person a personal
 * login-creation link containing their single-use Eterna invitation code.
 *
 * Server-only: RESEND_API_KEY is read inside the sender and never returned.
 */

function senderConfig() {
  const domain = process.env["ONBOARDING_SENDER_DOMAIN"] || "send.eternasentinel.com";
  const fromEmail = process.env["WAITLIST_FROM_EMAIL"] || `access@${domain}`;
  const fromName = process.env["WAITLIST_FROM_NAME"] || "Eterna Sentinel";
  return { fromEmail, fromName };
}

export function appBaseUrl(originHeader?: string | null): string {
  const configured = process.env["APP_PUBLIC_URL"];
  if (configured) return configured.replace(/\/+$/, "");
  if (originHeader && /^https?:\/\//.test(originHeader)) return originHeader.replace(/\/+$/, "");
  return "https://eternally-defend.lovable.app";
}

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendWaitlistApprovalEmail(args: {
  to: string;
  fullName: string;
  code: string;
  signupUrl: string;
  expiresAt: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey || apiKey.trim() === "" || apiKey.includes("placeholder")) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const { fromEmail, fromName } = senderConfig();
  const firstName = args.fullName.split(/\s+/)[0] || "there";
  const expiryLine = args.expiresAt
    ? `This invitation expires on ${new Date(args.expiresAt).toUTCString()}.`
    : "This invitation is single-use.";

  const textBody = [
    `Hello ${firstName},`,
    "",
    "Your Eterna Priority Access request has been approved.",
    "",
    "Create your account here:",
    args.signupUrl,
    "",
    `Invitation code: ${args.code}`,
    expiryLine,
    "",
    "The code is personal to this email address and can be used once.",
    "",
    "— Eterna Sentinel",
  ].join("\n");

  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
<p>Hello ${esc(firstName)},</p>
<p>Your <strong>Eterna Priority Access</strong> request has been approved.</p>
<p><a href="${esc(args.signupUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px">Create your Eterna account</a></p>
<p>Invitation code: <code style="font-size:16px">${esc(args.code)}</code><br/>
<span style="color:#64748b;font-size:13px">${esc(expiryLine)} The code is personal to this email address and can be used once.</span></p>
<p style="color:#64748b;font-size:13px">If the button does not work, open: ${esc(args.signupUrl)}</p>
<p style="color:#94a3b8;font-size:12px">Eterna Sentinel</p>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [args.to],
        subject: "Your Eterna access is approved — create your account",
        text: textBody,
        html: htmlBody,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, error: payload.message || `Resend HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "network error" };
  }
}
