/**
 * FINAL PRE-SEND GATE — server-side fact collection, decision and audit claim.
 *
 * Every outbound enforcement notice MUST pass through `runFinalPreSendGate`
 * immediately before transport execution. There is no UI-only path: the gate
 * runs inside the send routine itself, reads state from the database and the
 * environment, writes an immutable audit row, and returns NO_GO on any doubt.
 *
 * Server-only module. Never returns secrets, keys or credentials, and never
 * writes them into the audit trail.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluatePreSendGate,
  outboundIdempotencyKey,
  type PreSendGateDecision,
  type PreSendGateFacts,
} from "./pre-send-gate";
import { EnforcementRateLimiter } from "./rate-limiter";
import { isRecipientAllowlisted, isRecipientSuppressed } from "./recipient-allowlist.server";
import { getResendSenderConfig } from "./transports/resend-transport";

export interface PreSendGateRequest {
  userId: string;
  caseId?: string | null;
  enforcementRequestId?: string | null;
  targetUrl: string;
  recipient: string;
  /** The exact notice about to be handed to the transport. */
  notice: {
    recipient: string;
    subject: string;
    textBody: string;
    evidenceReferenceCount: number;
    clientIdentity: string | null;
    replyTo: string | null;
    noticeHash?: string | null;
    cc?: string[];
    bcc?: string[];
  };
  operatorUserId?: string | null;
  findingId?: string | null;
  protectedAssetId?: string | null;
}

export interface PreSendGateOutcome extends PreSendGateDecision {
  auditId: string | null;
  idempotencyKey: string;
  /** True when an audit row for this exact action already existed. */
  duplicate: boolean;
}

