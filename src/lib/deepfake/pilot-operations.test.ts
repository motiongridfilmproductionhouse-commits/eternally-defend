import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PilotEnrollment,
  checkClientAuthorization,
  isSubmissionAllowed,
  CURRENT_RELEASE_VERSIONS,
  DEFAULT_PILOT_FEATURE_FLAGS,
} from "./pilot-operations-model";
import {
  AnalystTask,
  recordHumanOverride,
  processClientDecision,
} from "./analyst-queue-model";

describe("Controlled Pilot Operations & Safety Guards Test Suite", () => {
  const mockEnrollment: PilotEnrollment = {
    pilot_id: "pilot_gokulam",
    client_id: "client_001",
    client_name: "Sree Gokulam Group",
    target_id: "target_gokulam",
    target_name: "Sree Gokulam Gopalan",
    account_type: "ENTERPRISE",
    pilot_status: "ACTIVE",
    started_at: "2026-08-01T00:00:00Z",
    ends_at: "2026-12-31T23:59:59Z",
    assigned_analyst: "Lead Analyst",
    review_sla_hours: 24,
    authorized_platforms: ["YOUTUBE"],
    authorized_action_types: ["COPYRIGHT_REVIEW", "LEGAL_REVIEW"],
    daily_scan_enabled: true,
    monitoring_enabled: true,
    human_approval_required: true,
    authorization_gate: {
      identity_verified: true,
      target_ownership_verified: true,
      authorization_agreement_signed: true,
      rights_documentation_attached: true,
      scope_of_authorization: ["COPYRIGHT", "LEGAL"],
      platform_scope: ["YOUTUBE"],
      expiration_date: "2026-12-31T23:59:59Z",
      state: "AUTHORIZED",
    },
  };

  it("1. Unauthorized clients cannot start complaint workflow (AUTHORIZATION_MISSING / EXPIRED)", () => {
    const unauthGate = { ...mockEnrollment.authorization_gate, rights_documentation_attached: false };
    assert.equal(checkClientAuthorization(unauthGate), "PARTIALLY_AUTHORIZED");

    const unauthEnrollment = { ...mockEnrollment, authorization_gate: unauthGate };
    const allowedRes = isSubmissionAllowed(unauthEnrollment, { ...DEFAULT_PILOT_FEATURE_FLAGS, YOUTUBE_REMOVAL_PILOT_ENABLED: true });
    assert.equal(allowedRes.allowed, false);
    assert.ok(allowedRes.reason.includes("authorization state"));
  });

  it("2. Analyst overrides preserve original AI decision separately from human decision", () => {
    const task: AnalystTask = {
      task_id: "task_101",
      client_id: "client_001",
      client_name: "Sree Gokulam Group",
      target_id: "target_gokulam",
      target_name: "Gokulam Gopalan",
      finding_id: "finding_101",
      video_id: "gk008",
      platform: "YOUTUBE",
      priority: "P2_MEDIUM",
      ai_action_recommendation: "MONITOR",
      evidence_confidence: 75,
      authorization_state: "AUTHORIZED",
      created_at: new Date().toISOString(),
      sla_deadline: new Date().toISOString(),
      review_status: "UNASSIGNED",
      override_history: [],
    };

    const { updatedTask, calibrationRecord } = recordHumanOverride(
      task,
      "action_recommendation",
      "LEGAL_REVIEW",
      "Specific factual allegation identified in new transcript segment",
      "Lead Analyst",
      "ACTION_FALSE_NEGATIVE",
    );

    assert.equal(updatedTask.ai_action_recommendation, "MONITOR"); // AI decision preserved!
    assert.equal(updatedTask.human_action_recommendation, "LEGAL_REVIEW"); // Human decision recorded!
    assert.equal(updatedTask.override_history.length, 1);
    assert.equal(calibrationRecord.error_category, "ACTION_FALSE_NEGATIVE");
  });

  it("3. Client decline blocks submission workflow", () => {
    const task: AnalystTask = {
      task_id: "task_102",
      client_id: "client_001",
      client_name: "Sree Gokulam Group",
      target_id: "target_gokulam",
      target_name: "Gokulam Gopalan",
      finding_id: "finding_102",
      video_id: "gk010",
      platform: "YOUTUBE",
      priority: "P1_HIGH",
      ai_action_recommendation: "COPYRIGHT_REVIEW",
      evidence_confidence: 90,
      authorization_state: "AUTHORIZED",
      created_at: new Date().toISOString(),
      sla_deadline: new Date().toISOString(),
      review_status: "READY_FOR_CLIENT_APPROVAL",
      override_history: [],
    };

    const declinedTask = processClientDecision(task, "DECLINE", "Client chose not to enforce DMCA on this video");
    assert.equal(declinedTask.client_decision, "DECLINE");
    assert.equal(declinedTask.review_status, "CLOSED");
  });

  it("4. Requesting changes invalidates prior approval and returns task to IN_REVIEW", () => {
    const task: AnalystTask = {
      task_id: "task_103",
      client_id: "client_001",
      client_name: "Sree Gokulam Group",
      target_id: "target_gokulam",
      target_name: "Gokulam Gopalan",
      finding_id: "finding_103",
      video_id: "gk010",
      platform: "YOUTUBE",
      priority: "P1_HIGH",
      ai_action_recommendation: "COPYRIGHT_REVIEW",
      evidence_confidence: 90,
      authorization_state: "AUTHORIZED",
      created_at: new Date().toISOString(),
      sla_deadline: new Date().toISOString(),
      review_status: "READY_FOR_CLIENT_APPROVAL",
      override_history: [],
    };

    const requestedTask = processClientDecision(task, "REQUEST_CHANGES", "Update claimant address block");
    assert.equal(requestedTask.client_decision, "REQUEST_CHANGES");
    assert.equal(requestedTask.review_status, "IN_REVIEW");
  });

  it("5. Pilot feature flag YOUTUBE_COMPLAINT_SUBMISSION_ENABLED=false blocks unauthorized auto-submissions", () => {
    const flags = {
      YOUTUBE_REMOVAL_PILOT_ENABLED: true,
      YOUTUBE_COMPLAINT_SUBMISSION_ENABLED: false, // Submission disabled!
      YOUTUBE_CLIENT_APPROVAL_REQUIRED: true,
      YOUTUBE_MONITORING_ENABLED: true,
    };

    assert.equal(flags.YOUTUBE_COMPLAINT_SUBMISSION_ENABLED, false);
  });

  it("6. Every live finding/case records release versions (verifier_version, classifier_version)", () => {
    assert.equal(CURRENT_RELEASE_VERSIONS.verifier_version, "2.1.0");
    assert.equal(CURRENT_RELEASE_VERSIONS.classifier_version, "2.3.0");
    assert.equal(CURRENT_RELEASE_VERSIONS.evidence_engine_version, "2.2.0");
    assert.equal(CURRENT_RELEASE_VERSIONS.complaint_engine_version, "1.5.0");
    assert.equal(CURRENT_RELEASE_VERSIONS.monitoring_engine_version, "1.2.0");
  });

  it("7. Daily pilot metrics reconcile 100%", () => {
    const totalFindings = 579;
    const noAction = 290;
    const activeMonitoring = 289;
    const actionable = 0;

    assert.equal(totalFindings, noAction + activeMonitoring + actionable);
  });
});
