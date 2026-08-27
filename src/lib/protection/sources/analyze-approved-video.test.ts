import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeApprovedSourceVideo } from "./analyze-approved-video.server";
import { createMockSupabase } from "../test-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: "video-1",
    source_id: "source-1",
    user_id: "user-1",
    youtube_video_id: "yt-1",
    title: "Some video",
    thumbnail_url: "https://example.com/thumb.jpg",
    url: "https://www.youtube.com/watch?v=yt-1",
    analysis_status: "pending",
    ...overrides,
  };
}

test("REGRESSION: the automatic pipeline never calls or imports case-prep at all — case-prep is only reachable via the admin Takedown action", () => {
  const source = readFileSync(join(__dirname, "analyze-approved-video.server.ts"), "utf8");
  // Matches an actual call or import, not the explanatory prose in this
  // file's own doc comment (which names onVerifiedFinding by way of
  // contrast, without calling or importing it).
  assert.doesNotMatch(
    source,
    /onVerifiedFinding\(|from ["']@\/lib\/enforcement\/orchestrator["']/,
    "the automatic pipeline must never call or import case-prep — only takedownSourceVideoCore may",
  );
});

test("no target profile enrolled -> needs_review, pending_review, skipped, no evidence ever attempted", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let evidenceCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => null,
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "e1", status: "captured" }
    ),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "needs_review");
  assert.equal(row.review_status, "pending_review");
  assert.equal(row.analysis_status, "skipped");
  assert.equal(evidenceCalled, false);
});

test("face matched, synthetic detection confirms clean -> legitimate_appearance, pending_review, no evidence capture", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let evidenceCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [{ target_face_match: true, face_similarity: 92 } as never],
      rejected: [],
      errors: [],
    }),
    classifyHitsWithHive: async () => [
      { is_synthetic: false, confidence: 4, classification_status: "completed" } as never,
    ],
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "e1", status: "captured" }
    ),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "legitimate_appearance");
  assert.equal(
    row.review_status,
    "pending_review",
    "even a legitimate result must await human review",
  );
  assert.equal(row.analysis_status, "completed");
  assert.equal(evidenceCalled, false, "a genuine appearance must never create evidence");
});

test("face matched and synthetic confirmed -> flagged, evidence captured for preservation, still only pending_review (never auto-actioned)", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let evidenceCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [{ target_face_match: true, face_similarity: 97 } as never],
      rejected: [],
      errors: [],
    }),
    classifyHitsWithHive: async () => [
      { is_synthetic: true, confidence: 96, classification_status: "completed" } as never,
    ],
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "evidence-1", status: "captured" }
    ),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "verified_deepfake");
  assert.equal(row.automated_finding_evidence_id, "evidence-1");
  assert.equal(evidenceCalled, true, "evidence should still be preserved automatically");
  assert.equal(
    row.review_status,
    "pending_review",
    "a verified_deepfake suggestion must still wait for a human decision, never auto-act",
  );
});

test("confident non-match -> not_subject, pending_review, synthetic classifier never even called", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let hiveCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [],
      rejected: [{ target_face_match: false, face_similarity: 12 } as never],
      errors: [],
    }),
    classifyHitsWithHive: async () => ((hiveCalled = true), []),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "not_subject");
  assert.equal(row.review_status, "pending_review");
  assert.equal(
    hiveCalled,
    false,
    "no reason to run synthetic detection on content that isn't even the subject",
  );
});

test("REGRESSION: face comparison lands in the errors bucket (comparison_failed/no_image) -> needs_review, never not_subject, no evidence, hive never called", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let hiveCalled = false;
  let evidenceCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [],
      rejected: [],
      errors: [
        { target_face_match: false, face_verification_status: "comparison_failed" } as never,
      ],
    }),
    classifyHitsWithHive: async () => ((hiveCalled = true), []),
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "e1", status: "captured" }
    ),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(
    row.classification,
    "needs_review",
    "a failed face comparison must never be treated as a confident non-match",
  );
  assert.equal(row.review_status, "pending_review");
  assert.equal(hiveCalled, false);
  assert.equal(evidenceCalled, false);
});

test("REGRESSION: filterCandidatesByTargetFace throws (e.g. Rekognition/storage outage) -> needs_review, not not_subject", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => {
      throw new Error("Rekognition unavailable");
    },
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "needs_review");
  assert.equal(row.analysis_error, "Face comparison could not be completed.");
});

test("REGRESSION: face matched but Hive returns provider_error -> needs_review, never legitimate_appearance, no evidence", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });
  let evidenceCalled = false;

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [{ target_face_match: true, face_similarity: 92 } as never],
      rejected: [],
      errors: [],
    }),
    classifyHitsWithHive: async () => [
      { is_synthetic: false, confidence: 0, classification_status: "provider_error" } as never,
    ],
    captureAndRecordFindingEvidence: async () => (
      (evidenceCalled = true),
      { ok: true, evidenceId: "e1", status: "captured" }
    ),
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(
    row.classification,
    "needs_review",
    "an inconclusive Hive result must never be treated as confirmed clean",
  );
  assert.equal(evidenceCalled, false);
});

test("REGRESSION: face matched but Hive returns no_media -> needs_review, never legitimate_appearance", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [{ target_face_match: true, face_similarity: 92 } as never],
      rejected: [],
      errors: [],
    }),
    classifyHitsWithHive: async () => [
      { is_synthetic: false, confidence: 0, classification_status: "no_media" } as never,
    ],
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "needs_review");
});

test("REGRESSION: classifyHitsWithHive throws -> needs_review, not legitimate_appearance", async () => {
  const supabase = createMockSupabase({
    approved_source_videos: [seedVideo()],
  });

  await analyzeApprovedSourceVideo(supabase, "video-1", {
    findExistingDeepfakeTarget: async () => ({ profileId: "dtp-1", referenceFaceCount: 3 }),
    filterCandidatesByTargetFace: async () => ({
      matched: [{ target_face_match: true, face_similarity: 92 } as never],
      rejected: [],
      errors: [],
    }),
    classifyHitsWithHive: async () => {
      throw new Error("Hive API unreachable");
    },
  });

  const row = supabase._store.approved_source_videos[0];
  assert.equal(row.classification, "needs_review");
  assert.equal(row.analysis_error, "Synthetic-media classification could not be completed.");
});
