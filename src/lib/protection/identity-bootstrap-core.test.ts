import test from "node:test";
import assert from "node:assert/strict";
import { createMockSupabase } from "./test-utils";
import {
  confirmIdentityCandidateClusterCore,
  rejectIdentityCandidateClusterCore,
  revokeAdminConfirmedAnchorCore,
  type ClusterActionDeps,
} from "./identity-bootstrap-core.server";

function baseFixture() {
  return {
    protected_asset_grid_tiles: [
      {
        id: "tile-1",
        user_id: "user-1",
        parent_asset_id: "asset-1",
        tile_storage_path: "clients/user-1/reference/candidate/asset-1/0.jpg",
        face_confidence: 93,
        cluster_id: "cluster-1",
      },
    ],
    face_identity_candidate_clusters: [
      {
        id: "cluster-1",
        user_id: "user-1",
        representative_tile_id: "tile-1",
        tile_count: 3,
        status: "PENDING",
      },
    ],
  };
}

function fakeDeps(promoteCallLog: unknown[]): ClusterActionDeps {
  return {
    downloadTileBytes: async () => new Uint8Array([1, 2, 3]),
    computePhash: async () => "fakephash",
    promoteToReferenceFace: async (supabaseAdmin, input) => {
      promoteCallLog.push(input);
      const { data } = await supabaseAdmin
        .from("deepfake_reference_faces")
        .insert({
          profile_id: input.profileId,
          storage_path: input.tileStorageKey,
          rekognition_face_id: "fake-face-1",
          reference_tier: input.referenceTier,
          source_type: input.sourceType,
          source_asset_id: input.sourceAssetId,
          source_tile_id: input.sourceTileId,
          confirmed_by: input.confirmedBy,
          confirmed_at: input.confirmedAt,
        })
        .select("id")
        .single();
      return { referenceId: data!.id };
    },
    runFaceReferenceExtraction: async () => ({ status: "COMPLETED" }),
  };
}

test("confirming a PENDING cluster creates exactly one ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE row and marks the cluster CONFIRMED", async () => {
  const supabase = createMockSupabase(baseFixture());
  const promoteCallLog: unknown[] = [];
  const deps = fakeDeps(promoteCallLog);

  const result = await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: "admin-1", targetUserId: "user-1", clusterId: "cluster-1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(promoteCallLog.length, 1);

  const refs = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refs.length, 1);
  assert.equal(refs[0].reference_tier, "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE");
  assert.equal(refs[0].source_type, "ADMIN_CONFIRMED_PROTECTED_ASSET");
  assert.equal(refs[0].confirmed_by, "admin-1");
  assert.ok(refs[0].confirmed_at);
  // Never labeled as liveness-verified or the automatic screenshot tier.
  assert.notEqual(refs[0].reference_tier, "CANONICAL_VERIFIED_REFERENCE");
  assert.notEqual(refs[0].reference_tier, "SCREENSHOT_DERIVED_REFERENCE");

  const clusters = supabase._store["face_identity_candidate_clusters"] ?? [];
  assert.equal(clusters[0].status, "CONFIRMED");
  assert.equal(clusters[0].confirmed_reference_id, refs[0].id);
  assert.equal(clusters[0].reviewed_by, "admin-1");
});

test("provenance: the confirmed reference retains the source asset, tile, confirming admin, and target profile", async () => {
  const supabase = createMockSupabase({
    ...baseFixture(),
    deepfake_target_profiles: [
      { id: "dtp-existing", user_id: "user-1", target_name: "Lena Kumar" },
    ],
  });
  const promoteCallLog: unknown[] = [];
  const deps = fakeDeps(promoteCallLog);

  await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: "admin-1", targetUserId: "user-1", clusterId: "cluster-1" },
    deps,
  );

  const refs = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refs[0].source_asset_id, "asset-1");
  assert.equal(refs[0].source_tile_id, "tile-1");
  assert.equal(
    refs[0].profile_id,
    "dtp-existing",
    "reuses the existing target profile, never a second one",
  );
  const targetProfiles = supabase._store["deepfake_target_profiles"] ?? [];
  assert.equal(targetProfiles.length, 1);
});

