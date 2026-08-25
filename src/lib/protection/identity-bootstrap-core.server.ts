/**
 * Plain, fully mockable core logic for the Protected-Asset Face Bootstrap
 * admin review actions (confirm/reject/revoke). Split out from
 * identity-bootstrap.functions.ts's createServerFn wrappers — which own
 * authentication and the admin-role check — the same way
 * face-enrollment-core.server.ts is split from face-enrollment.functions.ts
 * in this codebase. Every function here takes supabaseAdmin as its first
 * argument and trusts the caller to have already verified authorization;
 * these are never exposed directly to the client.
 */
import {
  ensureDeepfakeTargetProfileForUser,
  type TrustedAnchorTier,
} from "./trusted-face-anchors.server";

export interface ClusterActionDeps {
  downloadTileBytes: (storagePath: string) => Promise<Uint8Array>;
  computePhash: (bytes: Uint8Array) => Promise<string>;
  promoteToReferenceFace: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabaseAdmin: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any,
  ) => Promise<{ referenceId: string }>;
  runFaceReferenceExtraction?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabaseAdmin: any,
    userId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  /** Bridges this confirmation into Face Protection's own enrollment state (see face-protection-bridge.server.ts) — best-effort, never blocks or reverts the confirmation itself if it fails. */
  activateFaceProtection?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabaseAdmin: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
}

export interface ConfirmClusterResult {
  ok: true;
  referenceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraction: any;
}

const CONFIRMED_TIER: TrustedAnchorTier = "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE";

/**
 * The trust boundary itself. No candidate face becomes a trusted anchor
 * until this runs, and this only ever runs from an admin-verified caller.
 * Idempotent target-profile creation, tier-tagged insert, cluster marked
 * CONFIRMED, then the existing recurring dispatcher is reused (not a new
 * code path) to sweep every other eligible screenshot against the new
 * anchor immediately.
 */
export async function confirmIdentityCandidateClusterCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { adminUserId: string; targetUserId: string; clusterId: string },
  deps: ClusterActionDeps,
): Promise<ConfirmClusterResult> {
  const { data: cluster, error: clusterError } = await supabaseAdmin
    .from("face_identity_candidate_clusters")
    .select("id, status, representative_tile_id, user_id")
    .eq("id", input.clusterId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  if (clusterError) throw new Error(clusterError.message);
  if (!cluster) throw new Error("Identity candidate cluster not found.");
  if (cluster.status !== "PENDING") throw new Error("This candidate has already been reviewed.");
  if (!cluster.representative_tile_id) {
    throw new Error("This cluster has no representative tile to confirm.");
  }

  const { data: tile, error: tileError } = await supabaseAdmin
    .from("protected_asset_grid_tiles")
    .select("id, parent_asset_id, tile_storage_path, face_confidence")
    .eq("id", cluster.representative_tile_id)
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  if (tileError) throw new Error(tileError.message);
  if (!tile?.tile_storage_path) throw new Error("Representative tile image is missing.");

  const { data: profileRow } = await supabaseAdmin
    .from("protection_profiles")
    .select("display_name, verified_name")
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  const targetName =
    (profileRow?.display_name || profileRow?.verified_name || "").trim() || "Protected Subject";
  const profileId = await ensureDeepfakeTargetProfileForUser(
    supabaseAdmin,
    input.targetUserId,
    targetName,
  );

  const tileBytes = await deps.downloadTileBytes(tile.tile_storage_path);
  const phash = await deps.computePhash(tileBytes);
  const confirmedAt = new Date().toISOString();

  const promoted = await deps.promoteToReferenceFace(supabaseAdmin, {
    userId: input.targetUserId,
    profileId,
    tileBytes,
    tileStorageKey: tile.tile_storage_path,
    sourceAssetId: tile.parent_asset_id,
    sourceTileId: tile.id,
    faceConfidence: tile.face_confidence ?? null,
    phash,
    referenceTier: CONFIRMED_TIER,
    sourceType: "ADMIN_CONFIRMED_PROTECTED_ASSET",
    confirmedBy: input.adminUserId,
    confirmedAt,
  });

  await supabaseAdmin
    .from("face_identity_candidate_clusters")
    .update({
      status: "CONFIRMED",
      confirmed_reference_id: promoted.referenceId,
      reviewed_by: input.adminUserId,
      reviewed_at: confirmedAt,
    })
    .eq("id", cluster.id)
    .eq("user_id", input.targetUserId);

  // Best-effort bridge into Face Protection's own enrollment state — reuses
  // the confirmed representative tile so no second face capture is ever
  // requested. Never blocks or reverts the confirmation above if it fails;
  // a failure here just means Face Protection stays as it was.
  if (deps.activateFaceProtection) {
    try {
      await deps.activateFaceProtection(supabaseAdmin, {
        userId: input.targetUserId,
        tileBytes,
        tileStorageKey: tile.tile_storage_path,
        referenceFaceId: promoted.referenceId,
        faceConfidence: tile.face_confidence ?? null,
        label: `${targetName} — protected image reference`,
      });
    } catch (err) {
      console.error(
        "[identity-bootstrap] Face Protection activation failed",
        input.targetUserId,
        err,
      );
    }
  }

  let extraction: unknown = null;
  if (deps.runFaceReferenceExtraction) {
    try {
      extraction = await deps.runFaceReferenceExtraction(supabaseAdmin, input.targetUserId);
    } catch (err) {
      console.error(
        "[identity-bootstrap] post-confirmation extraction failed",
        input.targetUserId,
        err,
      );
    }
  }

  return { ok: true, referenceId: promoted.referenceId, extraction };
}

/** A rejected cluster is recorded, never deleted, and never touches deepfake_reference_faces. */
export async function rejectIdentityCandidateClusterCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { adminUserId: string; targetUserId: string; clusterId: string },
): Promise<{ ok: true }> {
  const { data: cluster, error } = await supabaseAdmin
    .from("face_identity_candidate_clusters")
    .select("id, status")
    .eq("id", input.clusterId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cluster) throw new Error("Identity candidate cluster not found.");
  if (cluster.status !== "PENDING") throw new Error("This candidate has already been reviewed.");

  await supabaseAdmin
    .from("face_identity_candidate_clusters")
    .update({
      status: "REJECTED",
      reviewed_by: input.adminUserId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", cluster.id)
    .eq("user_id", input.targetUserId);

  return { ok: true };
}

/**
 * Walks derived_from_reference_id edges outward from a just-revoked
 * reference (BFS, cycle-safe via `visited`) and marks every row that was
 * matched directly or transitively against it as revoked too — never
 * deleted, always tagged CASCADED_ANCHOR_REVOKED plus which root caused it,
 * so the audit trail says exactly why. A reference that independently
 * matched a *different*, still-trusted anchor is never touched — the walk
 * only ever follows edges that actually point at the revoked lineage.
 * Idempotent: a child already revoked (by an earlier cascade, or directly)
 * is skipped, never re-stamped, but its own children are still visited so a
 * partially-applied prior run can always be completed safely by re-calling
 * this.
 */
async function cascadeRevokeDerivedReferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { rootId: string; revokedBy: string; revokedAt: string },
): Promise<number> {
  let cascadedCount = 0;
  const visited = new Set<string>([input.rootId]);
  const queue: string[] = [input.rootId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const { data: children } = await supabaseAdmin
      .from("deepfake_reference_faces")
      .select("id, revoked_at")
      .eq("derived_from_reference_id", parentId);

    for (const child of (children ?? []) as Array<{ id: string; revoked_at: string | null }>) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      queue.push(child.id);

      if (child.revoked_at) continue; // already revoked (directly or by an earlier cascade) — leave its own record untouched

      await supabaseAdmin
        .from("deepfake_reference_faces")
        .update({
          revoked_at: input.revokedAt,
          revoked_by: input.revokedBy,
          revoked_reason: "CASCADED_ANCHOR_REVOKED",
          revoked_cascade_root_id: input.rootId,
        })
        .eq("id", child.id);
      cascadedCount += 1;
    }
  }

  return cascadedCount;
}

