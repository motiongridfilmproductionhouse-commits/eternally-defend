/**
 * Server-side Resend transport for Enforcement Center outbound notices.
 *
 * Security model:
 *  - Runs ONLY on the server. RESEND_API_KEY is read from process.env inside
 *    send() and is never returned to the caller or exposed to the browser.
 *  - Honors demo mode, emergency pause, the global kill switch, the production
 *    allowlist gate and a hard test-mode redirect that no upstream value can
 *    bypass.
 *  - Evidence/notice documents are included only as short-lived,
 *    backend-generated presigned links (never raw attachments/public URLs).
 */

import type {
  EnforcementEmailSendPayload,
  EnforcementEmailSendResult,
  EnforcementEmailTransport,
} from "./email-transport";
import { applyTestSubjectPrefix } from "./email-transport";

export interface EnforcementAttachmentLink {
  label: string;
  url: string;
  expiresInSeconds?: number;
}

export interface ResendSendPayload extends EnforcementEmailSendPayload {
  enforcementRequestId?: string;
  /** Backend-generated presigned document links (no raw file attachments). */
  documentLinks?: EnforcementAttachmentLink[];
  replyTo?: string;
}

/** Verified sending domain for enforcement mail. */
export const ENFORCEMENT_SENDER_DOMAIN = "send.eternasentinel.com";

export function getResendSenderConfig() {
  const fromEmail =
    process.env.ENFORCEMENT_RESEND_FROM_EMAIL ||
    process.env.ENFORCEMENT_FROM_EMAIL ||
    `enforcement@${ENFORCEMENT_SENDER_DOMAIN}`;
  const fromName = process.env.ENFORCEMENT_RESEND_FROM_NAME || "Eterna Sentinel Enforcement";
  const replyTo = process.env.ENFORCEMENT_RESEND_REPLY_TO || "legal@eternasentinel.com";
  const testDestination =
    process.env.ENFORCEMENT_TEST_DESTINATION || "enforcement@eternasentinel.com";
  return { fromEmail, fromName, replyTo, testDestination, senderDomain: ENFORCEMENT_SENDER_DOMAIN };
}

export function isResendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return !!key && key.trim() !== "" && !key.includes("placeholder");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBodies(
  payload: ResendSendPayload,
  opts: { isTestMode: boolean; actualRecipient: string },
) {
  const links = payload.documentLinks ?? [];

  const testHeaderLines = opts.isTestMode
    ? [
        "==========================================",
        "ETERNA CONTROLLED ENFORCEMENT TEST — DO NOT ACTION.",
        "No action is requested against any real third party.",
        `Intended recipient: ${payload.intendedRecipient}`,
        `Actual test recipient: ${opts.actualRecipient}`,
        "==========================================",
        "",
      ]
    : [];

  const linkLines = links.length
    ? [
        "",
        "SECURE EVIDENCE / NOTICE DOCUMENTS (time-limited links):",
        ...links.map(
          (l) =>
            `- ${l.label}: ${l.url}${l.expiresInSeconds ? ` (expires in ${Math.round(l.expiresInSeconds / 60)} minutes)` : ""}`,
        ),
      ]
    : [];

  const textBody = [...testHeaderLines, payload.textBody, ...linkLines].join("\n");

  const htmlBody =
    payload.htmlBody ??
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">
${opts.isTestMode ? `<p style="background:#fff4e5;border:1px solid #f0b429;padding:12px;border-radius:6px"><strong>ETERNA CONTROLLED ENFORCEMENT TEST — DO NOT ACTION.</strong><br/>Intended recipient: ${escapeHtml(payload.intendedRecipient)}</p>` : ""}
<pre style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;margin:0">${escapeHtml(payload.textBody)}</pre>
${
  links.length
    ? `<p style="margin-top:20px"><strong>Secure evidence / notice documents (time-limited links):</strong></p><ul>${links
        .map((l) => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a></li>`)
        .join("")}</ul>`
    : ""
}
</div>`;

  return { textBody, htmlBody };
}

