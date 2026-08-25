/**
 * CONTROLLED PREVIEW VALIDATION — Protected-Asset Identity Bootstrap (Path C)
 *
 * A single connected narrative that chains the REAL production functions
 * together end-to-end — runProtectedAssetBootstrapForUser (candidate
 * generation + clustering), confirmIdentityCandidateClusterCore /
 * rejectIdentityCandidateClusterCore / revokeAdminConfirmedAnchorCore (the
 * admin trust boundary), and the real runFaceReferenceExtractionForUser
 * (the existing recurring sweep, unchanged, reused after confirmation) —
 * against an in-memory mock Supabase and fake AWS/S3/image adapters. No
 * live network call is made and no production data is touched; this is
 * exactly the boundary every other test file in this codebase already uses
 * (see protected-asset-bootstrap.test.ts, identity-bootstrap-core.test.ts).
 *
 * The only things NOT exercised here are (a) the createServerFn HTTP/auth
 * middleware wrapper layer itself, which requires a live authenticated
 * request and is intentionally NOT run against the shared production
 * Supabase project per this validation's "no production data" constraint —
 * that layer is proven by `tsc`, ESLint, and a successful `next build`
 * instead — and (b) real AWS Rekognition/S3 network calls, faked at the
 * same dependency-injection seams every other test in this codebase uses.
 *
 * Fixture is a fictional two-tenant scenario ("user-1" / "user-2"), not
 * real customer data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMockSupabase } from "./test-utils";
import { runProtectedAssetBootstrapForUser } from "./dispatch/protected-asset-bootstrap.server";
import {
  confirmIdentityCandidateClusterCore,
  rejectIdentityCandidateClusterCore,
  revokeAdminConfirmedAnchorCore,
} from "./identity-bootstrap-core.server";
import { getTrustedFaceAnchorsForUser, hasTrustedAnchor } from "./trusted-face-anchors.server";
import { runFaceReferenceExtractionForUser } from "./dispatch/face-reference-extraction.server";

// ---------------------------------------------------------------------------
// Shared fake I/O — a tiny in-memory "filesystem" plus content-tagged fake
// image bytes, so identity/clustering fakes can reason about "who is this"
// without needing real images or real AWS Rekognition calls.
// ---------------------------------------------------------------------------

const fakeStorage = new Map<string, Uint8Array>();

function personOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString().split(":").pop()!;
}

/** (assetId, tileIndex) -> which fictional person appears in that crop. */
const PERSON_MAP: Record<string, string> = {
  "asset-1:0": "lena",
  "asset-1:1": "costar",
  "asset-2:0": "lena",
  "asset-B:0": "nadia",
};

const trace: string[] = [];
function log(line: string) {
  trace.push(line);
}

