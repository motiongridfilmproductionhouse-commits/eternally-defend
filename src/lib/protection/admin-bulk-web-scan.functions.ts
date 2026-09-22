/**
 * Admin-gated bulk web-discovery scan: preflight audit + batched execution
 * across every fully onboarded, active Eterna Sentinel account.
 *
 * Scope, exactly as specified for this operation:
 *  - Only the public web-search/discovery module (reputation_web_scan) runs.
 *    Takedown submission, enforcement delivery, email delivery, automatic
 *    removal, face scan, reverse-image scan, and deepfake enforcement are
 *    never invoked from this file.
 *  - The two demo accounts are excluded by case-insensitive exact email
 *    match and are never queued, searched, scanned, or notified.
 *  - Reuses the existing scan orchestrator's own primitives — the same
 *    runReputationWebScan dispatch (src/lib/protection/dispatch/
 *    reputation-web-scan.server.ts), the same scan_module_enrollments state
 *    machine and CAS claim pattern, and persistScanCore's existing
 *    non-destructive upsert (a failed provider never deletes or overwrites
 *    prior findings) — rather than building a parallel scan pipeline.
 *  - Never modifies production schema/config. The only writes this file
 *    makes are the ordinary scan_module_enrollments/scans/scan_hits writes
 *    the existing orchestrator already makes for this module, and only when
 *    dryRun is false.
 *
 * Authorization mirrors the existing backfillProtectionEnrollment precedent
 * (src/lib/onboarding/admin.functions.ts): requireAdmin(context) gates every
 * export. Enumeration reads use the service-role client (supabaseAdmin)
 * rather than the admin's own RLS-scoped session client, because
 * client_profiles — needed here for email/account-type — has no admin-read
 * RLS policy (unlike client_authorizations/protection_profiles/
 * scan_module_enrollments, which do; see the 20260716065358 and 20260822120000
 * migrations). This is a pre-existing gap in this schema, not introduced
 * here; it is called out again in the preflight report's `auditNotes`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireAdmin(ctx: any) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

/** Case-insensitive exact match. Never create/queue/search/scan/notify for these. */
export const DEMO_EXCLUDED_EMAILS = ["hellosreehari@gmail.com", "sijoj4464@gmail.com"] as const;

/** account_type values this operation treats as in-scope (account_type_enum, v2 additions). */
export const ELIGIBLE_ACCOUNT_TYPES = [
  "individual",
  "celebrity",
  "enterprise",
  "production_house",
] as const;

export const REPUTATION_WEB_SCAN_MODULE_KEY = "reputation_web_scan";

/** Enrollment states that mean "already has a queued or running web scan". */
const ACTIVE_ENROLLMENT_STATUSES = new Set(["QUEUED", "RUNNING"]);

export interface ClientProfileRow {
  user_id: string;
  email: string | null;
  account_type: string | null;
  onboarding_completed: boolean | null;
}

export interface EnrollmentRow {
  id: string;
  user_id: string;
  eligible: boolean;
  enabled: boolean;
  current_status: string;
  current_run_id: string | null;
  updated_at: string;
}

export interface CandidateClassification {
  totalOnboarded: number;
  demoExcluded: Array<{ user_id: string; email: string }>;
  accountTypeExcluded: number;
  authNotActiveExcluded: number;
  duplicateEmailExcluded: Array<{ user_id: string; email: string }>;
  noProtectionProfile: string[];
  noEnrollmentRow: string[];
  moduleNotEligible: string[];
  alreadyActive: Array<{ user_id: string; enrollment_id: string; status: string }>;
  plannedForScanning: Array<{ user_id: string; enrollment_id: string }>;
}

/**
 * Pure classification logic (no I/O), unit-testable without a Supabase
 * client. Mirrors the pure-function extraction pattern already used by
 * computeEnrollmentPatch (module-registry.ts) for the same reason: the
 * eligibility/exclusion decision is exactly the thing worth testing directly.
 */
