import React, { useState } from "react";
import {
  YouTubeQueueItem,
  mapRecommendationToUIAction,
} from "@/lib/deepfake/youtube-queue-model";
import {
  X,
  ShieldCheck,
  FileText,
  AlertTriangle,
  Gavel,
  CheckCircle2,
  Clock,
  History,
  FileSearch,
  ExternalLink,
  Sparkles,
  ChevronRight,
  Info,
} from "lucide-react";

interface YouTubeReviewDrawerProps {
  item: YouTubeQueueItem | null;
  onClose: () => void;
  onOpenWorkflow: (item: YouTubeQueueItem) => void;
  onUpdateStatus?: (item: YouTubeQueueItem, newStatus: any, notes?: string) => void;
}

export function YouTubeReviewDrawer({
  item,
  onClose,
  onOpenWorkflow,
  onUpdateStatus,
}: YouTubeReviewDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "evidence" | "signals" | "readiness" | "audit">("overview");
  const [notesText, setNotesText] = useState("");

  if (!item) return null;

  const uiAction = mapRecommendationToUIAction(item.action_recommendation);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end font-sans transition-all">
      <div className="w-full max-w-2xl bg-card border-l border-border h-full shadow-2xl flex flex-col overflow-hidden text-card-foreground">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-border bg-slate-900/90 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <FileSearch className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-100 line-clamp-1">
                Finding Detail Review
              </h2>
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <span>ID: {item.video_id}</span>
                <span>·</span>
                <span className="font-mono">{item.queue_status}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-border px-6 bg-slate-950 text-xs font-semibold text-slate-400">
          <button
            onClick={() => setActiveTab("overview")}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === "overview" ? "border-indigo-400 text-indigo-300 font-bold" : "border-transparent hover:text-slate-200"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("evidence")}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === "evidence" ? "border-indigo-400 text-indigo-300 font-bold" : "border-transparent hover:text-slate-200"
            }`}
          >
            Evidence Provenance
          </button>
          <button
            onClick={() => setActiveTab("signals")}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === "signals" ? "border-indigo-400 text-indigo-300 font-bold" : "border-transparent hover:text-slate-200"
            }`}
          >
            Detected Signals
          </button>
          <button
            onClick={() => setActiveTab("readiness")}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === "readiness" ? "border-indigo-400 text-indigo-300 font-bold" : "border-transparent hover:text-slate-200"
            }`}
          >
            Submission Readiness
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === "audit" ? "border-indigo-400 text-indigo-300 font-bold" : "border-transparent hover:text-slate-200"
            }`}
          >
            Audit Trail ({item.audit_trail?.length ?? 0})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tab 1: Overview */}
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Media Title & External Link */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Candidate Title</div>
                <h3 className="text-base font-bold text-slate-100">
                  <a href={item.url} target="_blank" rel="noreferrer" className="hover:text-indigo-300 inline-flex items-center gap-1.5">
                    {item.title}
                    <ExternalLink className="w-4 h-4 opacity-70" />
                  </a>
                </h3>
                <div className="text-xs text-slate-400 flex items-center gap-3 pt-1">
                  <span>Channel: <strong className="text-slate-200">{item.channel}</strong></span>
                  <span>·</span>
                  <span>Published: {item.published_at ? new Date(item.published_at).toLocaleDateString() : "YouTube"}</span>
                </div>
              </div>

              {/* Target Verification Section */}
              <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Target Verification
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {item.subject_verification_status} · {item.verification_score}%
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Candidate page verified against canonical target identity profile. High-confidence name & metadata match confirmed.
                </p>
              </div>

              {/* System Analysis & Human Explanation */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" /> Recommendation & System Determination
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded bg-indigo-950 text-indigo-300 font-mono font-bold text-xs border border-indigo-800">
                    {item.removal_classification}
                  </span>
                  <span className="px-2.5 py-1 rounded bg-amber-950 text-amber-300 font-mono font-bold text-xs border border-amber-800">
                    {item.action_recommendation}
                  </span>
                </div>
                <div className="text-sm text-slate-200 pt-1 leading-relaxed">
                  {item.human_readable_reason}
                </div>
              </div>

              {/* Supporting Evidence Items */}
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Supporting Evidence Statements</div>
                {item.supporting_evidence?.length > 0 ? (
                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                    {item.supporting_evidence.map((ev, i) => (
                      <li key={i}>{ev}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-slate-500 italic">No supporting evidence statements recorded.</div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Evidence Provenance */}
          {activeTab === "evidence" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400 font-medium mb-1">Evidence Status</div>
                  <div className="text-base font-bold text-slate-100">{item.evidence_status}</div>
                </div>
                <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="text-slate-400 font-medium mb-1">Evidence Confidence</div>
                  <div className="text-base font-bold text-emerald-400">{item.evidence_confidence}%</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Active Evidence Sources</div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {item.evidence_sources?.map((src, i) => (
                    <span key={i} className="px-2.5 py-1 rounded bg-slate-800 text-indigo-300 font-mono text-xs border border-slate-700">
                      {src}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Transcript Availability</div>
                <div className="text-slate-200">
                  {item.transcript_available ? (
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Full transcript obtained and parsed
                    </span>
                  ) : (
                    <span className="text-amber-400 font-bold flex items-center gap-1.5">
                      <Info className="w-4 h-4" /> Captions / transcript unavailable (Fallback to description & metadata)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Detected Signals */}
          {activeTab === "signals" && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Policy Signal Indicators</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
                  {Object.entries(item.policy_signals || {}).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400">{key}</span>
                      <span className={val ? "text-emerald-400 font-bold" : "text-slate-600"}>
                        {val ? "TRUE" : "FALSE"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {item.removal_reason_codes?.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Associated Reason Codes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.removal_reason_codes.map((code, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-mono text-[11px] border border-amber-800">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Submission Readiness */}
          {activeTab === "readiness" && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Submission Readiness Status</span>
                  <span className="px-3 py-1 rounded-full bg-indigo-950 text-indigo-300 font-bold font-mono border border-indigo-700">
                    {item.submission_readiness}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Evaluates whether copyright ownership proof, legal representation authorization, and sufficient evidence have been verified prior to submission.
                </p>
              </div>
            </div>
          )}

          {/* Tab 5: Audit Trail */}
          {activeTab === "audit" && (
            <div className="space-y-3 text-xs">
              <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" /> Chronological Status History
              </div>
              {item.audit_trail?.length > 0 ? (
                <div className="space-y-2.5">
                  {item.audit_trail.map((log, i) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1 font-mono">
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span className="font-bold text-slate-200">{log.action}</span>
                        <span>{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="text-slate-300 text-xs">
                        Status: <span className="text-amber-400">{log.previous_status}</span> $\rightarrow$ <span className="text-emerald-400">{log.new_status}</span>
                      </div>
                      <div className="text-slate-500 text-[11px]">Actor: {log.actor}</div>
                      {log.notes && <div className="text-slate-400 text-[11px] italic">Notes: {log.notes}</div>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 italic">No previous status transitions recorded.</div>
              )}
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="p-4 border-t border-border bg-slate-900 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border hover:bg-slate-800 text-xs font-semibold text-slate-300"
          >
            Close
          </button>
          {uiAction.isActionableTakedown && (
            <button
              onClick={() => {
                onClose();
                onOpenWorkflow(item);
              }}
              className="px-4 py-2 rounded-lg text-white font-semibold text-xs inline-flex items-center gap-2 shadow hover:opacity-95"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Gavel className="w-4 h-4" />
              {uiAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
