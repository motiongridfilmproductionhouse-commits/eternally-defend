/**
 * FINAL PRE-SEND GATE — pure decision logic.
 *
 * This is the last authority before any enforcement notice is handed to a
 * transport. It is intentionally a pure function so it can be unit-tested and
 * so no UI, connector or operator action can bypass it: the server-side caller
 * (`pre-send-gate.server.ts`) collects the facts, this function decides, and
 * the transport is only reached on `GO`.
 *
 * Fail-closed: every condition must be explicitly satisfied. Missing or
 * unknown data is a failure, never a pass.
 */

export type PreSendGateResult = "GO" | "NO_GO";

/** Verification methods that may ever back an automated email recipient. */
export const EMAIL_ELIGIBLE_VERIFICATION_METHODS = [
  "PUBLISHED_DMCA_PAGE",
  "PUBLISHED_LEGAL_CONTACT",
  "OFFICIAL_CORRESPONDENCE",
] as const;

/** Sources that can never, on their own, authorize an automated recipient. */
export const DISALLOWED_RECIPIENT_SOURCES = [
  "WHOIS",
  "REGISTRAR",
  "REGISTRAR_ABUSE_RECORD",
  "HOSTING_PROVIDER_ABUSE_PAGE",
  "CDN",
  "CLOUDFLARE",
  "THIRD_PARTY_DIRECTORY",
  "ABUSE_DATABASE",
] as const;

export interface PreSendGateFacts {
  system: {
    liveEnabled: boolean;
    testMode: boolean;
    emergencyPause: boolean;
    demoMode: boolean;
    allowlistFlagEnabled: boolean;
  };
  client: {
    userId: string | null;
    productionApproved: boolean;
    authorizationId: string | null;
    authorizationStatus: string | null;
    authorizationEnforcementEnabled: boolean;
    authorizationExpiresAt: string | null;
  };
  asset: {
    assetId: string | null;
    productionApproved: boolean;
    rightsEvidenceRef: string | null;
  };
  finding: {
    findingId: string | null;
    reviewed: boolean;
    enforcementGround: string | null;
    evidenceSnapshotRef: string | null;
  };
  route: {
    infringingHost: string | null;
    recipient: string | null;
    verificationStatus: string | null;
    verificationMethod: string | null;
    authoritativeSourceUrl: string | null;
    verificationEvidencePreserved: boolean;
    verifiedAt: string | null;
    sameOrganisationPassed: boolean;
    recipientSource: string | null;
    allowlisted: boolean;
    suppressed: boolean;
    emailEligible: boolean;
  };
  notice: {
    recipient: string | null;
    subject: string | null;
    evidenceReferenceCount: number;
    clientIdentity: string | null;
    authorizedRepresentativeLanguagePresent: boolean;
    replyTo: string | null;
    replyToVerified: boolean;
    testRecipientSubstitution: boolean;
    ccRecipients: string[];
    bccRecipients: string[];
  };
  limits: {
    globalCeilingPassed: boolean;
    clientCeilingPassed: boolean;
    domainCeilingPassed: boolean;
    duplicateSendProtectionPassed: boolean;
    limitReason?: string | null;
  };
}

export interface PreSendGateDecision {
  result: PreSendGateResult;
  failedConditions: string[];
  /** Human-readable single-line verdict, safe for logs (no secrets). */
  summary: string;
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.now();
}

/**
 * Evaluates every pilot condition. Returns GO only when all pass.
 */
