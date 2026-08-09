/**
 * YouTube Removal Intelligence — Complaint Draft Generator & Completeness Validator.
 *
 * Generates structured, truthful complaint drafts, validates required evidence fields per ground,
 * and automatically invalidates human approvals upon draft or evidence edits.
 */

import {
  ComplaintCase,
  CompletenessBlocker,
  CaseAuditLogEntry,
  GroundDetails,
} from "./complaint-case-model";

/** Validate evidence completeness for the selected complaint ground. */
export function validateEvidenceCompleteness(
  caseData: ComplaintCase,
): CompletenessBlocker[] {
  const blockers: CompletenessBlocker[] = [];
  const g = caseData.ground_details || {};
  const ev = caseData.evidence_snapshot || {};

  // Human approval check
  if (!caseData.approval_record && caseData.case_status !== "APPROVED" && caseData.case_status !== "SUBMISSION_READY") {
    blockers.push("HUMAN_APPROVAL_REQUIRED");
  }

  switch (caseData.complaint_ground) {
    case "COPYRIGHT": {
      if (!g.claimant_identity) blockers.push("MISSING_TARGET_AUTHORITY");
      if (!g.ownership_rights_evidence && (!ev.authority_proof_refs || ev.authority_proof_refs.length === 0)) {
        blockers.push("MISSING_RIGHTS_PROOF");
      }
      if (g.claimant_identity && g.rights_owner && g.claimant_identity.toLowerCase() !== g.rights_owner.toLowerCase()) {
        if (!g.authorization_relationship && (!ev.authorization_proof_refs || ev.authorization_proof_refs.length === 0)) {
          blockers.push("MISSING_AUTHORIZATION");
        }
      }
      if (!g.copyrighted_work_identification && !g.original_work_reference) {
        blockers.push("MISSING_ORIGINAL_WORK");
      }
      if (!g.allegedly_infringing_material && !ev.video_url) {
        blockers.push("MISSING_INFRINGING_REFERENCE");
      }
      break;
    }

    case "IMPERSONATION": {
      if (!g.identity_being_impersonated) blockers.push("MISSING_TARGET_AUTHORITY");
      if (!g.deceptive_representation_evidence && (!g.confusing_signals || g.confusing_signals.length === 0)) {
        blockers.push("MISSING_IMPERSONATION_EVIDENCE");
      }
      break;
    }

    case "PRIVACY": {
      if (!g.affected_individual) blockers.push("MISSING_TARGET_AUTHORITY");
      if (!g.type_of_private_info && !g.explanation_of_privacy_impact) {
        blockers.push("MISSING_PRIVACY_EVIDENCE");
      }
      break;
    }

    case "HARASSMENT": {
      if (!g.targeted_individual_or_entity) blockers.push("MISSING_TARGET_AUTHORITY");
      if (!g.specific_harassing_statements && (!g.transcript_supporting_excerpts || g.transcript_supporting_excerpts.length === 0)) {
        blockers.push("MISSING_HARASSMENT_EVIDENCE");
      }
      break;
    }

    case "MANIPULATED_MEDIA": {
      if (!g.manipulation_type && (!g.synthetic_indicators || g.synthetic_indicators.length === 0)) {
        blockers.push("MISSING_MANIPULATION_EVIDENCE");
      }
      break;
    }

    case "LEGAL_REVIEW": {
      if (caseData.case_status !== "APPROVED" && caseData.case_status !== "SUBMISSION_READY") {
        blockers.push("LEGAL_REVIEW_REQUIRED");
      }
      break;
    }
  }

  return blockers;
}

