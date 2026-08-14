/**
 * Builds and dispatches real enforcement notices (DMCA / report emails) from
 * existing case + evidence data via Resend, records the delivery audit row,
 * and only marks the enforcement request SUBMITTED after Resend accepts.
 *
 * Server-only module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ResendEnforcementTransport,
  getResendSenderConfig,
  type EnforcementAttachmentLink,
} from "./transports/resend-transport";
import { recordEmailDelivery } from "./email-delivery-log.server";
import { getSignedGetUrl } from "@/lib/aws/s3.server";
import type { EnforcementEmailSendResult } from "./transports/email-transport";

const LINK_TTL_SECONDS = 60 * 60 * 24 * 3; // 3 days

export interface NoticeSendOutcome {
  success: boolean;
  status: string;
  providerMessageId?: string;
  destination?: string;
  intendedRecipient?: string;
  sentAt?: string;
  error?: string;
  deliveryLogId?: string | null;
  testMode: boolean;
  retryable: boolean;
}

async function presign(key: string, label: string): Promise<EnforcementAttachmentLink | null> {
  try {
    const url = await getSignedGetUrl(key, LINK_TTL_SECONDS, {
      disposition: "attachment",
      filename: key.split("/").pop() || "document.pdf",
      contentType: "application/pdf",
    });
    return { label, url, expiresInSeconds: LINK_TTL_SECONDS };
  } catch (err) {
    console.error("[enforcement/email] failed to presign document", key, err);
    return null;
  }
}

export function buildDmcaNoticeBody(input: {
  requestId: string;
  targetUrl: string;
  platform: string;
  complainantName: string;
  complainantEmail: string;
  workTitle?: string | null;
  evidenceSummary: string[];
}): { subject: string; textBody: string } {
  const host = (() => {
    try {
      return new URL(input.targetUrl).hostname;
    } catch {
      return input.platform;
    }
  })();

  const subject = `DMCA Takedown Notice — Unauthorized use of protected content on ${host}`;

  const textBody = [
    "OFFICIAL DMCA TAKEDOWN NOTICE",
    `Date: ${new Date().toUTCString()}`,
    `Reference: ${input.requestId}`,
    "",
    `Rights holder / complainant: ${input.complainantName}`,
    `Contact email: ${input.complainantEmail}`,
    input.workTitle ? `Protected work: ${input.workTitle}` : "",
    "",
    "INFRINGING MATERIAL:",
    `- URL: ${input.targetUrl}`,
    `- Platform / host: ${input.platform}`,
    "",
    input.evidenceSummary.length ? "EVIDENCE ON RECORD:" : "",
    ...input.evidenceSummary.map((e) => `- ${e}`),
    "",
    "STATEMENT OF INFRINGEMENT:",
    `The URL above hosts or distributes material that infringes rights owned or exclusively represented by ${input.complainantName}. This use is not authorized by the rights holder, its agent, or the law.`,
    "",
    "REQUIRED STATUTORY DECLARATIONS:",
    "1. I have a good faith belief that the use of the material described above is not authorized by the copyright owner, its agent, or the law.",
    "2. The information in this notification is accurate, and under penalty of perjury I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.",
    "",
    "REQUESTED ACTION: Please expeditiously remove or disable access to the infringing material and confirm the action taken to the contact email above.",
    "",
    "Sincerely,",
    input.complainantName,
    `Eterna Sentinel Enforcement Center (Ref: ${input.requestId})`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { subject, textBody };
}

/**
 * Sends the notice for an existing enforcement_request row.
 * `destinationEmail` must already be a verified/resolved abuse route.
 */
