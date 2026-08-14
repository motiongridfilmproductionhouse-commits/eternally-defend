/**
 * Server-side Outbound Email Transport Abstraction for Postmark API.
 * Encapsulates transactional email dispatch via Postmark REST API,
 * environment safety checks, emergency pause, production allowlist gating, and hard test-mode redirection.
 */

export interface EnforcementEmailSendPayload {
  caseId: string;
  intendedRecipient: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  demoMode?: boolean;
}

export interface EnforcementEmailSendResult {
  success: boolean;
  status:
    | "PROVIDER_ACCEPTED"
    | "CONFIGURATION_ERROR"
    | "FAILED"
    | "FAILED_RETRYABLE"
    | "DEMO_MODE_BLOCKED"
    | "ROUTE_DISCOVERY_REQUIRED"
    | "KILL_SWITCH_ACTIVE"
    | "EMERGENCY_PAUSED"
    | "PRODUCTION_APPROVAL_REQUIRED"
    | "NOTICE_INCOMPLETE"
    | "QUEUED_FOR_CONTROLLED_RELEASE";
  provider?: "POSTMARK" | "RESEND";
  providerMessageId?: string;
  submittedAt?: string;
  error?: string;
  notes?: string;
  intendedRecipient?: string;
  actualRecipient?: string;
  messageStream?: string;
}

export interface EnforcementEmailTransport {
  send(payload: EnforcementEmailSendPayload): Promise<EnforcementEmailSendResult>;
}

/** Canonical controlled-test subject marker. */
export const ENFORCEMENT_TEST_SUBJECT_PREFIX = "[ETERNA ENFORCEMENT TEST — DO NOT ACTION] ";

/**
 * Applies the controlled-test subject marker exactly once.
 * Idempotent: any pre-existing marker(s) are collapsed to a single leading prefix,
 * so upstream notice builders and transports can both call this safely.
 */
export function applyTestSubjectPrefix(subject: string, isTestMode: boolean): string {
  const marker = ENFORCEMENT_TEST_SUBJECT_PREFIX.trim();
  let base = (subject ?? "").trim();
  while (base.startsWith(marker)) {
    base = base.slice(marker.length).trim();
  }
  return isTestMode ? `${ENFORCEMENT_TEST_SUBJECT_PREFIX}${base}` : base;
}


