import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pollApprovedChannelSource } from "./poll-approved-source.server";
import { createMockSupabase } from "../test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    user_id: "user-1",
    source_kind: "channel",
    status: "active",
    uploads_playlist_id: "UUplaylist1",
    last_polled_at: null,
    last_error: null,
    ...overrides,
  };
}

function fakeVideo(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "yt-new-1",
    channelId: "UCchannel00000000000001",
    title: "New upload",
    description: "desc",
    thumbnailUrl: "https://example.com/thumb.jpg",
    publishedAt: "2026-08-27T00:00:00.000Z",
    durationSeconds: 120,
    viewCount: 10,
    likeCount: 1,
    commentCount: 0,
    isPrivateOrDeleted: false,
    ...overrides,
  };
}

test("REGRESSION: this file never references case-prep/enforcement/evidence-capture at all — polling can discover and analyze, but never enforce", () => {
  const source = readFileSync(join(__dirname, "poll-approved-source.server.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /onVerifiedFinding|AutoEnforcementOrchestrator|captureAndRecordFindingEvidence|from ["']@\/lib\/enforcement\/orchestrator["']|from ["']@\/lib\/protection\/evidence\.server["']/,
  );
});

test("new video discovered -> a approved_source_videos row is inserted and analyzed", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
  });
  let analyzedId: string | null = null;

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => [fakeVideo()],
    analyzeApprovedSourceVideo: async (_s, videoId) => {
      analyzedId = videoId;
    },
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.checked, 1);
  assert.equal(supabase._store.approved_source_videos.length, 1);
  const video = supabase._store.approved_source_videos[0];
  assert.equal(video.source_id, "source-1");
  assert.equal(video.user_id, "user-1");
  assert.equal(video.youtube_video_id, "yt-new-1");
  assert.equal(video.url, "https://www.youtube.com/watch?v=yt-new-1");
  assert.equal(video.analysis_status, "pending");
  assert.equal(analyzedId, video.id, "the newly inserted row must be passed to analysis");
});

test("duplicate video (already exists for this source) -> no duplicate row, not re-analyzed", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
    approved_source_videos: [
      {
        id: "existing-video",
        source_id: "source-1",
        user_id: "user-1",
        youtube_video_id: "yt-new-1",
      },
    ],
  });
  let analyzeCalled = false;

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => [fakeVideo({ videoId: "yt-new-1" })],
    analyzeApprovedSourceVideo: async () => {
      analyzeCalled = true;
    },
  });

  assert.equal(result.inserted, 0);
  assert.equal(supabase._store.approved_source_videos.length, 1, "no duplicate row created");
  assert.equal(analyzeCalled, false, "an already-known video must not be re-analyzed");
});

test("multiple new videos -> all inserted and analyzed, fetchUploadsSince called with the existing max:25 limit", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
  });
  const analyzedIds: string[] = [];
  let capturedMax: number | undefined;

  const videos = Array.from({ length: 5 }, (_, i) => fakeVideo({ videoId: `yt-${i}` }));

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async (opts) => {
      capturedMax = opts.max;
      return videos;
    },
    analyzeApprovedSourceVideo: async (_s, videoId) => {
      analyzedIds.push(videoId);
    },
  });

  assert.equal(capturedMax, 25, "the existing per-poll cap of 25 must still be respected");
  assert.equal(result.inserted, 5);
  assert.equal(result.checked, 5);
  assert.equal(supabase._store.approved_source_videos.length, 5);
  assert.equal(analyzedIds.length, 5, "every newly discovered video must be analyzed");
});

test("YouTube API failure -> visible failure: last_error and last_polled_at are recorded, the error is not swallowed", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
  });

  await assert.rejects(
    () =>
      pollApprovedChannelSource(supabase, "source-1", {
        fetchUploadsSince: async () => {
          throw new Error("YouTube quotaExceeded");
        },
      }),
    /YouTube quotaExceeded/,
  );

  const source = supabase._store.approved_youtube_sources.find((r) => r.id === "source-1");
  assert.equal(source?.last_error, "YouTube quotaExceeded");
  assert.ok(
    source?.last_polled_at,
    "last_polled_at must still be recorded so the UI shows a real attempt happened",
  );
});

test("an inactive (paused) source is never polled — fetchUploadsSince is not even called", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource({ status: "paused" })],
    approved_source_videos: [],
  });
  let fetchCalled = false;

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => ((fetchCalled = true), []),
  });

  assert.deepEqual(result, { inserted: 0, checked: 0 });
  assert.equal(fetchCalled, false);
  assert.equal(supabase._store.approved_source_videos.length, 0);
});

test("a removed source is never polled — no new ingestion", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource({ status: "removed" })],
  });
  let fetchCalled = false;

  await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => ((fetchCalled = true), []),
  });

  assert.equal(fetchCalled, false);
});

test("a video-kind source is never polled — channel discovery does not touch manually-added individual videos", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource({ source_kind: "video" })],
  });
  let fetchCalled = false;

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => ((fetchCalled = true), []),
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, { inserted: 0, checked: 0 });
});

test("analysis failure on one discovered video is recorded as failed with analysis_error — never left stuck at running, never treated as legitimate", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
  });

  await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => [fakeVideo()],
    analyzeApprovedSourceVideo: async () => {
      throw new Error("Rekognition unavailable");
    },
  });

  const video = supabase._store.approved_source_videos[0];
  assert.equal(video.analysis_status, "failed");
  assert.equal(video.analysis_error, "Rekognition unavailable");
  assert.notEqual(video.classification, "legitimate_appearance");
});

test("successful poll updates last_polled_at/next_poll_at and clears last_error", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource({ last_error: "stale previous failure" })],
  });

  await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => [],
    analyzeApprovedSourceVideo: async () => {},
  });

  const source = supabase._store.approved_youtube_sources.find((r) => r.id === "source-1");
  assert.ok(source?.last_polled_at);
  assert.ok(source?.next_poll_at);
  assert.equal(source?.last_error, null);
});

test("private/deleted videos returned by the YouTube API are skipped, never inserted", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource()],
    approved_source_videos: [],
  });

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => [fakeVideo({ isPrivateOrDeleted: true })],
  });

  assert.equal(result.inserted, 0);
  assert.equal(supabase._store.approved_source_videos.length, 0);
});

test("missing uploads_playlist_id records a visible error and never attempts a fetch", async () => {
  const supabase = createMockSupabase({
    approved_youtube_sources: [seedSource({ uploads_playlist_id: null })],
  });
  let fetchCalled = false;

  const result = await pollApprovedChannelSource(supabase, "source-1", {
    fetchUploadsSince: async () => ((fetchCalled = true), []),
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, { inserted: 0, checked: 0 });
  const source = supabase._store.approved_youtube_sources.find((r) => r.id === "source-1");
  assert.equal(source?.last_error, "Missing uploads playlist id.");
});
