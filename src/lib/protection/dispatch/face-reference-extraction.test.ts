import test from "node:test";
import assert from "node:assert/strict";
import { runFaceReferenceExtractionForUser } from "./face-reference-extraction.server";
import { createMockSupabase } from "../test-utils";

test("no deepfake_target_profiles row for this user -> honest NO_TARGET_PROFILE, nothing processed", async () => {
  const supabase = createMockSupabase();
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1");
  assert.deepEqual(outcome, {
    status: "WAITING_FOR_NEXT_SCAN",
    candidates_found: 0,
    verified_findings: 0,
    blocked_reason: "NO_TARGET_PROFILE",
  });
  assert.equal(supabase._store.protected_asset_grid_tiles?.length ?? 0, 0);
});

test("target profile exists but zero reference faces -> honest NO_REFERENCE_FACES, never bootstraps an anchor", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
  });
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1");
  assert.deepEqual(outcome, {
    status: "WAITING_FOR_NEXT_SCAN",
    candidates_found: 0,
    verified_findings: 0,
    blocked_reason: "NO_REFERENCE_FACES",
  });
});

test("target profile and reference faces exist but no protected_assets are pending -> WAITING_FOR_NEXT_SCAN with no blocked_reason", async () => {
  const supabase = createMockSupabase({
    deepfake_target_profiles: [{ id: "dtp-1", user_id: "user-1", target_name: "Jane Doe" }],
    deepfake_reference_faces: [
      {
        id: "f1",
        profile_id: "dtp-1",
        storage_path: null,
        reference_tier: "APPROVED_SECONDARY_REFERENCE",
      },
    ],
  });
  const outcome = await runFaceReferenceExtractionForUser(supabase, "user-1");
  // storage_path is null on the only reference row, so it can never be
  // downloaded -> zero usable reference images -> NO_REFERENCE_FACES, not a
  // silent skip straight to "nothing pending".
  assert.equal(outcome.blocked_reason, "NO_REFERENCE_FACES");
  assert.equal(outcome.status, "WAITING_FOR_NEXT_SCAN");
});
