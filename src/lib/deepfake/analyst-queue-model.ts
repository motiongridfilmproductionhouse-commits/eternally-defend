/**
 * YouTube Removal Intelligence — Analyst Queue, Human Override System & Production Feedback Loop.
 *
 * Manages analyst SLA queues (P0-P3), dual AI vs Human decision tracking, human overrides,
 * client decision workflows, and feedback calibration logs.
 */

export type SLAPriority = "P0_CRITICAL" | "P1_HIGH" | "P2_MEDIUM" | "P3_NORMAL";

export type AnalystReviewStatus =
  | "UNASSIGNED"
  | "ASSIGNED"
  | "IN_REVIEW"
  | "NEEDS_CLIENT_INFO"
  | "READY_FOR_CLIENT_APPROVAL"
  | "CLOSED";

export type ClientDecision = "APPROVE" | "REQUEST_CHANGES" | "DECLINE" | "ASK_FOR_REVIEW";

export type FeedbackErrorCategory =
  | "SUBJECT_FALSE_POSITIVE"
  | "SUBJECT_FALSE_NEGATIVE"
  | "EVIDENCE_FAILURE"
  | "ACTION_FALSE_POSITIVE"
  | "ACTION_FALSE_NEGATIVE"
  | "WRONG_COMPLAINT_GROUND"
  | "CONFIDENCE_MISCALIBRATION"
  | "OTHER";

export interface HumanOverrideRecord {
  finding_id: string;
  field_overridden: "removal_classification" | "action_recommendation" | "evidence_status" | "queue_priority";
  ai_original_value: string;
  human_override_value: string;
  reason: string;
  analyst: string;
  timestamp: string;
}

export interface FeedbackCalibrationRecord {
  finding_id: string;
  model_version: string;
  ai_prediction: string;
  human_decision: string;
  override_reason: string;
  error_category: FeedbackErrorCategory;
  timestamp: string;
}

export interface AnalystTask {
  task_id: string;
  client_id: string;
  client_name: string;
  target_id: string;
  target_name: string;
  finding_id: string;
  video_id: string;
  platform: "YOUTUBE";
  priority: SLAPriority;
  ai_action_recommendation: string;
  human_action_recommendation?: string;
  evidence_confidence: number;
  authorization_state: string;
  assigned_analyst?: string;
  created_at: string;
  sla_deadline: string;
  review_status: AnalystReviewStatus;
  override_history: HumanOverrideRecord[];
  client_decision?: ClientDecision;
  client_decision_notes?: string;
  client_decision_at?: string;
}

/** Record human analyst override while preserving original AI decision separately. */
export function recordHumanOverride(
  task: AnalystTask,
  field: HumanOverrideRecord["field_overridden"],
  newValue: string,
  reason: string,
  analyst: string,
  errorCategory: FeedbackErrorCategory = "OTHER",
): { updatedTask: AnalystTask; calibrationRecord: FeedbackCalibrationRecord } {
  const now = new Date().toISOString();
  const prevValue = task.human_action_recommendation || task.ai_action_recommendation;

  const overrideEntry: HumanOverrideRecord = {
    finding_id: task.finding_id,
    field_overridden: field,
    ai_original_value: task.ai_action_recommendation,
    human_override_value: newValue,
    reason,
    analyst,
    timestamp: now,
  };

  const calibrationRecord: FeedbackCalibrationRecord = {
    finding_id: task.finding_id,
    model_version: "youtube-removal-intelligence-v1-production-baseline",
    ai_prediction: task.ai_action_recommendation,
    human_decision: newValue,
    override_reason: reason,
    error_category: errorCategory,
    timestamp: now,
  };

  const updatedTask: AnalystTask = {
    ...task,
    human_action_recommendation: newValue,
    override_history: [...(task.override_history || []), overrideEntry],
    review_status: "READY_FOR_CLIENT_APPROVAL",
  };

  return { updatedTask, calibrationRecord };
}

/** Process explicit client approval center decision. */
export function processClientDecision(
  task: AnalystTask,
  decision: ClientDecision,
  notes?: string,
): AnalystTask {
  const now = new Date().toISOString();

  let nextReviewStatus: AnalystReviewStatus = task.review_status;
  if (decision === "APPROVE") {
    nextReviewStatus = "CLOSED";
  } else if (decision === "REQUEST_CHANGES" || decision === "ASK_FOR_REVIEW") {
    nextReviewStatus = "IN_REVIEW";
  } else if (decision === "DECLINE") {
    nextReviewStatus = "CLOSED";
  }

  return {
    ...task,
    client_decision: decision,
    client_decision_notes: notes,
    client_decision_at: now,
    review_status: nextReviewStatus,
  };
}
