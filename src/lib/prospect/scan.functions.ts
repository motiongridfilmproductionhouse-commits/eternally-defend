/**
 * Pre-Enrollment Intelligence — staff server functions.
 *
 * Authorization: every function requires a signed-in session AND the staff
 * role (is_prospect_staff, which reads user_roles). Reads and staff decisions
 * run through the caller's own RLS-scoped client, so the database enforces the
 * same boundary a second time. The background runner is the only place the
 * service-role client is used, and it is started only after the staff check.
 *
 * Nothing here can start enforcement: no takedown, complaint, notice or
 * platform submission code is imported or reachable from this module.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const IDENTITY_TYPES = [
  "celebrity",
  "public_figure",
  "individual",
  "executive",
  "brand",
  "company",
  "organization",
] as const;

const list = (max: number) =>
  z.array(z.string().trim().min(1).max(120)).max(max).optional().default([]);

const StartScanInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    identityType: z.enum(IDENTITY_TYPES).default("public_figure"),
    countryRegion: z.string().trim().max(80).optional().nullable(),
    knownProfileUrl: z.string().trim().url().max(400).optional().nullable().or(z.literal("")),
    knownWebsite: z.string().trim().url().max(400).optional().nullable().or(z.literal("")),
    profession: z.string().trim().max(80).optional().nullable(),
    organization: z.string().trim().max(120).optional().nullable(),
    aliases: list(5),
    knownHandles: list(8),
    knownWorks: list(10),
    linkedEntities: list(10),
    nameIsAmbiguous: z.boolean().optional().default(false),
  })
  .strict();

export type StartScanPayload = z.input<typeof StartScanInput>;

function handleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length === 1 ? parts[0]!.replace(/^@/, "") : null;
  } catch {
    return null;
  }
}

function launchInBackground(scanId: string) {
  return (async () => {
    const { advanceProspectScan } = await import("./runner-wiring.server");
    const work = advanceProspectScan(scanId, 18_000).catch((error) =>
      console.error(
        "[prospect] scan execution failed",
        scanId,
        error instanceof Error ? error.message : error,
      ),
    );
    const request = getRequest() as Request & { waitUntil?: (p: Promise<unknown>) => void };
    if (request?.waitUntil) request.waitUntil(work);
    else {
      const { registerWaitUntilExecution } = await import("@/lib/deepfake/startup-network.server");
      registerWaitUntilExecution(work);
    }
  })();
}

async function createScanRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  prospectId: string,
  identity: {
    display_name: string;
    aliases: string[];
    profession: string | null;
    organization: string | null;
    country_region: string | null;
    known_works: string[];
  },
): Promise<string> {
  const { SOURCE_FAMILY_SET_VERSION, intendedFamilies } = await import("./source-registry");
  const { allPlannedQueryTerms } = await import("./query-plan");
  const { CLASSIFICATION_VERSION } = await import("./runner");
  const queryTerms = allPlannedQueryTerms(
    intendedFamilies().map((f) => f.key),
    {
      name: identity.display_name,
      aliases: identity.aliases,
      profession: identity.profession,
      organization: identity.organization,
      countryRegion: identity.country_region,
      knownWorks: identity.known_works,
    },
  );
  const { data, error } = await db
    .from("prospect_scans")
    .insert({
      prospect_id: prospectId,
      status: "queued",
      source_family_set_version: SOURCE_FAMILY_SET_VERSION,
      classification_version: CLASSIFICATION_VERSION,
      query_terms: queryTerms,
      aliases_used: identity.aliases,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create scan: ${error.message}`);
  return data.id as string;
}

/** Is the signed-in user an authorised staff member? (server-side check) */
export const getStaffAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_prospect_staff", { _user_id: context.userId });
    return { isStaff: data === true };
  });

/** Lock the identity and start a real scan. */
export const startProspectScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: StartScanPayload) => StartScanInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);

    const profileHandle = handleFromUrl(data.knownProfileUrl || null);
    const handles = Array.from(
      new Set([
        ...data.knownHandles.map((h) => h.replace(/^@/, "")),
        ...(profileHandle ? [profileHandle] : []),
      ]),
    );
    const identityRow = {
      display_name: data.name,
      normalized_name: data.name.toLowerCase().replace(/\s+/g, " ").trim(),
      identity_type: data.identityType,
      country_region: data.countryRegion || null,
      known_profile_url: data.knownProfileUrl || null,
      known_website: data.knownWebsite || null,
      profession: data.profession || null,
      organization: data.organization || null,
      aliases: data.aliases,
      known_handles: handles,
      known_works: data.knownWorks,
      linked_entities: data.linkedEntities,
      name_is_ambiguous: data.nameIsAmbiguous,
      created_by: context.userId,
    };
    const { data: identity, error } = await db
      .from("prospect_identities")
      .insert(identityRow)
      .select("id")
      .single();
    if (error) throw new Error(`Could not lock identity: ${error.message}`);

    const scanId = await createScanRow(db, context.userId, identity.id, identityRow);
    await launchInBackground(scanId);
    return { scanId, prospectId: identity.id as string };
  });