test("confirming an already-reviewed cluster throws and creates no new reference", async () => {
  const supabase = createMockSupabase({
    protected_asset_grid_tiles: baseFixture().protected_asset_grid_tiles,
    face_identity_candidate_clusters: [
      {
        id: "cluster-1",
        user_id: "user-1",
        representative_tile_id: "tile-1",
        tile_count: 3,
        status: "CONFIRMED",
      },
    ],
  });
  const promoteCallLog: unknown[] = [];
  const deps = fakeDeps(promoteCallLog);

  await assert.rejects(() =>
    confirmIdentityCandidateClusterCore(
      supabase,
      { adminUserId: "admin-1", targetUserId: "user-1", clusterId: "cluster-1" },
      deps,
    ),
  );
  assert.equal(promoteCallLog.length, 0);
});

test("rejecting a candidate marks it REJECTED and never creates a trusted reference", async () => {
  const supabase = createMockSupabase(baseFixture());

  const result = await rejectIdentityCandidateClusterCore(supabase, {
    adminUserId: "admin-1",
    targetUserId: "user-1",
    clusterId: "cluster-1",
  });

  assert.equal(result.ok, true);
  const clusters = supabase._store["face_identity_candidate_clusters"] ?? [];
  assert.equal(clusters[0].status, "REJECTED");
  assert.equal(clusters[0].reviewed_by, "admin-1");
  assert.equal((supabase._store["deepfake_reference_faces"] ?? []).length, 0);
});

test("rejecting an already-reviewed cluster throws", async () => {
  const supabase = createMockSupabase({
    face_identity_candidate_clusters: [
      {
        id: "cluster-1",
        user_id: "user-1",
        representative_tile_id: "tile-1",
        tile_count: 1,
        status: "REJECTED",
      },
    ],
  });
  await assert.rejects(() =>
    rejectIdentityCandidateClusterCore(supabase, {
      adminUserId: "admin-1",
      targetUserId: "user-1",
      clusterId: "cluster-1",
    }),
  );
});

test("revocation: marks revoked_at/revoked_by without deleting the row (audit history preserved)", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "ref-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "ref-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyRevoked, false);
  const refs = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refs.length, 1, "the row is never deleted");
  assert.ok(refs[0].revoked_at);
  assert.equal(refs[0].revoked_by, "admin-1");
});

test("revocation is idempotent: revoking an already-revoked reference is a safe no-op", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "ref-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: "2026-08-01T00:00:00.000Z",
        revoked_by: "admin-0",
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "ref-1",
  });

  assert.equal(result.alreadyRevoked, true);
  const refs = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refs[0].revoked_by, "admin-0", "original revocation is not overwritten");
});

test("revocation refuses to touch a non-admin-confirmed tier (e.g. a screenshot-derived or canonical reference)", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      { id: "ref-1", profile_id: "dtp-1", reference_tier: "SCREENSHOT_DERIVED_REFERENCE" },
    ],
  });
  await assert.rejects(() =>
    revokeAdminConfirmedAnchorCore(supabase, { adminUserId: "admin-1", referenceFaceId: "ref-1" }),
  );
});

// ---------------------------------------------------------------------------
// Revocation cascade — a SCREENSHOT_DERIVED_REFERENCE auto-matched against an
// ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE anchor must stop being trusted
// when that anchor is revoked; an admin who confirmed the wrong person needs
// everything matched against that mistake to stop being trusted too.
// ---------------------------------------------------------------------------

test("revocation cascade 1: confirmed anchor -> derived reference -> revoke anchor -> derived reference becomes inactive", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
      {
        id: "derived-1",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-1",
        revoked_at: null,
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  assert.equal(result.cascadedCount, 1);
  const derived = supabase._store["deepfake_reference_faces"].find((r) => r.id === "derived-1")!;
  assert.ok(derived.revoked_at, "the derived reference must become inactive too");
  assert.equal(derived.revoked_by, "admin-1");
  assert.equal(derived.revoked_reason, "CASCADED_ANCHOR_REVOKED");
  assert.equal(derived.revoked_cascade_root_id, "anchor-1");

  // Prevented from being used as a trusted matching reference going forward.
  const { getTrustedFaceAnchorsForUser } = await import("./trusted-face-anchors.server");
  const supabaseWithProfile = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1" }],
    deepfake_reference_faces: supabase._store["deepfake_reference_faces"],
  });
  const anchors = await getTrustedFaceAnchorsForUser(supabaseWithProfile, "user-1");
  assert.equal(
    anchors.anchors.length,
    0,
    "both the anchor and its cascaded derivative are excluded",
  );
});