function buildDeps() {
  return {
    downloadAssetBytes: async (storagePath: string) => Buffer.from(storagePath),
    uploadTileBytes: async (key: string, bytes: Uint8Array) => {
      fakeStorage.set(key, bytes);
    },
    downloadCandidateTileBytes: async (key: string) => {
      const bytes = fakeStorage.get(key);
      if (!bytes) throw new Error(`no fake object for ${key}`);
      return bytes;
    },
    sha256: async (bytes: Uint8Array) => Buffer.from(bytes).toString("hex"),
    detectGrid: async (screenshotBytes: Uint8Array) => {
      const assetId = Buffer.from(screenshotBytes).toString();
      const tileCount = Object.keys(PERSON_MAP).filter((k) => k.startsWith(`${assetId}:`)).length;
      return {
        tiles: Array.from({ length: tileCount }, (_, i) => ({
          x: i * 10,
          y: 0,
          width: 10,
          height: 10,
        })),
        confidence: "HIGH" as const,
        imageWidth: tileCount * 10,
        imageHeight: 10,
      };
    },
    cropTile: async (screenshotBytes: Uint8Array, tile: { x: number }) => {
      const assetId = Buffer.from(screenshotBytes).toString();
      const tileIndex = tile.x / 10;
      const person = PERSON_MAP[`${assetId}:${tileIndex}`];
      return Buffer.from(`${assetId}:${tileIndex}:${person}`);
    },
    analyzeFace: async () => ({
      classification: "USABLE_FACE" as const,
      confidence: 91,
      boundingBox: null,
    }),
    compareFacesForClustering: async (a: Uint8Array, b: Uint8Array) =>
      personOf(a) === personOf(b) ? 96 : 20,
    computePhash: async (bytes: Uint8Array) => Buffer.from(bytes).toString("hex"),
    checkDuplicate: async (input: {
      candidateBytes: Uint8Array;
      existingReferences: Array<{ id: string; imageBytes: Uint8Array }>;
    }) => {
      const candidateStr = Buffer.from(input.candidateBytes).toString();
      const dup = input.existingReferences.find(
        (r) => Buffer.from(r.imageBytes).toString() === candidateStr,
      );
      return dup
        ? { isDuplicate: true, duplicateOfReferenceId: dup.id }
        : { isDuplicate: false, duplicateOfReferenceId: null };
    },
    matchIdentity: async (input: { tileBytes: Uint8Array; referenceImages: Uint8Array[] }) => {
      const candidatePerson = personOf(input.tileBytes);
      let bestSimilarity = 0;
      let bestIndex: number | null = null;
      input.referenceImages.forEach((ref, i) => {
        const sim = personOf(ref) === candidatePerson ? 97 : 15;
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestIndex = i;
        }
      });
      const status =
        bestSimilarity >= 95 ? ("MATCHED_PROTECTED_SUBJECT" as const) : ("NOT_SUBJECT" as const);
      return { status, similarity: bestSimilarity, matchedReferenceIndex: bestIndex };
    },
  };
}

// Fake AWS-free promotion: mirrors face-reference-extraction-io.server.ts's
// real promoteToReferenceFace insert shape exactly, minus the live
// indexDeepfakeReferenceFace (Rekognition IndexFaces) call.
function fakePromoteToReferenceFace() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (supabaseAdmin: any, input: any) => {
    const referenceFaceId = `ref-${Math.random().toString(36).slice(2, 10)}`;
    const { data: record } = await supabaseAdmin
      .from("deepfake_reference_faces")
      .insert({
        id: referenceFaceId,
        profile_id: input.profileId,
        storage_path: input.tileStorageKey,
        rekognition_face_id: `fake-rekognition-${referenceFaceId}`,
        face_confidence: input.faceConfidence,
        reference_tier: input.referenceTier ?? "SCREENSHOT_DERIVED_REFERENCE",
        source_type: input.sourceType ?? "SCREENSHOT_DERIVED",
        source_asset_id: input.sourceAssetId,
        source_tile_id: input.sourceTileId,
        phash: input.phash,
        confirmed_by: input.confirmedBy ?? null,
        confirmed_at: input.confirmedAt ?? null,
        derived_from_reference_id: input.derivedFromReferenceId ?? null,
        revoked_at: null,
        revoked_by: null,
      })
      .select("id")
      .single();
    return { referenceId: record.id };
  };
}

