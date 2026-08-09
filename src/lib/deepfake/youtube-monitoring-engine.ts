/**
 * YouTube Removal Intelligence — Persistent Monitoring & Change Detection Engine.
 *
 * Manages target-linked persistent finding identities, versioned immutable snapshot histories,
 * smart change detection with severity levels, risk escalation guards, and event emission.
 */

import crypto from "node:crypto";

export type AvailabilityStatus =
  | "PUBLIC"
  | "PRIVATE"
  | "UNLISTED"
  | "REMOVED"
  | "UNAVAILABLE"
  | "REGION_RESTRICTED"
  | "UNKNOWN";

export type RemovalAttribution =
  | "PLATFORM_CONFIRMED_REMOVAL"
  | "CLAIMANT_CONFIRMED_REMOVAL"
  | "OBSERVED_UNAVAILABLE"
  | "CREATOR_DELETED"
  | "PRIVATE_OR_RESTRICTED"
  | "UNKNOWN";

export type MonitoringTier = "NORMAL" | "ELEVATED" | "ACTIVE_CASE";
export type MonitoringUrgency = "NORMAL" | "WATCH" | "ELEVATED" | "URGENT";

export type ChangeType =
  | "TITLE_CHANGED"
  | "DESCRIPTION_CHANGED"
  | "CHANNEL_CHANGED"
  | "TRANSCRIPT_CHANGED"
  | "NEW_TRANSCRIPT_AVAILABLE"
  | "TRANSCRIPT_REMOVED"
  | "THUMBNAIL_CHANGED"
  | "VIDEO_UNAVAILABLE"
  | "VIDEO_AVAILABLE_AGAIN"
  | "PRIVACY_STATUS_CHANGED"
  | "EVIDENCE_CHANGED"
  | "RISK_INCREASED"
  | "RISK_DECREASED"
  | "ACTION_RECOMMENDATION_CHANGED"
  | "REMOVAL_CLASSIFICATION_CHANGED"
  | "POSSIBLE_REUPLOAD";

export type ChangeSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ChangeRecord {
  change_type: ChangeType;
  severity: ChangeSeverity;
  previous_value?: string;
  new_value?: string;
  timestamp: string;
  description: string;
}

export interface FindingSnapshot {
  snapshot_version: number;
  video_id: string;
  title: string;
  description: string;
  channel: string;
  channel_id?: string;
  published_at?: string;
  availability_status: AvailabilityStatus;
  thumbnail_url?: string;
  transcript_hash: string;
  description_hash: string;
  title_hash: string;
  evidence_hash: string;
  verification_status: string;
  verification_score: number;
  evidence_status: string;
  evidence_confidence: number;
  removal_classification: string;
  removal_score: number;
  action_recommendation: string;
  reason_codes: string[];
  captured_at: string;
}

export interface PersistentFinding {
  composite_key: string; // target_id::YOUTUBE::video_id
  target_id: string;
  platform: "YOUTUBE";
  video_id: string;
  url: string;
  title: string;
  channel: string;
  first_seen_at: string;
  last_seen_at: string;
  last_scanned_at: string;
  last_changed_at: string;
  scan_count: number;
  current_status: string;
  previous_risk_score: number;
  current_risk_score: number;
  latest_evidence_version: number;
  availability_status: AvailabilityStatus;
  removal_attribution: RemovalAttribution;
  monitoring_tier: MonitoringTier;
  monitoring_urgency: MonitoringUrgency;
  latest_snapshot: FindingSnapshot;
  snapshot_history: FindingSnapshot[];
  change_history: ChangeRecord[];
}