export function evaluatePreSendGate(facts: PreSendGateFacts): PreSendGateDecision {
  const failed: string[] = [];
  const fail = (code: string) => failed.push(code);

  // ---- SYSTEM ------------------------------------------------------------
  if (!facts.system.liveEnabled) fail("SYSTEM.LIVE_ENFORCEMENT_DISABLED");
  if (facts.system.testMode) fail("SYSTEM.TEST_MODE_ACTIVE");
  if (facts.system.emergencyPause) fail("SYSTEM.EMERGENCY_PAUSE_ACTIVE");
  if (facts.system.demoMode) fail("SYSTEM.DEMO_MODE_ACTIVE");
  if (!facts.system.allowlistFlagEnabled) fail("SYSTEM.PRODUCTION_ALLOWLIST_FLAG_DISABLED");

  // ---- CLIENT ------------------------------------------------------------
  if (!facts.client.userId) fail("CLIENT.MISSING");
  if (!facts.client.productionApproved) fail("CLIENT.NOT_PRODUCTION_APPROVED");
  if (!facts.client.authorizationId) fail("CLIENT.AUTHORIZATION_MISSING");
  if ((facts.client.authorizationStatus ?? "").toUpperCase() !== "ACTIVE")
    fail("CLIENT.AUTHORIZATION_NOT_ACTIVE");
  if (!facts.client.authorizationEnforcementEnabled)
    fail("CLIENT.AUTHORIZATION_ENFORCEMENT_NOT_ENABLED");
  if (isExpired(facts.client.authorizationExpiresAt)) fail("CLIENT.AUTHORIZATION_EXPIRED");

  // ---- ASSET -------------------------------------------------------------
  if (!facts.asset.assetId) fail("ASSET.MISSING");
  if (!facts.asset.productionApproved) fail("ASSET.NOT_PRODUCTION_APPROVED");
  if (!facts.asset.rightsEvidenceRef) fail("ASSET.RIGHTS_EVIDENCE_MISSING");

  // ---- FINDING -----------------------------------------------------------
  if (!facts.finding.findingId) fail("FINDING.MISSING");
  if (!facts.finding.reviewed) fail("FINDING.NOT_REVIEWED");
  if (!facts.finding.enforcementGround) fail("FINDING.ENFORCEMENT_GROUND_MISSING");
  if (!facts.finding.evidenceSnapshotRef) fail("FINDING.EVIDENCE_SNAPSHOT_MISSING");

  // ---- ROUTE -------------------------------------------------------------
  const recipient = (facts.route.recipient ?? "").trim().toLowerCase();
  if (!recipient.includes("@")) fail("ROUTE.RECIPIENT_MISSING");
  if ((facts.route.verificationStatus ?? "").toUpperCase() !== "VERIFIED")
    fail("ROUTE.RECIPIENT_NOT_VERIFIED");
  if (
    !EMAIL_ELIGIBLE_VERIFICATION_METHODS.includes(
      (facts.route.verificationMethod ?? "") as (typeof EMAIL_ELIGIBLE_VERIFICATION_METHODS)[number],
    )
  )
    fail("ROUTE.VERIFICATION_METHOD_NOT_EMAIL_ELIGIBLE");
  if (!facts.route.emailEligible) fail("ROUTE.NOT_EMAIL_ELIGIBLE");
  if (!facts.route.authoritativeSourceUrl) fail("ROUTE.AUTHORITATIVE_SOURCE_URL_MISSING");
  if (!facts.route.verificationEvidencePreserved)
    fail("ROUTE.VERIFICATION_EVIDENCE_NOT_PRESERVED");
  if (!facts.route.verifiedAt) fail("ROUTE.VERIFICATION_TIMESTAMP_MISSING");
  if (!facts.route.sameOrganisationPassed) fail("ROUTE.SAME_ORGANISATION_POLICY_FAILED");
  if (
    facts.route.recipientSource &&
    DISALLOWED_RECIPIENT_SOURCES.includes(
      facts.route.recipientSource.toUpperCase() as (typeof DISALLOWED_RECIPIENT_SOURCES)[number],
    )
  )
    fail("ROUTE.RECIPIENT_SOURCE_NOT_AUTHORITATIVE");
  if (!facts.route.allowlisted) fail("ROUTE.RECIPIENT_NOT_ALLOWLISTED");
  if (facts.route.suppressed) fail("ROUTE.RECIPIENT_SUPPRESSED");

  // Authoritative source page must live on the infringing host's own domain.
  const sourceHost = hostOf(facts.route.authoritativeSourceUrl);
  const infringingHost = (facts.route.infringingHost ?? "").toLowerCase().replace(/^www\./, "");
  if (sourceHost && infringingHost) {
    const sameOrg =
      sourceHost === infringingHost ||
      sourceHost.endsWith(`.${infringingHost}`) ||
      infringingHost.endsWith(`.${sourceHost}`);
    if (!sameOrg) fail("ROUTE.SOURCE_HOST_MISMATCH");
  }

  // ---- NOTICE ------------------------------------------------------------
  const noticeRecipient = (facts.notice.recipient ?? "").trim().toLowerCase();
  if (!noticeRecipient || noticeRecipient !== recipient) fail("NOTICE.RECIPIENT_MISMATCH");
  if (!facts.notice.subject || facts.notice.subject.trim().length < 8)
    fail("NOTICE.SUBJECT_INVALID");
  if (facts.notice.evidenceReferenceCount < 1) fail("NOTICE.EVIDENCE_REFERENCES_MISSING");
  if (!facts.notice.clientIdentity || facts.notice.clientIdentity.trim().length < 2)
    fail("NOTICE.CLIENT_IDENTITY_MISSING");
  if (!facts.notice.authorizedRepresentativeLanguagePresent)
    fail("NOTICE.AUTHORIZED_REPRESENTATIVE_LANGUAGE_MISSING");
  if (!facts.notice.replyTo) fail("NOTICE.REPLY_TO_MISSING");
  if (!facts.notice.replyToVerified) fail("NOTICE.REPLY_TO_NOT_VERIFIED");
  if (facts.notice.testRecipientSubstitution) fail("NOTICE.TEST_RECIPIENT_SUBSTITUTION");
  if (facts.notice.ccRecipients.length > 0) fail("NOTICE.UNEXPECTED_CC_RECIPIENTS");
  if (facts.notice.bccRecipients.length > 0) fail("NOTICE.UNEXPECTED_BCC_RECIPIENTS");

  // ---- RATE LIMITS -------------------------------------------------------
  if (!facts.limits.globalCeilingPassed) fail("LIMITS.GLOBAL_CEILING_EXCEEDED");
  if (!facts.limits.clientCeilingPassed) fail("LIMITS.CLIENT_CEILING_EXCEEDED");
  if (!facts.limits.domainCeilingPassed) fail("LIMITS.DOMAIN_CEILING_EXCEEDED");
  if (!facts.limits.duplicateSendProtectionPassed) fail("LIMITS.DUPLICATE_SEND_DETECTED");

  const result: PreSendGateResult = failed.length === 0 ? "GO" : "NO_GO";
  return {
    result,
    failedConditions: failed,
    summary:
      result === "GO"
        ? "GO — all pre-send conditions satisfied."
        : `NO-GO — SEND BLOCKED (${failed.length} failed condition${failed.length === 1 ? "" : "s"}): ${failed.join(", ")}`,
  };
}

/**
 * Stable idempotency key for one approved outbound enforcement action.
 * Identical inputs always produce the same key, so retries, worker restarts,
 * double clicks and concurrent jobs collapse onto a single audit row.
 */
export function outboundIdempotencyKey(input: {
  caseId?: string | null;
  enforcementRequestId?: string | null;
  recipient: string;
  targetUrl: string;
}): string {
  return [
    "outbound",
    input.caseId ?? "no-case",
    input.enforcementRequestId ?? "no-request",
    input.recipient.trim().toLowerCase(),
    input.targetUrl.trim().toLowerCase(),
  ].join("|");
}
