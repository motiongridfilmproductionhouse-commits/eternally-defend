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
import { PostmarkTransport, EnforcementEmailTransport } from "../transports/email-transport";

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
    this.transport = transport || new PostmarkTransport();
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
    const subjectPrefix = isTestMode ? "[ETERNA ENFORCEMENT TEST — DO NOT ACTION] " : "";
    const noticeSubject = `${subjectPrefix}DMCA Takedown Notice — Infringement of Protected Asset on ${payload.domain}`;

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

    // 2. Route Verification Check
    const isRouteVerified = payload.destinationRouteStatus === "VERIFIED" || payload.destinationEmail;
    if (!isRouteVerified) {
      return {
        success: false,
        status: "ROUTE_DISCOVERY_REQUIRED",
        error: `Destination email route for ${payload.domain} is not verified. Automated email delivery halted.`,
      };
    }

    // 3. Prepare notice body
    const prepared = await this.prepare(payload);
    const intendedRecipient = payload.destinationEmail || `dmca@${payload.domain}`;

    // 4. Dispatch via PostmarkTransport
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
      trackingRef: result.providerMessageId ? `POSTMARK-${result.providerMessageId}` : undefined,
      notes: result.notes,
      error: result.error,
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
