import test from "node:test";
import assert from "node:assert/strict";
import { removeApprovedSourceCore } from "./approved-sources.functions";
import { createMockSupabase } from "../test-utils";

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