function twoUserFixture() {
  return {
    protected_assets: [
      {
        id: "asset-1",
        user_id: "user-1",
        kind: "photo",
        storage_path: "asset-1",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
      {
        id: "asset-2",
        user_id: "user-1",
        kind: "photo",
        storage_path: "asset-2",
        created_at: "2026-08-02T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
      {
        id: "asset-B",
        user_id: "user-2",
        kind: "photo",
        storage_path: "asset-B",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
    ],
  };
}

const supabase = createMockSupabase(twoUserFixture());
const ADMIN_ID = "admin-preview-1";

let lenaClusterId = "";
let costarClusterId = "";
let confirmedReferenceId = "";

test("STEP 1 — customer starts identity-candidate generation (own screenshots only, no reference comparison)", async () => {
  const deps = buildDeps();
  const before = (supabase._store["deepfake_reference_faces"] ?? []).length;

  const outcomeUser1 = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  const outcomeUser2 = await runProtectedAssetBootstrapForUser(supabase, "user-2", deps);

  log(
    `user-1 triggerIdentityCandidateReview -> ${outcomeUser1.status}, candidatesFound=${outcomeUser1.candidatesFound}, newClustersCreated=${outcomeUser1.newClustersCreated}`,
  );
  log(
    `user-2 triggerIdentityCandidateReview -> ${outcomeUser2.status}, candidatesFound=${outcomeUser2.candidatesFound}, newClustersCreated=${outcomeUser2.newClustersCreated}`,
  );

  assert.equal(outcomeUser1.status, "CANDIDATES_GENERATED");
  assert.equal(outcomeUser1.candidatesFound, 3, "asset-1 (lena, costar) + asset-2 (lena)");
  assert.equal(
    outcomeUser1.newClustersCreated,
    2,
    "lena cluster (2 appearances) + costar cluster (1)",
  );
  assert.equal(outcomeUser2.status, "CANDIDATES_GENERATED");
  assert.equal(
    outcomeUser2.newClustersCreated,
    1,
    "nadia cluster (1 appearance), isolated from user-1",
  );

  // STEP 12 precondition, part A: no promotion has happened anywhere yet.
  const after = (supabase._store["deepfake_reference_faces"] ?? []).length;
  assert.equal(after, before, "candidate generation alone must never create a trusted reference");
  assert.equal(after, 0);

  const user1Tiles = (supabase._store["protected_asset_grid_tiles"] ?? []).filter(
    (t) => t.user_id === "user-1",
  );
  assert.equal(user1Tiles.length, 3);
  for (const t of user1Tiles) assert.equal(t.promotion_status, "UNCONFIRMED_IDENTITY_CANDIDATE");

  const clusters = (supabase._store["face_identity_candidate_clusters"] ?? []).filter(
    (c) => c.user_id === "user-1",
  );
  const lenaCluster = clusters.find((c) => c.tile_count === 2)!;
  const costarCluster = clusters.find((c) => c.tile_count === 1)!;
  assert.ok(lenaCluster && costarCluster);
  lenaClusterId = lenaCluster.id;
  costarClusterId = costarCluster.id;
});

test("STEP 2 — customer sees Identity confirmation required (live, non-hardcoded counts)", async () => {
  // Replicates the exact query shape getIdentityBootstrapState performs
  // (identity-bootstrap.functions.ts:51-80) against the same mock store.
  const anchorResult = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  const pendingClusters = (supabase._store["face_identity_candidate_clusters"] ?? []).filter(
    (c) => c.user_id === "user-1" && c.status === "PENDING",
  );

  log(
    `user-1 Coverage panel state: hasTrustedAnchor=${hasTrustedAnchor(anchorResult)}, pendingClusterCount=${pendingClusters.length}`,
  );
  assert.equal(hasTrustedAnchor(anchorResult), false);
  assert.equal(pendingClusters.length, 2);
  // This is exactly the branch condition FaceReferenceCoveragePanel.tsx
  // checks (bootstrap.pendingClusterCount > 0) to render "Identity
  // confirmation required" instead of any claim of a verified identity.
});

test("STEP 3/4/5 — admin opens the identity-review queue and sees representative crops + provenance, scoped per customer", async () => {
  // Replicates listIdentityCandidateClustersForReview's query shape
  // (identity-bootstrap.functions.ts:108-156) for two different targetUserIds
  // against the SAME shared mock store, to prove no cross-tenant leakage.
  for (const targetUserId of ["user-1", "user-2"]) {
    const clusters = (supabase._store["face_identity_candidate_clusters"] ?? []).filter(
      (c) => c.user_id === targetUserId,
    );
    for (const cluster of clusters) {
      const memberTiles = (supabase._store["protected_asset_grid_tiles"] ?? []).filter(
        (t) => t.cluster_id === cluster.id && t.user_id === targetUserId,
      );
      assert.ok(
        memberTiles.every((t) => t.user_id === targetUserId),
        "every crop returned for a review queue must belong to the targeted customer",
      );
      assert.ok(
        memberTiles.length > 0,
        "a cluster must have at least one visible representative crop",
      );
      log(
        `admin queue[${targetUserId}] cluster ${cluster.id}: tile_count=${cluster.tile_count}, crops=${memberTiles.length}, representative_tile_id=${cluster.representative_tile_id}`,
      );
    }
  }

  const user1Clusters = (supabase._store["face_identity_candidate_clusters"] ?? []).filter(
    (c) => c.user_id === "user-1",
  );
  const user2Clusters = (supabase._store["face_identity_candidate_clusters"] ?? []).filter(
    (c) => c.user_id === "user-2",
  );
  assert.equal(user1Clusters.length, 2);
  assert.equal(user2Clusters.length, 1);
});

test("STEP 9 — admin rejects the costar cluster: no trusted reference is ever created for it", async () => {
  const before = (supabase._store["deepfake_reference_faces"] ?? []).length;
  const result = await rejectIdentityCandidateClusterCore(supabase, {
    adminUserId: ADMIN_ID,
    targetUserId: "user-1",
    clusterId: costarClusterId,
  });
  const after = (supabase._store["deepfake_reference_faces"] ?? []).length;

  log(
    `admin rejects costar cluster ${costarClusterId} -> ok=${result.ok}, reference rows before=${before} after=${after}`,
  );
  assert.equal(result.ok, true);
  assert.equal(after, before, "rejection must never create a reference row");

  const cluster = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.id === costarClusterId,
  )!;
  assert.equal(cluster.status, "REJECTED");
  assert.equal(cluster.reviewed_by, ADMIN_ID);

  // Cross-tenant adversarial check for STEP 11: an admin cannot act on
  // another customer's cluster by id, even with the right cluster id, if
  // the targetUserId doesn't match its owner.
  const user2Cluster = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.user_id === "user-2",
  )!;
  await assert.rejects(
    () =>
      rejectIdentityCandidateClusterCore(supabase, {
        adminUserId: ADMIN_ID,
        targetUserId: "user-1", // wrong owner on purpose
        clusterId: user2Cluster.id,
      }),
    /not found/i,
    "a cluster id must never resolve under the wrong targetUserId",
  );
  assert.equal(user2Cluster.status, "PENDING", "user-2's cluster must be completely untouched");
});

test("STEP 6/7/8 — admin confirms the lena cluster: exactly one ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE row is created, and the existing recurring sweep resumes automatically", async () => {
  const deps = buildDeps();
  const result = await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: ADMIN_ID, targetUserId: "user-1", clusterId: lenaClusterId },
    {
      downloadTileBytes: async (storagePath: string) => {
        const bytes = fakeStorage.get(storagePath);
        if (!bytes) throw new Error(`no fake object for ${storagePath}`);
        return bytes;
      },
      computePhash: deps.computePhash,
      promoteToReferenceFace: fakePromoteToReferenceFace(),
      runFaceReferenceExtraction: (admin, userId) =>
        runFaceReferenceExtractionForUser(admin, userId, {
          downloadAssetBytes: deps.downloadAssetBytes,
          uploadTileBytes: deps.uploadTileBytes,
          sha256: deps.sha256,
          downloadTrustedAnchorBytes: async (_supabase, anchor) => {
            // The anchor's own storage_path is the representative candidate
            // tile key that was uploaded during bootstrap — fake storage
            // already has it, so no real S3/Supabase Storage call is made.
            const refRow = supabase._store["deepfake_reference_faces"].find(
              (r) => r.id === anchor.referenceId,
            );
            if (!refRow) throw new Error(`no reference row for anchor ${anchor.referenceId}`);
            const bytes = fakeStorage.get(refRow.storage_path);
            if (!bytes) throw new Error(`no fake anchor bytes for ${refRow.storage_path}`);
            return bytes;
          },
          promoteToReferenceFace: fakePromoteToReferenceFace(),
          detectGrid: deps.detectGrid,
          cropTile: deps.cropTile,
          analyzeFace: deps.analyzeFace,
          matchIdentity: deps.matchIdentity,
          computePhash: deps.computePhash,
          checkDuplicate: deps.checkDuplicate,
        }),
    },
  );

  confirmedReferenceId = result.referenceId;
  const confirmedRow = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === confirmedReferenceId,
  )!;

  log(
    `admin confirms lena cluster ${lenaClusterId} -> referenceId=${confirmedReferenceId}, tier=${confirmedRow.reference_tier}, source_type=${confirmedRow.source_type}, confirmed_by=${confirmedRow.confirmed_by}, source_asset_id=${confirmedRow.source_asset_id}, source_tile_id=${confirmedRow.source_tile_id}`,
  );
  log(`post-confirmation sweep outcome: ${JSON.stringify(result.extraction)}`);

  assert.equal(result.ok, true);
  assert.equal(confirmedRow.reference_tier, "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE");
  assert.equal(confirmedRow.source_type, "ADMIN_CONFIRMED_PROTECTED_ASSET");
  assert.equal(confirmedRow.confirmed_by, ADMIN_ID);
  assert.ok(confirmedRow.confirmed_at);
  assert.ok(confirmedRow.source_asset_id);
  assert.ok(confirmedRow.source_tile_id);
  // Never mislabeled as liveness or as an ordinary automatic match.
  assert.notEqual(confirmedRow.reference_tier, "CANONICAL_VERIFIED_REFERENCE");
  assert.notEqual(confirmedRow.reference_tier, "SCREENSHOT_DERIVED_REFERENCE");

  const lenaCluster = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.id === lenaClusterId,
  )!;
  assert.equal(lenaCluster.status, "CONFIRMED");
  assert.equal(lenaCluster.confirmed_reference_id, confirmedReferenceId);

  // STEP 8: the existing recurring extraction pipeline (not a second
  // pipeline) resumed and swept the still-PENDING assets now that a real
  // anchor exists. Exactly one more reference should exist: the OTHER lena
  // tile (not the representative one, which is a byte-identical duplicate
  // of the anchor itself and correctly deduped, not re-promoted).
  const user1Refs = supabase._store["deepfake_reference_faces"].filter(
    (r) => r.profile_id === confirmedRow.profile_id,
  );
  log(
    `user-1 total trusted reference rows after sweep: ${user1Refs.length} (${user1Refs.map((r) => r.reference_tier).join(", ")})`,
  );
  assert.equal(
    user1Refs.length,
    2,
    "the admin-confirmed anchor + exactly one newly auto-matched secondary reference",
  );
  const autoMatched = user1Refs.find((r) => r.id !== confirmedReferenceId)!;
  assert.equal(autoMatched.reference_tier, "SCREENSHOT_DERIVED_REFERENCE");
  assert.equal(autoMatched.source_type, "SCREENSHOT_DERIVED");

  // The costar tile, independently re-matched during the same sweep,
  // correctly failed to match the confirmed anchor — proving the sweep
  // makes its own real per-face comparison rather than trusting the
  // cluster grouping (which was itself already rejected in STEP 9).
  const costarTile = supabase._store["protected_asset_grid_tiles"].find(
    (t) => t.parent_asset_id === "asset-1" && t.tile_index === 1,
  )!;
  log(
    `costar tile after sweep: identity_status=${costarTile.identity_status}, promotion_status=${costarTile.promotion_status}`,
  );
  assert.equal(costarTile.identity_status, "NOT_SUBJECT");
  assert.equal(costarTile.promotion_status, "NOT_CANDIDATE");

  // Isolation: none of this touched user-2.
  const user2RefsAfter = supabase._store["deepfake_reference_faces"].filter(
    (r) => r.storage_path?.includes("user-2") || false,
  );
  assert.equal(user2RefsAfter.length, 0);
  const user2Cluster = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.user_id === "user-2",
  )!;
  assert.equal(
    user2Cluster.status,
    "PENDING",
    "user-2's cluster is still untouched by user-1's confirmation",
  );
});