/** Rescan the same locked identity: always a NEW run; history is preserved. */
export const rescanProspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scanId: string }) =>
    z.object({ scanId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    const { data: prev, error } = await db
      .from("prospect_scans")
      .select("prospect_id")
      .eq("id", data.scanId)
      .single();
    if (error) throw new Error("Scan not found");
    const { data: identity } = await db
      .from("prospect_identities")
      .select("*")
      .eq("id", prev.prospect_id)
      .single();
    const scanId = await createScanRow(db, context.userId, prev.prospect_id, identity);
    await launchInBackground(scanId);
    return { scanId };
  });

/**
 * Advance a running scan by one bounded, resumable step. The open scan popup
 * calls this in a loop; a lease guarantees only one step runs at a time, and
 * every step resumes from stored rows (nothing is kept in process memory).
 */
export const advanceScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scanId: string }) =>
    z.object({ scanId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    // RLS read proves this staff session can see the scan before we act on it.
    const { data: visible } = await db
      .from("prospect_scans")
      .select("id")
      .eq("id", data.scanId)
      .maybeSingle();
    if (!visible) throw new Error("Scan not found");
    const { advanceProspectScan } = await import("./runner-wiring.server");
    return advanceProspectScan(data.scanId, 20_000);
  });

/** Everything the scan popup renders — computed from stored rows only. */
export const getProspectScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scanId: string }) =>
    z.object({ scanId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff, loadScanSnapshot, toView } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    return toView(await loadScanSnapshot(db, data.scanId));
  });

/** Recent scans for the search screen. */
export const listProspectScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    const { data, error } = await db
      .from("prospect_scans")
      .select(
        "id, status, coverage_state, created_at, finished_at, prospect_identities(display_name, identity_type)",
      )
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);
    return { scans: data ?? [] };
  });

/** Evidence drawer payload for one finding. */
export const getFindingEvidence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { findingId: string }) =>
    z.object({ findingId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    const { data: finding, error } = await db
      .from("prospect_findings")
      .select("*")
      .eq("id", data.findingId)
      .single();
    if (error) throw new Error("Finding not found");
    const [discovery, evidence, observations, decisions] = await Promise.all([
      db.from("prospect_discoveries").select("*").eq("id", finding.discovery_id).single(),
      db
        .from("prospect_finding_evidence")
        .select("*")
        .eq("finding_id", finding.id)
        .order("created_at"),
      db
        .from("prospect_discovery_observations")
        .select(
          "provider, family_key, query_used, query_purpose, discovery_method, result_rank, retrieved_at, raw_url",
        )
        .eq("discovery_id", finding.discovery_id)
        .order("retrieved_at"),
      db
        .from("prospect_staff_decisions")
        .select("id, actor_id, action, previous_state, new_state, reason, created_at")
        .or(`finding_id.eq.${finding.id},discovery_id.eq.${finding.discovery_id}`)
        .order("created_at", { ascending: false }),
    ]);
    return JSON.parse(
      JSON.stringify({
        finding,
        discovery: discovery.data,
        evidence: evidence.data ?? [],
        observations: observations.data ?? [],
        decisions: decisions.data ?? [],
        viewerId: context.userId,
      }),
    ) as EvidencePayload;
  });

type JsonRow = { [key: string]: Json | undefined };
export interface EvidencePayload {
  finding: JsonRow;
  discovery: JsonRow | null;
  evidence: JsonRow[];
  observations: JsonRow[];
  decisions: JsonRow[];
  viewerId: string;
}

const DECISION_STATE = {
  VERIFY: "VERIFIED",
  REJECT: "REJECTED",
  NEEDS_REVIEW: "NEEDS_HUMAN_REVIEW",
  ESCALATE: "ESCALATED",
} as const;

