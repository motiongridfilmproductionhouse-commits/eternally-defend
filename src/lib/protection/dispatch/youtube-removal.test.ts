import test from "node:test";
import assert from "node:assert/strict";
import {
  selectActionableYoutubeFindings,
  runYoutubeRemovalForUser,
} from "./youtube-removal.server";
import { createMockSupabase } from "../test-utils";

test("selectActionableYoutubeFindings: excludes unverified subjects, official news, and low-risk/no-action findings", () => {
  const findings = [
    {
      id: "1",
      subject_status: "not_subject",
      channel_class: "independent",
      risk_level: "high",
      recommended_action: "takedown",
    },
    {
      id: "2",
      subject_status: "verified",
      channel_class: "official_news",
      risk_level: "high",
      recommended_action: "takedown",
    },
    {
      id: "3",
      subject_status: "verified",
      channel_class: "independent",
      risk_level: "low",
      recommended_action: null,
    },
    {
      id: "4",
      subject_status: "verified",
      channel_class: "independent",
      risk_level: "critical",
      recommended_action: "takedown",
    },
  ];
  const actionable = selectActionableYoutubeFindings(findings);
  assert.deepEqual(
    actionable.map((f) => f.id),
    ["4"],
  );
});

test("runYoutubeRemovalForUser: no subject name -> honest failure, no scan created", async () => {
  const supabase = createMockSupabase();
  const outcome = await runYoutubeRemovalForUser(supabase, "user-1", {
    display_name: null,
    verified_name: null,
  });
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.blocked_reason, "NO_SUBJECT_NAME");
  assert.equal(supabase._store.youtube_removal_scans?.length ?? 0, 0);
});

test("runYoutubeRemovalForUser: an in-flight scan for this user prevents starting a duplicate", async () => {
  const supabase = createMockSupabase({
    youtube_removal_scans: [{ id: "s1", user_id: "user-1", status: "running" }],
  });
  const outcome = await runYoutubeRemovalForUser(supabase, "user-1", {
    display_name: "Jane Doe",
    verified_name: null,
  });
  assert.equal(outcome.status, "RUNNING");
});

test("runYoutubeRemovalForUser: actionable finding captures evidence before case prep, in order", async () => {
  const supabase = createMockSupabase();
  const order: string[] = [];

  const outcome = await runYoutubeRemovalForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    {
      runYoutubeRemovalScan: async (s, _u, scanId) => {
        supabase._store.youtube_removal_findings = [
          {
            id: "f1",
            scan_id: scanId,
            video_url: "https://youtube.com/watch?v=abc",
            title: "Fake video",
            subject_status: "verified",
            channel_class: "independent",
            risk_level: "critical",
            recommended_action: "takedown",
          },
        ];
      },
      captureEvidence: async (_s, input) => {
        order.push(`evidence:${input.findingId}`);
        return { ok: true, evidenceId: "ev-1", status: "verified" };
      },
      onVerifiedFinding: async (_s, _u, finding) => {
        order.push(`case:${finding.id}`);
        return { caseId: "case-1", status: "QUEUED", idempotencyDeduplicated: false };
      },
    },
  );

  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.verified_findings, 1);
  assert.deepEqual(order, ["evidence:f1", "case:f1"]);
});

test("runYoutubeRemovalForUser: tenant isolation — an in-flight scan for a different user doesn't block this one", async () => {
  const supabase = createMockSupabase({
    youtube_removal_scans: [{ id: "s1", user_id: "other-user", status: "running" }],
  });
  const outcome = await runYoutubeRemovalForUser(
    supabase,
    "user-1",
    { display_name: "Jane Doe", verified_name: null },
    { runYoutubeRemovalScan: async () => {} },
  );
  assert.notEqual(outcome.status, "RUNNING");
});
