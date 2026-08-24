import test from "node:test";
import assert from "node:assert/strict";
import {
  selectActionableDeepfakeFindings,
  findExistingDeepfakeTarget,
  runDeepfakeIntelForUser,
  MIN_REFERENCE_FACES_FOR_MATCHING,
} from "./deepfake.server";
import { createMockSupabase } from "../test-utils";

test("selectActionableDeepfakeFindings: only takedown_recommended findings are actionable", () => {
  const findings = [
    { id: "1", takedown_recommended: false },
    { id: "2", takedown_recommended: true },
  ];
  assert.deepEqual(
    selectActionableDeepfakeFindings(findings).map((f) => f.id),
    ["2"],
  );
});

test("findExistingDeepfakeTarget: no target profile for this user -> null (read-only, never creates one)", async () => {
  const supabase = createMockSupabase();
  const result = await findExistingDeepfakeTarget(supabase, "user-1");
  assert.equal(result, null);
  // Confirms nothing was written.
  assert.equal(supabase._store.deepfake_target_profiles?.length ?? 0, 0);
});

test("findExistingDeepfakeTarget: existing target profile with reference faces is reused as-is", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      { id: "f1", profile_id: "dtp-1" },
      { id: "f2", profile_id: "dtp-1" },
    ],
  });
  const result = await findExistingDeepfakeTarget(supabase, "user-1");
  assert.deepEqual(result, { profileId: "dtp-1", referenceFaceCount: 2 });
});

test("findExistingDeepfakeTarget: target profile exists but zero reference faces", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
  });
  const result = await findExistingDeepfakeTarget(supabase, "user-1");
  assert.deepEqual(result, { profileId: "dtp-1", referenceFaceCount: 0 });
});

test("runDeepfakeIntelForUser: no target profile, no liveness anchor -> honest NO_VERIFIED_FACE_REFERENCE, pipeline never invoked", async () => {
  const supabase = createMockSupabase();
  let invoked = false;
  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runDeepfakeScanCore: async () => ((invoked = true), { scan_id: "x", already_running: false }),
    },
  );
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
  assert.equal(outcome.blocked_reason, "NO_VERIFIED_FACE_REFERENCE");
  assert.equal(invoked, false);
});

test("runDeepfakeIntelForUser: target profile exists but no reference faces, no liveness anchor -> honest NO_VERIFIED_FACE_REFERENCE, pipeline never invoked (regression: unchanged from before the liveness bridge)", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
  });
  let invoked = false;
  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runDeepfakeScanCore: async () => ((invoked = true), { scan_id: "x", already_running: false }),
    },
  );
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
  assert.equal(outcome.blocked_reason, "NO_VERIFIED_FACE_REFERENCE");
  assert.equal(invoked, false);
});

test("runDeepfakeIntelForUser: no target profile, but a liveness-verified Face Protection anchor exists -> NOT blocked, scan runs text-only", async () => {
  const supabase = createMockSupabase({
    protected_face_profiles: [{ id: "pfp-1", user_id: "user-1", status: "FACE_VERIFIED" }],
    protected_faces: [
      { id: "pf-1", user_id: "user-1", status: "ACTIVE", s3_bucket: "b", s3_key: "k1" },
    ],
  });
  let capturedProfileId: string | undefined | null = "unset";
  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runDeepfakeScanCore: async (_s, _u, rawData) => {
        capturedProfileId = (rawData as { profile_id?: string }).profile_id;
        return { scan_id: "scan-1", already_running: false };
      },
    },
  );
  assert.notEqual(outcome.blocked_reason, "NO_VERIFIED_FACE_REFERENCE");
  assert.equal(outcome.status, "COMPLETED");
  // No deepfake_target_profiles row exists for this customer, and this
  // dispatcher must never create one — the scan runs without a profile_id
  // (text-only, no Rekognition face-filtering) rather than fabricating one.
  assert.equal(capturedProfileId, undefined);
  assert.equal(outcome.blocked_reason, "TEXT_ONLY_NO_FACE_FILTER");
  assert.equal(supabase._store.deepfake_target_profiles?.length ?? 0, 0);
});

test("runDeepfakeIntelForUser: reuses the existing target profile id, never creates a new one", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      { id: "f1", profile_id: "dtp-1" },
      { id: "f2", profile_id: "dtp-1" },
      { id: "f3", profile_id: "dtp-1" },
    ],
  });
  let capturedProfileId: string | undefined;

  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runDeepfakeScanCore: async (_s, _u, rawData) => {
        capturedProfileId = (rawData as { profile_id?: string }).profile_id;
        supabase._store.deepfake_findings = [
          {
            id: "df-1",
            scan_id: "scan-1",
            url: "https://bad.example/fake.mp4",
            takedown_recommended: true,
          },
        ];
        return { scan_id: "scan-1", already_running: false };
      },
      onVerifiedFinding: async () => ({
        caseId: "case-1",
        status: "QUEUED",
        idempotencyDeduplicated: false,
      }),
    },
  );

  assert.equal(capturedProfileId, "dtp-1", "must reuse the existing target profile id");
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.verified_findings, 1);
  // 3 reference faces meets MIN_REFERENCE_FACES_FOR_MATCHING -> no text-only fallback flag.
  assert.equal(outcome.blocked_reason, null);
  // Confirms no new deepfake_target_profiles/deepfake_reference_faces rows were created.
  assert.equal(supabase._store.deepfake_target_profiles.length, 1);
  assert.equal(supabase._store.deepfake_reference_faces.length, 3);
});

test("runDeepfakeIntelForUser: fewer than MIN_REFERENCE_FACES_FOR_MATCHING is reported honestly, not silently upgraded", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [{ id: "f1", profile_id: "dtp-1" }],
  });
  assert.ok(1 < MIN_REFERENCE_FACES_FOR_MATCHING);

  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runDeepfakeScanCore: async () => ({ scan_id: "scan-1", already_running: false }),
      onVerifiedFinding: async () => ({
        caseId: null,
        status: "QUEUED",
        idempotencyDeduplicated: false,
      }),
    },
  );
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.blocked_reason, "TEXT_ONLY_NO_FACE_FILTER");
});

test("runDeepfakeIntelForUser: an already-running scan for the same target is reported as RUNNING, not re-queued", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      { id: "f1", profile_id: "dtp-1" },
      { id: "f2", profile_id: "dtp-1" },
      { id: "f3", profile_id: "dtp-1" },
    ],
  });
  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    { runDeepfakeScanCore: async () => ({ scan_id: "scan-1", already_running: true }) },
  );
  assert.equal(outcome.status, "RUNNING");
});

test("runDeepfakeIntelForUser: no subject name -> honest failure, pipeline never invoked", async () => {
  const supabase = createMockSupabase();
  let invoked = false;
  const outcome = await runDeepfakeIntelForUser(
    supabase,
    "user-1",
    { display_name: null, verified_name: null },
    {
      runDeepfakeScanCore: async () => ((invoked = true), { scan_id: "x", already_running: false }),
    },
  );
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.blocked_reason, "NO_SUBJECT_NAME");
  assert.equal(invoked, false);
});

test("tenant isolation: one user's target profile/reference faces are never used for another user", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [
      { id: "dtp-other", user_id: "other-user", target_name: "Someone Else" },
    ],
    deepfake_reference_faces: [
      { id: "f1", profile_id: "dtp-other" },
      { id: "f2", profile_id: "dtp-other" },
      { id: "f3", profile_id: "dtp-other" },
    ],
  });
  const result = await findExistingDeepfakeTarget(supabase, "user-1");
  assert.equal(result, null, "must not see another tenant's target profile");
});
