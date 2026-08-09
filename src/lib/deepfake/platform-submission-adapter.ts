/**
 * YouTube Removal Intelligence — Platform Submission Adapter Layer.
 *
 * Provides a modular adapter interface for platform complaint submissions.
 * Initially supports OPEN_PLATFORM_WORKFLOW for YouTube, recording handoffs in audit logs.
 */

import { ComplaintCase, CaseAuditLogEntry } from "./complaint-case-model";

export interface SubmissionPayload {
  destination: string;
  submission_method: "OPEN_PLATFORM_WORKFLOW" | "DIRECT_API";
  complaint_ground: string;
  video_url: string;
  evidence_snapshot_hash: string;
  draft_version: number;
  approved_by?: string;
  ready: boolean;
  unresolved_blockers: string[];
}

export interface SubmissionResult {
  success: boolean;
  submission_reference_id: string;
  destination: string;
  timestamp: string;
  updated_case: ComplaintCase;
}

export interface PlatformSubmissionAdapter {
  prepareSubmission(caseData: ComplaintCase): SubmissionPayload;
  validateSubmission(caseData: ComplaintCase): { isValid: boolean; blockers: string[] };
  getSubmissionDestination(caseData: ComplaintCase): string;
  recordSubmittedReference(caseData: ComplaintCase, referenceId: string, actor: string): SubmissionResult;
}

export class YouTubePlatformAdapter implements PlatformSubmissionAdapter {
  getSubmissionDestination(caseData: ComplaintCase): string {
    switch (caseData.complaint_ground) {
      case "COPYRIGHT":
        return "YouTube DMCA Copyright Takedown Webform";
      case "IMPERSONATION":
        return "YouTube Impersonation Complaint Form";
      case "PRIVACY":
        return "YouTube Privacy Complaint Process";
      case "HARASSMENT":
        return "YouTube Harassment & Cyberbullying Reporting Tool";
      case "MANIPULATED_MEDIA":
        return "YouTube Synthetic / Altered Content Reporting Workflow";
      case "LEGAL_REVIEW":
        return "YouTube Legal Webform (Defamation / Court Order)";
      default:
        return "YouTube Platform Reporting Workflow";
    }
  }

  validateSubmission(caseData: ComplaintCase): { isValid: boolean; blockers: string[] } {
    const blockers: string[] = [];

    if (!caseData.approval_record) {
      blockers.push("HUMAN_APPROVAL_REQUIRED");
    }

    if (caseData.case_status !== "APPROVED" && caseData.case_status !== "SUBMISSION_READY") {
      blockers.push("INVALID_CASE_STATUS");
    }

    if (!caseData.evidence_snapshot?.sha256_hash) {
      blockers.push("MISSING_EVIDENCE_HASH");
    }

    return {
      isValid: blockers.length === 0,
      blockers,
    };
  }

  prepareSubmission(caseData: ComplaintCase): SubmissionPayload {
    const validation = this.validateSubmission(caseData);
    const destination = this.getSubmissionDestination(caseData);

    return {
      destination,
      submission_method: "OPEN_PLATFORM_WORKFLOW",
      complaint_ground: caseData.complaint_ground,
      video_url: caseData.evidence_snapshot.video_url,
      evidence_snapshot_hash: caseData.evidence_snapshot.sha256_hash,
      draft_version: caseData.draft_version,
      approved_by: caseData.approval_record?.approved_by,
      ready: validation.isValid,
      unresolved_blockers: validation.blockers,
    };
  }

  recordSubmittedReference(
    caseData: ComplaintCase,
    referenceId: string,
    actor = "Human Reviewer",
  ): SubmissionResult {
    const validation = this.validateSubmission(caseData);
    if (!validation.isValid) {
      throw new Error(`Cannot record submission for unapproved or invalid case: ${validation.blockers.join(", ")}`);
    }

    const now = new Date().toISOString();
    const destination = this.getSubmissionDestination(caseData);
    const refId = referenceId || `yt_ref_${Date.now()}`;

    const auditEntry: CaseAuditLogEntry = {
      case_id: caseData.id,
      action: "PLATFORM_WORKFLOW_OPENED",
      previous_status: caseData.case_status,
      new_status: "SUBMITTED",
      actor,
      timestamp: now,
      notes: `Opened external platform workflow (${destination}). Reference: ${refId}`,
      draft_version: caseData.draft_version,
      evidence_snapshot_version: caseData.evidence_snapshot_version,
    };

    const updatedCase: ComplaintCase = {
      ...caseData,
      case_status: "SUBMITTED",
      updated_at: now,
      case_audit_trail: [...(caseData.case_audit_trail || []), auditEntry],
    };

    return {
      success: true,
      submission_reference_id: refId,
      destination,
      timestamp: now,
      updated_case: updatedCase,
    };
  }
}
