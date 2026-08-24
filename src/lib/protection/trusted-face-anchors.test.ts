import test from "node:test";
import assert from "node:assert/strict";
import { createMockSupabase } from "./test-utils";
import {
  getTrustedFaceAnchorsForUser,
  hasTrustedAnchor,
  ensureDeepfakeTargetProfileForUser,
  orderAnchorsByTrust,
} from "./trusted-face-anchors.server";

test("liveness anchor accepted: FACE_VERIFIED + active protected_faces row -> a CANONICAL_VERIFIED_REFERENCE anchor from FACE_PROTECTION", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
  });
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(hasTrustedAnchor(result), true);
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].source, "FACE_PROTECTION");
  assert.equal(result.anchors[0].tier, "CANONICAL_VERIFIED_REFERENCE");
  assert.deepEqual(result.anchors[0].retrieval, { kind: "s3", bucket: "b", key: "k1" });
  assert.equal(result.deepfakeTargetProfileId, null);
});

test("a protected_face_profiles row that is not FACE_VERIFIED yields no Source A anchor", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "CAPTURE_IN_PROGRESS" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
  });
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(result.anchors.length, 0);
});

test("an INACTIVE protected_faces row is excluded even when the profile is FACE_VERIFIED", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "INACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
  });
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(result.anchors.length, 0);
});

test("existing deepfake references still work: deepfake_target_profiles + deepfake_reference_faces -> DEEPFAKE_PROFILE anchors, no regression", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      {
        id: "f1",
        profile_id: "dtp-1",
        storage_path: "path/1.jpg",
        reference_tier: "APPROVED_SECONDARY_REFERENCE",
      },
    ],
  });
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].source, "DEEPFAKE_PROFILE");
  assert.equal(result.anchors[0].tier, "APPROVED_SECONDARY_REFERENCE");
  assert.equal(result.deepfakeTargetProfileId, "dtp-1");
});

test("both sources present -> both anchors returned, canonical sorts first", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      {
        id: "f1",
        profile_id: "dtp-1",
        storage_path: "path/1.jpg",
        reference_tier: "SCREENSHOT_DERIVED_REFERENCE",
      },
    ],
  });
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(result.anchors.length, 2);
  const ordered = orderAnchorsByTrust(result.anchors);
  assert.equal(ordered[0].source, "FACE_PROTECTION");
  assert.equal(ordered[1].source, "DEEPFAKE_PROFILE");
});

test("no anchors: no liveness, no deepfake references -> empty result", async () => {
  const supabase = createMockSupabase();
  const result = await getTrustedFaceAnchorsForUser(supabase, "user-1");
  assert.equal(hasTrustedAnchor(result), false);
  assert.equal(result.deepfakeTargetProfileId, null);
});

test("cross-user isolation: User A's lookup never returns User B's protected_faces or deepfake_reference_faces", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [
      { id: "pfp-a", user_id: "user-A", status: "FACE_VERIFIED" },
      { id: "pfp-b", user_id: "user-B", status: "FACE_VERIFIED" },
    ],
    protected_faces: [
      { id: "pf-a", user_id: "user-A", status: "ACTIVE", s3_bucket: "b", s3_key: "a-key" },
      { id: "pf-b", user_id: "user-B", status: "ACTIVE", s3_bucket: "b", s3_key: "b-key" },
    ],
    deepfake_target_profiles: [
      { id: "dtp-a", user_id: "user-A", target_name: "A" },
      { id: "dtp-b", user_id: "user-B", target_name: "B" },
    ],
    deepfake_reference_faces: [
      {
        id: "ref-a",
        profile_id: "dtp-a",
        storage_path: "a.jpg",
        reference_tier: "APPROVED_SECONDARY_REFERENCE",
      },
      {
        id: "ref-b",
        profile_id: "dtp-b",
        storage_path: "b.jpg",
        reference_tier: "APPROVED_SECONDARY_REFERENCE",
      },
    ],
  });

  const resultA = await getTrustedFaceAnchorsForUser(supabase, "user-A");
  assert.equal(resultA.anchors.length, 2);
  assert.equal(resultA.deepfakeTargetProfileId, "dtp-a");
  for (const anchor of resultA.anchors) {
    if (anchor.retrieval.kind === "s3") assert.equal(anchor.retrieval.key, "a-key");
    if (anchor.retrieval.kind === "deepfake_reference_storage")
      assert.equal(anchor.retrieval.path, "a.jpg");
  }

  const resultB = await getTrustedFaceAnchorsForUser(supabase, "user-B");
  assert.equal(resultB.anchors.length, 2);
  assert.equal(resultB.deepfakeTargetProfileId, "dtp-b");
  for (const anchor of resultB.anchors) {
    if (anchor.retrieval.kind === "s3") assert.equal(anchor.retrieval.key, "b-key");
    if (anchor.retrieval.kind === "deepfake_reference_storage")
      assert.equal(anchor.retrieval.path, "b.jpg");
  }
});

test("ensureDeepfakeTargetProfileForUser is idempotent: second call returns the same id, no duplicate row", async () => {
  const supabase = createMockSupabase();
  const first = await ensureDeepfakeTargetProfileForUser(supabase, "user-1", "Jane Doe");
  const second = await ensureDeepfakeTargetProfileForUser(supabase, "user-1", "Jane Doe");
  assert.equal(first, second);
  const rows = (supabase._store["deepfake_target_profiles"] ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.user_id === "user-1",
  );
  assert.equal(rows.length, 1);
});

test("ensureDeepfakeTargetProfileForUser reuses an existing manually-created target profile instead of creating a second one", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-existing", user_id: "user-1", target_name: "Jane Doe" }],
  });
  const id = await ensureDeepfakeTargetProfileForUser(supabase, "user-1", "Jane Doe");
  assert.equal(id, "dtp-existing");
  assert.equal((supabase._store["deepfake_target_profiles"] ?? []).length, 1);
});