export class PostmarkTransport implements EnforcementEmailTransport {
  async send(payload: EnforcementEmailSendPayload): Promise<EnforcementEmailSendResult> {
    // 1. DEMO MODE HARD BLOCK
    const isDemoMode =
      payload.demoMode ??
      (process.env.DEMO_MODE === "true" || process.env.NODE_ENV === "test_demo");

    if (isDemoMode) {
      return {
        success: false,
        status: "DEMO_MODE_BLOCKED",
        provider: "POSTMARK",
        notes: "SIMULATION ONLY — Hard-blocked server-side in DEMO MODE. Postmark transmission halted.",
      };
    }

    // 2. EMERGENCY PAUSE CHECK (Requirement 11)
    if (process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true") {
      return {
        success: false,
        status: "EMERGENCY_PAUSED",
        provider: "POSTMARK",
        error: "EMERGENCY STOP ACTIVE: All enforcement transmissions are paused server-side.",
      };
    }

    // 3. GLOBAL PRODUCTION KILL SWITCH & ALLOWLIST CHECK (Requirements 1 & 6)
    const isLiveEnabled = process.env.ENFORCEMENT_LIVE_ENABLED === "true";
    const isTestMode = process.env.ENFORCEMENT_TEST_MODE === "true";
    const isAllowlistRequired = process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED === "true";

    if (!isLiveEnabled && !isTestMode) {
      return {
        success: false,
        status: "KILL_SWITCH_ACTIVE",
        provider: "POSTMARK",
        error: "GLOBAL KILL SWITCH ACTIVE: ENFORCEMENT_LIVE_ENABLED is false. External enforcement dispatches are blocked.",
      };
    }

    if (isLiveEnabled && !isTestMode && !isAllowlistRequired) {
      return {
        success: false,
        status: "PRODUCTION_APPROVAL_REQUIRED",
        provider: "POSTMARK",
        error: "PRODUCTION ALLOWLIST REQUIRED: ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED is false.",
      };
    }

    // 4. SERVER-SIDE ENVIRONMENT CHECK: POSTMARK_SERVER_TOKEN
    const serverToken = process.env.POSTMARK_SERVER_TOKEN;
    if (!serverToken || serverToken.trim() === "" || serverToken.includes("placeholder")) {
      return {
        success: false,
        status: "CONFIGURATION_ERROR",
        provider: "POSTMARK",
        error: "Missing required POSTMARK_SERVER_TOKEN environment variable. Live email delivery cannot proceed.",
      };
    }

    // 5. HARD TEST MODE ESCAPE PROTECTION
    const testDestination = process.env.ENFORCEMENT_TEST_DESTINATION || "test-enforcement@eterna.ai";

    const intendedRecipient = payload.intendedRecipient;
    // Hard force test destination when ENFORCEMENT_TEST_MODE is true; NO upstream value can bypass this
    const actualRecipient = isTestMode ? testDestination : intendedRecipient;

    const fullSubject = applyTestSubjectPrefix(payload.subject, isTestMode);

    const testWarningHeader = isTestMode
      ? [
          "==========================================",
          "THIS IS AN ETERNA CONTROLLED ENFORCEMENT TEST.",
          "NO ACTION IS REQUESTED AGAINST ANY REAL THIRD PARTY.",
          `INTENDED RECIPIENT: ${intendedRecipient}`,
          `ACTUAL TEST RECIPIENT: ${actualRecipient}`,
          "==========================================\n",
        ].join("\n")
      : "";

    const fullTextBody = `${testWarningHeader}${payload.textBody}`;

    const fromEmail = process.env.ENFORCEMENT_FROM_EMAIL || "enforcement@eterna.ai";
    const messageStream = process.env.POSTMARK_MESSAGE_STREAM || "outbound";

    // 6. REAL POSTMARK REST API CALL (Sends ONLY to actualRecipient)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "X-Postmark-Server-Token": serverToken.trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          From: fromEmail,
          To: actualRecipient,
          Subject: fullSubject,
          TextBody: fullTextBody,
          MessageStream: messageStream,
        }),
      });
      clearTimeout(timeout);

      const resData = (await res.json()) as {
        To?: string;
        SubmittedAt?: string;
        MessageID?: string;
        ErrorCode?: number;
        Message?: string;
      };

      if (res.status === 401) {
        return {
          success: false,
          status: "CONFIGURATION_ERROR",
          provider: "POSTMARK",
          error: `Postmark authentication failed (401): Invalid POSTMARK_SERVER_TOKEN.`,
        };
      }

      if (res.status === 422 || (resData.ErrorCode && resData.ErrorCode > 0)) {
        return {
          success: false,
          status: "FAILED",
          provider: "POSTMARK",
          error: `Postmark API error (${resData.ErrorCode || res.status}): ${resData.Message || "Unprocessable entity / invalid sender or recipient."}`,
        };
      }

      if (res.status === 429 || res.status >= 500) {
        return {
          success: false,
          status: "FAILED_RETRYABLE",
          provider: "POSTMARK",
          error: `Postmark transient error (${res.status}): ${resData.Message || "Service throttled or temporary failure."}`,
        };
      }

      if (!res.ok || !resData.MessageID) {
        return {
          success: false,
          status: "FAILED",
          provider: "POSTMARK",
          error: `Postmark API error (${res.status}): ${resData.Message || "Missing MessageID in response."}`,
        };
      }

      return {
        success: true,
        status: "PROVIDER_ACCEPTED",
        provider: "POSTMARK",
        providerMessageId: resData.MessageID,
        submittedAt: resData.SubmittedAt || new Date().toISOString(),
        intendedRecipient,
        actualRecipient,
        messageStream,
        notes: isTestMode
          ? `REAL POSTMARK TEST EMAIL DELIVERED (ID: ${resData.MessageID}). Redirected to controlled mailbox ${actualRecipient} (Intended: ${intendedRecipient}).`
          : `REAL POSTMARK ENFORCEMENT NOTICE DELIVERED (ID: ${resData.MessageID}) to ${actualRecipient}.`,
      };
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === "AbortError";
      return {
        success: false,
        status: isTimeout ? "FAILED_RETRYABLE" : "FAILED",
        provider: "POSTMARK",
        error: isTimeout
          ? "Network timeout connecting to Postmark API."
          : `Network error connecting to Postmark API: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
