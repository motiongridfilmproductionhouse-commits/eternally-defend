/**
 * Removal-order email notifications via the existing Resend provider.
 * Credentials are read only from server env; sends are best-effort and never block the workflow.
 */
const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendRemovalMail(to: string | string[], subject: string, lines: string[]) {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey || apiKey.includes("placeholder")) return { ok: false, error: "email not configured" };
  const domain = process.env["ONBOARDING_SENDER_DOMAIN"] || "send.eternasentinel.com";
  const from = `${process.env["REMOVAL_FROM_NAME"] || "Eterna Sentinel"} <${process.env["REMOVAL_FROM_EMAIL"] || `cases@${domain}`}>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, text: lines.join("\n\n") }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export function staffRecipients() {
  return (process.env["REMOVAL_STAFF_ALERT_EMAIL"] || "eternaSentinel@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
}

export const trackLink = (caseId: string) => `https://protectbyeterna.com/track-case?case=${caseId}`;
