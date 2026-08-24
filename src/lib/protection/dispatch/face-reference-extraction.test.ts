import test from "node:test";
import assert from "node:assert/strict";
import { runFaceReferenceExtractionForUser } from "./face-reference-extraction.server";
import { createMockSupabase } from "../test-utils";

test("no anchors at all -> honest NO_VERIFIED_FACE_REFERENCE, nothing processed", async () => {
  const supabase = createMockSupabase();
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1");
  assert.deepEqual(outcome, {
    status: "WAITING_FOR_NEXT_SCAN",
    candidates_found: 0,
    verified_findings: 0,
    blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
  });
  assert.equal(supabase._store.protected_asset_grid_tiles?.length ?? 0, 0);
});

test("deepfake target profile exists but zero reference faces -> NO_VERIFIED_FACE_REFERENCE, never bootstraps an anchor", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
  });
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1");
  assert.deepEqual(outcome, {
    status: "WAITING_FOR_NEXT_SCAN",
    candidates_found: 0,
    verified_findings: 0,
    blocked_reason: "NO_VERIFIED_FACE_REFERENCE",
  });
});

test("deepfake target profile and reference faces exist but no protected_assets are pending -> WAITING_FOR_NEXT_SCAN with no blocked_reason (regression, existing deepfake reference support still works)", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      {
        id: "f1",
        profile_id: "dtp-1",
        storage_path: "clients/user-1/reference/f1.jpg",
        reference_tier: "APPROVED_SECONDARY_REFERENCE",
      },
    ],
  });
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1", {
    downloadTrustedAnchorBytes: async () => new Uint8Array([1, 2, 3]),
  });
  assert.equal(outcome.blocked_reason, null);
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
});

test("liveness anchor accepted: FACE_VERIFIED + active protected_faces row, no deepfake_target_profiles -> NOT NO_VERIFIED_FACE_REFERENCE, proceeds to look for pending assets", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
  });
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1", {
    downloadTrustedAnchorBytes: async () => new Uint8Array([1, 2, 3]),
  });
  // No deepfake_target_profiles row exists, and this must NOT be reported as
  // a blocked state at all -- the liveness anchor alone is sufficient, so
  // the only remaining reason to stop is "nothing pending to process".
  assert.notEqual(outcome.blocked_reason, "NO_TARGET_PROFILE");
  assert.notEqual(outcome.blocked_reason, "NO_VERIFIED_FACE_REFERENCE");
  assert.equal(outcome.blocked_reason, null);
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
});

test("liveness-only customer's first genuine match lazily creates exactly one deepfake_target_profiles row, and promotes into deepfake_reference_faces tagged SCREENSHOT_DERIVED_REFERENCE", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
    protected_assets: [
      {
        id: "asset-1",
        user_id: "user-1",
        kind: "photo",
        storage_path: "clients/user-1/assets/screenshot.jpg",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
    ],
  });

  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1", {
    downloadAssetBytes: async () => new Uint8Array([9, 9, 9]),
    downloadTrustedAnchorBytes: async () => new Uint8Array([1, 2, 3]),
    uploadTileBytes: async () => {},
    sha256: async () => "deadbeef",
    detectGrid: async () => ({
      tiles: [{ x: 0, y: 0, width: 10, height: 10 }],
      confidence: "HIGH",
      imageWidth: 10,
      imageHeight: 10,
    }),
    cropTile: async () => Buffer.from("tile-bytes"),
    analyzeFace: async () => ({ classification: "USABLE_FACE", confidence: 99, boundingBox: null }),
    matchIdentity: async () => ({
      status: "MATCHED_PROTECTED_SUBJECT",
      similarity: 97,
      matchedReferenceIndex: 0,
    }),
    computePhash: async () => "fakephash",
    checkDuplicate: async () => ({ isDuplicate: false, duplicateOfReferenceId: null }),
    promoteToReferenceFace: async (_supabaseAdmin, input) => {
      const { data } = await supabase
        .from("deepfake_reference_faces")
        .insert({
          profile_id: input.profileId,
          storage_path: input.tileStorageKey,
          rekognition_face_id: "fake-face-1",
          reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
          source_type: "SCREENSHOT_DERIVED",
        })
        .select("id")
        .single();
      return { referenceId: data!.id };
    },
  });

  assert.equal(outcome.status, "COMPLETED");
  const targetProfiles = supabase._store["deepfake_target_profiles"] ?? [];
  assert.equal(
    targetProfiles.length,
    1,
    "exactly one lazily-created target profile, never zero, never two",
  );
  assert.equal(targetProfiles[0].user_id, "user-1");

  const refFaces = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refFaces.length, 1);
  assert.equal(refFaces[0].reference_tier, "SCREENSHOT_DERIVED_REFERENCE");
  assert.equal(refFaces[0].profile_id, targetProfiles[0].id);
});