/** Generate a truthful, structured complaint draft citing ONLY real evidence in the case. */
export function generateComplaintDraft(caseData: ComplaintCase): string {
  const g = caseData.ground_details || {};
  const ev = caseData.evidence_snapshot || {};

  const lines: string[] = [];

  lines.push("==================================================");
  lines.push(`FORMAL COMPLAINT PACKAGE DRAFT — [${caseData.complaint_ground}]`);
  lines.push(`Draft Version: ${caseData.draft_version} | Snapshot Hash: ${ev.sha256_hash}`);
  lines.push("==================================================\n");

  // 1. Case Summary
  lines.push("1. CASE SUMMARY");
  lines.push(`- Case ID: ${caseData.id}`);
  lines.push(`- Finding ID: ${caseData.finding_id}`);
  lines.push(`- Target Entity: ${g.claimant_identity || g.identity_being_impersonated || g.affected_individual || g.targeted_individual_or_entity || "Sree Gokulam Gopalan"}`);
  lines.push(`- Complaint Ground: ${caseData.complaint_ground}`);
  lines.push(`- Action Recommendation: ${caseData.action_recommendation}`);
  lines.push(`- System Verification Score: ${ev.verification_score}% (${ev.subject_verification_status})\n`);

  // 2. Target / Rights Holder
  lines.push("2. TARGET / RIGHTS HOLDER IDENTITY");
  lines.push(`- Claimant Name: ${g.claimant_identity || "Sree Gokulam Gopalan"}`);
  if (g.rights_owner) lines.push(`- Rights Owner: ${g.rights_owner}`);
  if (g.authorization_relationship) lines.push(`- Representation Authorization: ${g.authorization_relationship}`);
  lines.push("");

  // 3. Reported Content Details
  lines.push("3. REPORTED CONTENT");
  lines.push(`- Video URL: ${ev.video_url}`);
  lines.push(`- Video Title: "${ev.title}"`);
  lines.push(`- Channel Name: ${ev.channel}`);
  if (ev.published_at) lines.push(`- Published Date: ${ev.published_at}`);
  lines.push("");

  // 4. Ground-Specific Evidence & Statement
  lines.push("4. EVIDENCE & COMPLAINT BASIS");

  if (caseData.complaint_ground === "COPYRIGHT") {
    lines.push(`- Copyrighted Work: ${g.copyrighted_work_identification || "Film Production Asset / Audio Asset"}`);
    if (g.original_work_reference) lines.push(`- Original Reference: ${g.original_work_reference}`);
    if (g.exact_timestamps) lines.push(`- Infringing Timestamps: ${g.exact_timestamps}`);
    lines.push(`- Explanation of Copying: ${g.explanation_of_copied_material || "Unauthorized reproduction of copyrighted movie footage/asset."}`);
  } else if (caseData.complaint_ground === "IMPERSONATION") {
    lines.push(`- Impersonated Identity: ${g.identity_being_impersonated || "Sree Gokulam Gopalan / Gokulam Group"}`);
    if (g.official_identity_references) lines.push(`- Official Reference: ${g.official_identity_references}`);
    lines.push(`- Deceptive Representation: ${g.deceptive_representation_evidence || "Deceptive channel / profile representation."}`);
  } else if (caseData.complaint_ground === "PRIVACY") {
    lines.push(`- Affected Individual: ${g.affected_individual || "Target Entity"}`);
    lines.push(`- Type of Private Info: ${g.type_of_private_info || "Personal Identity Information"}`);
    lines.push(`- Consent Status: ${g.consent_status || "UNKNOWN"}`);
  } else if (caseData.complaint_ground === "HARASSMENT") {
    lines.push(`- Targeted Party: ${g.targeted_individual_or_entity || "Target Entity"}`);
    if (g.harassment_timestamps) lines.push(`- Harassment Timestamps: ${g.harassment_timestamps}`);
    lines.push(`- Specific Statement: ${g.specific_harassing_statements || "Targeted abusive campaign statement."}`);
  } else if (caseData.complaint_ground === "MANIPULATED_MEDIA") {
    lines.push(`- Manipulation Type: ${g.manipulation_type || "SYNTHETIC_MEDIA"}`);
    lines.push(`- Synthetic Indicators: ${g.synthetic_indicators?.join(", ") || "AI voice clone / face swap"}`);
  } else if (caseData.complaint_ground === "LEGAL_REVIEW") {
    lines.push("- Legal Brief Note: Potentially actionable factual allegation identified.");
    if (g.exact_factual_assertion_identified) lines.push(`- Factual Assertion Identified: "${g.exact_factual_assertion_identified}"`);
    if (g.evidence_suggesting_potential_falsity) lines.push(`- Basis for Review: ${g.evidence_suggesting_potential_falsity}`);
  }

  lines.push("");

  // 5. Cites Only Real Evidence Excerpts
  lines.push("5. VERIFIED EVIDENCE EXCERPTS");
  if (ev.transcript_excerpts && ev.transcript_excerpts.length > 0) {
    lines.push("- Transcript Excerpt:");
    ev.transcript_excerpts.forEach((ex) => lines.push(`  > "${ex}"`));
  } else {
    lines.push("- Transcript Excerpt: None (Captions unavailable)");
  }

  if (ev.description_excerpts && ev.description_excerpts.length > 0) {
    lines.push("- Metadata Description Excerpt:");
    ev.description_excerpts.forEach((ex) => lines.push(`  > "${ex}"`));
  }

  lines.push("");

  // 6. Declarations
  lines.push("6. GOOD-FAITH & ACCURACY DECLARATIONS");
  lines.push("- I have a good-faith belief that the use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.");
  lines.push("- The information in this notification is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.");
  lines.push("==================================================");

  return lines.join("\n");
}

/** Automatically invalidate human approval when a draft or evidence snapshot is edited. */
export function invalidateApprovalOnEdit(
  caseData: ComplaintCase,
  actor: string,
  editReason: string,
): ComplaintCase {
  if (caseData.case_status !== "APPROVED" && caseData.case_status !== "SUBMISSION_READY") {
    return caseData;
  }

  const now = new Date().toISOString();
  const prevStatus = caseData.case_status;
  const newStatus = "AWAITING_APPROVAL";

  const auditEntry: CaseAuditLogEntry = {
    case_id: caseData.id,
    action: "APPROVAL_INVALIDATED",
    previous_status: prevStatus,
    new_status: newStatus,
    actor,
    timestamp: now,
    notes: `Human approval invalidated due to edit: ${editReason}`,
    draft_version: caseData.draft_version,
    evidence_snapshot_version: caseData.evidence_snapshot_version,
  };

  return {
    ...caseData,
    case_status: newStatus,
    approval_record: undefined,
    updated_at: now,
    case_audit_trail: [...(caseData.case_audit_trail || []), auditEntry],
  };
}
