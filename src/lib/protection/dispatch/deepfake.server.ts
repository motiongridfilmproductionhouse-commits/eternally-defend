/**
 * Deepfake Intelligence dispatch. Wires the real, live production pipeline
 * (runDeepfakeScanCore, extracted from src/lib/deepfake-intel.functions.ts's
 * runDeepfakeScan) — not the orphaned checkpointed worker path in
 * scan-executor.server.ts/scan-pipeline.server.ts, which nothing in
 * production ever dispatches to.
 *
 * Identity gating now goes through the shared getTrustedFaceAnchorsForUser
 * resolver (src/lib/protection/trusted-face-anchors.server.ts). protected_faces
 * / protected_face_profiles DO exist in production and are the table Face
 * Protection / AWS Liveness enrollment actually writes to (confirmed by the
 * current deployed src/lib/onboarding/face-enrollment-core.server.ts and
 * src/lib/face-protection/protected-face-registry.ts) — an earlier version
 * of this comment said otherwise; that was correct at the time it was
 * written but is now stale. A customer with ONLY a liveness anchor (no
 * deepfake_target_profiles row) is no longer reported as having no
 * reference at all: the scan runs, just without Rekognition face-filtering
 * until deepfake_reference_faces accumulates >=3 rows for them (via Face
 * Reference Extraction's own auto-promotion, or the manual Deepfake Intel
 * upload flow — either way, never a forced re-upload). This module still
 * never creates, modifies, or deletes a deepfake_target_profiles or
 * deepfake_reference_faces row itself — face-filtering eligibility is
 * purely a read of whatever already exists.
 */
import { AutoEnforcementOrchestrator, type FindingShape } from "@/lib/enforcement/orchestrator";
import { getTrustedFaceAnchorsForUser } from "../trusted-face-anchors.server";

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
  const anchorResult = await getTrustedFaceAnchorsForUser(supabaseAdmin, userId);
  const hasLivenessAnchor = anchorResult.anchors.some((a) => a.source === "FACE_PROTECTION");
  const referenceFaceCount = existing?.referenceFaceCount ?? 0;

  // Preserves the exact pre-existing behavior for every case that doesn't
  // involve a liveness anchor: a target profile with zero reference faces
  // (and no liveness anchor) is still a hard block, same as before — this
  // only adds the new case of "no target profile, but a liveness-verified
  // Face Protection anchor exists," which must no longer be reported as
  // having no reference at all.
  if (!hasLivenessAnchor && referenceFaceCount === 0) {
    return {
      status: "WAITING_FOR_NEXT_SCAN",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
    };
  }
  // referenceFaceCount drives face-filtering eligibility below
  // (MIN_REFERENCE_FACES_FOR_MATCHING) — a liveness-only customer with no
  // deepfake_target_profiles row has 0 here, same as before, and the scan
  // still proceeds text-only via TEXT_ONLY_NO_FACE_FILTER rather than being
  // blocked outright.

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
      profile_id: existing?.profileId,
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
    referenceFaceCount < MIN_REFERENCE_FACES_FOR_MATCHING ? "TEXT_ONLY_NO_FACE_FILTER" : null;

  return {
    status: "COMPLETED",
    candidates_found: rows.length,
    verified_findings: actionable.length,
    blocked_reason: blockedReason,
  };
}