test("revocation cascade transitively follows a multi-hop chain (derived reference that itself became an anchor for a further match)", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
      {
        id: "derived-1",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-1",
        revoked_at: null,
      },
      {
        id: "derived-2",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "derived-1",
        revoked_at: null,
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  assert.equal(result.cascadedCount, 2, "both derived-1 and the second-hop derived-2 must cascade");
  const derived1 = supabase._store["deepfake_reference_faces"].find((r) => r.id === "derived-1")!;
  const derived2 = supabase._store["deepfake_reference_faces"].find((r) => r.id === "derived-2")!;
  assert.ok(derived1.revoked_at);
  assert.ok(derived2.revoked_at);
  // revoked_cascade_root_id always points at the original anchor an admin
  // actually acted on, even for a second-hop row whose direct parent was
  // derived-1, not the anchor itself.
  assert.equal(derived1.revoked_cascade_root_id, "anchor-1");
  assert.equal(derived2.revoked_cascade_root_id, "anchor-1");
});

test("revocation cascade 2: historical evidence remains intact — nothing is deleted, provenance is preserved", async () => {
  const supabase = createMockSupabase({
    face_identity_candidate_clusters: [
      {
        id: "cluster-1",
        user_id: "user-1",
        status: "CONFIRMED",
        confirmed_reference_id: "anchor-1",
      },
    ],
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        source_asset_id: "asset-1",
        source_tile_id: "tile-1",
        revoked_at: null,
      },
      {
        id: "derived-1",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-1",
        source_asset_id: "asset-2",
        source_tile_id: "tile-2",
        revoked_at: null,
      },
    ],
  });

  await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  const refs = supabase._store["deepfake_reference_faces"];
  assert.equal(refs.length, 2, "no row is ever deleted");
  const anchor = refs.find((r) => r.id === "anchor-1")!;
  const derived = refs.find((r) => r.id === "derived-1")!;
  assert.equal(anchor.source_asset_id, "asset-1", "the anchor's own provenance is untouched");
  assert.equal(derived.source_asset_id, "asset-2", "the derived row's provenance is untouched");
  assert.equal(
    derived.derived_from_reference_id,
    "anchor-1",
    "the dependency edge itself is preserved",
  );

  const cluster = supabase._store["face_identity_candidate_clusters"][0];
  assert.equal(
    cluster.status,
    "CONFIRMED",
    "the original confirm decision's audit record is untouched",
  );
  assert.equal(cluster.confirmed_reference_id, "anchor-1");
});

test("revocation cascade 3 / cross-user isolation: a reference derived from a DIFFERENT anchor (different customer) is never touched", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
      {
        id: "derived-1",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-1",
        revoked_at: null,
      },
      // A completely different customer's own admin-confirmed anchor and its own derived match.
      {
        id: "anchor-2",
        profile_id: "dtp-2",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
      {
        id: "unrelated-derived",
        profile_id: "dtp-2",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-2",
        revoked_at: null,
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  assert.equal(result.cascadedCount, 1, "only anchor-1's own derived reference cascades");
  const unrelated = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === "unrelated-derived",
  )!;
  const otherAnchor = supabase._store["deepfake_reference_faces"].find((r) => r.id === "anchor-2")!;
  assert.equal(
    unrelated.revoked_at,
    null,
    "a different customer's independently-matched reference stays active",
  );
  assert.equal(otherAnchor.revoked_at, null, "a different customer's anchor is never touched");
});

test("revocation cascade 4: repeated revocation creates no duplicate state", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
      {
        id: "derived-1",
        profile_id: "dtp-1",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        derived_from_reference_id: "anchor-1",
        revoked_at: null,
      },
    ],
  });

  const first = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });
  assert.equal(first.cascadedCount, 1);
  const derivedAfterFirst = {
    ...supabase._store["deepfake_reference_faces"].find((r) => r.id === "derived-1"),
  };

  const second = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });
  assert.equal(second.alreadyRevoked, true);
  assert.equal(
    second.cascadedCount,
    0,
    "re-revoking the already-revoked anchor does no further cascade work",
  );

  const derivedAfterSecond = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === "derived-1",
  );
  assert.deepEqual(
    derivedAfterSecond,
    derivedAfterFirst,
    "the cascaded row's revocation record is not re-stamped",
  );
  assert.equal(
    supabase._store["deepfake_reference_faces"].length,
    2,
    "still no rows deleted or duplicated",
  );
});

// ---------------------------------------------------------------------------
// Face Protection activation bridge (Lena's flow) — confirming a cluster
// also activates Face Protection from the SAME confirmed image, without any
// second face capture, and revocation deactivates it again.
// ---------------------------------------------------------------------------

