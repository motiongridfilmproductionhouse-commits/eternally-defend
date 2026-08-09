import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  ShieldCheck,
  AlertTriangle,
  HelpCircle,
  XCircle,
  FileSearch,
  CheckCircle2,
  ListFilter,
  Gavel,
  ShieldAlert,
  ShieldX,
  FileCode2,
} from "lucide-react";

export interface RejectedCandidate {
  video_id: string;
  title: string;
  channel: string;
  rejection_stage: string;
  rejection_reason: string;
  verification_score: number;
  matched_target_signals: string[];
  failed_target_signals: string[];
  url?: string;
  thumbnail?: string;
}

export interface PerVideoRecord {
  video_id: string;
  title: string;
  channel: string;
  subject_verification_status: string;
  verification_score: number;
  evidence_status: string;
  removal_classification: string;
  removal_score: number;
  removal_reason_codes: string[];
  supporting_evidence: string[];
  transcript_available: boolean;
  analysis_version: string;
  url?: string;
  thumbnail?: string;
}

export interface RemovalTelemetry {
  evidence_analyzed: number;
  high_removal: number;
  medium_removal: number;
  low_removal: number;
  not_eligible: number;
  analysis_failed: number;
  reason_code_counts: Record<string, number>;
  per_video_records?: PerVideoRecord[];
}

export interface FunnelData {
  discovered_total: number;
  deduplicated_total: number;
  official_news_excluded: number;
  verification_attempted: number;
  verified_subject: number;
  probable_subject: number;
  not_subject: number;
  verification_failed: number;
  verification_skipped: number;
  missing_metadata: number;
  transcript_available: number;
  transcript_unavailable: number;
  classifier_called: number;
  classifier_failed: number;
  classifier_parse_failed: number;
  persisted_results: number;
  hidden_results: number;
  rejected_candidates?: RejectedCandidate[];
  removal?: RemovalTelemetry;
}

interface FunnelDebugPanelProps {
  funnel?: FunnelData;
}