export async function sendEnforcementRequestNotice(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    enforcementRequestId: string;
    destinationEmail: string;
    caseId?: string | null;
    demoMode?: boolean;
  },
): Promise<NoticeSendOutcome> {
  const isTestMode = process.env.ENFORCEMENT_TEST_MODE === "true";
  const { fromEmail } = getResendSenderConfig();

  const { data: req } = await (supabase as any)
    .from("enforcement_requests")
    .select("*")
    .eq("id", opts.enforcementRequestId)
    .eq("user_id", opts.userId)
    .maybeSingle();

  if (!req) {
    return {
      success: false,
      status: "NOT_FOUND",
      error: "Enforcement request not found for this account.",
      testMode: isTestMode,
      retryable: false,
    };
  }

  const [{ data: evidence }, { data: profile }] = await Promise.all([
    (supabase as any)
      .from("enforcement_evidence")
      .select("evidence_type, reference, storage_path, created_at")
      .eq("enforcement_request_id", opts.enforcementRequestId)
      .eq("user_id", opts.userId),
    (supabase as any)
      .from("client_profiles")
      .select("legal_name, full_name, company_name, email")
      .eq("user_id", opts.userId)
      .maybeSingle(),
  ]);

  const complainantName =
    profile?.legal_name || profile?.company_name || profile?.full_name || "";
  const complainantEmail = profile?.email || getResendSenderConfig().replyTo;

  if (!complainantName || complainantName.length < 2) {
    return {
      success: false,
      status: "NOTICE_INCOMPLETE",
      error: "Rights holder legal name is missing on the account profile.",
      testMode: isTestMode,
      retryable: false,
    };
  }
  if (!req.target_url) {
    return {
      success: false,
      status: "NOTICE_INCOMPLETE",
      error: "Enforcement request has no target URL.",
      testMode: isTestMode,
      retryable: false,
    };
  }

  const evidenceSummary = (evidence ?? []).map(
    (e: { evidence_type: string; reference: string | null; created_at: string }) =>
      `${e.evidence_type}${e.reference ? `: ${e.reference}` : ""} (captured ${new Date(e.created_at).toISOString().slice(0, 10)})`,
  );

  const { subject, textBody } = buildDmcaNoticeBody({
    requestId: req.id,
    targetUrl: req.target_url,
    platform: req.platform || "Web",
    complainantName,
    complainantEmail,
    workTitle: (req.metadata as Record<string, unknown> | null)?.["work_title"] as string | undefined,
    evidenceSummary,
  });

  // Secure, backend-generated, time-limited document links (never public URLs).
  const docKeys: Array<{ key: string; label: string }> = [];
  if (req.evidence_pdf_path) docKeys.push({ key: req.evidence_pdf_path, label: "Evidence package (PDF)" });
  if (req.platform_complaint_pdf_path)
    docKeys.push({ key: req.platform_complaint_pdf_path, label: "Formal notice (PDF)" });
  if (req.authorization_pdf_path)
    docKeys.push({ key: req.authorization_pdf_path, label: "Authorization letter (PDF)" });
  for (const e of evidence ?? []) {
    if (e.storage_path) docKeys.push({ key: e.storage_path, label: `Evidence — ${e.evidence_type}` });
  }

  const documentLinks: EnforcementAttachmentLink[] = [];
  for (const d of docKeys.slice(0, 8)) {
    const link = await presign(d.key, d.label);
    if (link) documentLinks.push(link);
  }

  const result: EnforcementEmailSendResult = await new ResendEnforcementTransport().send({
    caseId: opts.caseId ?? req.id,
    enforcementRequestId: req.id,
    intendedRecipient: opts.destinationEmail,
    subject,
    textBody,
    documentLinks,
    demoMode: opts.demoMode,
    replyTo: complainantEmail,
  });

  const deliveryLogId = await recordEmailDelivery(
    {
      userId: opts.userId,
      enforcementRequestId: req.id,
      caseId: opts.caseId ?? null,
      fromEmail,
      intendedRecipient: opts.destinationEmail,
      subject,
      testMode: isTestMode,
      attachments: docKeys.map((d) => ({ label: d.label, key: d.key, expiresInSeconds: LINK_TTL_SECONDS })),
      metadata: { targetUrl: req.target_url, platform: req.platform },
    },
    result,
  );

  const nowIso = new Date().toISOString();

  if (result.success) {
    // Only mark SUBMITTED after the email provider returns success.
    await (supabase as any)
      .from("enforcement_requests")
      .update({
        status: "SUBMITTED",
        submission_status: "SUBMITTED",
        submitted_at: result.submittedAt ?? nowIso,
        metadata: {
          ...((req.metadata as Record<string, unknown>) ?? {}),
          last_email_delivery_id: deliveryLogId,
          provider_message_id: result.providerMessageId,
          provider_destination: result.actualRecipient,
          provider_test_mode: isTestMode,
        } as never,
        updated_at: nowIso,
      })
      .eq("id", req.id);
  } else {
    // Persist the error and leave the request retryable.
    await (supabase as any)
      .from("enforcement_requests")
      .update({
        submission_status: result.status === "FAILED_RETRYABLE" ? "RETRY_PENDING" : "SEND_FAILED",
        response_notes: result.error ?? result.notes ?? null,
        metadata: {
          ...((req.metadata as Record<string, unknown>) ?? {}),
          last_email_delivery_id: deliveryLogId,
          last_send_error: result.error ?? null,
          last_send_error_at: nowIso,
          retryable: result.status === "FAILED_RETRYABLE",
        } as never,
        updated_at: nowIso,
      })
      .eq("id", req.id);
  }

  return {
    success: result.success,
    status: result.status,
    providerMessageId: result.providerMessageId,
    destination: result.actualRecipient,
    intendedRecipient: result.intendedRecipient ?? opts.destinationEmail,
    sentAt: result.submittedAt,
    error: result.error,
    deliveryLogId,
    testMode: isTestMode,
    retryable: result.status === "FAILED_RETRYABLE",
  };
}