export function classifyBulkWebScanCandidates(
  profiles: ClientProfileRow[],
  activeAuthUserIds: Set<string>,
  protectionProfileUserIds: Set<string>,
  enrollments: EnrollmentRow[],
): CandidateClassification {
  const demoSet = new Set(DEMO_EXCLUDED_EMAILS.map((e) => e.toLowerCase()));
  const eligibleTypeSet = new Set<string>(ELIGIBLE_ACCOUNT_TYPES);

  const result: CandidateClassification = {
    totalOnboarded: profiles.filter((p) => p.onboarding_completed === true).length,
    demoExcluded: [],
    accountTypeExcluded: 0,
    authNotActiveExcluded: 0,
    duplicateEmailExcluded: [],
    noProtectionProfile: [],
    noEnrollmentRow: [],
    moduleNotEligible: [],
    alreadyActive: [],
    plannedForScanning: [],
  };

  const onboarded = profiles.filter((p) => p.onboarding_completed === true);

  // Duplicate-email detection is a reporting heuristic only — this schema
  // has no formal duplicate-account flag or unique-email constraint on
  // client_profiles. Grouping is by case-insensitive normalized email; the
  // lexicographically-first user_id per email is kept as primary so the
  // choice is deterministic and reproducible across runs.
  const byEmail = new Map<string, ClientProfileRow[]>();
  for (const p of onboarded) {
    const norm = (p.email ?? "").trim().toLowerCase();
    if (!norm) continue;
    const arr = byEmail.get(norm) ?? [];
    arr.push(p);
    byEmail.set(norm, arr);
  }
  const duplicateUserIds = new Set<string>();
  for (const [, rows] of byEmail) {
    if (rows.length <= 1) continue;
    const sorted = [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id));
    for (const r of sorted.slice(1)) duplicateUserIds.add(r.user_id);
  }

  const survivingUserIds: string[] = [];

  for (const p of onboarded) {
    const normEmail = (p.email ?? "").trim().toLowerCase();

    if (demoSet.has(normEmail)) {
      result.demoExcluded.push({ user_id: p.user_id, email: p.email ?? "" });
      continue;
    }
    if (!activeAuthUserIds.has(p.user_id)) {
      result.authNotActiveExcluded++;
      continue;
    }
    if (!p.account_type || !eligibleTypeSet.has(p.account_type)) {
      result.accountTypeExcluded++;
      continue;
    }
    if (duplicateUserIds.has(p.user_id)) {
      result.duplicateEmailExcluded.push({ user_id: p.user_id, email: p.email ?? "" });
      continue;
    }
    survivingUserIds.push(p.user_id);
  }

  const enrollmentByUser = new Map<string, EnrollmentRow>();
  for (const e of enrollments) enrollmentByUser.set(e.user_id, e);

  for (const userId of survivingUserIds) {
    if (!protectionProfileUserIds.has(userId)) {
      result.noProtectionProfile.push(userId);
      continue;
    }
    const enrollment = enrollmentByUser.get(userId);
    if (!enrollment) {
      result.noEnrollmentRow.push(userId);
      continue;
    }
    if (!enrollment.eligible || !enrollment.enabled) {
      result.moduleNotEligible.push(userId);
      continue;
    }
    if (ACTIVE_ENROLLMENT_STATUSES.has(enrollment.current_status)) {
      result.alreadyActive.push({
        user_id: userId,
        enrollment_id: enrollment.id,
        status: enrollment.current_status,
      });
      continue;
    }
    result.plannedForScanning.push({ user_id: userId, enrollment_id: enrollment.id });
  }

  return result;
}

