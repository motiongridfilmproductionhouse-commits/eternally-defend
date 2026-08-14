/**
 * Server-side Amazon SES transport for Enforcement Center outbound notices.
 *
 * Security model:
 *  - Runs ONLY on the server. AWS credentials are read from process.env inside
 *    the send() call and are never returned to the caller or the browser.
 *  - Honors the global kill switch, emergency pause, demo mode, production
 *    allowlist gate and a hard test-mode redirect that no upstream value can
 *    bypass.
 *  - Evidence/notice documents are attached only as short-lived,
 *    backend-generated presigned links (never public URLs).
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type {
  EnforcementEmailSendPayload,
  EnforcementEmailSendResult,
  EnforcementEmailTransport,
} from "./email-transport";

export interface SesAttachmentLink {
  label: string;
  url: string;
  expiresInSeconds?: number;
}

export interface SesSendPayload extends EnforcementEmailSendPayload {
  enforcementRequestId?: string;
  /** Backend-generated presigned document links (no raw file attachments). */
  documentLinks?: SesAttachmentLink[];
  replyTo?: string;
}

let _ses: SESv2Client | null = null;

function getSesClient(): SESv2Client {
  if (_ses) return _ses;
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (!region) throw new Error("MISSING_ENV:AWS_SES_REGION");
  // Credentials may also be supplied by an attached IAM role; only pass explicit
  // keys when both are present.
  _ses = new SESv2Client(
    accessKeyId && secretAccessKey
      ? { region, credentials: { accessKeyId, secretAccessKey } }
      : { region },
  );
  return _ses;
}

export function getSesSenderConfig() {
  const fromEmail =
    process.env.ENFORCEMENT_SES_FROM_EMAIL ||
    process.env.AWS_SES_FROM_EMAIL ||
    process.env.ENFORCEMENT_FROM_EMAIL ||
    "enforcement@eternasentinel.com";
  const fromName = process.env.ENFORCEMENT_SES_FROM_NAME || "Eterna Sentinel Enforcement";
  const replyTo = process.env.ENFORCEMENT_SES_REPLY_TO || "legal@eternasentinel.com";
  const testDestination =
    process.env.ENFORCEMENT_TEST_DESTINATION || "enforcement-test@eternasentinel.com";
  const configurationSet = process.env.AWS_SES_CONFIGURATION_SET || undefined;
  return { fromEmail, fromName, replyTo, testDestination, configurationSet };
}

export function isSesConfigured(): boolean {
  const region = process.env.AWS_SES_REGION || process.env.AWS_REGION;
  const hasKeys =
    !!(process.env.AWS_SES_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) &&
    !!(process.env.AWS_SES_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY);
  const roleBased = process.env.AWS_SES_USE_INSTANCE_ROLE === "true";
  return !!region && (hasKeys || roleBased);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBodies(
  payload: SesSendPayload,
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
        .map(
          (l) =>
            `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a></li>`,
        )
        .join("")}</ul>`
    : ""
}
</div>`;

  return { textBody, htmlBody };
}

export class SesEnforcementTransport implements EnforcementEmailTransport {
  async send(payload: SesSendPayload): Promise<EnforcementEmailSendResult> {
    // 1. DEMO MODE HARD BLOCK — never dispatch to real third parties.
    const isDemoMode =
      payload.demoMode ??
      (process.env.DEMO_MODE === "true" || process.env.NODE_ENV === "test_demo");
    if (isDemoMode) {
      return {
        success: false,
        status: "DEMO_MODE_BLOCKED",
        notes: "SIMULATION ONLY — hard-blocked server-side in DEMO MODE. SES transmission halted.",
      };
    }

    // 2. EMERGENCY PAUSE
    if (process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true") {
      return {
        success: false,
        status: "EMERGENCY_PAUSED",
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
        error:
          "GLOBAL KILL SWITCH ACTIVE: ENFORCEMENT_LIVE_ENABLED is false. External enforcement dispatches are blocked.",
      };
    }

    if (isLiveEnabled && !isTestMode && !isAllowlistEnabled) {
      return {
        success: false,
        status: "PRODUCTION_APPROVAL_REQUIRED",
        error:
          "PRODUCTION ALLOWLIST REQUIRED: ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED is false.",
      };
    }

    // 4. CONFIGURATION CHECK
    if (!isSesConfigured()) {
      return {
        success: false,
        status: "CONFIGURATION_ERROR",
        error:
          "Amazon SES is not configured. Required: AWS_SES_REGION (or AWS_REGION) plus AWS_SES_ACCESS_KEY_ID/AWS_SES_SECRET_ACCESS_KEY (or AWS_SES_USE_INSTANCE_ROLE=true).",
      };
    }

    const { fromEmail, fromName, replyTo, testDestination, configurationSet } =
      getSesSenderConfig();

    // 5. HARD TEST-MODE REDIRECT — cannot be bypassed by upstream data.
    const intendedRecipient = payload.intendedRecipient;
    const actualRecipient = isTestMode ? testDestination : intendedRecipient;

    if (!actualRecipient || !actualRecipient.includes("@")) {
      return {
        success: false,
        status: "FAILED",
        error: `Invalid destination email address: ${String(actualRecipient)}`,
      };
    }

    const subject = `${isTestMode ? "[ETERNA ENFORCEMENT TEST — DO NOT ACTION] " : ""}${payload.subject}`;
    const { textBody, htmlBody } = buildBodies(payload, { isTestMode, actualRecipient });

    try {
      const out = await getSesClient().send(
        new SendEmailCommand({
          FromEmailAddress: `${fromName} <${fromEmail}>`,
          ReplyToAddresses: [payload.replyTo || replyTo],
          Destination: { ToAddresses: [actualRecipient] },
          ConfigurationSetName: configurationSet,
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: textBody, Charset: "UTF-8" },
                Html: { Data: htmlBody, Charset: "UTF-8" },
              },
            },
          },
        }),
      );

      if (!out.MessageId) {
        return {
          success: false,
          status: "FAILED_RETRYABLE",
          provider: undefined,
          error: "SES accepted the request but returned no MessageId.",
        };
      }

      return {
        success: true,
        status: "PROVIDER_ACCEPTED",
        providerMessageId: out.MessageId,
        submittedAt: new Date().toISOString(),
        intendedRecipient,
        actualRecipient,
        notes: isTestMode
          ? `SES TEST EMAIL DELIVERED (ID: ${out.MessageId}) to controlled mailbox ${actualRecipient} (intended: ${intendedRecipient}).`
          : `SES ENFORCEMENT NOTICE DELIVERED (ID: ${out.MessageId}) to ${actualRecipient}.`,
      };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name || "";
      const message = err instanceof Error ? err.message : String(err);

      const retryable =
        name === "Throttling" ||
        name === "ThrottlingException" ||
        name === "TooManyRequestsException" ||
        name === "TimeoutError" ||
        name === "SendingPausedException" ||
        /timeout|ECONN|EAI_AGAIN|5\d\d/i.test(message);

      const configError =
        name === "MessageRejected" ||
        name === "NotFoundException" ||
        name === "AccessDeniedException" ||
        name === "UnrecognizedClientException" ||
        name === "InvalidClientTokenId" ||
        /not verified|Email address is not verified|credential/i.test(message);

      return {
        success: false,
        status: configError ? "CONFIGURATION_ERROR" : retryable ? "FAILED_RETRYABLE" : "FAILED",
        error: `SES ${name || "error"}: ${message}`,
        intendedRecipient,
        actualRecipient,
      };
    }
  }
}
