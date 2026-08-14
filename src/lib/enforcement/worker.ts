/**
 * Server-Side Durable Job Worker with Controlled Production Activation Guards.
 * Executes pre-send client & asset production approval checks, first-live basis restrictions,
 * rate limit checks, Postmark transport dispatch, immutable submission snapshots, and status verification schedules.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { connectorRegistry, EnforcementCasePayload } from "./connectors/registry";
import { VerificationEngine } from "./verification-engine";
import { EnforcementRouteResolver } from "./route-resolver";
import { EnforcementRateLimiter } from "./rate-limiter";
import { createHash } from "crypto";
import "./connectors/platform-connectors";

export interface JobRow {
  id: string;
  case_id: string;
  user_id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
}

export class EnforcementWorkerRunner {
  static async processNextJob(supabase: SupabaseClient, workerId = "backend-worker-1"): Promise<boolean> {
    // 1. EMERGENCY STOP CHECK (Requirement 11)
    if (process.env.ENFORCEMENT_EMERGENCY_PAUSE === "true") {
      return false;
    }

    // 2. ATOMIC JOB CLAIMING
    let job: JobRow | null = null;

    try {
      const { data: claimed } = await (supabase as any).rpc("claim_next_enforcement_job", {
        p_worker_id: workerId,
      });

      if (claimed && Array.isArray(claimed) && claimed.length > 0) {
        job = claimed[0] as JobRow;
      }
    } catch {
      // Fallback
    }

    if (!job) {
      const nowIso = new Date().toISOString();
      const { data: fallbackJob } = await (supabase as any)
        .from("enforcement_jobs")
        .select("*")
        .eq("status", "queued")
        .lte("scheduled_at", nowIso)
        .order("scheduled_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!fallbackJob) return false;

      const { data: updated, error: lockErr } = await (supabase as any)
        .from("enforcement_jobs")
        .update({ status: "processing", locked_by: workerId, locked_at: nowIso, attempts: fallbackJob.attempts + 1 })
        .eq("id", fallbackJob.id)
        .eq("status", "queued")
        .select()
        .maybeSingle();

      if (lockErr || !updated) return false;
      job = updated as JobRow;
    }

    try {
      if (job.job_type === "AUTO_ENFORCEMENT_SUBMIT" || job.job_type === "AUTO_ENFORCEMENT_RETRY") {
        await this.handleSubmissionJob(supabase, job, workerId);
      } else if (job.job_type === "AUTO_ENFORCEMENT_STATUS_CHECK") {
        await this.handleStatusCheckJob(supabase, job);
      } else if (job.job_type === "AUTO_ENFORCEMENT_ESCALATION") {
        await this.handleEscalationJob(supabase, job);
      } else if (job.job_type === "AUTO_ENFORCEMENT_REUPLOAD_SCAN") {
        await this.handleReuploadScanJob(supabase, job);
      }

      await (supabase as any)
        .from("enforcement_jobs")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", job.id);

      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isFinalAttempt = job.attempts + 1 >= (job.max_attempts || 3);
      const nextSchedule = new Date(Date.now() + Math.pow(2, job.attempts || 1) * 60_000).toISOString();

      await (supabase as any)
        .from("enforcement_jobs")
        .update({
          status: isFinalAttempt ? "failed" : "queued",
          error: errorMsg,
          scheduled_at: nextSchedule,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await (supabase as any).from("enforcement_events").insert({
        case_id: job.case_id,
        user_id: job.user_id,
        event_type: "RETRY_SCHEDULED",
        actor_type: "WORKER",
        worker_id: workerId,
        metadata: { attempt: job.attempts + 1, error: errorMsg, nextSchedule },
      });

      return true;
    }
  }

  private static async handleSubmissionJob(supabase: SupabaseClient, job: JobRow, workerId: string): Promise<void> {
    const [{ data: c }, { data: profile }, { data: auth }, { data: settings }] = await Promise.all([
      (supabase as any).from("enforcement_cases").select("*").eq("id", job.case_id).single(),
      (supabase as any).from("client_profiles").select("legal_name, full_name, company_name, email").eq("user_id", job.user_id).maybeSingle(),
      (supabase as any).from("client_authorizations").select("id, status, effective_date").eq("user_id", job.user_id).eq("status", "ACTIVE").order("version", { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from("client_enforcement_settings").select("automatic_enforcement_enabled, production_enforcement_approved").eq("user_id", job.user_id).maybeSingle(),
    ]);

    if (!c) throw new Error("Enforcement case not found");

    // 1. PER-CLIENT SEND-TIME SETTING CHECK (Requirement 7)
    if (settings && settings.automatic_enforcement_enabled === false) {
      await (supabase as any).from("enforcement_cases").update({ status: "CANCELLED_BY_POLICY", updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "CANCELLED_BY_POLICY",
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: "CANCELLED_BY_POLICY",
        metadata: { reason: "Automatic enforcement disabled by client setting prior to dispatch." },
      });
      return;
    }

    // 2. CLIENT & ASSET PRODUCTION APPROVAL CHECK (Requirements 2 & 3)
    const isLiveEnabled = process.env.ENFORCEMENT_LIVE_ENABLED === "true";
    const isTestMode = process.env.ENFORCEMENT_TEST_MODE === "true";

    if (isLiveEnabled && !isTestMode) {
      if (!settings || !settings.production_enforcement_approved) {
        await (supabase as any).from("enforcement_cases").update({ status: "PRODUCTION_APPROVAL_REQUIRED", updated_at: new Date().toISOString() }).eq("id", c.id);
        await (supabase as any).from("enforcement_events").insert({
          case_id: c.id,
          user_id: job.user_id,
          event_type: "PRODUCTION_APPROVAL_REQUIRED",
          actor_type: "WORKER",
          previous_state: c.status,
          new_state: "PRODUCTION_APPROVAL_REQUIRED",
          metadata: { reason: "Client has not been approved for production auto-enforcement." },
        });
        return;
      }

      if (c.protected_asset_id) {
        const { data: assetSettings } = await (supabase as any)
          .from("asset_enforcement_settings")
          .select("production_enforcement_approved")
          .eq("asset_id", c.protected_asset_id)
          .maybeSingle();

        if (!assetSettings || !assetSettings.production_enforcement_approved) {
          await (supabase as any).from("enforcement_cases").update({ status: "PRODUCTION_APPROVAL_REQUIRED", updated_at: new Date().toISOString() }).eq("id", c.id);
          await (supabase as any).from("enforcement_events").insert({
            case_id: c.id,
            user_id: job.user_id,
            event_type: "PRODUCTION_APPROVAL_REQUIRED",
            actor_type: "WORKER",
            previous_state: c.status,
            new_state: "PRODUCTION_APPROVAL_REQUIRED",
            metadata: { reason: "Protected asset has not been approved for production auto-enforcement." },
          });
          return;
        }
      }
    }

    // 3. FIRST-LIVE BASIS RESTRICTION (Requirement 4)
    const isControlledMode = process.env.CONTROLLED_PRODUCTION_MODE === "true";
    if (isControlledMode && c.enforcement_basis !== "COPYRIGHT" && c.enforcement_basis !== "WEBSITE_COPYRIGHT") {
      await (supabase as any).from("enforcement_cases").update({ status: "HUMAN_ACTION_REQUIRED", updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "HUMAN_ACTION_REQUIRED",
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: "HUMAN_ACTION_REQUIRED",
        metadata: { reason: `Controlled production mode permits only COPYRIGHT basis for auto dispatch. ${c.enforcement_basis} held for human review.` },
      });
      return;
    }

    // 4. RECHECK AUTHORIZATION AT SEND-TIME (Requirement 8)
    if (!auth || auth.status !== "ACTIVE") {
      await (supabase as any).from("enforcement_cases").update({ status: "NOT_ELIGIBLE", updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "NOT_ELIGIBLE",
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: "NOT_ELIGIBLE",
        metadata: { reason: "Client authorization expired or inactive prior to dispatch." },
      });
      return;
    }

    // 5. SEND-TIME ROUTE RECHECK (Requirement 9)
    const resolvedRoute = await EnforcementRouteResolver.resolveRoute(supabase, c.target_url, c.enforcement_basis);
    if (!resolvedRoute.canAutoSend) {
      const targetStatus = resolvedRoute.verificationStatus === "STALE" || resolvedRoute.verificationStatus === "DISCOVERED_UNVERIFIED"
        ? "ROUTE_DISCOVERY_REQUIRED"
        : "HUMAN_ACTION_REQUIRED";

      await (supabase as any).from("enforcement_cases").update({ status: targetStatus, updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: targetStatus,
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: targetStatus,
        metadata: { verificationStatus: resolvedRoute.verificationStatus, notes: resolvedRoute.notes, canAutoSend: false },
      });
      return;
    }

    // 6. PRODUCTION RATE LIMIT & CONTROLLED CEILING CHECK (Requirement 5 & 12)
    const rateCheck = await EnforcementRateLimiter.checkRateLimit(supabase, job.user_id, resolvedRoute.domain);
    if (!rateCheck.allowed) {
      const targetStatus = rateCheck.status || "RATE_LIMIT_EXCEEDED";
      await (supabase as any).from("enforcement_cases").update({ status: targetStatus, updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: targetStatus,
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: targetStatus,
        metadata: { reason: rateCheck.reason },
      });
      return;
    }

    const connector = connectorRegistry.get(c.connector_id || "website_copyright_connector") || connectorRegistry.get("email_dmca_connector")!;

    const payload: EnforcementCasePayload = {
      caseId: c.id,
      userId: job.user_id,
      targetUrl: c.target_url,
      domain: c.domain || resolvedRoute.domain,
      platform: c.platform || "Web",
      enforcementBasis: c.enforcement_basis,
      protectedAssetId: c.protected_asset_id,
      complainantName: profile?.legal_name || profile?.full_name || profile?.company_name || "Authorized Representative",
      complainantEmail: profile?.email || "enforcement@eterna.ai",
      authorizationLevel: auth?.status || "VERIFIED",
      signedAt: auth?.effective_date,
      destinationEmail: resolvedRoute.contactEmail || undefined,
      destinationRouteStatus: resolvedRoute.verificationStatus,
      demoMode: process.env.DEMO_MODE === "true",
    };

    // 6b. RENDER THE EXACT NOTICE ONCE, HASH IT, AND SNAPSHOT IT BEFORE SENDING.
    const prepared = await connector.prepare(payload);
    const renderedSubject = String(
      prepared["noticeSubject"] ??
        `DMCA Takedown Notice — Infringement of Protected Asset on ${resolvedRoute.domain}`,
    );
    const renderedBody = String(prepared["noticeBody"] ?? "");
    const finalRecipient = payload.destinationEmail || "";
    payload.preparedNotice = { subject: renderedSubject, textBody: renderedBody };

    const { hashRenderedNotice } = await import("./notice-hash");
    const noticeHash = hashRenderedNotice({
      caseId: c.id,
      recipient: finalRecipient,
      subject: renderedSubject,
      textBody: renderedBody,
      manifest: [
        { label: "target_url", reference: c.target_url },
        { label: "authorization", reference: auth?.id ?? null },
        { label: "protected_asset", reference: c.protected_asset_id ?? null },
      ],
    });

    // 7. PRE-SEND PRODUCTION SNAPSHOT — MANDATORY. If it cannot be persisted the
    //    send is aborted (no unauditable external enforcement is permitted).
    const { error: snapshotError } = await (supabase as any)
      .from("production_submission_snapshots")
      .insert({
        case_id: c.id,
        user_id: job.user_id,
        protected_asset_id: c.protected_asset_id,
        copyright_owner: payload.complainantName,
        authorization_id: auth.id,
        target_url: c.target_url,
        target_domain: resolvedRoute.domain,
        enforcement_basis: c.enforcement_basis,
        verified_route: resolvedRoute as never,
        recipient: finalRecipient,
        notice_subject: renderedSubject,
        notice_hash: noticeHash,
        worker_id: workerId,
      });

    if (snapshotError) {
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "SUBMISSION_BLOCKED",
        actor_type: "WORKER",
        connector_id: connector.id,
        previous_state: c.status,
        metadata: {
          reason: "PRE_SEND_SNAPSHOT_FAILED",
          error: snapshotError.message ?? String(snapshotError),
          workerId,
        },
      });
      // Throw so the standard retry/backoff path records the failure. No send.
      throw new Error(
        `Pre-send audit snapshot could not be persisted; send aborted: ${
          snapshotError.message ?? String(snapshotError)
        }`,
      );
    }

    await (supabase as any).from("enforcement_events").insert({
      case_id: c.id,
      user_id: job.user_id,
      event_type: "SUBMISSION_ATTEMPTED",
      actor_type: "WORKER",
      connector_id: connector.id,
      previous_state: c.status,
      metadata: { noticeHash, workerId },
    });

    const result = await connector.submit(payload);

    // DURABLE OUTBOUND EMAIL AUDIT (provider message id, destination, status)
    if (connector.submissionMethod === "EMAIL") {
      try {
        const { recordEmailDelivery } = await import("./email-delivery-log.server");
        const { getResendSenderConfig } = await import("./transports/resend-transport");
        await recordEmailDelivery(
          {
            userId: job.user_id,
            caseId: c.id,
            enforcementRequestId: (c.enforcement_request_id as string) || null,
            provider: result.provider || "RESEND",
            fromEmail: getResendSenderConfig().fromEmail,
            intendedRecipient: payload.destinationEmail || `dmca@${resolvedRoute.domain}`,
            subject: `DMCA Takedown Notice — Infringement of Protected Asset on ${resolvedRoute.domain}`,
            testMode: process.env.ENFORCEMENT_TEST_MODE === "true",
            metadata: { noticeHash, workerId, connectorId: connector.id, targetUrl: c.target_url },
          },
          {
            success: result.success,
            status: result.status as never,
            intendedRecipient: result.intendedRecipient ?? undefined,
            actualRecipient: result.actualRecipient ?? undefined,
            providerMessageId: result.providerMessageId ?? undefined,
            error: result.error ?? undefined,
            notes: result.notes ?? undefined,
            submittedAt: new Date().toISOString(),
          },
        );
      } catch (logErr) {
        console.error("[enforcement/worker] delivery log failed", logErr);
      }
    }

    const statusStr = result.status as string;
    if (
      statusStr === "CONFIGURATION_ERROR" ||
      statusStr === "ROUTE_DISCOVERY_REQUIRED" ||
      statusStr === "DEMO_MODE_BLOCKED" ||
      statusStr === "HUMAN_ACTION_REQUIRED" ||
      statusStr === "KILL_SWITCH_ACTIVE" ||
      statusStr === "NOTICE_INCOMPLETE" ||
      statusStr === "EMERGENCY_PAUSED" ||
      statusStr === "PRODUCTION_APPROVAL_REQUIRED" ||
      statusStr === "QUEUED_FOR_CONTROLLED_RELEASE"
    ) {
      await (supabase as any).from("enforcement_cases").update({ status: result.status, updated_at: new Date().toISOString() }).eq("id", c.id);
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: result.status,
        actor_type: "WORKER",
        connector_id: connector.id,
        previous_state: c.status,
        new_state: result.status,
        metadata: { error: result.error, notes: result.notes, workerId },
      });
      return;
    }

    if (!result.success) {
      throw new Error(result.error || "Connector submission failed");
    }

    const nextStatus = (result.status as string) === "HUMAN_ACTION_REQUIRED" ? "HUMAN_ACTION_REQUIRED" : "SUBMITTED";

    await (supabase as any)
      .from("enforcement_cases")
      .update({
        status: nextStatus,
        next_verification_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);

    await (supabase as any).from("enforcement_events").insert({
      case_id: c.id,
      user_id: job.user_id,
      protected_asset_id: c.protected_asset_id,
      target_url: c.target_url,
      enforcement_basis: c.enforcement_basis,
      authorization_id: auth.id,
      event_type: "SUBMITTED",
      actor_type: "WORKER",
      connector_id: connector.id,
      previous_state: c.status,
      new_state: nextStatus,
      metadata: {
        provider: result.provider || "POSTMARK",
        providerMessageId: result.providerMessageId,
        trackingRef: result.trackingRef,
        intendedRecipient: result.intendedRecipient ?? payload.destinationEmail,
        actualRecipient: result.actualRecipient ?? null,
        testMode: process.env.ENFORCEMENT_TEST_MODE === "true",
        noticeHash,
        workerId,
        notes: result.notes,
      },
    });

    try {
      await (supabase as any).rpc("record_route_outcome", {
        p_domain: resolvedRoute.domain,
        p_outcome: "PROVIDER_ACCEPTED",
      });
    } catch {
      /* ignore if RPC pending */
    }

    const offsets = [6 * 3600_000, 24 * 3600_000, 72 * 3600_000, 7 * 24 * 3600_000];
    for (const offset of offsets) {
      await (supabase as any).from("enforcement_jobs").insert({
        case_id: c.id,
        user_id: job.user_id,
        job_type: "AUTO_ENFORCEMENT_STATUS_CHECK",
        scheduled_at: new Date(Date.now() + offset).toISOString(),
        payload: { targetUrl: c.target_url, verificationOffsetMs: offset },
      });
    }
  }

  private static async handleStatusCheckJob(supabase: SupabaseClient, job: JobRow): Promise<void> {
    const { data: c } = await (supabase as any).from("enforcement_cases").select("*").eq("id", job.case_id).single();
    if (!c) return;

    const verification = await VerificationEngine.verifyTarget(c.target_url);

    await (supabase as any).from("enforcement_cases").update({
      status: verification.outcome,
      last_verification_at: new Date().toISOString(),
      verification_details: verification.evidence as never,
      next_verification_at: verification.outcome === "SOURCE_REMOVED" ? null : new Date(Date.now() + 24 * 3600_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", c.id);

    await (supabase as any).from("enforcement_events").insert({
      case_id: c.id,
      user_id: job.user_id,
      event_type: verification.outcome === "SOURCE_REMOVED" ? "SOURCE_REMOVED" : verification.outcome === "SEARCH_DELISTED" ? "DELISTED" : "STILL_LIVE",
      actor_type: "WORKER",
      previous_state: c.status,
      new_state: verification.outcome,
      metadata: verification.evidence as never,
    });
  }

  private static async handleEscalationJob(supabase: SupabaseClient, job: JobRow): Promise<void> {
    const { data: c } = await (supabase as any).from("enforcement_cases").select("*").eq("id", job.case_id).single();
    if (!c) return;

    if (c.status === "STILL_LIVE") {
      await (supabase as any).from("enforcement_cases").update({
        status: "ESCALATION_REQUIRED",
        enforcement_basis: "SEARCH_ENGINE_COPYRIGHT",
        updated_at: new Date().toISOString(),
      }).eq("id", c.id);

      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "ESCALATION_REQUIRED",
        actor_type: "WORKER",
        previous_state: c.status,
        new_state: "ESCALATION_REQUIRED",
        metadata: { escalationPath: "SEARCH_ENGINE_DELISTING" },
      });
    }
  }

  private static async handleReuploadScanJob(supabase: SupabaseClient, job: JobRow): Promise<void> {
    const { data: c } = await (supabase as any).from("enforcement_cases").select("*").eq("id", job.case_id).single();
    if (!c || !c.scan_hit_id) return;

    const { data: duplicateHit } = await (supabase as any)
      .from("scan_hits")
      .select("*")
      .eq("user_id", job.user_id)
      .neq("id", c.scan_hit_id)
      .eq("canonical_url", c.target_url)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (duplicateHit) {
      await (supabase as any).from("enforcement_events").insert({
        case_id: c.id,
        user_id: job.user_id,
        event_type: "REUPLOAD_DETECTED",
        actor_type: "WORKER",
        metadata: { duplicateScanHitId: duplicateHit.id, targetUrl: duplicateHit.canonical_url },
      });
    }
  }
}
