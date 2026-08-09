import React, { useState, useMemo } from "react";
import { PersistentFinding } from "@/lib/deepfake/youtube-monitoring-engine";
import {
  Activity,
  AlertTriangle,
  Clock,
  ExternalLink,
  Eye,
  History,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";

interface YouTubeMonitoringDashboardProps {
  findings: PersistentFinding[];
  onSelectFinding?: (finding: PersistentFinding) => void;
}

export function YouTubeMonitoringDashboard({
  findings,
  onSelectFinding,
}: YouTubeMonitoringDashboardProps) {
  const [activeTab, setActiveTab] = useState<"attention" | "changed" | "stable" | "unavailable" | "reuploads">("stable");
  const [selectedTimelineFinding, setSelectedTimelineFinding] = useState<PersistentFinding | null>(null);

  const metrics = useMemo(() => {
    return {
      totalMonitored: findings.length,
      changedToday: findings.filter((f) => f.change_history.length > 0).length,
      riskIncreased: findings.filter((f) => f.current_risk_score > f.previous_risk_score).length,
      newEvidence: findings.filter((f) => f.latest_snapshot.transcript_hash !== "").length,
      unavailableVideos: findings.filter((f) => f.availability_status === "UNAVAILABLE" || f.availability_status === "REMOVED").length,
      possibleReuploads: findings.filter((f) => f.change_history.some((c) => c.change_type === "POSSIBLE_REUPLOAD" || c.change_type === "VIDEO_AVAILABLE_AGAIN")).length,
      escalatedFindings: findings.filter((f) => f.current_status === "ACTION_RECOMMENDED").length,
    };
  }, [findings]);

  const filteredFindings = useMemo(() => {
    switch (activeTab) {
      case "attention":
        return findings.filter((f) => f.current_status === "ACTION_RECOMMENDED" || f.current_risk_score > f.previous_risk_score);
      case "changed":
        return findings.filter((f) => f.change_history.length > 0);
      case "unavailable":
        return findings.filter((f) => f.availability_status === "UNAVAILABLE" || f.availability_status === "REMOVED");
      case "reuploads":
        return findings.filter((f) => f.change_history.some((c) => c.change_type === "POSSIBLE_REUPLOAD" || c.change_type === "VIDEO_AVAILABLE_AGAIN"));
      case "stable":
      default:
        return findings.filter((f) => f.current_status !== "ACTION_RECOMMENDED");
    }
  }, [findings, activeTab]);

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header & Telemetry Summary */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-400" />
              YouTube Persistent Monitoring Engine
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time change detection, risk escalation guard, and availability tracking.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-bold text-xs border border-emerald-500/20 font-mono">
              Active Monitored Candidates: {metrics.totalMonitored}
            </span>
          </div>
        </div>

        {/* Diagnostic Telemetry Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 font-mono text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Monitored</div>
            <div className="text-base font-bold text-slate-100">{metrics.totalMonitored}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Changed</div>
            <div className="text-base font-bold text-indigo-300">{metrics.changedToday}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Risk Up</div>
            <div className="text-base font-bold text-amber-400">{metrics.riskIncreased}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Transcript Ev.</div>
            <div className="text-base font-bold text-emerald-400">{metrics.newEvidence}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Unavailable</div>
            <div className="text-base font-bold text-rose-400">{metrics.unavailableVideos}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Reuploads</div>
            <div className="text-base font-bold text-cyan-400">{metrics.possibleReuploads}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-center">
            <div className="text-slate-500 text-[10px] uppercase">Escalated</div>
            <div className="text-base font-bold text-purple-400">{metrics.escalatedFindings}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-medium">
        {[
          { id: "stable", label: "Stable Monitoring", count: findings.length },
          { id: "attention", label: "Needs Attention", count: metrics.escalatedFindings, isHighlight: true },
          { id: "changed", label: "Recently Changed", count: metrics.changedToday },
          { id: "unavailable", label: "Unavailable / Removed", count: metrics.unavailableVideos },
          { id: "reuploads", label: "Possible Reuploads", count: metrics.possibleReuploads },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-3.5 py-2 rounded-lg border transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
              activeTab === t.id
                ? t.isHighlight
                  ? "bg-indigo-600 text-white font-bold border-indigo-500 shadow-sm"
                  : "bg-slate-800 text-slate-100 font-bold border-slate-600"
                : "bg-card text-muted-foreground border-border hover:border-slate-700 hover:text-foreground"
            }`}
          >
            <span>{t.label}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/20 font-mono">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Findings List */}
      {filteredFindings.length === 0 ? (
        <div className="p-8 rounded-xl border border-dashed border-border text-center space-y-2">
          <div className="text-sm font-semibold text-foreground">No findings in this category</div>
          <div className="text-xs text-muted-foreground">
            All active monitoring candidates are stably tracked. Switch to "Stable Monitoring" to view all records.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredFindings.map((finding) => (
            <div
              key={finding.composite_key}
              className="p-4 rounded-xl border border-border bg-card hover:border-slate-700 transition-all space-y-3 font-sans"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-foreground font-semibold line-clamp-1">{finding.channel}</span>
                  <span>·</span>
                  <span className="font-mono text-[10px]">{finding.video_id}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px]">
                  <span>Scan Count: <strong>{finding.scan_count}</strong></span>
                  <span>·</span>
                  <span>Latest Ev: v{finding.latest_evidence_version}</span>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-sm text-foreground line-clamp-1">
                  <a href={finding.url} target="_blank" rel="noreferrer" className="hover:text-indigo-400 inline-flex items-center gap-1.5">
                    {finding.title}
                    <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                  </a>
                </h3>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                  {finding.latest_snapshot.action_recommendation}
                </span>
              </div>

              {/* Status Note */}
              <div className="text-xs text-slate-300 bg-muted/30 p-2.5 rounded-lg border border-border/50 flex items-center justify-between gap-2">
                <span>{finding.latest_snapshot.removal_classification} — {finding.latest_snapshot.reason_codes?.join(", ") || "Fair Comment / Public Event"}</span>
                <button
                  onClick={() => setSelectedTimelineFinding(finding)}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono text-[11px] inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <History className="w-3.5 h-3.5" /> Timeline ({finding.snapshot_history.length})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Finding Timeline Modal */}
      {selectedTimelineFinding && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden text-card-foreground p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <History className="w-4 h-4 text-indigo-400" /> Finding Chronological Timeline
              </h3>
              <button
                onClick={() => setSelectedTimelineFinding(null)}
                className="text-muted-foreground hover:text-foreground text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto font-mono text-xs">
              {selectedTimelineFinding.snapshot_history.map((snap, i) => (
                <div key={i} className="p-3 rounded bg-slate-900 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span className="font-bold text-slate-200">Snapshot v{snap.snapshot_version}</span>
                    <span>{new Date(snap.captured_at).toLocaleString()}</span>
                  </div>
                  <div className="text-slate-300 text-xs">
                    Verification: {snap.verification_status} ({snap.verification_score}%)
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Action: <span className="text-amber-400">{snap.action_recommendation}</span> | Ev Status: <span className="text-emerald-400">{snap.evidence_status}</span>
                  </div>
                  <div className="text-slate-500 text-[10px]">
                    Hashes: title={snap.title_hash.slice(0, 10)}... | ev={snap.evidence_hash.slice(0, 10)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