/**
 * Fetches everything classifyBulkWebScanCandidates needs, via the
 * service-role client (see file header for why client_profiles specifically
 * requires this rather than the admin's RLS-scoped session client).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadCandidateInputs(supabaseAdmin: any): Promise<{
  profiles: ClientProfileRow[];
  activeAuthUserIds: Set<string>;
  protectionProfileUserIds: Set<string>;
  enrollments: EnrollmentRow[];
}> {
  const [{ data: profiles }, { data: activeAuths }, { data: profileRows }, { data: enrollments }] =
    await Promise.all([
      supabaseAdmin
        .from("client_profiles")
        .select("user_id,email,account_type,onboarding_completed"),
      supabaseAdmin.from("client_authorizations").select("user_id").eq("status", "ACTIVE"),
      supabaseAdmin.from("protection_profiles").select("user_id"),
      supabaseAdmin
        .from("scan_module_enrollments")
        .select("id,user_id,eligible,enabled,current_status,current_run_id,updated_at")
        .eq("module_key", REPUTATION_WEB_SCAN_MODULE_KEY),
    ]);

  return {
    profiles: (profiles ?? []) as ClientProfileRow[],
    activeAuthUserIds: new Set((activeAuths ?? []).map((a: { user_id: string }) => a.user_id)),
    protectionProfileUserIds: new Set(
      (profileRows ?? []).map((p: { user_id: string }) => p.user_id),
    ),
    enrollments: (enrollments ?? []) as EnrollmentRow[],
  };
}

/**
 * Static provider configuration snapshot. This does NOT dispatch any query —
 * a fresh DiscoveryRouter reports each adapter's isConfigured()/credential
 * state only, so every provider's queriesAttempted is 0 here. Labeled
 * honestly in the response as a configuration check, not a live health
 * check, since no request has actually been made to any provider yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function providerConfigurationSnapshot(): Promise<any> {
  const { DiscoveryRouter } = await import("@/lib/scan/discovery/router.server");
  const router = new DiscoveryRouter();
  return router.report();
}

export interface BulkWebScanPreflightResult {
  operationId: string;
  generatedAt: string;
  totals: {
    totalOnboarded: number;
    eligibleForScan: number;
    alreadyRunning: number;
    plannedForScanning: number;
    excludedDemo: number;
    excludedAccountType: number;
    excludedAuthNotActive: number;
    excludedDuplicateEmail: number;
    incompleteNoProtectionProfile: number;
    incompleteNoEnrollmentRow: number;
    incompleteModuleNotEligible: number;
  };
  excludedDemoAccounts: Array<{ user_id: string; email: string }>;
  alreadyActive: Array<{ user_id: string; enrollment_id: string; status: string }>;
  plannedForScanning: Array<{ user_id: string; enrollment_id: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerConfiguration: any;
  auditNotes: string[];
}

export interface AuditBulkWebScanPreflightDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerConfigurationSnapshot?: () => Promise<any>;
}

/**
 * Core logic, decoupled from the createServerFn/auth wrapper so it can be
 * exercised directly in tests against a fake Postgrest-style client (same
 * decoupling convention as applyAutomationStatusCallback /
 * recoverStaleAutomationJobs). Read-only. Makes zero writes and dispatches
 * zero scan/provider queries. Returns the exact counts specified for this
 * operation's preflight step, plus a fresh operationId for the batched
 * execution calls that follow.
 */
export async function auditBulkWebScanPreflightCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  deps: AuditBulkWebScanPreflightDeps = {},
): Promise<BulkWebScanPreflightResult> {
  const inputs = await loadCandidateInputs(supabaseAdmin);
  const classification = classifyBulkWebScanCandidates(
    inputs.profiles,
    inputs.activeAuthUserIds,
    inputs.protectionProfileUserIds,
    inputs.enrollments,
  );
  const snapshot = deps.providerConfigurationSnapshot ?? providerConfigurationSnapshot;
  const providerConfiguration = await snapshot();

  return {
    operationId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    totals: {
      totalOnboarded: classification.totalOnboarded,
      eligibleForScan:
        classification.plannedForScanning.length + classification.alreadyActive.length,
      alreadyRunning: classification.alreadyActive.length,
      plannedForScanning: classification.plannedForScanning.length,
      excludedDemo: classification.demoExcluded.length,
      excludedAccountType: classification.accountTypeExcluded,
      excludedAuthNotActive: classification.authNotActiveExcluded,
      excludedDuplicateEmail: classification.duplicateEmailExcluded.length,
      incompleteNoProtectionProfile: classification.noProtectionProfile.length,
      incompleteNoEnrollmentRow: classification.noEnrollmentRow.length,
      incompleteModuleNotEligible: classification.moduleNotEligible.length,
    },
    excludedDemoAccounts: classification.demoExcluded,
    alreadyActive: classification.alreadyActive,
    plannedForScanning: classification.plannedForScanning,
    providerConfiguration,
    auditNotes: [
      "client_profiles has no admin-read RLS policy in this schema (only " +
        '"own client profile" USING auth.uid() = user_id). This function ' +
        "reads it via the service-role client after requireAdmin() gating, " +
        "not via the caller's session client, for that reason.",
      "duplicateEmailExcluded is a reporting heuristic (case-insensitive " +
        "email grouping) — this schema has no formal duplicate-account " +
        "flag or unique-email constraint on client_profiles.",
      "providerConfiguration reflects each provider's configured/credential " +
        "state only; no discovery query was dispatched to produce it, so " +
        "queriesAttempted is 0 for every provider here.",
    ],
  };
}