/** Staff decision on a finding: audited, then scores recomputed (append-only). */
export const recordFindingDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      findingId: string;
      action: keyof typeof DECISION_STATE;
      reason?: string;
      reclassifyAs?: string;
    }) =>
      z
        .object({
          findingId: z.string().uuid(),
          action: z.enum(["VERIFY", "REJECT", "NEEDS_REVIEW", "ESCALATE"]),
          reason: z.string().trim().max(500).optional(),
          reclassifyAs: z.string().trim().min(2).max(80).optional(),
        })
        .strict()
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff, recomputeScores } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    const { data: finding, error } = await db
      .from("prospect_findings")
      .select("id, scan_id, discovery_id, state")
      .eq("id", data.findingId)
      .single();
    if (error) throw new Error("Finding not found");
    const newState = DECISION_STATE[data.action];

    const { error: decisionError } = await db.from("prospect_staff_decisions").insert({
      scan_id: finding.scan_id,
      finding_id: finding.id,
      discovery_id: finding.discovery_id,
      actor_id: context.userId,
      action: data.action.toLowerCase(),
      previous_state: finding.state,
      new_state: newState,
      reason:
        [data.reason, data.reclassifyAs ? `Reclassified as: ${data.reclassifyAs}` : null]
          .filter(Boolean)
          .join(" · ") || null,
    });
    if (decisionError) throw new Error(`Could not record decision: ${decisionError.message}`);

    const { error: updateError } = await db
      .from("prospect_findings")
      .update({
        state: newState,
        verified_by: context.userId,
        verified_at: new Date().toISOString(),
        ...(data.reclassifyAs ? { staff_classification: data.reclassifyAs } : {}),
      })
      .eq("id", finding.id);
    if (updateError) throw new Error(`Could not update finding: ${updateError.message}`);

    await recomputeScores(db, finding.scan_id, context.userId);
    return { ok: true, state: newState };
  });

/** Staff identity review: move an item into or out of the matched totals. */
export const recordIdentityDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { discoveryId: string; decision: "MATCHED" | "UNRELATED"; reason?: string }) =>
      z
        .object({
          discoveryId: z.string().uuid(),
          decision: z.enum(["MATCHED", "UNRELATED"]),
          reason: z.string().trim().max(500).optional(),
        })
        .strict()
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff, recomputeScores } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);
    const { data: discovery, error } = await db
      .from("prospect_discoveries")
      .select("id, scan_id, identity_bucket")
      .eq("id", data.discoveryId)
      .single();
    if (error) throw new Error("Discovery not found");
    const { error: decisionError } = await db.from("prospect_staff_decisions").insert({
      scan_id: discovery.scan_id,
      discovery_id: discovery.id,
      actor_id: context.userId,
      action: "identity_review",
      previous_state: discovery.identity_bucket,
      new_state: data.decision,
      reason: data.reason ?? null,
    });
    if (decisionError)
      throw new Error(`Could not record identity decision: ${decisionError.message}`);
    const { error: updateError } = await db
      .from("prospect_discoveries")
      .update({
        identity_bucket: data.decision,
        identity_approved_by: context.userId,
        identity_approved_at: new Date().toISOString(),
      })
      .eq("id", discovery.id);
    if (updateError) throw new Error(`Could not update identity: ${updateError.message}`);
    await recomputeScores(db, discovery.scan_id, context.userId);
    return { ok: true };
  });

/**
 * Begin Client Enrollment: hand the verified prospect package to onboarding.
 * Idempotent — repeat clicks never duplicate transferred findings. Preserves the
 * originating prospect_scan_id on every transferred record. Never enforcement.
 */
