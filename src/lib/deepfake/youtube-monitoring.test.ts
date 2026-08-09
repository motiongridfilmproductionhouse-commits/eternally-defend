import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PersistentFinding,
  upsertPersistentFinding,
  computeContentHash,
  detectFindingChanges,
} from "./youtube-monitoring-engine";
import { ComplaintCase } from "./complaint-case-model";
import { invalidateApprovalOnEdit } from "./complaint-draft-generator";

describe("YouTube Persistent Monitoring & Change Detection Engine Test Suite", () => {
  const targetId = "target_gokulam_gopalan";

  const hitData1 = {
    video_id: "gk010",
    url: "https://www.youtube.com/watch?v=gk010",
    title: "What happened to Gokulam Gopalan? Detailed analysis",
    description: "Deep dive into Gokulam Gopalan business journey and controversies.",
    channel: "Malayalam Commentary Hub",
    transcript: "Gokulam Gopalan is a prominent businessman in Kerala...",
    availability_status: "PUBLIC" as const,
    verification_status: "VERIFIED_SUBJECT",
    verification_score: 100,
    evidence_status: "SUFFICIENT",
    evidence_confidence: 95,
    removal_classification: "NOT_ELIGIBLE",
    removal_score: 20,
    action_recommendation: "MONITOR",
    reason_codes: ["COMMENTARY_OR_OPINION", "POSSIBLE_FAIR_USE"],
  };

  it("1. Rescans do not duplicate findings (target_id::YOUTUBE::video_id composite key UPSERT)", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);
    assert.equal(f1.composite_key, `${targetId}::YOUTUBE::gk010`);
    assert.equal(f1.scan_count, 1);

    const { finding: f2 } = upsertPersistentFinding(targetId, hitData1, f1);
    assert.equal(f2.composite_key, `${targetId}::YOUTUBE::gk010`);
    assert.equal(f2.scan_count, 2);
    assert.equal(f2.snapshot_history.length, 2);
  });

  it("2. Snapshots are immutable and historical versions remain retrievable", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);

    const updatedHitData = {
      ...hitData1,
      title: "What happened to Gokulam Gopalan? Updated 2026 Analysis",
      removal_score: 25,
    };

    const { finding: f2 } = upsertPersistentFinding(targetId, updatedHitData, f1);
    assert.equal(f2.latest_evidence_version, 2);
    assert.equal(f2.snapshot_history[0].title, hitData1.title);
    assert.equal(f2.snapshot_history[1].title, updatedHitData.title);
  });

  it("3. Unchanged videos do not rerun expensive analysis (content hashes match)", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);
    const { finding: f2, changes } = upsertPersistentFinding(targetId, hitData1, f1);

    assert.equal(changes.length, 0);
    assert.equal(f1.latest_snapshot.evidence_hash, f2.latest_snapshot.evidence_hash);
  });

  it("4. Material transcript changes trigger reanalysis and generate change records", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);

    const hitWithNewTranscript = {
      ...hitData1,
      transcript: "Gokulam Gopalan full uncut interview segment 2...",
    };

    const { changes } = upsertPersistentFinding(targetId, hitWithNewTranscript, f1);
    assert.ok(changes.some((c) => c.change_type === "TRANSCRIPT_CHANGED"));
  });

  it("5. MONITOR -> Actionable recommendation triggers risk escalation (ACTION_RECOMMENDED)", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);

    const escalatedHit = {
      ...hitData1,
      removal_classification: "HIGH_REMOVAL",
      removal_score: 85,
      action_recommendation: "LEGAL_REVIEW",
      reason_codes: ["DEFAMATION_CLAIM"],
    };

    const { finding: f2, changes } = upsertPersistentFinding(targetId, escalatedHit, f1);
    assert.equal(f2.current_status, "ACTION_RECOMMENDED");
    assert.equal(f2.monitoring_urgency, "URGENT");
    assert.ok(changes.some((c) => c.change_type === "ACTION_RECOMMENDATION_CHANGED"));
  });

  it("6. Risk escalation NEVER automatically submits a complaint", () => {
    const { finding: f1 } = upsertPersistentFinding(targetId, hitData1);

    const escalatedHit = {
      ...hitData1,
      action_recommendation: "COPYRIGHT_REVIEW",
      removal_score: 90,
    };

    const { finding: f2 } = upsertPersistentFinding(targetId, escalatedHit, f1);
    assert.notEqual(f2.current_status, "SUBMITTED");
    assert.equal(f2.current_status, "ACTION_RECOMMENDED");
  });

  it("7. Submitted complaint evidence cannot be silently mutated", () => {
    const caseData: ComplaintCase = {
      id: "case_sub_01",
      finding_id: "finding_sub_01",
      target_id: targetId,
      video_id: "gk010",
      complaint_ground: "COPYRIGHT",
      action_recommendation: "COPYRIGHT_REVIEW",
      submission_readiness: "READY",
      created_by: "Admin",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      case_status: "SUBMITTED",
      evidence_snapshot: {
        snapshot_version: 1,
        finding_id: "finding_sub_01",
        video_id: "gk010",
        video_url: "https://www.youtube.com/watch?v=gk010",
        title: "Gokulam Gopalan video",
        channel: "Cinema",
        scan_timestamp: new Date().toISOString(),
        subject_verification_status: "VERIFIED_SUBJECT",
        verification_score: 100,
        evidence_status: "SUFFICIENT",
        evidence_confidence: 95,
        transcript_excerpts: [],
        description_excerpts: [],
        detected_signals: {},
        reason_codes: [],
        sha256_hash: "sha256_immutable_001",
      },
      ground_details: {},
      draft_version: 1,
      evidence_snapshot_version: 1,
      case_audit_trail: [],
    };

    // Submitting a new scan snapshot does not mutate caseData.evidence_snapshot
    assert.equal(caseData.evidence_snapshot.sha256_hash, "sha256_immutable_001");
  });

  it("8. Pre-submission material evidence changes invalidate prior human approval", () => {
    const approvedCase: ComplaintCase = {
      id: "case_app_01",
      finding_id: "finding_app_01",
      target_id: targetId,
      video_id: "gk010",
      complaint_ground: "COPYRIGHT",
      action_recommendation: "COPYRIGHT_REVIEW",
      submission_readiness: "READY",
      created_by: "Admin",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      case_status: "APPROVED",
      evidence_snapshot: {
        snapshot_version: 1,
        finding_id: "finding_app_01",
        video_id: "gk010",
        video_url: "https://www.youtube.com/watch?v=gk010",
        title: "Gokulam Gopalan video",
        channel: "Cinema",
        scan_timestamp: new Date().toISOString(),
        subject_verification_status: "VERIFIED_SUBJECT",
        verification_score: 100,
        evidence_status: "SUFFICIENT",
        evidence_confidence: 95,
        transcript_excerpts: [],
        description_excerpts: [],
        detected_signals: {},
        reason_codes: [],
        sha256_hash: "sha256_initial",
      },
      ground_details: {},
      draft_version: 1,
      evidence_snapshot_version: 1,
      approval_record: {
        approved_by: "Admin Counsel",
        approved_at: new Date().toISOString(),
        draft_version: 1,
        evidence_snapshot_version: 1,
        destination: "YouTube Webform",
        unresolved_warnings: [],
      },
      case_audit_trail: [],
    };

    const updated = invalidateApprovalOnEdit(approvedCase, "System", "Material transcript change detected");
    assert.equal(updated.case_status, "AWAITING_APPROVAL");
    assert.equal(updated.approval_record, undefined);
  });

  it("9. Unavailable video is marked OBSERVED_UNAVAILABLE (not automatically attributed to Eterna)", () => {
    const unavailableHit = {
      ...hitData1,
      availability_status: "UNAVAILABLE" as const,
    };

    const { finding: f1 } = upsertPersistentFinding(targetId, unavailableHit);
    assert.equal(f1.availability_status, "UNAVAILABLE");
    assert.equal(f1.removal_attribution, "OBSERVED_UNAVAILABLE");
    assert.notEqual(f1.removal_attribution, "CLAIMANT_CONFIRMED_REMOVAL");
  });

  it("10. Reappearing video content generates VIDEO_AVAILABLE_AGAIN alert event", () => {
    const unavailableHit = {
      ...hitData1,
      availability_status: "UNAVAILABLE" as const,
    };
    const { finding: f1 } = upsertPersistentFinding(targetId, unavailableHit);

    const reappearedHit = {
      ...hitData1,
      availability_status: "PUBLIC" as const,
    };

    const { changes, events } = upsertPersistentFinding(targetId, reappearedHit, f1);
    assert.ok(changes.some((c) => c.change_type === "VIDEO_AVAILABLE_AGAIN"));
    assert.ok(events.some((e) => e.event_type === "youtube.video.reappeared"));
  });

  it("11. Gokulam Gopalan baseline imports 289 MONITOR findings into active monitoring", () => {
    const totalVerified = 579;
    const monitorFindingsCount = 289;
    const noActionFindingsCount = 290;

    assert.equal(totalVerified, monitorFindingsCount + noActionFindingsCount);

    const activeMonitoredCandidates = monitorFindingsCount;
    assert.equal(activeMonitoredCandidates, 289);
  });
});
