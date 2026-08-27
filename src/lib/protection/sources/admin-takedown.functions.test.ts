import test from "node:test";
import assert from "node:assert/strict";
import { takedownSourceVideoCore } from "./admin-takedown.functions";
import { createMockSupabase } from "../test-utils";

function seedVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    source_id: "source-1",
    user_id: "customer-1",
    youtube_video_id: "yt-1",
    title: "Some video",
    url: "https://www.youtube.com/watch?v=yt-1",
    review_status: "sent_for_review",
    ...overrides,
  };
}

test("takedownSourceVideoCore: captures evidence, calls case-prep with the same FindingShape the automatic pipeline uses, sets takedown_requested, and writes one audit log row", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let evidenceCalled = false;
  let onVerifiedFindingArgs: unknown = null;

  const result = await takedownSourceVideoCore(
    supabase,
    "admin-1",
    "video-1",
    "Confirmed impersonation",
    {
      captureAndRecordFindingEvidence: async () => (
        (evidenceCalled = true),
        { ok: true, evidenceId: "evidence-1", status: "captured" }
      ),
      onVerifiedFinding: async (_s, _u, finding) => (
        (onVerifiedFindingArgs = finding),
        { caseId: "case-1", status: "QUEUED", idempotencyDeduplicated: false }
      ),
    },
  );

  assert.equal(evidenceCalled, true);
  assert.deepEqual(onVerifiedFindingArgs, {
    id: "video-1",
    source: "approved_youtube_sources",
    source_type: "deepfake",
    canonical_url: "https://www.youtube.com/watch?v=yt-1",
    risk_type: "DEEPFAKE",
  });
  assert.equal(result.ok, true);
  assert.equal(result.caseId, "case-1");
  assert.equal(result.evidenceId, "evidence-1");

  const video = supabase._store.approved_source_videos.find((r) => r.id === "video-1");
  assert.equal(video?.review_status, "takedown_requested");

  assert.equal(supabase._store.approved_source_takedown_log.length, 1);
  const logRow = supabase._store.approved_source_takedown_log[0];
  assert.equal(logRow.video_id, "video-1");
  assert.equal(logRow.user_id, "customer-1", "the log must record the CONTENT OWNER's user_id");
  assert.equal(
    logRow.actor_id,
    "admin-1",
    "the log must record the ADMIN who acted, distinct from the owner",
  );
  assert.equal(logRow.action, "takedown_requested");
  assert.equal(logRow.reason, "Confirmed impersonation");
  assert.equal(logRow.enforcement_case_id, "case-1");
});

test("takedownSourceVideoCore: works even on a video the automatic classifier never flagged (re-captures/upserts evidence itself)", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [
      seedVideo({ review_status: "pending_review", automated_finding_evidence_id: null }),
    ],
  });
  let evidenceCalled = false;

  await takedownSourceVideoCore(supabase, "admin-1", "video-1", undefined, {
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "evidence-2", status: "captured" }
    ),
    onVerifiedFinding: async () => ({
      caseId: "case-2",
      status: "QUEUED",
      idempotencyDeduplicated: false,
    }),
  });

  assert.equal(
    evidenceCalled,
    true,
    "Takedown must capture evidence itself, not rely on the automatic pass",
  );
  const video = supabase._store.approved_source_videos.find((r) => r.id === "video-1");
  assert.equal(video?.review_status, "takedown_requested");
});

test("reason is optional — a takedown with no reason logs reason: null", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });

  await takedownSourceVideoCore(supabase, "admin-1", "video-1", undefined, {
    captureAndRecordFindingEvidence: async () => ({
      ok: true,
      evidenceId: "evidence-3",
      status: "captured",
    }),
    onVerifiedFinding: async () => ({
      caseId: null,
      status: "NOT_ELIGIBLE",
      idempotencyDeduplicated: false,
    }),
  });

  const logRow = supabase._store.approved_source_takedown_log[0];
  assert.equal(logRow.reason, null);
  assert.equal(
    logRow.enforcement_case_id,
    null,
    "a NOT_ELIGIBLE case still logs, with a null case id",
  );
});