/**
 * Never deletes — marks revoked so getTrustedFaceAnchorsForUser stops
 * using it for any future comparison, while every past confirm/reject
 * decision on face_identity_candidate_clusters stays exactly as it is
 * (audit history preserved, no destructive cleanup). Any
 * SCREENSHOT_DERIVED_REFERENCE that was auto-matched directly or
 * transitively against THIS anchor is cascaded to revoked too — an
 * automatic match made against an anchor that turns out to be the wrong
 * person is no more trustworthy than the anchor itself. A reference that
 * independently matched a different, still-valid anchor is never touched.
 *
 * Defense in depth: targetUserId must actually own referenceFaceId (via its
 * deepfake_target_profiles.user_id) before anything is touched. This never
 * changes who may call this — the caller must still be an admin, re-verified
 * by the createServerFn wrapper exactly as before — it only guards against a
 * caller-side mismatch (e.g. a stale UI, a future bug) silently revoking the
 * wrong customer's reference. A mismatch fails closed: no row is read for
 * mutation, nothing is revoked, nothing cascades.
 */
export async function revokeAdminConfirmedAnchorCore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  input: { adminUserId: string; targetUserId: string; referenceFaceId: string },
): Promise<{ ok: true; alreadyRevoked: boolean; cascadedCount: number }> {
  const { data: reference, error } = await supabaseAdmin
    .from("deepfake_reference_faces")
    .select("id, profile_id, reference_tier, revoked_at")
    .eq("id", input.referenceFaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!reference) throw new Error("Reference not found.");
  if (reference.reference_tier !== CONFIRMED_TIER) {
    throw new Error("Only an admin-confirmed protected-asset reference can be revoked this way.");
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("deepfake_target_profiles")
    .select("user_id")
    .eq("id", reference.profile_id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.user_id !== input.targetUserId) {
    throw new Error("Reference not found.");
  }

  if (reference.revoked_at) return { ok: true, alreadyRevoked: true, cascadedCount: 0 };

  const revokedAt = new Date().toISOString();
  await supabaseAdmin
    .from("deepfake_reference_faces")
    .update({
      revoked_at: revokedAt,
      revoked_by: input.adminUserId,
      revoked_reason: "ADMIN_REVOKED",
    })
    .eq("id", input.referenceFaceId);

  const cascadedCount = await cascadeRevokeDerivedReferences(supabaseAdmin, {
    rootId: input.referenceFaceId,
    revokedBy: input.adminUserId,
    revokedAt,
  });

  // If this anchor was ever bridged into Face Protection (see
  // face-protection-bridge.server.ts), that reference must stop being used
  // for future automatic matching too — deactivated, never deleted, and
  // Face Protection's own status reverts (never touching a genuinely
  // liveness-verified profile, which this path never produces in the first
  // place).
  const { data: linkedFaces } = await supabaseAdmin
    .from("protected_faces")
    .select("id, user_id, status")
    .eq("linked_reference_face_id", input.referenceFaceId);
  for (const pf of (linkedFaces ?? []) as Array<{
    id: string;
    user_id: string;
    status: string;
  }>) {
    if (pf.status === "ACTIVE") {
      await supabaseAdmin.from("protected_faces").update({ status: "INACTIVE" }).eq("id", pf.id);
    }
    await supabaseAdmin
      .from("protected_face_profiles")
      .update({ status: "DEFERRED" })
      .eq("user_id", pf.user_id)
      .eq("status", "FACE_VERIFIED_VIA_PROTECTED_ASSET");
  }

  return { ok: true, alreadyRevoked: false, cascadedCount };
}