export const auditBulkWebScanPreflight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return auditBulkWebScanPreflightCore(supabaseAdmin);
  });

export interface RunBulkWebScanBatchInput {
  operationId: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface BulkWebScanBatchAccountResult {
  user_id: string;
  enrollment_id: string;
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

export interface BulkWebScanBatchSkip {
  user_id: string;
  enrollment_id: string;
  reason: string;
}

export interface RunBulkWebScanBatchResult {
  operationId: string;
  dryRun: boolean;
  batchSize: number;
  claimed: number;
  processed: BulkWebScanBatchAccountResult[];
  skipped: BulkWebScanBatchSkip[];
  remainingAfterThisBatch: number;
}

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;

export type RunReputationWebScanFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  opts: { skipFaceAnalysis?: boolean },
) => Promise<{
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}>;

export interface RunBulkWebScanBatchDeps {
  runReputationWebScan: RunReputationWebScanFn;
}

/**
 * Core logic, decoupled from the createServerFn/auth wrapper so it can be
 * exercised directly in tests against a fake Postgrest-style client and an
 * injected fake scan runner (same decoupling convention as
 * applyAutomationStatusCallback / recoverStaleAutomationJobs — no real
 * Supabase instance, network call, or search provider involved).
 *
 * Executes one controlled batch of the reputation_web_scan (public
 * web-discovery) module for accounts the preflight step already classified
 * as plannedForScanning. Call repeatedly with the same operationId to work
 * through the full set in small batches — each call only claims rows this
 * operationId hasn't already touched (current_run_id !== operationId),
 * using the exact same optimistic CAS claim scan-orchestrator.ts uses
 * (current_status + updated_at), so a real concurrent cron tick or a second
 * bulk batch call can never double-claim the same row.
 *
 * dryRun: true performs zero writes and zero provider queries — it only
 * reports which rows would be claimed vs. skipped. Recommended for the
 * first invocation, per the confirmed dry-run-first plan.
 */
export async function runBulkWebScanBatchCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  data: RunBulkWebScanBatchInput,
  deps: RunBulkWebScanBatchDeps,
): Promise<RunBulkWebScanBatchResult> {
  if (!data.operationId) throw new Error("operationId is required");

  const batchSize = Math.max(1, Math.min(data.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
  const dryRun = data.dryRun ?? false;
  const { runReputationWebScan } = deps;

  const inputs = await loadCandidateInputs(supabaseAdmin);
  const classification = classifyBulkWebScanCandidates(
    inputs.profiles,
    inputs.activeAuthUserIds,
    inputs.protectionProfileUserIds,
    inputs.enrollments,
  );

  const skipped: BulkWebScanBatchSkip[] = classification.alreadyActive.map((a) => ({
    user_id: a.user_id,
    enrollment_id: a.enrollment_id,
    reason: `already ${a.status.toLowerCase()} — skipped to avoid a duplicate active scan`,
  }));

  const enrollmentByUser = new Map(inputs.enrollments.map((e) => [e.user_id, e]));

  // Only rows this operationId hasn't already touched (processed or
  // explicitly claimed) — lets repeated calls page through the full
  // plannedForScanning set without re-processing the same account twice.
  const untouched = classification.plannedForScanning.filter((c) => {
    const row = enrollmentByUser.get(c.user_id);
    return row?.current_run_id !== data.operationId;
  });
  const slice = untouched.slice(0, batchSize);

  const processed: BulkWebScanBatchAccountResult[] = [];

  if (dryRun) {
    return {
      operationId: data.operationId,
      dryRun: true,
      batchSize,
      claimed: 0,
      processed: [],
      skipped: [
        ...skipped,
        ...slice.map((s) => ({
          user_id: s.user_id,
          enrollment_id: s.enrollment_id,
          reason: "dry run — would be claimed and scanned, no write performed",
        })),
      ],
      remainingAfterThisBatch: Math.max(untouched.length, 0),
    } satisfies RunBulkWebScanBatchResult;
  }

  for (const candidate of slice) {
    const row = enrollmentByUser.get(candidate.user_id);
    if (!row) continue;

    // Same optimistic claim scan-orchestrator.ts uses for the normal cron
    // tick, plus current_run_id so this operation can page across repeated
    // batch calls without re-claiming a row it already processed.
    const { data: claimed } = await supabaseAdmin
      .from("scan_module_enrollments")
      .update({ current_status: "RUNNING", current_run_id: data.operationId })
      .eq("id", row.id)
      .eq("current_status", row.current_status)
      .eq("updated_at", row.updated_at)
      .select()
      .maybeSingle();

    if (!claimed) {
      skipped.push({
        user_id: candidate.user_id,
        enrollment_id: candidate.enrollment_id,
        reason: "claim lost the race to a concurrent claimant — will retry on a later batch",
      });
      continue;
    }

    const nowIso = new Date().toISOString();
    const cadenceMinutes = claimed.cadence_minutes ?? 1440;
    const nextScanAt = new Date(Date.now() + cadenceMinutes * 60_000).toISOString();

    try {
      // skipFaceAnalysis: true — this operation must never trigger face,
      // identity, or deepfake modules as a side effect of persisting
      // web-discovery hits.
      const outcome = await runReputationWebScan(supabaseAdmin, candidate.user_id, {
        skipFaceAnalysis: true,
      });

      await supabaseAdmin
        .from("scan_module_enrollments")
        .update({
          current_status: outcome.status,
          candidates_found: outcome.candidates_found,
          verified_findings: outcome.verified_findings,
          blocked_reason: outcome.blocked_reason,
          last_scan_at: nowIso,
          last_success_at: outcome.status === "COMPLETED" ? nowIso : claimed.last_success_at,
          next_scan_at: nextScanAt,
          retry_count: outcome.status === "COMPLETED" ? 0 : (claimed.retry_count ?? 0) + 1,
          provider_failures:
            outcome.status === "PROVIDER_LIMITED"
              ? (claimed.provider_failures ?? 0) + 1
              : claimed.provider_failures,
        })
        .eq("id", row.id);

      processed.push({
        user_id: candidate.user_id,
        enrollment_id: candidate.enrollment_id,
        status: outcome.status,
        candidates_found: outcome.candidates_found,
        verified_findings: outcome.verified_findings,
        blocked_reason: outcome.blocked_reason,
      });
    } catch (err) {
      console.error("[admin-bulk-web-scan] account failed", candidate.user_id, err);
      await supabaseAdmin
        .from("scan_module_enrollments")
        .update({
          current_status: "FAILED",
          blocked_reason: (err as Error).message?.slice(0, 200) ?? "UNKNOWN_ERROR",
          retry_count: (claimed.retry_count ?? 0) + 1,
          next_scan_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        })
        .eq("id", row.id);
      processed.push({
        user_id: candidate.user_id,
        enrollment_id: candidate.enrollment_id,
        status: "FAILED",
        candidates_found: 0,
        verified_findings: 0,
        blocked_reason: (err as Error).message?.slice(0, 200) ?? "UNKNOWN_ERROR",
      });
    }
  }

  return {
    operationId: data.operationId,
    dryRun: false,
    batchSize,
    claimed: processed.length,
    processed,
    skipped,
    remainingAfterThisBatch: Math.max(untouched.length - slice.length, 0),
  } satisfies RunBulkWebScanBatchResult;
}

export const runBulkWebScanBatch = createServerFn({ method: "POST" })
  .inputValidator((d: RunBulkWebScanBatchInput) => d)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runReputationWebScan } =
      await import("@/lib/protection/dispatch/reputation-web-scan.server");
    return runBulkWebScanBatchCore(supabaseAdmin, data, { runReputationWebScan });
  });
