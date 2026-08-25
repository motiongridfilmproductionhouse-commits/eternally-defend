import test from "node:test";
import assert from "node:assert/strict";
import { createMockSupabase } from "../test-utils";
import { activateFaceProtectionFromProtectedAssetReference } from "./face-protection-bridge.server";

function fakeDeps(faceId = "aws-face-1") {
  return {
    ensureCollection: async (userId: string) => `eterna_${userId.replace(/-/g, "")}`,
    indexFace: async () => [
      { faceId, imageId: "img-1", externalImageId: "ext-1", confidence: 99.2, boundingBox: null },
    ],
    getBucket: () => "eterna-app-bucket",
  };
}

test("activation creates an ACTIVE protected_faces row, registers the collection, and sets the distinct FACE_VERIFIED_VIA_PROTECTED_ASSET status — never FACE_VERIFIED", async () => {
  const supabase = createMockSupabase();
  const result = await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 93,
      label: "Lena — protected image reference",
    },
    fakeDeps(),
  );

  assert.equal(result.activated, true);
  const faces = supabase._store["protected_faces"] ?? [];
  assert.equal(faces.length, 1);
  assert.equal(faces[0].status, "ACTIVE");
  assert.equal(faces[0].source, "protected_asset_admin_confirmed");
  assert.equal(faces[0].linked_reference_face_id, "ref-1");
  assert.equal(faces[0].face_id, "aws-face-1");

  const collections = supabase._store["rekognition_collections"] ?? [];
  assert.equal(collections.length, 1);
  assert.equal(collections[0].user_id, "user-1");

  const profiles = supabase._store["protected_face_profiles"] ?? [];
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].status, "FACE_VERIFIED_VIA_PROTECTED_ASSET");
  assert.notEqual(
    profiles[0].status,
    "FACE_VERIFIED",
    "must never claim genuine liveness occurred",
  );
});

test("never touches a profile that is already genuinely FACE_VERIFIED (real liveness) — Path C is a fallback, not a replacement", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [
      { user_id: "user-1", status: "FACE_VERIFIED", collection_id: "eterna_user1" },
    ],
  });

  const result = await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 93,
      label: "Lena — protected image reference",
    },
    fakeDeps(),
  );

  assert.equal(result.activated, false);
  assert.equal(result.reason, "ALREADY_LIVENESS_VERIFIED");
  assert.equal(
    (supabase._store["protected_faces"] ?? []).length,
    0,
    "no protected_faces row is created",
  );
  const profiles = supabase._store["protected_face_profiles"];
  assert.equal(profiles[0].status, "FACE_VERIFIED", "the genuine liveness status is never touched");
});

test("re-activating for the same AWS face id updates the existing row instead of duplicating it", async () => {
  const supabase = createMockSupabase();
  const deps = fakeDeps("aws-face-1");

  await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 93,
      label: "Lena — protected image reference",
    },
    deps,
  );
  await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 95,
      label: "Lena — protected image reference",
    },
    deps,
  );

  assert.equal((supabase._store["protected_faces"] ?? []).length, 1, "no duplicate row");
});

test("no face indexed (e.g. the reference image is unusable) reports NO_FACE_INDEXED and touches nothing", async () => {
  const supabase = createMockSupabase();
  const result = await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 93,
      label: "Lena — protected image reference",
    },
    { ...fakeDeps(), indexFace: async () => [] },
  );

  assert.equal(result.activated, false);
  assert.equal(result.reason, "NO_FACE_INDEXED");
  assert.equal((supabase._store["protected_faces"] ?? []).length, 0);
  assert.equal((supabase._store["protected_face_profiles"] ?? []).length, 0);
});

test("cross-user isolation: activating for user-1 never creates or touches a row for a different user", async () => {
  const supabase = createMockSupabase({
    protected_faces: [
      {
        id: "pf-other",
        user_id: "user-2",
        face_id: "aws-face-1",
        collection_id: "eterna_user2",
        status: "ACTIVE",
      },
    ],
  });

  await activateFaceProtectionFromProtectedAssetReference(
    supabase,
    {
      userId: "user-1",
      tileBytes: new Uint8Array([1, 2, 3]),
      tileStorageKey: "clients/user-1/reference/candidate/asset-1/0.jpg",
      referenceFaceId: "ref-1",
      faceConfidence: 93,
      label: "Lena — protected image reference",
    },
    fakeDeps("aws-face-1"),
  );

  const faces = supabase._store["protected_faces"];
  assert.equal(faces.length, 2);
  const other = faces.find((f) => f.id === "pf-other")!;
  assert.equal(other.user_id, "user-2", "the other user's row is completely untouched");
  const mine = faces.find((f) => f.user_id === "user-1")!;
  assert.ok(mine);
});
