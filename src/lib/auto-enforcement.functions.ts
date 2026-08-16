/**
 * Auto-Enforcement Server Functions.
 * Exposes server functions for retrieving settings, cases, review queue,
 * live activity audit feed, and triggering background worker processing.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { AutoEnforcementOrchestrator } from "./enforcement/orchestrator";
import { EnforcementWorkerRunner } from "./enforcement/worker";
import { excludeTestFixtures, isTestFixtureTarget } from "./enforcement/test-fixtures";

export const getClientEnforcementSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: settings } = await (supabase as any)
      .from("client_enforcement_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!settings) {
      const defaultSettings = {
        user_id: userId,
        automatic_enforcement_enabled: false,
        enforcement_basis_policies: {
          copyright: "AUTO",
          impersonation: "AUTO",
          deepfake: "AUTO",
          privacy: "REVIEW",
          harassment: "REVIEW",
          legal_escalation: "MANUAL",
        },
      };

      const { data: created } = await (supabase as any)
        .from("client_enforcement_settings")
        .insert(defaultSettings)
        .select()
        .single();

      return { settings: created || defaultSettings };
    }

    return { settings };
  });

export const updateClientEnforcementSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          automaticEnforcementEnabled: z.boolean(),
          enforcementBasisPolicies: z.record(z.string(), z.string()).optional(),
        })
        .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Step 1: Check if user row exists
    const { data: existing } = await (supabase as any)
      .from("client_enforcement_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    const updatePayload: Record<string, unknown> = {
      automatic_enforcement_enabled: data.automaticEnforcementEnabled,
      updated_at: new Date().toISOString(),
    };
    if (data.enforcementBasisPolicies) {
      updatePayload.enforcement_basis_policies = data.enforcementBasisPolicies;
    }

    let updated: any = null;
    let dbError: any = null;

    if (existing) {
      // Step 2: UPDATE existing row
      const { data: resData, error: err } = await (supabase as any)
        .from("client_enforcement_settings")
        .update(updatePayload)
        .eq("user_id", userId)
        .select("user_id, automatic_enforcement_enabled, enforcement_basis_policies, updated_at")
        .single();

      updated = resData;
      dbError = err;
    } else {
      // Step 3: INSERT new row if missing
      const insertPayload = {
        user_id: userId,
        ...updatePayload,
      };

      const { data: resData, error: err } = await (supabase as any)
        .from("client_enforcement_settings")
        .insert(insertPayload)
        .select("user_id, automatic_enforcement_enabled, enforcement_basis_policies, updated_at")
        .single();

      updated = resData;
      dbError = err;
    }

    console.log("[ENFORCEMENT_SETTINGS_UPDATE]", {
      user_id: userId,
      requested_auto_enabled: data.automaticEnforcementEnabled,
      database_auto_enabled_after_update: updated?.automatic_enforcement_enabled,
      success: !dbError && Boolean(updated),
      supabase_error_code: dbError?.code || null,
      supabase_error_message: dbError?.message || null,
    });

    if (dbError) {
      throw new Error(`[Database Error ${dbError.code || "UNKNOWN"}]: ${dbError.message || "Failed to save client enforcement settings"}`);
    }

    if (!updated) {
      throw new Error("[Database Error]: Update executed but no record was returned.");
    }

    return { settings: updated };
  });

export const listEnforcementCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          statusFilter: z.string().optional(),
          limit: z.number().min(1).max(200).optional().default(100),
        })
        .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let q = (supabase as any)
      .from("enforcement_cases")
      .select(
        "id, scan_hit_id, target_url, domain, platform, enforcement_basis, eligibility_status, eligibility_reason, authorization_status, selected_route, connector_id, status, attempts, next_verification_at, last_verification_at, verification_details, reupload_count, created_at, updated_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.statusFilter && data.statusFilter !== "all") {
      q = q.eq("status", data.statusFilter);
    }

    const { data: cases, error } = await q;
    if (error) throw error;
    // Ownership is enforced above (and by RLS). Controlled-test fixtures are
    // additionally hidden from customer dashboards while staying in the DB.
    return { cases: excludeTestFixtures((cases ?? []) as any[]) };
  });

export const listReviewQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: queue, error } = await (supabase as any)
      .from("enforcement_review_queue")
      .select(
        "id, case_id, reason, review_status, reviewer_notes, decided_at, created_at, enforcement_cases(id, target_url, domain, platform, enforcement_basis, eligibility_reason, scan_hits(id, title, thumbnail_url, threat_score, severity))"
      )
      .eq("user_id", userId)
      .eq("review_status", "PENDING")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return {
      queue: ((queue ?? []) as any[]).filter((row) => !isTestFixtureTarget(row?.enforcement_cases)),
    };
  });

export const reviewCaseDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          queueId: z.string().uuid(),
          caseId: z.string().uuid(),
          action: z.enum(["APPROVE", "REJECT", "CHANGE_BASIS"]),
          newBasis: z.string().optional(),
          notes: z.string().max(1000).optional(),
        })
        .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    // SUBJECT ISOLATION — the case and queue row must belong to this account.
    const { data: ownedCase } = await (supabase as any)
      .from("enforcement_cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!ownedCase) throw new Error("Not authorized for this enforcement case.");

    if (data.action === "APPROVE") {
      await (supabase as any)
        .from("enforcement_cases")
        .update({
          eligibility_status: "AUTO_ELIGIBLE",
          status: "QUEUED",
          updated_at: nowIso,
        })
        .eq("id", data.caseId)
        .eq("user_id", userId);

      await (supabase as any).from("enforcement_jobs").insert({
        case_id: data.caseId,
        user_id: userId,
        job_type: "AUTO_ENFORCEMENT_SUBMIT",
        payload: { approvedByHuman: true },
        status: "queued",
      });

      await (supabase as any).from("enforcement_events").insert({
        case_id: data.caseId,
        user_id: userId,
        event_type: "REVIEW_DECIDED",
        actor_type: "HUMAN",
        new_state: "QUEUED",
        metadata: { decision: "APPROVED", notes: data.notes || null },
      });
    } else if (data.action === "REJECT") {
      await (supabase as any)
        .from("enforcement_cases")
        .update({
          eligibility_status: "NOT_ELIGIBLE",
          status: "NOT_ELIGIBLE",
          updated_at: nowIso,
        })
        .eq("id", data.caseId)
        .eq("user_id", userId);

      await (supabase as any).from("enforcement_events").insert({
        case_id: data.caseId,
        user_id: userId,
        event_type: "REVIEW_DECIDED",
        actor_type: "HUMAN",
        new_state: "NOT_ELIGIBLE",
        metadata: { decision: "REJECTED", notes: data.notes || null },
      });
    }

    await (supabase as any)
      .from("enforcement_review_queue")
      .update({
        review_status: data.action,
        reviewer_id: userId,
        reviewer_notes: data.notes || null,
        decided_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", data.queueId)
      .eq("user_id", userId);

    return { ok: true };
  });

export const listLiveActivityFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          limit: z.number().min(1).max(100).optional().default(50),
        })
        .parse(d)
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    const { data: events, error } = await (supabase as any)
      .from("enforcement_events")
      .select("id, case_id, event_type, actor_type, connector_id, previous_state, new_state, metadata, created_at, enforcement_cases(target_url, platform, domain)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (error) throw error;
    return {
      events: ((events ?? []) as any[]).filter(
        (row) => !isTestFixtureTarget(row?.enforcement_cases),
      ),
    };
  });

export const runWorkerBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Owner-scoped: a customer worker pass may only touch their own jobs.
    const processed = await EnforcementWorkerRunner.processNextJob(
      supabase,
      `client-${userId}`,
      userId,
    );
    return { processed };
  });

export const triggerAutoEnforcementForHits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          scanHitIds: z.array(z.string().uuid()).min(1).max(50),
        })
        .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: hits } = await supabase
      .from("scan_hits")
      .select("*")
      .eq("user_id", userId)
      .in("id", data.scanHitIds);

    const results = [];
    for (const hit of hits || []) {
      const res = await AutoEnforcementOrchestrator.onVerifiedFinding(supabase, userId, hit as any);
      results.push({ scanHitId: hit.id, ...res });
    }

    // Trigger worker pass to process newly enqueued jobs
    await EnforcementWorkerRunner.processNextJob(supabase);

    return { results };
  });