function admin(): Promise<SupabaseClient> {
  return import("@/integrations/supabase/client.server").then(
    (m) => m.supabaseAdmin as unknown as SupabaseClient,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Reply-To mailbox is only trusted when an operator has explicitly confirmed it. */
export function isReplyToVerified(replyTo: string | null): boolean {
  if (!replyTo) return false;
  const confirmed = (process.env.ENFORCEMENT_REPLY_TO_VERIFIED ?? "").trim().toLowerCase();
  const mailbox = (process.env.ENFORCEMENT_REPLY_TO_VERIFIED_MAILBOX ?? "").trim().toLowerCase();
  if (confirmed !== "true") return false;
  return !!mailbox && mailbox === replyTo.trim().toLowerCase();
}

/**
 * Collects facts, evaluates the gate and records the immutable audit row.
 * A `GO` result also claims the idempotency key, so a second concurrent
 * attempt for the same action is reported as a duplicate and blocked.
 */
export async function runFinalPreSendGate(
  supabase: SupabaseClient,
  req: PreSendGateRequest,
): Promise<PreSendGateOutcome> {
  const db = await admin();
  const host = hostOf(req.targetUrl);
  const recipient = (req.recipient ?? "").trim().toLowerCase();
  const idempotencyKey = outboundIdempotencyKey({
    caseId: req.caseId,
    enforcementRequestId: req.enforcementRequestId,
    recipient,
    targetUrl: req.targetUrl,
  });

  const liveEnabled = process.env.ENFORCEMENT_LIVE_ENABLED === "true";
  const testMode = process.env.ENFORCEMENT_TEST_MODE === "true";
  const { replyTo: defaultReplyTo, testDestination } = getResendSenderConfig();
  const replyTo = req.notice.replyTo || defaultReplyTo;

  const [
    caseRow,
    clientApproval,
    assetApproval,
    authorization,
    route,
    allowlist,
    suppression,
    existingAudit,
  ] = await Promise.all([
    req.caseId
      ? (db as any)
          .from("enforcement_cases")
          .select(
            "id, user_id, protected_asset_id, scan_hit_id, enforcement_basis, eligibility_status, authorization_status, target_url, domain",
          )
          .eq("id", req.caseId)
          .eq("user_id", req.userId)
          .maybeSingle()
          .then((r: any) => r.data)
      : Promise.resolve(null),
    (db as any)
      .from("enforcement_production_approvals")
      .select("id, approval_reference, rights_evidence_ref")
      .eq("scope", "CLIENT")
      .eq("user_id", req.userId)
      .eq("active", true)
      .maybeSingle()
      .then((r: any) => r.data),
    Promise.resolve(null),
    (db as any)
      .from("client_authorizations")
      .select("id, auth_number, status, enforcement_enabled, expiry_date")
      .eq("user_id", req.userId)
      .eq("status", "ACTIVE")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r: any) => r.data),
    host
      ? (db as any)
          .from("domain_enforcement_routes")
          .select(
            "id, domain, recipient_email, copyright_email, verification_status, verification_method, authoritative_source_url, source_url, evidence_snapshot, verified_at, contact_type, route_type",
          )
          .eq("domain", host)
          .maybeSingle()
          .then((r: any) => r.data)
      : Promise.resolve(null),
    isRecipientAllowlisted(recipient),
    isRecipientSuppressed(recipient),
    (db as any)
      .from("enforcement_presend_audit")
      .select("id, gate_result, provider_message_id, submission_status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle()
      .then((r: any) => r.data),
  ]);

  const assetId = req.protectedAssetId ?? caseRow?.protected_asset_id ?? null;
  const assetApprovalRow = assetId
    ? await (db as any)
        .from("enforcement_production_approvals")
        .select("id, approval_reference, rights_evidence_ref")
        .eq("scope", "ASSET")
        .eq("protected_asset_id", assetId)
        .eq("user_id", req.userId)
        .eq("active", true)
        .maybeSingle()
        .then((r: any) => r.data)
    : (assetApproval as null);

  // Evidence snapshot for the finding (preserved internal copy is mandatory).
  const findingId = req.findingId ?? caseRow?.scan_hit_id ?? null;
  const evidenceRow = findingId
    ? await (db as any)
        .from("preserved_evidence_media")
        .select("id, storage_key, finding_id")
        .eq("user_id", req.userId)
        .eq("finding_id", findingId)
        .limit(1)
        .maybeSingle()
        .then((r: any) => r.data)
    : null;

  const rate = await EnforcementRateLimiter.checkRateLimit(supabase, req.userId, host);
  const rateBlocked = !rate.allowed;

  const verificationMethod = route?.verification_method ?? null;
  const authoritativeSourceUrl = route?.authoritative_source_url ?? null;
  const evidenceSnapshot = route?.evidence_snapshot ?? null;
  const routeRecipient = (route?.recipient_email ?? route?.copyright_email ?? null) as string | null;

  const facts: PreSendGateFacts = {
    system: {
      liveEnabled,
      testMode,
      emergencyPause: process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true",
      demoMode: process.env.DEMO_MODE === "true",
      allowlistFlagEnabled: process.env.ENFORCEMENT_PRODUCTION_ALLOWLIST_ENABLED === "true",
    },
    client: {
      userId: req.userId,
      productionApproved: !!clientApproval?.id,
      authorizationId: authorization?.id ?? null,
      authorizationStatus: authorization?.status ?? null,
      authorizationEnforcementEnabled: !!authorization?.enforcement_enabled,
      authorizationExpiresAt: authorization?.expiry_date ?? null,
    },
    asset: {
      assetId,
      productionApproved: !!assetApprovalRow?.id,
      rightsEvidenceRef: assetApprovalRow?.rights_evidence_ref ?? null,
    },
    finding: {
      findingId,
      reviewed: (caseRow?.eligibility_status ?? "") === "ELIGIBLE",
      enforcementGround: caseRow?.enforcement_basis ?? null,
      evidenceSnapshotRef: evidenceRow?.storage_key ?? null,
    },
    route: {
      infringingHost: host || null,
      recipient: routeRecipient ? routeRecipient.trim().toLowerCase() : recipient || null,
      verificationStatus: route?.verification_status ?? null,
      verificationMethod,
      authoritativeSourceUrl,
      verificationEvidencePreserved:
        !!evidenceSnapshot && Object.keys(evidenceSnapshot as object).length > 0,
      verifiedAt: route?.verified_at ?? null,
      sameOrganisationPassed:
        !!routeRecipient && !!host && routeRecipient.toLowerCase().endsWith(`@${host}`),
      recipientSource: route?.contact_type ?? null,
      allowlisted: allowlist.allowed,
      suppressed: !suppression.allowed,
      emailEligible: (route?.route_type ?? "") !== "HOST_ORIGIN_DISCOVERY_REQUIRED",
    },
    notice: {
      recipient: req.notice.recipient,
      subject: req.notice.subject,
      evidenceReferenceCount: req.notice.evidenceReferenceCount,
      clientIdentity: req.notice.clientIdentity,
      authorizedRepresentativeLanguagePresent: /authorized to act on behalf/i.test(
        req.notice.textBody,
      ),
      replyTo,
      replyToVerified: isReplyToVerified(replyTo),
      testRecipientSubstitution:
        !!testDestination && recipient === testDestination.trim().toLowerCase(),
      ccRecipients: req.notice.cc ?? [],
      bccRecipients: req.notice.bcc ?? [],
    },
    limits: {
      globalCeilingPassed: !rateBlocked,
      clientCeilingPassed: !rateBlocked,
      domainCeilingPassed: !rateBlocked,
      duplicateSendProtectionPassed: !existingAudit,
      limitReason: rate.reason ?? null,
    },
  };

  const decision = evaluatePreSendGate(facts);

  if (existingAudit) {
    return {
      ...decision,
      result: "NO_GO",
      failedConditions: Array.from(
        new Set([...decision.failedConditions, "LIMITS.DUPLICATE_SEND_DETECTED"]),
      ),
      summary:
        "NO-GO — SEND BLOCKED: an outbound action for this exact case/recipient/URL already exists.",
      auditId: existingAudit.id ?? null,
      idempotencyKey,
      duplicate: true,
    };
  }

  const { data: inserted, error } = await (db as any)
    .from("enforcement_presend_audit")
    .insert({
      idempotency_key: idempotencyKey,
      case_id: req.caseId ?? null,
      enforcement_request_id: req.enforcementRequestId ?? null,
      user_id: req.userId,
      protected_asset_id: assetId,
      finding_id: findingId,
      infringing_url: req.targetUrl,
      infringing_host: host || null,
      recipient,
      recipient_verification_method: verificationMethod,
      authoritative_source_url: authoritativeSourceUrl,
      recipient_verified_at: route?.verified_at ?? null,
      evidence_reference: evidenceRow?.storage_key ?? null,
      evidence_snapshot_ref: (evidenceSnapshot as object) ?? {},
      operator_approved_by: req.operatorUserId ?? null,
      client_authorization_id: authorization?.id ?? null,
      client_authorization_reference: authorization?.auth_number ?? null,
      asset_approval_id: assetApprovalRow?.id ?? null,
      asset_approval_reference: assetApprovalRow?.approval_reference ?? null,
      enforcement_ground: caseRow?.enforcement_basis ?? null,
      gate_result: decision.result,
      failed_conditions: decision.failedConditions,
      gate_snapshot: facts as unknown as Record<string, unknown>,
      notice_hash: req.notice.noticeHash ?? null,
      notice_subject: req.notice.subject,
      reply_to: replyTo,
      reply_to_verified: facts.notice.replyToVerified,
      test_mode: testMode,
      live_enabled: liveEnabled,
      transport: "RESEND",
      submission_status: decision.result === "GO" ? "GATE_PASSED" : "GATE_BLOCKED",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique-key collision => a concurrent attempt claimed this action first.
    return {
      result: "NO_GO",
      failedConditions: Array.from(
        new Set([...decision.failedConditions, "LIMITS.DUPLICATE_SEND_DETECTED"]),
      ),
      summary:
        "NO-GO — SEND BLOCKED: concurrent attempt already claimed this outbound action (idempotency collision).",
      auditId: null,
      idempotencyKey,
      duplicate: true,
    };
  }

  return {
    ...decision,
    auditId: inserted?.id ?? null,
    idempotencyKey,
    duplicate: false,
  };
}

/** Records the transport result against the pre-send audit row. */
export async function recordPreSendAuditResult(
  auditId: string | null,
  result: {
    providerMessageId?: string | null;
    submittedAt?: string | null;
    submissionStatus: string;
    transport?: string;
  },
): Promise<void> {
  if (!auditId) return;
  const db = await admin();
  await (db as any)
    .from("enforcement_presend_audit")
    .update({
      provider_message_id: result.providerMessageId ?? null,
      submitted_at: result.submittedAt ?? null,
      submission_status: result.submissionStatus,
      transport: result.transport ?? "RESEND",
    })
    .eq("id", auditId);
}