test("a liveness-only customer who ALSO already has a manually-created deepfake_target_profiles row never gets a second one", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
    deepfake_target_profiles: [{ id: "dtp-existing", user_id: "user-1", target_name: "Jane Doe" }],
    protected_assets: [
      {
        id: "asset-1",
        user_id: "user-1",
        kind: "photo",
        storage_path: "clients/user-1/assets/screenshot.jpg",
        created_at: "2026-08-01T00:00:00.000Z",
        grid_screenshot_status: "UNSCREENED",
      },
    ],
  });

  await runFaceReferenceExtractionForUser(supabase, "user-1", {
    downloadAssetBytes: async () => new Uint8Array([9, 9, 9]),
    downloadTrustedAnchorBytes: async () => new Uint8Array([1, 2, 3]),
    uploadTileBytes: async () => {},
    sha256: async () => "deadbeef",
    detectGrid: async () => ({
      tiles: [{ x: 0, y: 0, width: 10, height: 10 }],
      confidence: "HIGH",
      imageWidth: 10,
      imageHeight: 10,
    }),
    cropTile: async () => Buffer.from("tile-bytes"),
    analyzeFace: async () => ({ classification: "USABLE_FACE", confidence: 99, boundingBox: null }),
    matchIdentity: async () => ({
      status: "MATCHED_PROTECTED_SUBJECT",
      similarity: 97,
      matchedReferenceIndex: 0,
    }),
    computePhash: async () => "fakephash",
    checkDuplicate: async () => ({ isDuplicate: false, duplicateOfReferenceId: null }),
    promoteToReferenceFace: async (_supabaseAdmin, input) => {
      const { data } = await supabase
        .from("deepfake_reference_faces")
        .insert({
          profile_id: input.profileId,
          storage_path: input.tileStorageKey,
          reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
        })
        .select("id")
        .single();
      return { referenceId: data!.id };
    },
  });

  const targetProfiles = supabase._store["deepfake_target_profiles"] ?? [];
  assert.equal(targetProfiles.length, 1);
  assert.equal(targetProfiles[0].id, "dtp-existing");
  const refFaces = supabase._store["deepfake_reference_faces"] ?? [];
  assert.equal(refFaces[0].profile_id, "dtp-existing");
});

test("cross-user isolation: User A's run never loads or is affected by User B's protected_faces or deepfake_reference_faces", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [
      { id: "pfp-a", user_id: "user-A", status: "FACE_VERIFIED" },
      { id: "pfp-b", user_id: "user-B", status: "FACE_VERIFIED" },
    ],
    protected_faces: [
      { id: "pf-a", user_id: "user-A", status: "ACTIVE", s3_bucket: "b", s3_key: "a-key" },
      { id: "pf-b", user_id: "user-B", status: "ACTIVE", s3_bucket: "b", s3_key: "b-key" },
    ],
  });

  const seenKeys: string[] = [];
  await runFaceReferenceExtractionForUser(supabase, "user-A", {
    downloadTrustedAnchorBytes: async (_s, anchor) => {
      if (anchor.retrieval.kind === "s3") seenKeys.push(anchor.retrieval.key);
      return new Uint8Array([1]);
    },
  });

  assert.deepEqual(seenKeys, ["a-key"], "must never touch user-B's s3 key");
});
