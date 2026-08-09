/**
 * YouTube Removal Queue — Data Models, Status Transitions & Audit Trail Engine.
 *
 * Manages production removal queue statuses, submission readiness states, and audit log history.
 */

export type QueueStatus =
  | "DISCOVERED"
  | "VERIFIED"
  | "EVIDENCE_REVIEW"
  | "ACTION_RECOMMENDED"
  | "AWAITING_HUMAN_APPROVAL"
  | "SUBMISSION_READY"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "REMOVED"
  | "REJECTED"
  | "ESCALATED"
  | "MONITORING"
  | "NO_ACTION";

export type SubmissionReadiness =
  | "READY"
  | "MISSING_RIGHTS_PROOF"
  | "MISSING_AUTHORIZATION"
  | "MISSING_EVIDENCE"
  | "LEGAL_REVIEW_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED";

export interface AuditLogEntry {
  finding_id: string;
  scan_id?: string;
  video_id: string;
  previous_status: QueueStatus;
  new_status: QueueStatus;
  actor: string; // e.g. "System", "Human Reviewer (Admin)"
  action: string;
  timestamp: string; // ISO 8601
  notes?: string;
}

export interface UIActionMapping {
  label: string;
  primaryButtonVariant: "brand" | "amber" | "indigo" | "outline" | "ghost";
  isActionableTakedown: boolean;
}

export interface YouTubeQueueItem {
  id: string;
  scan_id?: string;
  video_id: string;
  title: string;
  channel: string;
  published_at?: string;
  url: string;
  thumbnail_url?: string;
  subject_verification_status: string;
  verification_score: number;
  evidence_status: "SUFFICIENT" | "INSUFFICIENT" | "UNAVAILABLE";
  evidence_confidence: number;
  transcript_available: boolean;
  evidence_sources: string[];
  removal_classification: "HIGH_REMOVAL" | "MEDIUM_REMOVAL" | "LOW_REMOVAL" | "NOT_ELIGIBLE" | "ANALYSIS_FAILED";
  removal_score: number;
  action_recommendation:
    | "PLATFORM_REPORT_CANDIDATE"
    | "COPYRIGHT_REVIEW"
    | "LEGAL_REVIEW"
    | "IMPERSONATION_REVIEW"
    | "PRIVACY_REVIEW"
    | "HARASSMENT_REVIEW"
    | "MONITOR"
    | "NO_ACTION"
    | "INSUFFICIENT_EVIDENCE";
  policy_signals: {
    hasCopyrightMatch: boolean;
    hasImpersonation: boolean;
    hasManipulatedMedia: boolean;
    hasPrivacyViolation: boolean;
    hasHarassmentOrThreats: boolean;
    hasFactualAllegation: boolean;
    isOpinionOrCommentary: boolean;
    isOfficialOrSupportive: boolean;
  };
  removal_reason_codes: string[];
  supporting_evidence: string[];
  human_readable_reason: string;
  queue_status: QueueStatus;
  submission_readiness: SubmissionReadiness;
  has_rights_proof?: boolean;
  has_authorization?: boolean;
  audit_trail: AuditLogEntry[];
  created_at: string;
  updated_at: string;
}

/** Map action recommendations to human-understandable UI action labels & button behaviors. */
export function mapRecommendationToUIAction(
  recommendation: YouTubeQueueItem["action_recommendation"],
): UIActionMapping {
  switch (recommendation) {
    case "PLATFORM_REPORT_CANDIDATE":
      return {
        label: "Review & Start Platform Report",
        primaryButtonVariant: "brand",
        isActionableTakedown: true,
      };
    case "COPYRIGHT_REVIEW":
      return {
        label: "Review Copyright Evidence",
        primaryButtonVariant: "brand",
        isActionableTakedown: true,
      };
    case "LEGAL_REVIEW":
      return {
        label: "Send for Legal Review",
        primaryButtonVariant: "indigo",
        isActionableTakedown: true,
      };
    case "IMPERSONATION_REVIEW":
      return {
        label: "Review Impersonation Evidence",
        primaryButtonVariant: "brand",
        isActionableTakedown: true,
      };
    case "PRIVACY_REVIEW":
      return {
        label: "Review Privacy Evidence",
        primaryButtonVariant: "brand",
        isActionableTakedown: true,
      };
    case "HARASSMENT_REVIEW":
      return {
        label: "Review Harassment Evidence",
        primaryButtonVariant: "brand",
        isActionableTakedown: true,
      };
    case "MONITOR":
      return {
        label: "Add to Monitoring",
        primaryButtonVariant: "amber",
        isActionableTakedown: false,
      };
    case "INSUFFICIENT_EVIDENCE":
      return {
        label: "Acquire / Review Evidence",
        primaryButtonVariant: "outline",
        isActionableTakedown: false,
      };
    case "NO_ACTION":
    default:
      return {
        label: "No Action Recommended",
        primaryButtonVariant: "ghost",
        isActionableTakedown: false,
      };
  }
}

/** Calculate strict submission readiness status for potentially actionable cases. */
export function calculateSubmissionReadiness(
  item: Partial<YouTubeQueueItem>,
): SubmissionReadiness {
  if (item.removal_classification === "NOT_ELIGIBLE" || item.action_recommendation === "NO_ACTION") {
    return "MANUAL_REVIEW_REQUIRED";
  }

  if (item.action_recommendation === "MONITOR") {
    return "MANUAL_REVIEW_REQUIRED";
  }

  if (item.evidence_status === "INSUFFICIENT" || item.evidence_status === "UNAVAILABLE") {
    return "MISSING_EVIDENCE";
  }

  if (item.action_recommendation === "COPYRIGHT_REVIEW") {
    if (!item.has_rights_proof) return "MISSING_RIGHTS_PROOF";
    if (!item.has_authorization) return "MISSING_AUTHORIZATION";
  }

  if (item.action_recommendation === "LEGAL_REVIEW") {
    return "LEGAL_REVIEW_REQUIRED";
  }

  if (
    item.action_recommendation === "PLATFORM_REPORT_CANDIDATE" ||
    item.action_recommendation === "IMPERSONATION_REVIEW" ||
    item.action_recommendation === "PRIVACY_REVIEW" ||
    item.action_recommendation === "HARASSMENT_REVIEW"
  ) {
    if (!item.has_authorization) return "MISSING_AUTHORIZATION";
    return "READY";
  }

  return "MANUAL_REVIEW_REQUIRED";
}

/** Safely transition queue status while recording an audit log entry. */
export function transitionQueueStatus(
  item: YouTubeQueueItem,
  newStatus: QueueStatus,
  action: string,
  actor = "Human Reviewer",
  notes?: string,
): YouTubeQueueItem {
  const now = new Date().toISOString();
  const entry: AuditLogEntry = {
    finding_id: item.id,
    scan_id: item.scan_id,
    video_id: item.video_id,
    previous_status: item.queue_status,
    new_status: newStatus,
    actor,
    action,
    timestamp: now,
    notes,
  };

  const updated: YouTubeQueueItem = {
    ...item,
    queue_status: newStatus,
    updated_at: now,
    audit_trail: [...(item.audit_trail || []), entry],
  };

  updated.submission_readiness = calculateSubmissionReadiness(updated);
  return updated;
}
