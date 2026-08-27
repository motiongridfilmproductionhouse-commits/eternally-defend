import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  removeApprovedSourceCore,
  updateSourceVideoReviewStatusCore,
} from "./approved-sources.functions";
import { createMockSupabase } from "../test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("REGRESSION: removing a source soft-deletes (status='removed'), never issues a DELETE", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [
      { id: "source-1", user_id: "user-1", status: "active", title: "Some Channel" },
    ],
  });

  await removeApprovedSourceCore(supabase, "user-1", "source-1");

  assert.equal(
    supabase.calls.some((c) => c.table === "approved_youtube_sources" && c.op === "delete"),
    false,
    "removing a source must never issue a DELETE",
  );
  assert.equal(
    supabase.calls.some((c) => c.table === "approved_youtube_sources" && c.op === "update"),
    true,
  );

  const row = supabase._store.approved_youtube_sources.find((r) => r.id === "source-1");
  assert.ok(row, "the source row must still exist after removal");
  assert.equal(row?.status, "removed");
  assert.equal(row?.title, "Some Channel", "unrelated fields must be preserved");
});

test("REGRESSION: historical approved_source_videos rows (including a flagged deepfake) survive removing their source", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [{ id: "source-1", user_id: "user-1", status: "active" }],
    approved_source_videos: [
      {
        id: "video-1",
        source_id: "source-1",
        user_id: "user-1",
        classification: "verified_deepfake",
        automated_finding_evidence_id: "evidence-1",
      },
    ],
  });

  await removeApprovedSourceCore(supabase, "user-1", "source-1");

  assert.equal(
    supabase.calls.some((c) => c.table === "approved_source_videos"),
    false,
    "removing a source must not touch approved_source_videos at all — the app issues no cascading operation",
  );
  assert.equal(supabase._store.approved_source_videos.length, 1);
  const video = supabase._store.approved_source_videos[0];
  assert.equal(video.classification, "verified_deepfake");
  assert.equal(video.automated_finding_evidence_id, "evidence-1");
});

test("a customer cannot soft-delete another customer's source (scoped by user_id)", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [{ id: "source-1", user_id: "other-user", status: "active" }],
  });

  await removeApprovedSourceCore(supabase, "user-1", "source-1");

  const row = supabase._store.approved_youtube_sources.find((r) => r.id === "source-1");
  assert.equal(
    row?.status,
    "active",
    "a mismatched user_id must leave the other tenant's row untouched",
  );
});

test("REGRESSION: this file never imports evidence-capture or enforcement code — a customer's own review decision can never trigger enforcement", () => {
  const source = readFileSync(join(__dirname, "approved-sources.functions.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /onVerifiedFinding|AutoEnforcementOrchestrator|captureAndRecordFindingEvidence|evidence\.server/,
    "customer review actions (approve / send-for-review) must never be able to reach case-prep",
  );
});

test("approveSourceVideo core: sets approved_legitimate + reviewed_by/reviewed_at, never a DELETE or UPDATE to any other table", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [
      { id: "video-1", source_id: "source-1", user_id: "user-1", review_status: "pending_review" },
    ],
  });

  await updateSourceVideoReviewStatusCore(supabase, "user-1", "video-1", "approved_legitimate");

  const row = supabase._store.approved_source_videos.find((r) => r.id === "video-1");
  assert.equal(row?.review_status, "approved_legitimate");
  assert.equal(row?.reviewed_by, "user-1");
  assert.ok(row?.reviewed_at, "reviewed_at must be stamped");
  assert.equal(
    supabase.calls.every((c) => c.table === "approved_source_videos"),
    true,
    "must touch only approved_source_videos",
  );
  assert.equal(
    supabase.calls.some((c) => c.op === "delete"),
    false,
  );
});

test("sendSourceVideoForReview core: sets sent_for_review", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [
      { id: "video-1", source_id: "source-1", user_id: "user-1", review_status: "pending_review" },
    ],
  });

  await updateSourceVideoReviewStatusCore(supabase, "user-1", "video-1", "sent_for_review");

  const row = supabase._store.approved_source_videos.find((r) => r.id === "video-1");
  assert.equal(row?.review_status, "sent_for_review");
});

test("a customer cannot change another customer's video review_status (scoped by user_id)", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [
      {
        id: "video-1",
        source_id: "source-1",
        user_id: "other-user",
        review_status: "pending_review",
      },
    ],
  });

  await updateSourceVideoReviewStatusCore(supabase, "user-1", "video-1", "approved_legitimate");

  const row = supabase._store.approved_source_videos.find((r) => r.id === "video-1");
  assert.equal(
    row?.review_status,
    "pending_review",
    "a mismatched user_id must leave the other tenant's row untouched",
  );
});