export function FunnelDebugPanel({ funnel }: FunnelDebugPanelProps) {
  const [selectedFilter, setSelectedFilter] = useState<{ type: "stage" | "removal" | "reason"; key: string } | null>(null);
  const [isOpen, setIsOpen] = useState(true);

  if (!funnel) return null;

  const rejected = funnel.rejected_candidates ?? [];
  const removal = funnel.removal;
  const videoRecords = removal?.per_video_records ?? [];

  const activeRecords = selectedFilter
    ? selectedFilter.type === "stage"
      ? rejected.filter((r) => {
          if (selectedFilter.key === "OFFICIAL_NEWS") return r.rejection_stage === "OFFICIAL_NEWS_FILTER";
          if (selectedFilter.key === "VERIFICATION_FAILED") return r.rejection_stage === "TARGET_IDENTITY_VERIFICATION" && r.failed_target_signals?.includes("execution_error");
          if (selectedFilter.key === "NOT_SUBJECT") return r.rejection_stage === "TARGET_IDENTITY_VERIFICATION" && r.verification_score < 25;
          if (selectedFilter.key === "METADATA") return r.rejection_stage === "METADATA_CHECK";
          return r.rejection_stage === selectedFilter.key;
        })
      : selectedFilter.type === "removal"
      ? videoRecords.filter((v) => v.removal_classification === selectedFilter.key)
      : videoRecords.filter((v) => v.removal_reason_codes?.includes(selectedFilter.key))
    : [];

  return (
    <div className="my-6 rounded-xl border border-slate-700/80 bg-slate-900/90 text-slate-100 shadow-xl overflow-hidden font-sans">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-4 bg-slate-850 hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <ListFilter className="w-5 h-5 text-indigo-400" />
          <span className="font-semibold text-base text-slate-100">
            Pipeline Telemetry & Removal-Eligibility Debug Panel
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 font-mono border border-indigo-700/50">
            Reconciled Telemetry
          </span>
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
      </button>

      {isOpen && (
        <div className="p-5 space-y-6">
          {/* Target Identity Discovery & Verification Stage */}
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <FileSearch className="w-3.5 h-3.5 text-indigo-400" /> Stage 1 — Discovery & Identity Verification
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
              {/* Discovered */}
              <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/70 text-center">
                <div className="text-[11px] font-medium text-slate-400 uppercase">Discovered</div>
                <div className="text-xl font-bold text-slate-100">{funnel.discovered_total}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Deduplicated: {funnel.deduplicated_total}</div>
              </div>

              {/* Official News */}
              <button
                onClick={() => setSelectedFilter(selectedFilter?.key === "OFFICIAL_NEWS" ? null : { type: "stage", key: "OFFICIAL_NEWS" })}
                className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                  selectedFilter?.key === "OFFICIAL_NEWS"
                    ? "bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/30"
                    : "bg-slate-800/80 border-slate-700/70 hover:border-slate-500"
                }`}
              >
                <div className="text-[11px] font-medium text-amber-400 uppercase">Official News</div>
                <div className="text-xl font-bold text-amber-300">{funnel.official_news_excluded}</div>
                <div className="text-[10px] text-amber-500 mt-0.5">Excluded</div>
              </button>

              {/* Sent to Verify */}
              <div className="p-3 rounded-lg bg-slate-800/80 border border-slate-700/70 text-center">
                <div className="text-[11px] font-medium text-blue-400 uppercase">Sent to Verify</div>
                <div className="text-xl font-bold text-blue-300">{funnel.verification_attempted}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Identity check</div>
              </div>

              {/* Verified Subject */}
              <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-700/60 text-center">
                <div className="text-[11px] font-medium text-emerald-400 uppercase">Verified</div>
                <div className="text-xl font-bold text-emerald-300">{funnel.verified_subject}</div>
                <div className="text-[10px] text-emerald-500 mt-0.5">Strong match</div>
              </div>

              {/* Probable Subject */}
              <div className="p-3 rounded-lg bg-cyan-950/50 border border-cyan-700/60 text-center">
                <div className="text-[11px] font-medium text-cyan-400 uppercase">Probable</div>
                <div className="text-xl font-bold text-cyan-300">{funnel.probable_subject}</div>
                <div className="text-[10px] text-cyan-500 mt-0.5">Identity match</div>
              </div>

              {/* Not Subject */}
              <button
                onClick={() => setSelectedFilter(selectedFilter?.key === "NOT_SUBJECT" ? null : { type: "stage", key: "NOT_SUBJECT" })}
                className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                  selectedFilter?.key === "NOT_SUBJECT"
                    ? "bg-rose-950/60 border-rose-500 ring-2 ring-rose-500/30"
                    : "bg-slate-800/80 border-slate-700/70 hover:border-slate-500"
                }`}
              >
                <div className="text-[11px] font-medium text-rose-400 uppercase">Not Subject</div>
                <div className="text-xl font-bold text-rose-300">{funnel.not_subject}</div>
                <div className="text-[10px] text-rose-500 mt-0.5">Rejected entity</div>
              </button>

              {/* Verification Failed */}
              <button
                onClick={() => setSelectedFilter(selectedFilter?.key === "VERIFICATION_FAILED" ? null : { type: "stage", key: "VERIFICATION_FAILED" })}
                className={`p-3 rounded-lg border text-center transition-all cursor-pointer ${
                  selectedFilter?.key === "VERIFICATION_FAILED"
                    ? "bg-purple-950/60 border-purple-500 ring-2 ring-purple-500/30"
                    : "bg-slate-800/80 border-slate-700/70 hover:border-slate-500"
                }`}
              >
                <div className="text-[11px] font-medium text-purple-400 uppercase">Failed</div>
                <div className="text-xl font-bold text-purple-300">{funnel.verification_failed}</div>
                <div className="text-[10px] text-purple-500 mt-0.5">Infra error</div>
              </button>
            </div>
          </div>

          {/* Evidence Provenance Breakdown */}
          {removal && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Evidence Provenance Breakdown</span>
                <span className="font-mono text-[11px] text-slate-500">
                  Diagnostic Counter (title_only_but_marked_sufficient):{" "}
                  <span className={`font-bold ${(removal.title_only_but_marked_sufficient ?? 0) === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {removal.title_only_but_marked_sufficient ?? 0}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-xs bg-slate-950/70 p-3 rounded-lg border border-slate-800 font-mono text-slate-300">
                <div>Sufficient: <span className="text-emerald-400 font-bold">{removal.evidence_sufficient ?? 0}</span></div>
                <div>Insufficient: <span className="text-amber-400 font-bold">{removal.evidence_insufficient ?? 0}</span></div>
                <div>Unavailable: <span className="text-rose-400 font-bold">{removal.evidence_unavailable ?? 0}</span></div>
                <div>Transcript: <span className="text-indigo-400 font-bold">{removal.transcript_evidence ?? 0}</span></div>
                <div>Description: <span className="text-cyan-400 font-bold">{removal.description_evidence ?? 0}</span></div>
                <div>Title-Only: <span className="text-slate-400 font-bold">{removal.title_only_evidence ?? 0}</span></div>
                <div>Thumbnail OCR: <span className="text-purple-400 font-bold">{removal.thumbnail_ocr_evidence ?? 0}</span></div>
                <div>Multi-Source: <span className="text-emerald-300 font-bold">{removal.multi_source_evidence ?? 0}</span></div>
              </div>
            </div>
          )}

          {/* Removal Eligibility Terminal Hierarchy */}
          {removal && (
            <div className="pt-2 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Gavel className="w-3.5 h-3.5 text-emerald-400" /> Stage 2 — Removal Eligibility Hierarchy (Evidence Analyzed: {removal.evidence_analyzed})
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Reconciliation Math: {removal.high_removal} + {removal.medium_removal} + {removal.low_removal} + {removal.not_eligible} + {removal.analysis_failed} = {removal.evidence_analyzed}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {/* High Removal */}
                <button
                  onClick={() => setSelectedFilter(selectedFilter?.key === "HIGH_REMOVAL" ? null : { type: "removal", key: "HIGH_REMOVAL" })}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedFilter?.key === "HIGH_REMOVAL"
                      ? "bg-emerald-950/80 border-emerald-500 ring-2 ring-emerald-500/40"
                      : "bg-emerald-950/40 border-emerald-800/60 hover:border-emerald-500"
                  }`}
                >
                  <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">High Removal</div>
                  <div className="text-2xl font-extrabold text-emerald-300 mt-1">{removal.high_removal}</div>
                  <div className="text-[10px] text-emerald-500 mt-1">Actionable policy grounds</div>
                </button>

                {/* Medium Removal */}
                <button
                  onClick={() => setSelectedFilter(selectedFilter?.key === "MEDIUM_REMOVAL" ? null : { type: "removal", key: "MEDIUM_REMOVAL" })}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedFilter?.key === "MEDIUM_REMOVAL"
                      ? "bg-cyan-950/80 border-cyan-500 ring-2 ring-cyan-500/40"
                      : "bg-cyan-950/40 border-cyan-800/60 hover:border-cyan-500"
                  }`}
                >
                  <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Medium Removal</div>
                  <div className="text-2xl font-extrabold text-cyan-300 mt-1">{removal.medium_removal}</div>
                  <div className="text-[10px] text-cyan-500 mt-1">Unverified allegations</div>
                </button>

                {/* Low Removal */}
                <button
                  onClick={() => setSelectedFilter(selectedFilter?.key === "LOW_REMOVAL" ? null : { type: "removal", key: "LOW_REMOVAL" })}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedFilter?.key === "LOW_REMOVAL"
                      ? "bg-slate-800/90 border-slate-600 ring-2 ring-slate-400/40"
                      : "bg-slate-800/50 border-slate-700 hover:border-slate-500"
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Low Removal</div>
                  <div className="text-2xl font-extrabold text-slate-200 mt-1">{removal.low_removal}</div>
                  <div className="text-[10px] text-slate-400 mt-1">Mild reputation impact</div>
                </button>

                {/* Not Eligible */}
                <button
                  onClick={() => setSelectedFilter(selectedFilter?.key === "NOT_ELIGIBLE" ? null : { type: "removal", key: "NOT_ELIGIBLE" })}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedFilter?.key === "NOT_ELIGIBLE"
                      ? "bg-amber-950/80 border-amber-500 ring-2 ring-amber-500/40"
                      : "bg-amber-950/30 border-amber-800/60 hover:border-amber-500"
                  }`}
                >
                  <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Not Eligible</div>
                  <div className="text-2xl font-extrabold text-amber-300 mt-1">{removal.not_eligible}</div>
                  <div className="text-[10px] text-amber-500 mt-1">Commentary / No violation</div>
                </button>

                {/* Analysis Failed */}
                <button
                  onClick={() => setSelectedFilter(selectedFilter?.key === "ANALYSIS_FAILED" ? null : { type: "removal", key: "ANALYSIS_FAILED" })}
                  className={`p-3.5 rounded-lg border text-left transition-all cursor-pointer ${
                    selectedFilter?.key === "ANALYSIS_FAILED"
                      ? "bg-purple-950/80 border-purple-500 ring-2 ring-purple-500/40"
                      : "bg-purple-950/30 border-purple-800/60 hover:border-purple-500"
                  }`}
                >
                  <div className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Analysis Failed</div>
                  <div className="text-2xl font-extrabold text-purple-300 mt-1">{removal.analysis_failed}</div>
                  <div className="text-[10px] text-purple-500 mt-1">Classifier exception</div>
                </button>
              </div>

              {/* Not Eligible Structured Reason Code Breakdown */}
              {removal.reason_code_counts && Object.keys(removal.reason_code_counts).length > 0 && (
                <div className="mt-3 bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                    Not Eligible Structured Reason Code Breakdown
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(removal.reason_code_counts).map(([code, count]) => (
                      <button
                        key={code}
                        onClick={() => setSelectedFilter(selectedFilter?.key === code ? null : { type: "reason", key: code })}
                        className={`text-xs px-2.5 py-1 rounded font-mono border transition-all cursor-pointer ${
                          selectedFilter?.key === code
                            ? "bg-amber-500 text-slate-950 font-bold border-amber-400"
                            : "bg-slate-900 text-amber-300 border-amber-800/60 hover:border-amber-500"
                        }`}
                      >
                        {code}: <span className="font-bold">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Inspection Panel for Active Filter */}
          {selectedFilter && (
            <div className="mt-4 space-y-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <FileSearch className="w-4 h-4 text-indigo-400" />
                  Inspecting Records for: <span className="text-indigo-300 font-mono">{selectedFilter.key}</span>
                  <span className="text-xs font-normal text-slate-400">({activeRecords.length} records)</span>
                </h4>
                <button
                  onClick={() => setSelectedFilter(null)}
                  className="text-xs text-slate-400 hover:text-slate-200 underline"
                >
                  Close Inspection
                </button>
              </div>

              {activeRecords.length === 0 ? (
                <div className="text-xs text-slate-400 py-3 italic">
                  No records stored for filter "{selectedFilter.key}" in this scan run.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                  {activeRecords.map((r: any, i: number) => (
                    <div
                      key={i}
                      className="p-3.5 rounded bg-slate-950 border border-slate-800 text-xs space-y-2 font-sans"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-1.5">
                        <span className="font-semibold text-slate-100">{r.title}</span>
                        <span className="shrink-0 px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 text-[10px] font-mono border border-indigo-800">
                          {r.removal_classification || `Score: ${r.verification_score}/100`}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 font-medium">Subject: </span>
                          <span className="text-emerald-400 font-semibold">{r.subject_verification_status || "VERIFIED_SUBJECT"} · {r.verification_score ?? 90}%</span>
                        </div>
                        <div>
                          <span className="text-slate-400 font-medium">Evidence: </span>
                          <span className="text-cyan-300 font-semibold">{r.transcript_available ? "Transcript available" : "Transcript unavailable"}</span>
                          <span className="text-slate-400"> · Confidence: {r.evidence_confidence ?? 85}%</span>
                        </div>
                      </div>
                      <div className="text-[11px] flex flex-wrap gap-2">
                        <span className="text-slate-400 font-medium">Recommended action:</span>
                        <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 font-mono font-bold text-[10px] border border-amber-800">
                          {r.action_recommendation || "NO_ACTION"}
                        </span>
                      </div>
                      {r.human_readable_reason && (
                        <div className="text-slate-300 text-[11px] bg-slate-900/80 p-2 rounded border border-slate-800">
                          <span className="text-slate-400 font-medium">Reason: </span>
                          {r.human_readable_reason}
                        </div>
                      )}
                      {r.supporting_evidence?.length > 0 && (
                        <div className="text-emerald-400 text-[10px] font-mono">
                          Evidence: {r.supporting_evidence.join("; ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