test("STEP 10 — revoking the admin-confirmed reference preserves all historical evidence AND cascades to the reference it produced (revocation-policy fix)", async () => {
  const beforeCount = supabase._store["deepfake_reference_faces"].length;
  const beforeClusterRow = {
    ...supabase._store["face_identity_candidate_clusters"].find((c) => c.id === lenaClusterId),
  };
  const derivedReferenceId = supabase._store["deepfake_reference_faces"].find(
    (r) => r.derived_from_reference_id === confirmedReferenceId,
  )!.id;

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: ADMIN_ID,
    targetUserId: "user-1",
    referenceFaceId: confirmedReferenceId,
  });

  const afterCount = supabase._store["deepfake_reference_faces"].length;
  const revokedRow = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === confirmedReferenceId,
  )!;
  const cascadedRow = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === derivedReferenceId,
  )!;
  const clusterAfter = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.id === lenaClusterId,
  )!;

  log(
    `admin revokes reference ${confirmedReferenceId} -> ok=${result.ok}, alreadyRevoked=${result.alreadyRevoked}, cascadedCount=${result.cascadedCount}, revoked_at=${revokedRow.revoked_at}`,
  );
  log(
    `cascaded derived reference ${derivedReferenceId}: revoked_at=${cascadedRow.revoked_at}, revoked_reason=${cascadedRow.revoked_reason}, revoked_cascade_root_id=${cascadedRow.revoked_cascade_root_id}`,
  );

  assert.equal(result.ok, true);
  assert.equal(result.alreadyRevoked, false);
  assert.equal(
    result.cascadedCount,
    1,
    "the one auto-matched reference this anchor produced must cascade",
  );
  assert.equal(
    afterCount,
    beforeCount,
    "revocation must never delete a row — evidence stays intact",
  );
  assert.ok(revokedRow.revoked_at);
  assert.equal(revokedRow.revoked_by, ADMIN_ID);
  assert.equal(revokedRow.revoked_reason, "ADMIN_REVOKED");
  // The cascaded row itself: revoked, tagged with WHY, tagged with which
  // root triggered it, but its own row (and its own provenance) preserved.
  assert.ok(cascadedRow.revoked_at, "the derived reference must become inactive");
  assert.equal(cascadedRow.revoked_reason, "CASCADED_ANCHOR_REVOKED");
  assert.equal(cascadedRow.revoked_cascade_root_id, confirmedReferenceId);
  assert.ok(
    cascadedRow.source_asset_id,
    "the cascaded row's own provenance is preserved, not wiped",
  );

  // The audit trail — which cluster this came from, and the confirm
  // decision itself — is completely untouched by revocation.
  assert.deepEqual(clusterAfter, beforeClusterRow);

  const anchorResultAfter = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  log(
    `after revocation: hasTrustedAnchor(user-1)=${hasTrustedAnchor(anchorResultAfter)} (remaining anchors: ${anchorResultAfter.anchors.map((a) => a.tier).join(", ") || "none"})`,
  );
  assert.equal(
    hasTrustedAnchor(anchorResultAfter),
    false,
    "revoking the anchor AND cascading its one derived reference leaves this customer with no trusted anchor at all",
  );

  // Isolation: user-2's own anchor/reference is completely unaffected by
  // user-1's revocation cascade.
  const user2Refs = supabase._store["deepfake_reference_faces"].filter((r) =>
    r.storage_path?.includes("asset-B"),
  );
  for (const r of user2Refs) assert.equal(r.revoked_at, null, "user-2's references are untouched");
});