test("confirming a cluster also activates Face Protection from the same confirmed image — no second face capture is ever requested", async () => {
  const supabase = createMockSupabase(baseFixture());
  const promoteCallLog: unknown[] = [];
  const activateCallLog: unknown[] = [];
  const deps: ClusterActionDeps = {
    ...fakeDeps(promoteCallLog),
    activateFaceProtection: async (_supabaseAdmin, input) => {
      activateCallLog.push(input);
      return { activated: true };
    },
  };

  const result = await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: "admin-1", targetUserId: "user-1", clusterId: "cluster-1" },
    deps,
  );

  assert.equal(activateCallLog.length, 1, "Face Protection activation runs exactly once");
  const call = activateCallLog[0] as {
    userId: string;
    tileBytes: Uint8Array;
    tileStorageKey: string;
    referenceFaceId: string;
  };
  assert.equal(call.userId, "user-1");
  assert.ok(
    call.tileBytes,
    "reuses the same tile bytes already downloaded for the reference — no new capture",
  );
  assert.equal(
    call.tileStorageKey,
    "clients/user-1/reference/candidate/asset-1/0.jpg",
    "reuses the exact same confirmed representative tile, never a second image",
  );
  assert.equal(
    call.referenceFaceId,
    result.referenceId,
    "linked to the same reference just created — no second identity established",
  );
  assert.equal(promoteCallLog.length, 1, "no second reference/capture flow ran");
});

test("Face Protection activation failure never blocks or reverts the confirmation itself", async () => {
  const supabase = createMockSupabase(baseFixture());
  const promoteCallLog: unknown[] = [];
  const deps: ClusterActionDeps = {
    ...fakeDeps(promoteCallLog),
    activateFaceProtection: async () => {
      throw new Error("AWS IndexFaces unavailable");
    },
  };

  const result = await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: "admin-1", targetUserId: "user-1", clusterId: "cluster-1" },
    deps,
  );

  assert.equal(result.ok, true);
  assert.equal(
    (supabase._store["deepfake_reference_faces"] ?? []).length,
    1,
    "the reference is still created",
  );
  const cluster = supabase._store["face_identity_candidate_clusters"][0];
  assert.equal(
    cluster.status,
    "CONFIRMED",
    "the confirmation itself is unaffected by an activation failure",
  );
});

test("revoking an admin-confirmed anchor deactivates its linked Face Protection reference and reverts the profile status — never touches a genuinely liveness-verified profile", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
    ],
    protected_faces: [
      {
        id: "pf-1",
        user_id: "user-1",
        face_id: "aws-face-1",
        collection_id: "eterna_user1",
        status: "ACTIVE",
        linked_reference_face_id: "anchor-1",
      },
    ],
    protected_face_profiles: [
      {
        user_id: "user-1",
        status: "FACE_VERIFIED_VIA_PROTECTED_ASSET",
        collection_id: "eterna_user1",
      },
    ],
  });

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  assert.equal(result.ok, true);
  const face = supabase._store["protected_faces"].find((f) => f.id === "pf-1")!;
  assert.equal(face.status, "INACTIVE", "the linked Face Protection reference is deactivated");
  assert.equal(supabase._store["protected_faces"].length, 1, "the row is never deleted");

  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "user-1")!;
  assert.equal(
    profile.status,
    "DEFERRED",
    "Face Protection's own status reverts — it is no longer genuinely active",
  );
});

test("revocation never downgrades a profile that reached FACE_VERIFIED through genuine liveness, even if a linked_reference_face_id row somehow exists", async () => {
  const supabase = createMockSupabase({
    deepfake_reference_faces: [
      {
        id: "anchor-1",
        profile_id: "dtp-1",
        reference_tier: "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE",
        revoked_at: null,
      },
    ],
    protected_faces: [
      {
        id: "pf-1",
        user_id: "user-1",
        face_id: "aws-face-1",
        collection_id: "eterna_user1",
        status: "ACTIVE",
        linked_reference_face_id: "anchor-1",
      },
    ],
    // A genuinely liveness-verified profile must never be reverted by this path.
    protected_face_profiles: [
      { user_id: "user-1", status: "FACE_VERIFIED", collection_id: "eterna_user1" },
    ],
  });

  await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: "admin-1",
    referenceFaceId: "anchor-1",
  });

  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "user-1")!;
  assert.equal(profile.status, "FACE_VERIFIED", "a genuine liveness verification is never touched");
});