export class ResendEnforcementTransport implements EnforcementEmailTransport {
  async send(payload: ResendSendPayload): Promise<EnforcementEmailSendResult> {
    // 1. DEMO MODE HARD BLOCK — never dispatch to real third parties.
    const isDemoMode =
      payload.demoMode ??
      (process.env.DEMO_MODE === "true" || process.env.NODE_ENV === "test_demo");
    if (isDemoMode) {
      return {
        success: false,
        status: "DEMO_MODE_BLOCKED",
        provider: "RESEND",
        notes:
          "SIMULATION ONLY — hard-blocked server-side in DEMO MODE. Resend transmission halted.",
      };
    }

    // 2. EMERGENCY PAUSE
    if (process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true") {
      return {
        success: false,
        status: "EMERGENCY_PAUSED",
        provider: "RESEND",
        error: "EMERGENCY STOP ACTIVE: all enforcement transmissions are paused server-side.",
      };
    }

    // 3. KILL SWITCH + PRODUCTION ALLOWLIST GATE
    const isLiveEnabled = process.env.ENFORCEMENT_LIVE_ENABLED === "true";
    const isTestMode = process.env.ENFORCEMENT_TEST_MODE === "true";
    const isAllowlistEnabled = process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED === "true";

    if (!isLiveEnabled && !isTestMode) {
      return {
        success: false,
        status: "KILL_SWITCH_ACTIVE",
        provider: "RESEND",
        error:
          "GLOBAL KILL SWITCH ACTIVE: ENFORCEMENT_LIVE_ENABLED is false. External enforcement dispatches are blocked.",
      };
    }

    if (isLiveEnabled && !isTestMode && !isAllowlistEnabled) {
      return {
        success: false,
        status: "PRODUCTION_APPROVAL_REQUIRED",
        provider: "RESEND",
        error: "PRODUCTION ALLOWLIST REQUIRED: ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED is false.",
      };
    }

    // 4. CONFIGURATION CHECK
    const apiKey = process.env.RESEND_API_KEY;
    if (!isResendConfigured() || !apiKey) {
      return {
        success: false,
        status: "CONFIGURATION_ERROR",
        provider: "RESEND",
        error: "Resend is not configured. Required: RESEND_API_KEY.",
      };
    }

    const { fromEmail, fromName, replyTo, testDestination } = getResendSenderConfig();

    // 5. HARD TEST-MODE REDIRECT — cannot be bypassed by upstream data.
    const intendedRecipient = payload.intendedRecipient;
    const actualRecipient = isTestMode ? testDestination : intendedRecipient;

    if (!actualRecipient || !actualRecipient.includes("@")) {
      return {
        success: false,
        status: "FAILED",
        provider: "RESEND",
        error: `Invalid destination email address: ${String(actualRecipient)}`,
      };
    }

    const subject = applyTestSubjectPrefix(payload.subject, isTestMode);
    const { textBody, htmlBody } = buildBodies(payload, { isTestMode, actualRecipient });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [actualRecipient],
          reply_to: payload.replyTo || replyTo,
          subject,
          text: textBody,
          html: htmlBody,
        }),
      });
      clearTimeout(timeout);

      const raw = await res.text();
      let data: { id?: string; message?: string; name?: string } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        data = { message: raw.slice(0, 300) };
      }

      if (res.status === 401 || res.status === 403) {
        return {
          success: false,
          status: "CONFIGURATION_ERROR",
          provider: "RESEND",
          error: `Resend authentication failed (${res.status}): invalid or unauthorized RESEND_API_KEY.`,
        };
      }

      if (res.status === 429 || res.status >= 500) {
        return {
          success: false,
          status: "FAILED_RETRYABLE",
          provider: "RESEND",
          error: `Resend transient error (${res.status}): ${data.message || "throttled or temporary failure."}`,
        };
      }

      if (!res.ok || !data.id) {
        const message = data.message || "Unknown Resend error.";
        const isConfig = /domain|from|verif|not allowed/i.test(message);
        return {
          success: false,
          status: isConfig ? "CONFIGURATION_ERROR" : "FAILED",
          provider: "RESEND",
          error: `Resend API error (${res.status}): ${message}`,
        };
      }

      return {
        success: true,
        status: "PROVIDER_ACCEPTED",
        provider: "RESEND",
        providerMessageId: data.id,
        submittedAt: new Date().toISOString(),
        intendedRecipient,
        actualRecipient,
        notes: isTestMode
          ? `RESEND TEST EMAIL DELIVERED (ID: ${data.id}) to controlled mailbox ${actualRecipient} (intended: ${intendedRecipient}).`
          : `RESEND ENFORCEMENT NOTICE DELIVERED (ID: ${data.id}) to ${actualRecipient}.`,
      };
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      return {
        success: false,
        status: isTimeout ? "FAILED_RETRYABLE" : "FAILED",
        provider: "RESEND",
        error: isTimeout
          ? "Network timeout connecting to the Resend API."
          : `Network error connecting to the Resend API: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