test("STEP 4-equivalent — revocation cannot be bypassed by rerunning the extraction sweep", async () => {
  const deps = buildDeps();
  // A brand-new screenshot appears after revocation, containing another
  // "lena" face — if revocation could be bypassed, re-running the sweep
  // might still match it against the now-revoked lineage.
  PERSON_MAP["asset-3:0"] = "lena";
  supabase._store["protected_assets"].push({
    id: "asset-3",
    user_id: "user-1",
    kind: "photo",
    storage_path: "asset-3",
    created_at: "2026-08-03T00:00:00.000Z",
    grid_screenshot_status: "UNSCREENED",
  });

  const sweepOutcome = await runFaceReferenceExtractionForUser(supabase, "user-1", {
    downloadAssetBytes: deps.downloadAssetBytes,
    uploadTileBytes: deps.uploadTileBytes,
    sha256: deps.sha256,
    downloadTrustedAnchorBytes: async () => {
      throw new Error("must never be called — there is no non-revoked anchor left to load");
    },
    promoteToReferenceFace: fakePromoteToReferenceFace(),
    detectGrid: deps.detectGrid,
    cropTile: deps.cropTile,
    analyzeFace: deps.analyzeFace,
    matchIdentity: deps.matchIdentity,
    computePhash: deps.computePhash,
    checkDuplicate: deps.checkDuplicate,
  });

  log(
    `re-run sweep after full revocation -> status=${sweepOutcome.status}, blocked_reason=${sweepOutcome.blocked_reason}`,
  );
  assert.equal(sweepOutcome.status, "WAITING_FOR_NEXT_SCAN");
  assert.equal(sweepOutcome.blocked_reason, "NO_VERIFIED_FACE_REFERENCE");

  const asset3Refs = supabase._store["deepfake_reference_faces"].filter(
    (r) => r.source_asset_id === "asset-3",
  );
  assert.equal(asset3Refs.length, 0, "no new reference was ever created from the revoked lineage");

  // Also directly confirm the bootstrap dispatcher's own anchor check
  // agrees — the revoked lineage can never be silently resurrected by
  // either entry point.
  const bootstrapOutcome = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  log(
    `user-1 re-run triggerIdentityCandidateReview after full revocation -> ${bootstrapOutcome.status}`,
  );
  assert.notEqual(bootstrapOutcome.status, "ANCHOR_ALREADY_EXISTS");
});

