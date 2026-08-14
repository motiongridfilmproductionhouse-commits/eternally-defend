/**
 * Email Enforcement Connector using Postmark Transport.
 * Integrates PostmarkTransport for outbound email enforcement notice delivery.
 * Enforces Outbound Notice Audit & Completeness Guards.
 */

import {
  EnforcementConnector,
  EnforcementCasePayload,
  ConnectorValidationResult,
  ConnectorSubmissionResult,
  ConnectorStatusResult,
} from "./registry";
import {
  PostmarkTransport,
  EnforcementEmailTransport,
  applyTestSubjectPrefix,
} from "../transports/email-transport";
import { ResendEnforcementTransport, isResendConfigured } from "../transports/resend-transport";

export class EmailEnforcementConnector implements EnforcementConnector {
  id = "email_dmca_connector";
  name = "Automated Email DMCA Connector";
  platform = "Email";
  submissionMethod = "EMAIL" as const;
  supportedBasis = [
    "COPYRIGHT" as const,
    "WEBSITE_COPYRIGHT" as const,
    "IMPERSONATION" as const,
    "DEEPFAKE" as const,
  ];

  private transport: EnforcementEmailTransport;

  constructor(transport?: EnforcementEmailTransport) {
    // Resend is the primary delivery path; Postmark remains a fallback
    // when RESEND_API_KEY is not configured in the environment.
    this.transport =
      transport || (isResendConfigured() ? new ResendEnforcementTransport() : new PostmarkTransport());
  }

  async validate(payload: EnforcementCasePayload): Promise<ConnectorValidationResult> {
    const issues: string[] = [];

    if (!payload.targetUrl || !payload.targetUrl.startsWith("http")) {
      issues.push("Invalid or missing infringing target URL");
    }
    if (!payload.complainantName || payload.complainantName.trim().length < 2 || payload.complainantName.includes("Placeholder")) {
      issues.push("Missing or placeholder rights holder legal name");
    }
    if (!payload.complainantEmail || !payload.complainantEmail.includes("@")) {
      issues.push("Missing valid complainant contact email");
    }
    if (!payload.authorizationLevel) {
      issues.push("Client authorization level not verified");
    }

    return { ok: issues.length === 0, issues };
  }

  async prepare(payload: EnforcementCasePayload): Promise<Record<string, unknown>> {
    const isTestMode = process.env.ENFORCEMENT_TEST_MODE === "true";
    const noticeSubject = applyTestSubjectPrefix(
      `DMCA Takedown Notice — Infringement of Protected Asset on ${payload.domain}`,
      isTestMode,
    );

    const noticeBody = [
      `OFFICIAL DMCA TAKEDOWN NOTICE & DEMAND FOR IMMEDIATE REMOVAL`,
      `Date: ${new Date().toUTCString()}`,
      `Target URL: ${payload.targetUrl}`,
      `Domain: ${payload.domain}`,
      `Rights Holder / Complainant: ${payload.complainantName}`,
      `Contact Email: ${payload.complainantEmail}`,
      `Authorization Status: VERIFIED (${payload.authorizationLevel})`,
      ``,
      `STATEMENT OF INFRINGEMENT:`,
      `The target URL listed above contains unauthorized publication of copyrighted content / protected identity material owned or exclusively represented by ${payload.complainantName}.`,
      ``,
      `REQUIRED STATUTORY DECLARATIONS:`,
      `1. Good Faith Belief: I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.`,
      `2. Perjury Declaration: The information in this notification is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.`,
      ``,
      `Requested Action: Please remove or disable access to the infringing material immediately.`,
      ``,
      `Sincerely,`,
      `${payload.complainantName}`,
      `Eterna Automated Enforcement System (Ref: ${payload.caseId})`,
    ].join("\n");

    return {
      noticeSubject,
      noticeBody,
      preparedAt: new Date().toISOString(),
    };
  }

  async submit(payload: EnforcementCasePayload): Promise<ConnectorSubmissionResult> {
    // 1. Validation check (Notice Completeness Guard)
    const validation = await this.validate(payload);
    if (!validation.ok) {
      return {
        success: false,
        status: "NOTICE_INCOMPLETE",
        error: `Notice Completeness Guard: Mandatory legal information missing: ${validation.issues.join("; ")}`,
      };
    }

    // 2. Route Verification Check — STRICT. A supplied destinationEmail can
    //    never substitute for a VERIFIED abuse route.
    if (payload.destinationRouteStatus !== "VERIFIED") {
      return {
        success: false,
        status: "ROUTE_DISCOVERY_REQUIRED",
        error: `Destination email route for ${payload.domain} is not VERIFIED (status: ${
          payload.destinationRouteStatus ?? "UNKNOWN"
        }). Automated email delivery halted.`,
      };
    }
    if (!payload.destinationEmail || !payload.destinationEmail.includes("@")) {
      return {
        success: false,
        status: "ROUTE_DISCOVERY_REQUIRED",
        error: `No resolved abuse recipient for ${payload.domain}. Automated email delivery halted.`,
      };
    }

    // 3. Use the pre-rendered (snapshotted) notice when provided, so the
    //    hashed/snapshotted content is byte-identical to what is sent.
    const prepared = payload.preparedNotice
      ? { noticeSubject: payload.preparedNotice.subject, noticeBody: payload.preparedNotice.textBody }
      : await this.prepare(payload);
    const intendedRecipient = payload.destinationEmail;

    // 4. Dispatch via the configured transport
    const result = await this.transport.send({
      caseId: payload.caseId,
      intendedRecipient,
      subject: String(prepared.noticeSubject),
      textBody: String(prepared.noticeBody),
      demoMode: payload.demoMode,
    });


    return {
      success: result.success,
      status: result.status,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      trackingRef: result.providerMessageId
        ? `${result.provider || (isResendConfigured() ? "RESEND" : "POSTMARK")}-${result.providerMessageId}`
        : undefined,
      notes: result.notes,
      error: result.error,
      intendedRecipient: result.intendedRecipient ?? intendedRecipient,
      actualRecipient: result.actualRecipient ?? null,
    };
  }

  async checkStatus(
    payload: EnforcementCasePayload,
    currentStatus: string,
  ): Promise<ConnectorStatusResult> {
    return {
      status: (currentStatus as ConnectorStatusResult["status"]) || "UNDER_REVIEW",
      verifiedAt: new Date().toISOString(),
    };
  }

  async retry(payload: EnforcementCasePayload, attempt: number): Promise<ConnectorSubmissionResult> {
    return this.submit(payload);
  }
}
