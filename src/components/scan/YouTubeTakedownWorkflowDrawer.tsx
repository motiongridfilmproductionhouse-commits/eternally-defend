import React, { useState, useEffect } from "react";
import {
  YouTubeQueueItem,
  transitionQueueStatus,
} from "@/lib/deepfake/youtube-queue-model";
import {
  ComplaintCase,
  ComplaintGround,
  computeEvidenceSnapshotHash,
} from "@/lib/deepfake/complaint-case-model";
import {
  generateComplaintDraft,
  validateEvidenceCompleteness,
  invalidateApprovalOnEdit,
} from "@/lib/deepfake/complaint-draft-generator";
import { YouTubePlatformAdapter } from "@/lib/deepfake/platform-submission-adapter";
import {
  X,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Gavel,
  ShieldCheck,
  FileText,
  AlertTriangle,
  FileCode,
  Send,
  UserCheck,
  RefreshCw,
  Lock,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";

interface YouTubeTakedownWorkflowDrawerProps {
  item: YouTubeQueueItem | null;
  onClose: () => void;
  onCompleteWorkflow: (updatedItem: YouTubeQueueItem) => void;
}

export function YouTubeTakedownWorkflowDrawer({
  item,
  onClose,
  onCompleteWorkflow,
}: YouTubeTakedownWorkflowDrawerProps) {
  const [currentStep, setCurrentStep] = useState(1);

  // Form states
  const [complaintGround, setComplaintGround] = useState<ComplaintGround>("COPYRIGHT");
  const [claimantIdentity, setClaimantIdentity] = useState("Sree Gokulam Gopalan");
  const [rightsOwner, setRightsOwner] = useState("Sree Gokulam Gopalan");
  const [authorizationRel, setAuthorizationRel] = useState("Direct Target Entity");
  const [copyrightedWork, setCopyrightedWork] = useState("Gokulam Production Movie Asset");
  const [infringingTimestamps, setInfringingTimestamps] = useState("0:15 - 3:45");

  const [evidenceConfirmed, setEvidenceConfirmed] = useState(true);
  const [hasRightsProof, setHasRightsProof] = useState(true);
  const [hasAuthorization, setHasAuthorization] = useState(true);
  const [humanApproved, setHumanApproved] = useState(false);
  const [reviewerName, setReviewerName] = useState("Human Reviewer (Admin)");
  const [reviewerNotes, setReviewerNotes] = useState("");

  const [draftText, setDraftText] = useState("");
  const [draftVersion, setDraftVersion] = useState(1);
  const [snapshotVersion, setSnapshotVersion] = useState(1);

  // Sync draft on load or ground change
  useEffect(() => {
    if (!item) return;

    const mockSnapshot = {
      snapshot_version: snapshotVersion,
      finding_id: item.id,
      video_id: item.video_id,
      video_url: item.url,
      title: item.title,
      channel: item.channel,
      published_at: item.published_at,
      thumbnail_url: item.thumbnail_url,
      scan_timestamp: new Date().toISOString(),
      subject_verification_status: item.subject_verification_status,
      verification_score: item.verification_score,
      evidence_status: item.evidence_status,
      evidence_confidence: item.evidence_confidence,
      transcript_excerpts: item.transcript_available ? ["Official statement excerpt"] : [],
      description_excerpts: [item.human_readable_reason],
      detected_signals: item.policy_signals as any,
      reason_codes: item.removal_reason_codes,
      sha256_hash: "",
    };
    mockSnapshot.sha256_hash = computeEvidenceSnapshotHash(mockSnapshot);

    const mockCase: ComplaintCase = {
      id: `case_${item.video_id}`,
      finding_id: item.id,
      target_id: "target_gokulam",
      video_id: item.video_id,
      complaint_ground: complaintGround,
      action_recommendation: item.action_recommendation,
      submission_readiness: item.submission_readiness,
      created_by: "System",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      case_status: "DRAFT",
      evidence_snapshot: mockSnapshot,
      ground_details: {
        claimant_identity: claimantIdentity,
        rights_owner: rightsOwner,
        authorization_relationship: authorizationRel,
        copyrighted_work_identification: copyrightedWork,
        exact_timestamps: infringingTimestamps,
        good_faith_declaration: true,
        accuracy_authority_declaration: true,
      },
      draft_version: draftVersion,
      evidence_snapshot_version: snapshotVersion,
      case_audit_trail: [],
    };

    setDraftText(generateComplaintDraft(mockCase));
  }, [item, complaintGround, claimantIdentity, rightsOwner, copyrightedWork, infringingTimestamps, draftVersion, snapshotVersion]);

  if (!item) return null;

  const adapter = new YouTubePlatformAdapter();

  const mockCaseForValidation: ComplaintCase = {
    id: `case_${item.video_id}`,
    finding_id: item.id,
    target_id: "target_gokulam",
    video_id: item.video_id,
    complaint_ground: complaintGround,
    action_recommendation: item.action_recommendation,
    submission_readiness: item.submission_readiness,
    created_by: "System",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    case_status: humanApproved ? "APPROVED" : "DRAFT",
    evidence_snapshot: {
      snapshot_version: snapshotVersion,
      finding_id: item.id,
      video_id: item.video_id,
      video_url: item.url,
      title: item.title,
      channel: item.channel,
      scan_timestamp: new Date().toISOString(),
      subject_verification_status: item.subject_verification_status,
      verification_score: item.verification_score,
      evidence_status: item.evidence_status,
      evidence_confidence: item.evidence_confidence,
      transcript_excerpts: [],
      description_excerpts: [],
      detected_signals: item.policy_signals as any,
      reason_codes: item.removal_reason_codes,
      sha256_hash: `sha256_${item.video_id}`,
    },
    ground_details: {
      claimant_identity: claimantIdentity,
      rights_owner: rightsOwner,
      ownership_rights_evidence: hasRightsProof ? "Rights verified" : undefined,
      authorization_relationship: authorizationRel,
      copyrighted_work_identification: copyrightedWork,
      allegedly_infringing_material: item.url,
    },
    draft_version: draftVersion,
    evidence_snapshot_version: snapshotVersion,
    approval_record: humanApproved
      ? {
          approved_by: reviewerName,
          approved_at: new Date().toISOString(),
          draft_version: draftVersion,
          evidence_snapshot_version: snapshotVersion,
          destination: adapter.getSubmissionDestination({ complaint_ground: complaintGround } as any),
          unresolved_warnings: [],
        }
      : undefined,
    case_audit_trail: [],
  };

  const blockers = validateEvidenceCompleteness(mockCaseForValidation);

  const handleNextStep = () => {
    if (currentStep < 7) setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleFinishWorkflow = () => {
    const res = adapter.recordSubmittedReference(mockCaseForValidation, `ref_${Date.now()}`, reviewerName);

    const updated = transitionQueueStatus(
      {
        ...item,
        has_rights_proof: hasRightsProof,
        has_authorization: hasAuthorization,
      },
      "SUBMITTED",
      `Executed Platform Takedown Handoff (${res.destination}). Ref: ${res.submission_reference_id}`,
      reviewerName,
      reviewerNotes || `Human approval confirmed by ${reviewerName}`,
    );

    onCompleteWorkflow(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex justify-end font-sans transition-all">
      <div className="w-full max-w-2xl bg-card border-l border-border h-full shadow-2xl flex flex-col overflow-hidden text-card-foreground">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border bg-slate-900 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Gavel className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Guided Takedown Workflow</h2>
              <p className="text-xs text-slate-400">Step {currentStep} of 7 — Complaint Draft & Evidence Package</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Bar */}
        <div className="px-6 py-3 bg-slate-950 border-b border-border flex items-center justify-between text-xs font-mono text-slate-400 overflow-x-auto">
          {[
            "1. Review",
            "2. Ground",
            "3. Evidence",
            "4. Rights",
            "5. Package",
            "6. Approval",
            "7. Handoff",
          ].map((label, idx) => {
            const stepNum = idx + 1;
            const isCurrent = stepNum === currentStep;
            const isCompleted = stepNum < currentStep;
            return (
              <span
                key={idx}
                className={`shrink-0 px-2 py-0.5 rounded transition-colors ${
                  isCurrent
                    ? "bg-indigo-500 text-white font-bold"
                    : isCompleted
                    ? "text-emerald-400"
                    : "text-slate-600"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>

        {/* Body Content per Step */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Step 1: Review Finding */}
          {currentStep === 1 && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-400 uppercase tracking-wider text-[11px]">Step 1 — Review Candidate Finding</div>
                <h3 className="text-sm font-bold text-slate-100">{item.title}</h3>
                <div className="text-slate-400">Channel: <strong className="text-slate-200">{item.channel}</strong></div>
                <div className="text-slate-400">Video ID: <strong className="font-mono text-slate-200">{item.video_id}</strong></div>
              </div>
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="font-semibold text-slate-400 uppercase tracking-wider text-[11px]">System Analysis</div>
                <div className="text-slate-200">{item.human_readable_reason}</div>
              </div>
            </div>
          )}

          {/* Step 2: Select Complaint Ground */}
          {currentStep === 2 && (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 2 — Select Ground Workflow</div>
              <div className="space-y-2">
                {[
                  { id: "COPYRIGHT", label: "Copyright DMCA Takedown", desc: "Unauthorized movie footage or copyrighted media asset" },
                  { id: "IMPERSONATION", label: "Identity / Channel Impersonation", desc: "Deceptive fake channel or scam giveaway" },
                  { id: "MANIPULATED_MEDIA", label: "Synthetic / Deepfake Media", desc: "AI face swap or voice cloning" },
                  { id: "PRIVACY", label: "Privacy / Doxxing Violation", desc: "Exposed private personal identifiers" },
                  { id: "HARASSMENT", label: "Targeted Harassment", desc: "Targeted abusive campaign or threat" },
                  { id: "LEGAL_REVIEW", label: "Neutral Legal Review Brief", desc: "Neutral factual brief for legal counsel evaluation" },
                ].map((g) => (
                  <label
                    key={g.id}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer ${
                      complaintGround === g.id
                        ? "bg-indigo-950/60 border-indigo-500 ring-1 ring-indigo-500"
                        : "bg-slate-900 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="complaintGround"
                      checked={complaintGround === g.id}
                      onChange={() => setComplaintGround(g.id as ComplaintGround)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-bold text-slate-100">{g.label}</div>
                      <div className="text-slate-400 text-[11px] mt-0.5">{g.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Verify Evidence */}
          {currentStep === 3 && (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 3 — Evidence Snapshot & Timestamps</div>
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="text-slate-300">Evidence Status: <strong className="text-emerald-400">{item.evidence_status}</strong> ({item.evidence_confidence}%)</div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Infringing Material Timestamps</label>
                  <input
                    type="text"
                    value={infringingTimestamps}
                    onChange={(e) => setInfringingTimestamps(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 pt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={evidenceConfirmed}
                    onChange={(e) => setEvidenceConfirmed(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-slate-200 font-medium">I confirm that evidence snapshot is accurate.</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 4: Verify Authority / Rights */}
          {currentStep === 4 && (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 4 — Rights & Representation Authority</div>
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Claimant Identity</label>
                  <input
                    type="text"
                    value={claimantIdentity}
                    onChange={(e) => setClaimantIdentity(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Rights Owner</label>
                  <input
                    type="text"
                    value={rightsOwner}
                    onChange={(e) => setRightsOwner(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Copyrighted Work Identification</label>
                  <input
                    type="text"
                    value={copyrightedWork}
                    onChange={(e) => setCopyrightedWork(e.target.value)}
                    className="w-full px-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Generate Draft & Completeness Check */}
          {currentStep === 5 && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 5 — Generated Package Draft (v{draftVersion})</div>
                <button
                  onClick={() => setDraftVersion((v) => v + 1)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-mono inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Regenerate Draft
                </button>
              </div>

              {/* Blockers */}
              {blockers.length > 0 ? (
                <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-200 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle className="w-4 h-4" /> Unresolved Requirements ({blockers.length})
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 font-mono text-[11px]">
                    {blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Complaint Package Ready for Review
                </div>
              )}

              {/* Draft Box */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 space-y-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {draftText}
              </div>
            </div>
          )}

          {/* Step 6: Human Approval */}
          {currentStep === 6 && (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 6 — Final Package & Human Reviewer Approval</div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Destination:</span>
                  <strong className="text-indigo-300">{adapter.getSubmissionDestination({ complaint_ground: complaintGround } as any)}</strong>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Approved Draft Version:</span>
                  <strong className="font-mono text-slate-200">v{draftVersion}</strong>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Reviewer Name</label>
                  <input
                    type="text"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Audit Notes</label>
                  <textarea
                    rows={2}
                    value={reviewerNotes}
                    onChange={(e) => setReviewerNotes(e.target.value)}
                    placeholder="Enter notes for audit trail..."
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs"
                  />
                </div>

                <label className="flex items-center gap-2 pt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={humanApproved}
                    onChange={(e) => setHumanApproved(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-emerald-400 font-bold">I explicitly review and approve this complaint package.</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 7: Handoff */}
          {currentStep === 7 && (
            <div className="space-y-4 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Step 7 — Platform Workflow Handoff</div>
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-700/60 space-y-3">
                <div className="text-emerald-400 font-bold text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" /> Complaint Package Approved & Ready for Dispatch
                </div>
                <div className="space-y-1 text-slate-300 font-mono">
                  <div>Destination: {adapter.getSubmissionDestination({ complaint_ground: complaintGround } as any)}</div>
                  <div>Method: OPEN_PLATFORM_WORKFLOW</div>
                  <div>Approved By: {reviewerName}</div>
                  <div>Draft Version: v{draftVersion}</div>
                </div>
                <p className="text-slate-300 text-xs pt-1">
                  Clicking "Commit Handoff" will record an immutable entry in the audit trail and mark the finding as <strong className="text-white">SUBMITTED</strong>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-4 border-t border-border bg-slate-900 flex items-center justify-between gap-3">
          <button
            onClick={handlePrevStep}
            disabled={currentStep === 1}
            className="px-4 py-2 rounded-lg border border-border hover:bg-slate-800 text-xs font-semibold text-slate-300 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>
          {currentStep < 7 ? (
            <button
              onClick={handleNextStep}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs inline-flex items-center gap-1 cursor-pointer"
            >
              Next Step <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleFinishWorkflow}
              disabled={!humanApproved}
              className="px-5 py-2 rounded-lg text-white font-bold text-xs inline-flex items-center gap-2 shadow hover:opacity-95 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Send className="w-4 h-4" /> Commit Handoff & Record Audit Log
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
