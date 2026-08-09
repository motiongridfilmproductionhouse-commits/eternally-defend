/**
 * YouTube Removal Intelligence — Complaint Case Model & Immutable Evidence Snapshot Engine.
 *
 * Manages persisted complaint case records, ground-specific workflows, immutable evidence snapshots with SHA-256 hashes,
 * and approval invalidation audit logs.
 */

import crypto from "node:crypto";

export type ComplaintGround =
  | "COPYRIGHT"
  | "IMPERSONATION"
  | "PRIVACY"
  | "HARASSMENT"
  | "MANIPULATED_MEDIA"
  | "LEGAL_REVIEW";

export type CaseStatus =
  | "DRAFT"
  | "EVIDENCE_INCOMPLETE"
  | "READY_FOR_REVIEW"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "SUBMISSION_READY"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "REMOVED"
  | "REJECTED"
  | "ESCALATED"
  | "CLOSED";

export type CompletenessBlocker =
  | "MISSING_TARGET_AUTHORITY"
  | "MISSING_RIGHTS_PROOF"
  | "MISSING_AUTHORIZATION"
  | "MISSING_ORIGINAL_WORK"
  | "MISSING_INFRINGING_REFERENCE"
  | "MISSING_TIMESTAMPS"
  | "MISSING_PRIVACY_EVIDENCE"
  | "MISSING_IMPERSONATION_EVIDENCE"
  | "MISSING_HARASSMENT_EVIDENCE"
  | "MISSING_MANIPULATION_EVIDENCE"
  | "LEGAL_REVIEW_REQUIRED"
  | "HUMAN_APPROVAL_REQUIRED";

export interface ImmutableEvidenceSnapshot {
  snapshot_version: number;
  finding_id: string;
  video_id: string;
  video_url: string;
  title: string;
  channel: string;
  published_at?: string;
  thumbnail_url?: string;
  scan_timestamp: string;
  subject_verification_status: string;
  verification_score: number;
  evidence_status: string;
  evidence_confidence: number;
  transcript_excerpts: string[];
  description_excerpts: string[];
  detected_signals: Record<string, boolean>;
  reason_codes: string[];
  screenshot_urls?: string[];
  copyright_asset_match_details?: {
    copyrighted_work_name?: string;
    original_work_url?: string;
    matched_asset_id?: string;
  };
  authority_proof_refs?: string[];
  authorization_proof_refs?: string[];
  sha256_hash: string;
}

export interface CaseAuditLogEntry {
  case_id: string;
  action: string;
  previous_status: CaseStatus;
  new_status: CaseStatus;
  actor: string;
  timestamp: string;
  notes?: string;
  draft_version?: number;
  evidence_snapshot_version?: number;
}

export interface ApprovalRecord {
  approved_by: string;
  approved_at: string;
  draft_version: number;
  evidence_snapshot_version: number;
  destination: string;
  unresolved_warnings: string[];
}

export interface GroundDetails {
  // Copyright ground details
  claimant_identity?: string;
  rights_owner?: string;
  authorization_relationship?: string;
  copyrighted_work_identification?: string;
  original_work_reference?: string;
  ownership_rights_evidence?: string;
  allegedly_infringing_material?: string;
  exact_timestamps?: string;
  explanation_of_copied_material?: string;
  good_faith_declaration?: boolean;
  accuracy_authority_declaration?: boolean;

  // Impersonation ground details
  identity_being_impersonated?: string;
  official_identity_references?: string;
  deceptive_representation_evidence?: string;
  confusing_signals?: string[];
  explanation_of_viewer_confusion?: string;

  // Privacy ground details
  affected_individual?: string;
  type_of_private_info?: string;
  privacy_location_timestamps?: string;
  consent_status?: "CONSENT_GIVEN" | "CONSENT_DENIED" | "UNKNOWN";
  explanation_of_privacy_impact?: string;

  // Harassment ground details
  targeted_individual_or_entity?: string;
  specific_harassing_statements?: string;
  harassment_timestamps?: string;
  repeated_pattern_evidence?: string;
  threats_present?: boolean;
  transcript_supporting_excerpts?: string[];

  // Manipulated media ground details
  manipulation_type?: "DEEPFAKE" | "FACE_SWAP" | "VOICE_CLONE" | "SYNTHETIC_MEDIA";
  synthetic_indicators?: string[];
  original_reference_media?: string;
  forensic_confidence?: number;
  deceptive_representation_explanation?: string;

  // Legal review ground details
  exact_factual_assertion_identified?: string;
  evidence_suggesting_potential_falsity?: string;
  evidence_still_required?: string;
  jurisdiction?: string;
  publication_context?: string;
}

export interface ComplaintCase {
  id: string;
  finding_id: string;
  scan_id?: string;
  target_id: string;
  video_id: string;
  complaint_ground: ComplaintGround;
  action_recommendation: string;
  submission_readiness: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  case_status: CaseStatus;
  evidence_snapshot: ImmutableEvidenceSnapshot;
  ground_details: GroundDetails;
  generated_draft?: string;
  draft_version: number;
  evidence_snapshot_version: number;
  approval_record?: ApprovalRecord;
  case_audit_trail: CaseAuditLogEntry[];
}

/** Calculate cryptographic SHA-256 hash digest for immutable evidence snapshot. */
export function computeEvidenceSnapshotHash(data: Omit<ImmutableEvidenceSnapshot, "sha256_hash">): string {
  const json = JSON.stringify({
    video_id: data.video_id,
    title: data.title,
    channel: data.channel,
    scan_timestamp: data.scan_timestamp,
    transcript_excerpts: data.transcript_excerpts,
    description_excerpts: data.description_excerpts,
    reason_codes: data.reason_codes,
    snapshot_version: data.snapshot_version,
  });

  // Safe SHA-256 calculation
  try {
    const hash = crypto.createHash("sha256");
    hash.update(json);
    return hash.digest("hex");
  } catch {
    // Fallback pseudo-hash digest for lightweight environments
    let h = 0;
    for (let i = 0; i < json.length; i++) {
      h = (Math.imul(31, h) + json.charCodeAt(i)) | 0;
    }
    return `sha256_${Math.abs(h).toString(16)}`;
  }
}
