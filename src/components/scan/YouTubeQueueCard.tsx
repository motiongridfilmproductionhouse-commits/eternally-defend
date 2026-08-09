import React from "react";
import {
  YouTubeQueueItem,
  mapRecommendationToUIAction,
} from "@/lib/deepfake/youtube-queue-model";
import {
  ExternalLink,
  Eye,
  Gavel,
  ShieldCheck,
  AlertCircle,
  FileText,
  FileQuestion,
  Sparkles,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from "lucide-react";

interface YouTubeQueueCardProps {
  item: YouTubeQueueItem;
  onOpenReview: (item: YouTubeQueueItem) => void;
  onOpenWorkflow: (item: YouTubeQueueItem) => void;
  onToggleMonitoring?: (item: YouTubeQueueItem) => void;
}

export function YouTubeQueueCard({
  item,
  onOpenReview,
  onOpenWorkflow,
  onToggleMonitoring,
}: YouTubeQueueCardProps) {
  const uiAction = mapRecommendationToUIAction(item.action_recommendation);

  const getStatusBadge = () => {
    switch (item.queue_status) {
      case "MONITORING":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">MONITORING</span>;
      case "NO_ACTION":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">NO ACTION REQUIRED</span>;
      case "SUBMITTED":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">SUBMITTED</span>;
      case "REMOVED":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">REMOVED</span>;
      case "REJECTED":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">REJECTED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">{item.queue_status}</span>;
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card text-card-foreground shadow-md hover:border-slate-700 transition-all p-4 space-y-3 font-sans">
      {/* Top Header: Channel, Published, Status Badges */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-foreground font-semibold line-clamp-1">{item.channel}</span>
          <span>·</span>
          <span>{item.published_at ? new Date(item.published_at).toLocaleDateString() : "YouTube"}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          {getStatusBadge()}
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Subject: {item.verification_score}%
          </span>
        </div>
      </div>

      {/* Title & Thumbnail Grid */}
      <div className="flex items-start gap-3.5">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={item.title}
            className="w-24 h-16 object-cover rounded-lg border border-border shrink-0 bg-muted"
          />
        ) : (
          <div className="w-24 h-16 rounded-lg border border-border shrink-0 bg-slate-800 flex items-center justify-center text-slate-500 text-xs">
            No Thumb
          </div>
        )}
        <div className="space-y-1 min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-foreground leading-snug line-clamp-2 hover:text-indigo-400 transition-colors">
            <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
              {item.title}
              <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
            </a>
          </h3>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
            <span>Evidence: <strong className="text-foreground">{item.evidence_status}</strong> ({item.evidence_confidence}%)</span>
            <span>·</span>
            <span>{item.transcript_available ? "Transcript Available" : "Transcript Unavailable"}</span>
            <span>·</span>
            <span className="font-mono text-[10px]">[{item.evidence_sources.join(", ")}]</span>
          </div>
        </div>
      </div>

      {/* Human Readable Explanation Box */}
      <div className="bg-muted/40 p-3 rounded-lg border border-border/60 text-xs space-y-1">
        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-0.5">
          <span className="flex items-center gap-1 text-slate-300">
            <Sparkles className="w-3 h-3 text-indigo-400" /> System Analysis Summary
          </span>
          <span className="font-mono text-[10px] text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800">
            {item.removal_classification}
          </span>
        </div>
        <p className="text-slate-200 leading-relaxed text-xs">
          {item.human_readable_reason}
        </p>
        {item.supporting_evidence?.length > 0 && (
          <div className="text-[11px] text-emerald-400/90 pt-1 border-t border-border/40 font-mono">
            Evidence: {item.supporting_evidence.slice(0, 2).join("; ")}
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="pt-2 border-t border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onOpenReview(item)}
            className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <Eye className="w-3.5 h-3.5 text-slate-400" />
            Inspect Finding
          </button>
        </div>

        <div className="flex items-center gap-2">
          {uiAction.isActionableTakedown ? (
            <button
              onClick={() => onOpenWorkflow(item)}
              className="px-3.5 py-1.5 rounded-lg text-white font-semibold text-xs inline-flex items-center gap-1.5 shadow transition-all hover:opacity-95 cursor-pointer"
              style={{ background: "var(--gradient-brand)" }}
            >
              <Gavel className="w-3.5 h-3.5" />
              {uiAction.label}
            </button>
          ) : (
            <button
              onClick={() => {
                if (onToggleMonitoring) onToggleMonitoring(item);
                else onOpenReview(item);
              }}
              className="px-3.5 py-1.5 rounded-lg border border-border hover:bg-slate-800 text-xs font-semibold text-slate-300 inline-flex items-center gap-1.5 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              {uiAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