export interface MonitoringEvent {
  event_type:
    | "youtube.finding.changed"
    | "youtube.risk.increased"
    | "youtube.video.unavailable"
    | "youtube.video.reappeared"
    | "youtube.action.changed"
    | "youtube.new_evidence"
    | "youtube.possible_reupload";
  target_id: string;
  video_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** Compute a SHA-256 hash digest for a text content string. */
export function computeContentHash(text: string): string {
  const normalized = (text || "").trim().replace(/\s+/g, " ");
  try {
    return crypto.createHash("sha256").update(normalized).digest("hex");
  } catch {
    let h = 0;
    for (let i = 0; i < normalized.length; i++) {
      h = (Math.imul(31, h) + normalized.charCodeAt(i)) | 0;
    }
    return `hash_${Math.abs(h).toString(16)}`;
  }
}

/** Assign change severity based on change type and risk score diff. */
export function calculateChangeSeverity(
  changeType: ChangeType,
  prevScore: number,
  nextScore: number,
): ChangeSeverity {
  switch (changeType) {
    case "VIDEO_AVAILABLE_AGAIN":
    case "POSSIBLE_REUPLOAD":
      return "CRITICAL";
    case "VIDEO_UNAVAILABLE":
    case "ACTION_RECOMMENDATION_CHANGED":
      return nextScore > prevScore ? "CRITICAL" : "HIGH";
    case "RISK_INCREASED":
      return nextScore >= 70 ? "CRITICAL" : "HIGH";
    case "NEW_TRANSCRIPT_AVAILABLE":
    case "TRANSCRIPT_CHANGED":
      return "MEDIUM";
    case "DESCRIPTION_CHANGED":
    case "TITLE_CHANGED":
      return "LOW";
    case "RISK_DECREASED":
    case "INFO" as any:
    default:
      return "INFO";
  }
}

/** Detect meaningful changes between a previous snapshot and a new snapshot. */
export function detectFindingChanges(
  prevSnap?: FindingSnapshot,
  nextSnap?: FindingSnapshot,
): ChangeRecord[] {
  if (!prevSnap || !nextSnap) return [];

  const changes: ChangeRecord[] = [];
  const now = nextSnap.captured_at;

  // Title change
  if (prevSnap.title_hash !== nextSnap.title_hash && prevSnap.title !== nextSnap.title) {
    changes.push({
      change_type: "TITLE_CHANGED",
      severity: calculateChangeSeverity("TITLE_CHANGED", prevSnap.removal_score, nextSnap.removal_score),
      previous_value: prevSnap.title,
      new_value: nextSnap.title,
      timestamp: now,
      description: `Title changed from "${prevSnap.title}" to "${nextSnap.title}"`,
    });
  }

  // Description change
  if (prevSnap.description_hash !== nextSnap.description_hash && prevSnap.description !== nextSnap.description) {
    changes.push({
      change_type: "DESCRIPTION_CHANGED",
      severity: calculateChangeSeverity("DESCRIPTION_CHANGED", prevSnap.removal_score, nextSnap.removal_score),
      timestamp: now,
      description: "Video description content updated materially",
    });
  }

  // Transcript availability change
  if (prevSnap.transcript_hash !== nextSnap.transcript_hash) {
    if (!prevSnap.transcript_hash && nextSnap.transcript_hash) {
      changes.push({
        change_type: "NEW_TRANSCRIPT_AVAILABLE",
        severity: "MEDIUM",
        timestamp: now,
        description: "New transcript/captions became available for video",
      });
    } else if (prevSnap.transcript_hash && !nextSnap.transcript_hash) {
      changes.push({
        change_type: "TRANSCRIPT_REMOVED",
        severity: "MEDIUM",
        timestamp: now,
        description: "Transcript/captions became unavailable",
      });
    } else {
      changes.push({
        change_type: "TRANSCRIPT_CHANGED",
        severity: "MEDIUM",
        timestamp: now,
        description: "Transcript content updated",
      });
    }
  }

  // Availability status change
  if (prevSnap.availability_status !== nextSnap.availability_status) {
    if (nextSnap.availability_status === "UNAVAILABLE" || nextSnap.availability_status === "REMOVED") {
      changes.push({
        change_type: "VIDEO_UNAVAILABLE",
        severity: "HIGH",
        previous_value: prevSnap.availability_status,
        new_value: nextSnap.availability_status,
        timestamp: now,
        description: `Video availability status changed to ${nextSnap.availability_status}`,
      });
    } else if (prevSnap.availability_status === "UNAVAILABLE" || prevSnap.availability_status === "REMOVED") {
      changes.push({
        change_type: "VIDEO_AVAILABLE_AGAIN",
        severity: "CRITICAL",
        previous_value: prevSnap.availability_status,
        new_value: nextSnap.availability_status,
        timestamp: now,
        description: "Previously unavailable video became available again (Resurface alert)",
      });
    }
  }

  // Action Recommendation / Risk Score change
  if (prevSnap.action_recommendation !== nextSnap.action_recommendation) {
    const isEscalation = nextSnap.removal_score > prevSnap.removal_score;
    changes.push({
      change_type: "ACTION_RECOMMENDATION_CHANGED",
      severity: isEscalation ? "CRITICAL" : "MEDIUM",
      previous_value: prevSnap.action_recommendation,
      new_value: nextSnap.action_recommendation,
      timestamp: now,
      description: `Action recommendation changed from ${prevSnap.action_recommendation} to ${nextSnap.action_recommendation}`,
    });
  }

  if (nextSnap.removal_score > prevSnap.removal_score + 5) {
    changes.push({
      change_type: "RISK_INCREASED",
      severity: calculateChangeSeverity("RISK_INCREASED", prevSnap.removal_score, nextSnap.removal_score),
      previous_value: `${prevSnap.removal_score}%`,
      new_value: `${nextSnap.removal_score}%`,
      timestamp: now,
      description: `Risk score increased from ${prevSnap.removal_score}% to ${nextSnap.removal_score}%`,
    });
  }

  return changes;
}

/** UPSERT persistent finding record while maintaining immutable snapshot history. */
export function upsertPersistentFinding(
  targetId: string,
  hitData: {
    video_id: string;
    url: string;
    title: string;
    description?: string;
    channel: string;
    published_at?: string;
    thumbnail_url?: string;
    transcript?: string;
    availability_status?: AvailabilityStatus;
    verification_status: string;
    verification_score: number;
    evidence_status: string;
    evidence_confidence: number;
    removal_classification: string;
    removal_score: number;
    action_recommendation: string;
    reason_codes: string[];
  },
  existingFinding?: PersistentFinding,
): { finding: PersistentFinding; changes: ChangeRecord[]; events: MonitoringEvent[] } {
  const now = new Date().toISOString();
  const compositeKey = `${targetId}::YOUTUBE::${hitData.video_id}`;

  const titleHash = computeContentHash(hitData.title);
  const descriptionHash = computeContentHash(hitData.description || "");
  const transcriptHash = computeContentHash(hitData.transcript || "");
  const evidenceHash = computeContentHash(`${titleHash}:${descriptionHash}:${transcriptHash}:${hitData.removal_score}`);

  const snapshotVersion = existingFinding ? existingFinding.latest_evidence_version + 1 : 1;

  const newSnapshot: FindingSnapshot = {
    snapshot_version: snapshotVersion,
    video_id: hitData.video_id,
    title: hitData.title,
    description: hitData.description || "",
    channel: hitData.channel,
    published_at: hitData.published_at,
    availability_status: hitData.availability_status || "PUBLIC",
    thumbnail_url: hitData.thumbnail_url,
    transcript_hash: transcriptHash,
    description_hash: descriptionHash,
    title_hash: titleHash,
    evidence_hash: evidenceHash,
    verification_status: hitData.verification_status,
    verification_score: hitData.verification_score,
    evidence_status: hitData.evidence_status,
    evidence_confidence: hitData.evidence_confidence,
    removal_classification: hitData.removal_classification,
    removal_score: hitData.removal_score,
    action_recommendation: hitData.action_recommendation,
    reason_codes: hitData.reason_codes,
    captured_at: now,
  };

  const changes = existingFinding
    ? detectFindingChanges(existingFinding.latest_snapshot, newSnapshot)
    : [];

  const isChanged = changes.length > 0;
  const lastChangedAt = isChanged ? now : existingFinding?.last_changed_at || now;

  let currentStatus = existingFinding?.current_status || "DISCOVERED";
  let urgency: MonitoringUrgency = "NORMAL";

  // Evaluate Risk Escalation
  if (existingFinding && existingFinding.latest_snapshot.action_recommendation === "MONITOR") {
    if (
      hitData.action_recommendation === "LEGAL_REVIEW" ||
      hitData.action_recommendation === "COPYRIGHT_REVIEW" ||
      hitData.action_recommendation === "PLATFORM_REPORT_CANDIDATE" ||
      hitData.action_recommendation === "IMPERSONATION_REVIEW" ||
      hitData.action_recommendation === "PRIVACY_REVIEW" ||
      hitData.action_recommendation === "HARASSMENT_REVIEW"
    ) {
      currentStatus = "ACTION_RECOMMENDED";
      urgency = "URGENT";
    }
  }

  const updatedFinding: PersistentFinding = {
    composite_key: compositeKey,
    target_id: targetId,
    platform: "YOUTUBE",
    video_id: hitData.video_id,
    url: hitData.url,
    title: hitData.title,
    channel: hitData.channel,
    first_seen_at: existingFinding?.first_seen_at || now,
    last_seen_at: now,
    last_scanned_at: now,
    last_changed_at: lastChangedAt,
    scan_count: (existingFinding?.scan_count || 0) + 1,
    current_status: currentStatus,
    previous_risk_score: existingFinding?.current_risk_score ?? hitData.removal_score,
    current_risk_score: hitData.removal_score,
    latest_evidence_version: snapshotVersion,
    availability_status: hitData.availability_status || "PUBLIC",
    removal_attribution: hitData.availability_status === "UNAVAILABLE" ? "OBSERVED_UNAVAILABLE" : "UNKNOWN",
    monitoring_tier: hitData.action_recommendation === "MONITOR" ? "ELEVATED" : "NORMAL",
    monitoring_urgency: urgency,
    latest_snapshot: newSnapshot,
    snapshot_history: [...(existingFinding?.snapshot_history || []), newSnapshot],
    change_history: [...(existingFinding?.change_history || []), ...changes],
  };

  const events: MonitoringEvent[] = changes.map((ch) => ({
    event_type: mapChangeTypeToEventType(ch.change_type),
    target_id: targetId,
    video_id: hitData.video_id,
    timestamp: now,
    payload: {
      change_type: ch.change_type,
      severity: ch.severity,
      description: ch.description,
      previous_value: ch.previous_value,
      new_value: ch.new_value,
    },
  }));

  return {
    finding: updatedFinding,
    changes,
    events,
  };
}

function mapChangeTypeToEventType(changeType: ChangeType): MonitoringEvent["event_type"] {
  switch (changeType) {
    case "RISK_INCREASED":
      return "youtube.risk.increased";
    case "VIDEO_UNAVAILABLE":
      return "youtube.video.unavailable";
    case "VIDEO_AVAILABLE_AGAIN":
      return "youtube.video.reappeared";
    case "ACTION_RECOMMENDATION_CHANGED":
      return "youtube.action.changed";
    case "TRANSCRIPT_CHANGED":
    case "NEW_TRANSCRIPT_AVAILABLE":
      return "youtube.new_evidence";
    case "POSSIBLE_REUPLOAD":
      return "youtube.possible_reupload";
    case "TITLE_CHANGED":
    case "DESCRIPTION_CHANGED":
    default:
      return "youtube.finding.changed";
  }
}
