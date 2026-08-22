/**
 * Deepfake Intelligence dispatch. Wires the real, live production pipeline
 * (runDeepfakeScanCore, extracted from src/lib/deepfake-intel.functions.ts's
 * runDeepfakeScan) — not the orphaned checkpointed worker path in
 * scan-executor.server.ts/scan-pipeline.server.ts, which nothing in
 * production ever dispatches to.
 *
 * Uses the confirmed-real production face chain user_id ->
 * deepfake_target_profiles -> deepfake_reference_faces STRICTLY READ-ONLY.
 * Earlier versions of this module auto-created a deepfake_target_profiles
 * row and bridged a reference image copied from a table called
 * protected_faces — that table does not exist in production (confirmed by
 * direct schema inspection), so that bridge could never have worked and is
 * removed entirely. This module now only reuses whatever
 * deepfake_target_profiles/deepfake_reference_faces rows already exist for
 * a customer (created via the existing manual Deepfake Intel UI) and
 * returns an honest blocked status when they don't — it never creates,
 * modifies, or deletes rows in either table.
 */
import { AutoEnforcementOrchestrator, type FindingShape } from "@/lib/enforcement/orchestrator";

export interface DeepfakeOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

interface ProtectionProfileLike {
  display_name: string | null;
  verified_name: string | null;
}

export const MIN_REFERENCE_FACES_FOR_MATCHING = 3;

export interface ExistingDeepfakeTarget {
  profileId: string;
  referenceFaceCount: number;
}

/**
 * Read-only lookup: does this customer already have a deepfake_target_profiles
 * row, and if so how many deepfake_reference_faces does it have? Never
 * inserts, updates, or deletes either table.
 */
export async function findExistingDeepfakeTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
): Promise<ExistingDeepfakeTarget | null> {
  const { data: targetProfile } = await supabaseAdmin
    .from("deepfake_target_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!targetProfile) return null;

  const { count } = await supabaseAdmin
    .from("deepfake_reference_faces")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", targetProfile.id);

  return { profileId: targetProfile.id, referenceFaceCount: count ?? 0 };
}

export interface DeepfakeFindingLike {
  id: string;
  url?: string;
  takedown_recommended: boolean;
}

/** Pure gate: only findings the pipeline's own two-gate verification already marked takedown-worthy. */
export function selectActionableDeepfakeFindings<T extends DeepfakeFindingLike>(
  findings: T[],
): T[] {
  return findings.filter((f) => f.takedown_recommended);
}

export interface DeepfakeDispatchDeps {
  runDeepfakeScanCore?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    userId: string,
    rawData: unknown,
  ) => Promise<{ scan_id: string; already_running: boolean }>;
  onVerifiedFinding?: typeof AutoEnforcementOrchestrator.onVerifiedFinding;
}

export async function runDeepfakeIntelForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  profile: ProtectionProfileLike,
  deps: DeepfakeDispatchDeps = {},
): Promise<DeepfakeOutcome> {
  const targetName = (profile.display_name || profile.verified_name || "").trim();
  if (!targetName) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_SUBJECT_NAME",
    };
  }

  const existing = await findExistingDeepfakeTarget(supabaseAdmin, userId);
  if (!existing) {
    // No fabricated enrollment — this customer has never gone through the
    // existing manual Deepfake Intel target-profile creation flow.
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_TARGET_PROFILE",
    };
  }
  if (existing.referenceFaceCount === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_REFERENCE_FACES",
    };
  }

  const { data: profileRow } = await supabaseAdmin
    .from("protection_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: aliasRows } = profileRow
    ? await supabaseAdmin
        .from("protection_profile_aliases")
        .select("alias")
        .eq("profile_id", profileRow.id)
        .eq("active", true)
    : { data: [] as { alias: string }[] };
  const aliases = (aliasRows ?? [])
    .map((a: { alias: string }) => a.alias)
    .filter((a: string) => a && a.toLowerCase() !== targetName.toLowerCase())
    .slice(0, 20);

  const { data: assets } = await supabaseAdmin
    .from("digital_assets")
    .select("handle")
    .eq("user_id", userId);
  const handles = (assets ?? [])
    .map((a: { handle: string | null }) => a.handle)
    .filter((h: string | null): h is string => !!h)
    .slice(0, 20);

  let result: { scan_id: string; already_running: boolean };
  try {
    const runDeepfakeScanCore =
      deps.runDeepfakeScanCore ??
      (await import("@/lib/deepfake-intel.functions")).runDeepfakeScanCore;
    result = await runDeepfakeScanCore(supabaseAdmin, userId, {
      target_name: targetName,
      profile_id: existing.profileId,
      aliases,
      handles,
    });
  } catch (err) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: (err as Error).message?.slice(0, 200) ?? "SCAN_EXECUTION_FAILED",
    };
  }

  if (result.already_running) {
    return { status: "RUNNING", candidates_found: 0, verified_findings: 0, blocked_reason: null };
  }

  const { data: findings } = await supabaseAdmin
    .from("deepfake_findings")
    .select("id, url, content_category, takedown_recommended")
    .eq("scan_id", result.scan_id);
  const rows = findings ?? [];
  const actionable = selectActionableDeepfakeFindings(rows as DeepfakeFindingLike[]);

  const onVerifiedFinding = deps.onVerifiedFinding ?? AutoEnforcementOrchestrator.onVerifiedFinding;

  for (const finding of actionable) {
    try {
      // deepfake's own pipeline already captured evidence into
      // deepfake_evidence before finalizing this finding — no duplicate
      // capture needed here, ordering is already satisfied.
      const shapedFinding: FindingShape = {
        id: finding.id as string,
        source: "deepfake_intel",
        source_type: "deepfake",
        canonical_url: finding.url as string,
        risk_type: "DEEPFAKE",
      };
      await onVerifiedFinding(supabaseAdmin, userId, shapedFinding);
    } catch (err) {
      console.error("[protection:deepfake] case prep failed", finding.id, err);
    }
  }

  const blockedReason =
    existing.referenceFaceCount < MIN_REFERENCE_FACES_FOR_MATCHING
      ? "TEXT_ONLY_NO_FACE_FILTER"
      : null;

  return {
    status: "COMPLETED",
    candidates_found: rows.length,
    verified_findings: actionable.length,
    blocked_reason: blockedReason,
  };
}
