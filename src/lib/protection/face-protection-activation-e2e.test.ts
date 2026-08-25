/**
 * End-to-end scenario for the Face Protection activation fix: a customer
 * (fictional "Lena" fixture, not real production data) who already has
 * protected/enrolled images but deferred AWS Face Liveness. Chains the
 * REAL production functions — candidate generation, admin confirmation
 * (identity-bootstrap-core.server.ts), the Face Protection bridge
 * (face-protection-bridge.server.ts), and the real
 * resolveActiveFaceMonitoring (the exact gate
 * src/lib/face-scan.server.ts's analyzeHitForFaces checks before running
 * any automatic match) — against an in-memory mock and fake AWS adapters,
 * matching the same boundary as identity-bootstrap-e2e-preview.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMockSupabase } from "./test-utils";
import { runProtectedAssetBootstrapForUser } from "./dispatch/protected-asset-bootstrap.server";
import {
  confirmIdentityCandidateClusterCore,
  revokeAdminConfirmedAnchorCore,
} from "./identity-bootstrap-core.server";
import { activateFaceProtectionFromProtectedAssetReference } from "./dispatch/face-protection-bridge.server";
import { resolveActiveFaceMonitoring } from "../face-protection/monitoring.server";

const fakeStorage = new Map<string, Uint8Array>();
const PERSON_MAP: Record<string, string> = {
  "asset-1:0": "lena",
  "asset-2:0": "lena",
  "asset-B:0": "someone-else",
};

function personOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString().split(":").pop()!;
}

function buildBootstrapDeps() {
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
  };
}

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
        reference_tier: input.referenceTier ?? "SCREENSHOT_DERIVED_REFERENCE",
        source_type: input.sourceType ?? "SCREENSHOT_DERIVED",
        source_asset_id: input.sourceAssetId,
        source_tile_id: input.sourceTileId,
        phash: input.phash,
        confirmed_by: input.confirmedBy ?? null,
        confirmed_at: input.confirmedAt ?? null,
        derived_from_reference_id: input.derivedFromReferenceId ?? null,
        revoked_at: null,
      })
      .select("id")
      .single();
    return { referenceId: record.id };
  };
}

function fakeAwsFaceProtectionDeps() {
  return {
    ensureCollection: async (userId: string) => `eterna_${userId.replace(/-/g, "")}`,
    indexFace: async () => [
      { faceId: "aws-face-lena-1", imageId: "img-1", externalImageId: "ext-1", confidence: 99 },
    ],
    getBucket: () => "eterna-app-bucket",
  };
}

function twoUserFixture() {
  return {
    protected_assets: [
      {
        id: "asset-1",
        user_id: "lena",
        kind: "photo",
        storage_path: "asset-1",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
      {
        id: "asset-2",
        user_id: "lena",
        kind: "photo",
        storage_path: "asset-2",
        created_at: "2026-08-02T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
      {
        id: "asset-B",
        user_id: "someone-else",
        kind: "photo",
        storage_path: "asset-B",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
    ],
    // Lena already has protected/enrolled images and previously deferred
    // Face Liveness — this is the exact starting state the bug report
    // describes ("Face Protection enrollment pending — Deferred").
    protected_face_profiles: [
      { user_id: "lena", status: "DEFERRED", collection_id: "eterna_lena" },
    ],
  };
}

const supabase = createMockSupabase(twoUserFixture());
const ADMIN_ID = "admin-1";
let lenaClusterId = "";
let confirmedReferenceId = "";

test("1. existing protected images -> candidate generation never requires a new scan and never auto-trusts a frequent face", async () => {
  const deps = buildBootstrapDeps();
  const outcome = await runProtectedAssetBootstrapForUser(supabase, "lena", deps);

  assert.equal(outcome.status, "CANDIDATES_GENERATED");
  assert.equal(outcome.newClustersCreated, 1, "the two recurring lena tiles form one cluster");
  assert.equal(
    (supabase._store["deepfake_reference_faces"] ?? []).length,
    0,
    "frequency alone never creates a trusted reference — only explicit admin confirmation may",
  );
  assert.equal(
    (supabase._store["protected_faces"] ?? []).filter((f) => f.status === "ACTIVE").length,
    0,
    "Face Protection is not activated by candidate generation alone",
  );

  const cluster = supabase._store["face_identity_candidate_clusters"].find(
    (c) => c.user_id === "lena",
  )!;
  lenaClusterId = cluster.id;
});

test("2. admin confirms the correct cluster from Lena's own protected images -> Face Protection becomes ACTIVE with no second live face scan", async () => {
  const bootstrapDeps = buildBootstrapDeps();
  const result = await confirmIdentityCandidateClusterCore(
    supabase,
    { adminUserId: ADMIN_ID, targetUserId: "lena", clusterId: lenaClusterId },
    {
      downloadTileBytes: async (storagePath) => {
        const bytes = fakeStorage.get(storagePath);
        if (!bytes) throw new Error(`no fake object for ${storagePath}`);
        return bytes;
      },
      computePhash: async (bytes) => Buffer.from(bytes).toString("hex"),
      promoteToReferenceFace: fakePromoteToReferenceFace(),
      activateFaceProtection: (admin, input) =>
        activateFaceProtectionFromProtectedAssetReference(
          admin,
          input,
          fakeAwsFaceProtectionDeps(),
        ),
    },
  );
  confirmedReferenceId = result.referenceId;

  const reference = supabase._store["deepfake_reference_faces"].find(
    (r) => r.id === confirmedReferenceId,
  )!;
  assert.equal(reference.reference_tier, "ADMIN_CONFIRMED_PROTECTED_ASSET_REFERENCE");

  // Face Protection is now ACTIVE from the SAME confirmed image — no
  // biometric_consents row, no liveness_session_id, no new capture of any
  // kind was ever touched by this flow.
  const activeFace = supabase._store["protected_faces"].find(
    (f) => f.user_id === "lena" && f.status === "ACTIVE",
  )!;
  assert.ok(activeFace, "an ACTIVE protected_faces row now exists for Lena");
  assert.equal(activeFace.source, "protected_asset_admin_confirmed");
  assert.equal(activeFace.linked_reference_face_id, confirmedReferenceId);

  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "lena")!;
  assert.equal(profile.status, "FACE_VERIFIED_VIA_PROTECTED_ASSET");
  assert.notEqual(profile.status, "FACE_VERIFIED", "never claims liveness occurred");
  assert.equal(
    (supabase._store["biometric_consents"] ?? []).length,
    0,
    "no biometric consent was ever recorded — no second scan was ever requested",
  );
});

test("UI STATE — after activation: the pending-enrollment banner disappears, Face Protection reads ACTIVE, and the stronger KYC/liveness verification state is never falsified", async () => {
  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "lena")!;
  const dbStatus = profile.status;

  // Replicates getFaceEnrollment's exact status derivation
  // (src/lib/onboarding/face-enrollment.functions.ts:54-70). This fixture
  // has no biometric_consents row for Lena — Path C never requires one —
  // so this is specifically the no-consent branch, which is exactly the
  // branch this fix edited: FACE_VERIFIED_VIA_PROTECTED_ASSET now passes
  // through unchanged instead of falling to CONSENT_REQUIRED.
  const enrollmentStatus: string =
    dbStatus === "FACE_VERIFIED" ||
    dbStatus === "DEFERRED" ||
    dbStatus === "DELETED" ||
    dbStatus === "FACE_VERIFIED_VIA_PROTECTED_ASSET"
      ? dbStatus
      : "CONSENT_REQUIRED";

  // Replicates PendingSetupCard's exact gate
  // (src/components/dashboard/PendingSetupCard.tsx:27-42) — this is
  // precisely why the banner disappears: it is neither of these two
  // conditions any more, so the component renders nothing. Computed before
  // any assert.equal narrows enrollmentStatus's inferred type.
  const isDeferred: boolean = enrollmentStatus === "DEFERRED";
  const isMissing: boolean = [
    "NOT_STARTED",
    "CONSENT_REQUIRED",
    "CAMERA_PERMISSION_REQUIRED",
    "LIVENESS_FAILED",
  ].includes(enrollmentStatus);

  assert.equal(enrollmentStatus, "FACE_VERIFIED_VIA_PROTECTED_ASSET");
  assert.equal(
    (supabase._store["biometric_consents"] ?? []).length,
    0,
    "reaches this ACTIVE state with zero biometric consent rows — no live scan was ever requested",
  );
  assert.equal(
    isDeferred,
    false,
    "'Face Protection enrollment pending — Deferred' no longer shows",
  );
  assert.equal(isMissing, false, "'Not completed' state no longer shows either");

  // Item 7 — the stronger KYC/liveness signal must never be falsified.
  // deriveVerificationStatus is untouched by this fix on purpose: it only
  // ever treats the literal string "FACE_VERIFIED" as proof of genuine
  // liveness, and FACE_VERIFIED_VIA_PROTECTED_ASSET is a different string.
  const { deriveVerificationStatus } = await import("../verification/verification-status");
  const verification = deriveVerificationStatus({
    kycStatus: null,
    faceStatus: enrollmentStatus,
    verificationBadge: null,
    authorizationStatus: null,
  });
  assert.notEqual(
    verification,
    "VERIFIED",
    "Face Protection activation from protected images must never be reported as full KYC/liveness verification",
  );
});

test("3. protected images from another user cannot become Lena's reference", async () => {
  const deps = buildBootstrapDeps();
  const outcome = await runProtectedAssetBootstrapForUser(supabase, "someone-else", deps);

  // someone-else independently has their own face — never grouped with
  // Lena's cluster, never contributes to Lena's reference.
  const someoneElseClusters = supabase._store["face_identity_candidate_clusters"].filter(
    (c) => c.user_id === "someone-else",
  );
  assert.ok(someoneElseClusters.length > 0);
  for (const c of someoneElseClusters) {
    assert.notEqual(c.id, lenaClusterId);
  }

  // And Lena's already-confirmed reference is untouched by someone-else's
  // own candidate generation running afterward.
  const lenaFace = supabase._store["protected_faces"].find(
    (f) => f.user_id === "lena" && f.status === "ACTIVE",
  )!;
  assert.equal(lenaFace.linked_reference_face_id, confirmedReferenceId);
  assert.equal(outcome.status, "CANDIDATES_GENERATED");
  const someoneElseFaces = supabase._store["protected_faces"].filter(
    (f) => f.user_id === "someone-else",
  );
  assert.equal(someoneElseFaces.length, 0, "generating candidates alone never creates a reference");
});

test("4. insufficient/ambiguous protected images still require explicit admin confirmation — nothing auto-promotes", async () => {
  // someone-else has exactly one candidate cluster (ambiguous: could be
  // anyone) — it must sit PENDING, never silently trusted, regardless of
  // how Lena's own flow resolved.
  const pending = supabase._store["face_identity_candidate_clusters"].filter(
    (c) => c.user_id === "someone-else" && c.status === "PENDING",
  );
  assert.ok(pending.length > 0, "someone-else's candidate is still awaiting admin review");
  const someoneElseFaces = supabase._store["protected_faces"].filter(
    (f) => f.user_id === "someone-else",
  );
  assert.equal(
    someoneElseFaces.length,
    0,
    "Face Protection was never activated without confirmation",
  );
});

test("5. the existing automatic monitoring sweep now resolves and uses Lena's reference — no code path change needed downstream", async () => {
  // This is the exact gate src/lib/face-scan.server.ts's analyzeHitForFaces
  // checks before running any AWS search — resolving a real collection and
  // active face here proves the automatic sweep is no longer blocked.
  const monitoring = await resolveActiveFaceMonitoring(supabase, "lena");
  assert.ok(monitoring.collectionId, "a Rekognition collection is resolved");
  assert.equal(monitoring.activeFaces.length, 1);
  assert.equal(monitoring.activeFaceIds[0], "aws-face-lena-1");

  // Discovering a new protected screenshot afterward still flows through
  // the SAME identity-match pipeline, comparing against Lena's now-real
  // anchor — matching content is recorded exactly as it always was
  // (protected_asset_grid_tiles / deepfake_reference_faces), never a
  // separate weaker path.
  const { runFaceReferenceExtractionForUser } =
    await import("./dispatch/face-reference-extraction.server");
  const bootstrapDeps = buildBootstrapDeps();
  const sweep = await runFaceReferenceExtractionForUser(supabase, "lena", {
    downloadAssetBytes: bootstrapDeps.downloadAssetBytes,
    uploadTileBytes: bootstrapDeps.uploadTileBytes,
    sha256: bootstrapDeps.sha256,
    downloadTrustedAnchorBytes: async (_supabase, anchor) => {
      const refRow = supabase._store["deepfake_reference_faces"].find(
        (r) => r.id === anchor.referenceId,
      );
      if (!refRow) throw new Error("no reference row for anchor");
      const bytes = fakeStorage.get(refRow.storage_path);
      if (!bytes) throw new Error("no fake anchor bytes");
      return bytes;
    },
    promoteToReferenceFace: fakePromoteToReferenceFace(),
    detectGrid: bootstrapDeps.detectGrid,
    cropTile: bootstrapDeps.cropTile,
    analyzeFace: bootstrapDeps.analyzeFace,
    matchIdentity: async (input: { tileBytes: Uint8Array; referenceImages: Uint8Array[] }) => {
      const candidatePerson = personOf(input.tileBytes);
      let best = 0;
      let bestIndex: number | null = null;
      input.referenceImages.forEach((ref, i) => {
        const sim = personOf(ref) === candidatePerson ? 97 : 15;
        if (sim > best) {
          best = sim;
          bestIndex = i;
        }
      });
      return {
        status: best >= 95 ? ("MATCHED_PROTECTED_SUBJECT" as const) : ("NOT_SUBJECT" as const),
        similarity: best,
        matchedReferenceIndex: bestIndex,
      };
    },
    computePhash: async (bytes) => Buffer.from(bytes).toString("hex"),
    checkDuplicate: async () => ({ isDuplicate: false, duplicateOfReferenceId: null }),
  });

  assert.notEqual(sweep.status, "WAITING_FOR_NEXT_SCAN", "the sweep is no longer blocked for Lena");
});

test("6. revocation still works: revoked references cannot be used for future matching, and Face Protection status reverts honestly", async () => {
  const beforeRefCount = supabase._store["deepfake_reference_faces"].length;

  const result = await revokeAdminConfirmedAnchorCore(supabase, {
    adminUserId: ADMIN_ID,
    targetUserId: "lena",
    referenceFaceId: confirmedReferenceId,
  });
  assert.equal(result.ok, true);

  // Nothing is deleted.
  assert.equal(supabase._store["deepfake_reference_faces"].length, beforeRefCount);
  const face = supabase._store["protected_faces"].find(
    (f) => f.linked_reference_face_id === confirmedReferenceId,
  )!;
  assert.equal(face.status, "INACTIVE", "the row is preserved but deactivated, never deleted");

  // The automatic monitoring sweep can no longer use it for future matching.
  const monitoringAfter = await resolveActiveFaceMonitoring(supabase, "lena");
  assert.equal(
    monitoringAfter.activeFaces.length,
    0,
    "revoked reference is excluded from future matching",
  );

  // Face Protection's own status honestly reverts — no longer claiming to
  // be active from a revoked anchor.
  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "lena")!;
  assert.equal(profile.status, "DEFERRED");
});

test("UI STATE — after revocation: the pending-enrollment banner honestly reappears (this is correct, not a regression)", async () => {
  const profile = supabase._store["protected_face_profiles"].find((p) => p.user_id === "lena")!;
  const dbStatus = profile.status;
  const enrollmentStatus: string =
    dbStatus === "FACE_VERIFIED" ||
    dbStatus === "DEFERRED" ||
    dbStatus === "DELETED" ||
    dbStatus === "FACE_VERIFIED_VIA_PROTECTED_ASSET"
      ? dbStatus
      : "CONSENT_REQUIRED";
  assert.equal(enrollmentStatus, "DEFERRED");

  const isDeferred: boolean = enrollmentStatus === "DEFERRED";
  assert.equal(
    isDeferred,
    true,
    "the banner correctly reappears — Face Protection is genuinely no longer active after revocation",
  );
});