export const beginClientEnrollment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scanId: string; findingIds: string[]; clientEmail?: string | null }) =>
    z
      .object({
        scanId: z.string().uuid(),
        findingIds: z.array(z.string().uuid()).max(500),
        clientEmail: z.string().trim().email().max(200).optional().nullable().or(z.literal("")),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertStaff } = await import("./snapshot.server");
    const { planEnrollmentTransfer } = await import("./enrollment");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    await assertStaff(db, context.userId);

    const { data: scan, error } = await db
      .from("prospect_scans")
      .select("id, prospect_id, status")
      .eq("id", data.scanId)
      .single();
    if (error) throw new Error("Scan not found");

    const [findingsRes, discoveriesRes, existingRes] = await Promise.all([
      db
        .from("prospect_findings")
        .select("id, discovery_id, state")
        .eq("scan_id", data.scanId)
        .in(
          "id",
          data.findingIds.length ? data.findingIds : ["00000000-0000-0000-0000-000000000000"],
        ),
      db.from("prospect_discoveries").select("id, identity_bucket").eq("scan_id", data.scanId),
      db
        .from("prospect_enrollment_transfers")
        .select("finding_id, target_table, target_id")
        .eq("scan_id", data.scanId),
    ]);
    const plan = planEnrollmentTransfer({
      selectedIds: data.findingIds,
      findings: findingsRes.data ?? [],
      discoveries: discoveriesRes.data ?? [],
      existing: existingRes.data ?? [],
    });
    if (plan.rejected.length) {
      throw new Error(
        `Only human-verified, identity-matched findings can be transferred (${plan.rejected.length} not eligible).`,
      );
    }

    const rows = [
      ...(plan.includeIdentity ? [{ finding_id: null, target_table: "enrollment_identity" }] : []),
      ...plan.toTransfer.map((id) => ({ finding_id: id, target_table: "enrollment_finding" })),
    ].map((r) => ({
      ...r,
      scan_id: scan.id,
      prospect_id: scan.prospect_id,
      transferred_by: context.userId,
    }));
    if (rows.length) {
      const { error: insertError } = await db.from("prospect_enrollment_transfers").insert(rows);
      if (insertError && insertError.code !== "23505")
        throw new Error(`Could not record transfer: ${insertError.message}`);
    }

    // Client invitation through the existing invite system (admins only, as today).
    let inviteCode: string | null = null;
    const email = data.clientEmail || null;
    const alreadyInvited = (existingRes.data ?? []).some(
      (t: { target_table: string }) => t.target_table === "signup_invite",
    );
    if (email && !alreadyInvited) {
      const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
        db.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
        db.rpc("has_role", { _user_id: context.userId, _role: "super_admin" }),
      ]);
      if (isAdmin || isSuper) {
        const { generateInviteCode, hashInviteCode } = await import("@/lib/invites/invites.server");
        const code = generateInviteCode();
        const { data: invite, error: inviteError } = await db
          .from("signup_invites")
          .insert({
            code_hash: hashInviteCode(code),
            label: `Pre-enrollment · scan ${scan.id.slice(0, 8)}`,
            max_uses: 1,
            assigned_email: email.toLowerCase(),
            created_by: context.userId,
          })
          .select("id")
          .single();
        if (!inviteError && invite) {
          inviteCode = code;
          await db.from("prospect_enrollment_transfers").insert({
            scan_id: scan.id,
            prospect_id: scan.prospect_id,
            finding_id: null,
            target_table: "signup_invite",
            target_id: invite.id,
            transferred_by: context.userId,
          });
        }
      }
    }

    return {
      prospectScanId: scan.id as string,
      transferred: plan.toTransfer.length,
      alreadyTransferred: plan.alreadyTransferred.length,
      identityPackaged: plan.includeIdentity || plan.identityAlreadyPackaged,
      inviteCode,
      inviteNote:
        email && !inviteCode
          ? alreadyInvited
            ? "An invitation was already issued for this scan."
            : "Invitations are issued by an admin — the package is ready for them."
          : null,
    };
  });

/**
 * Boot + search-screen readiness: which source families this environment can
 * actually query right now (credentials present, policy allows). Nothing here
 * claims a scan happened — it only reports capability.
 */
export const getDiscoveryReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertStaff } = await import("./snapshot.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await assertStaff(context.supabase as any, context.userId);
    const { SOURCE_FAMILIES } = await import("./source-registry");
    const { productionExecutors, productionDetector } = await import("./providers.server");
    const executors = productionExecutors();
    const families = SOURCE_FAMILIES.map((family) => {
      const configured = executors.filter((e) => e.familyKey === family.key && e.isConfigured());
      const state = !family.policyEnabled
        ? ("policy_disabled" as const)
        : !family.directAccess || configured.length === 0
          ? ("unavailable" as const)
          : ("available" as const);
      return {
        key: family.key as string,
        label: family.label,
        state,
        reason:
          state === "available"
            ? null
            : !family.policyEnabled
              ? (family.policyReason ?? "Disabled by policy")
              : !family.directAccess
                ? (family.unavailableReason ?? "No permitted API access configured")
                : "No configured provider",
        providers: configured.map((e) => e.label),
      };
    });
    const detector = productionDetector();
    return { families, detector: detector?.name ?? null, checkedAt: new Date().toISOString() };
  });