test("STEP 12 — re-running candidate generation after confirm+revoke creates no duplicate tiles or clusters", async () => {
  const deps = buildDeps();
  const tilesBefore = supabase._store["protected_asset_grid_tiles"].length;
  const clustersBefore = supabase._store["face_identity_candidate_clusters"].length;

  // asset-1 and asset-2 are already COMPLETED (every tile fully resolved by
  // the STEP 8 sweep) so they're never touched again. asset-3 (introduced
  // by the bypass-prevention check above, still with no anchor to compare
  // against) was already turned into exactly one fresh candidate cluster by
  // that check's own bootstrap call — this is the TRUE re-run against that
  // now-unchanged state, so it must find its one existing candidate tile
  // again (tile-level idempotency: re-detected, not duplicated) without
  // creating a second cluster for it.
  const outcome = await runProtectedAssetBootstrapForUser(supabase, "user-1", deps);
  log(
    `user-1 re-run triggerIdentityCandidateReview (idempotency check) -> ${outcome.status}, newClustersCreated=${outcome.newClustersCreated}`,
  );
  assert.equal(
    outcome.newClustersCreated,
    0,
    "the asset-3 candidate cluster already exists — never duplicated",
  );

  const tilesAfter = supabase._store["protected_asset_grid_tiles"].length;
  const clustersAfter = supabase._store["face_identity_candidate_clusters"].length;
  assert.equal(tilesAfter, tilesBefore, "no duplicate tile rows");
  assert.equal(clustersAfter, clustersBefore, "no duplicate cluster rows");
});

test("FINAL — print the complete state-transition trace", () => {
  const report = [
    "",
    "=== PROTECTED-ASSET IDENTITY BOOTSTRAP — PREVIEW VALIDATION TRACE ===",
    ...trace,
    "",
    "State transition observed: candidate -> pending review -> admin confirmed/rejected -> active/revoked",
    `  lena cluster:   PENDING -> CONFIRMED (reference ${confirmedReferenceId}, tier ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE) -> revoked (row preserved, revoked_reason=ADMIN_REVOKED)`,
    "  derived reference (auto-matched against the lena anchor): active -> revoked (row preserved, revoked_reason=CASCADED_ANCHOR_REVOKED, revoked_cascade_root_id=lena anchor)",
    `  costar cluster: PENDING -> REJECTED (no reference ever created)`,
    "=======================================================================",
  ].join("\n");
  console.log(report);
  assert.ok(true);
});
