import React, { useState, useMemo } from "react";
import {
  YouTubeQueueItem,
  QueueStatus,
  transitionQueueStatus,
} from "@/lib/deepfake/youtube-queue-model";
import { YouTubeQueueCard } from "./YouTubeQueueCard";
import { YouTubeReviewDrawer } from "./YouTubeReviewDrawer";
import { YouTubeTakedownWorkflowDrawer } from "./YouTubeTakedownWorkflowDrawer";
import {
  ListFilter,
  Search,
  SlidersHorizontal,
  Clock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Gavel,
  ShieldAlert,
  Info,
} from "lucide-react";

export type ClientFilterCategory =
  | "ALL"
  | "ACTION_REQUIRED"
  | "COPYRIGHT_REVIEW"
  | "LEGAL_REVIEW"
  | "PLATFORM_REPORT"
  | "INSUFFICIENT_EVIDENCE"
  | "MONITORING"
  | "NO_ACTION"
  | "SUBMITTED"
  | "REMOVED"
  | "REJECTED";

interface YouTubeRemovalQueueProps {
  items: YouTubeQueueItem[];
  onUpdateQueueItem?: (updatedItem: YouTubeQueueItem) => void;
}

export function YouTubeRemovalQueue({
  items,
  onUpdateQueueItem,
}: YouTubeRemovalQueueProps) {
  const [activeFilter, setActiveFilter] = useState<ClientFilterCategory>("ACTION_REQUIRED");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recency" | "score" | "confidence">("recency");

  const [selectedReviewItem, setSelectedReviewItem] = useState<YouTubeQueueItem | null>(null);
  const [selectedWorkflowItem, setSelectedWorkflowItem] = useState<YouTubeQueueItem | null>(null);

  // Local state copy for responsive UI updates
  const [queueItems, setQueueItems] = useState<YouTubeQueueItem[]>(items);

  // Sync if parent updates items
  React.useEffect(() => {
    setQueueItems(items);
  }, [items]);

  const handleUpdateItem = (updated: YouTubeQueueItem) => {
    setQueueItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    if (onUpdateQueueItem) onUpdateQueueItem(updated);
  };

  const handleToggleMonitoring = (item: YouTubeQueueItem) => {
    const nextStatus: QueueStatus = item.queue_status === "MONITORING" ? "NO_ACTION" : "MONITORING";
    const updated = transitionQueueStatus(
      item,
      nextStatus,
      nextStatus === "MONITORING" ? "Added to active monitoring" : "Removed from active monitoring",
    );
    handleUpdateItem(updated);
  };

  // Filter & Search computation
  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesChannel = item.channel.toLowerCase().includes(q);
        if (!matchesTitle && !matchesChannel) return false;
      }

      // Client Category filter
      switch (activeFilter) {
        case "ACTION_REQUIRED":
          return (
            item.action_recommendation === "PLATFORM_REPORT_CANDIDATE" ||
            item.action_recommendation === "COPYRIGHT_REVIEW" ||
            item.action_recommendation === "LEGAL_REVIEW" ||
            item.action_recommendation === "IMPERSONATION_REVIEW" ||
            item.action_recommendation === "PRIVACY_REVIEW" ||
            item.action_recommendation === "HARASSMENT_REVIEW"
          );
        case "COPYRIGHT_REVIEW":
          return item.action_recommendation === "COPYRIGHT_REVIEW";
        case "LEGAL_REVIEW":
          return item.action_recommendation === "LEGAL_REVIEW";
        case "PLATFORM_REPORT":
          return item.action_recommendation === "PLATFORM_REPORT_CANDIDATE";
        case "INSUFFICIENT_EVIDENCE":
          return item.evidence_status === "INSUFFICIENT" || item.action_recommendation === "INSUFFICIENT_EVIDENCE";
        case "MONITORING":
          return item.queue_status === "MONITORING" || item.action_recommendation === "MONITOR";
        case "NO_ACTION":
          return item.action_recommendation === "NO_ACTION";
        case "SUBMITTED":
          return item.queue_status === "SUBMITTED" || item.queue_status === "UNDER_REVIEW";
        case "REMOVED":
          return item.queue_status === "REMOVED";
        case "REJECTED":
          return item.queue_status === "REJECTED";
        case "ALL":
        default:
          return true;
      }
    });
  }, [queueItems, activeFilter, searchQuery]);

  // Counts for tabs
  const counts = useMemo(() => {
    return {
      all: queueItems.length,
      actionRequired: queueItems.filter((i) =>
        ["PLATFORM_REPORT_CANDIDATE", "COPYRIGHT_REVIEW", "LEGAL_REVIEW", "IMPERSONATION_REVIEW", "PRIVACY_REVIEW", "HARASSMENT_REVIEW"].includes(
          i.action_recommendation,
        ),
      ).length,
      monitoring: queueItems.filter((i) => i.queue_status === "MONITORING" || i.action_recommendation === "MONITOR").length,
      noAction: queueItems.filter((i) => i.action_recommendation === "NO_ACTION").length,
      insufficient: queueItems.filter((i) => i.evidence_status === "INSUFFICIENT").length,
      submitted: queueItems.filter((i) => i.queue_status === "SUBMITTED").length,
    };
  }, [queueItems]);

  return (
    <div className="space-y-5 font-sans">
      {/* Header & Truthful Status Banner */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Gavel className="w-5 h-5 text-indigo-400" />
              YouTube Target Removal Queue
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Production queue displaying verified YouTube candidates and actionable takedown cases.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
              Verified Target Findings: {queueItems.length}
            </span>
          </div>
        </div>

        {/* Truthful Baseline Explanation Banner */}
        {counts.actionRequired === 0 && (
          <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex items-start gap-3">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-100">Queue State Notice: </span>
              All <strong className="text-emerald-400">{queueItems.length} verified target findings</strong> have been evaluated against copyright, impersonation, synthetic media, privacy, and defamation grounds. Currently, <strong className="text-slate-100">{counts.noAction} findings</strong> are non-violating event/press coverage (<strong className="text-slate-100">NO_ACTION</strong>) and <strong className="text-slate-100">{counts.monitoring} findings</strong> are protected public commentary/reviews (<strong className="text-amber-300">MONITORING</strong>). <strong className="text-slate-100">0 actionable takedown candidates</strong> identified.
            </div>
          </div>
        )}
      </div>

      {/* Filter Tabs Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-medium">
        {[
          { id: "ACTION_REQUIRED", label: "Action Required", count: counts.actionRequired, isHighlight: true },
          { id: "ALL", label: "All Verified", count: counts.all },
          { id: "MONITORING", label: "Monitoring", count: counts.monitoring },
          { id: "NO_ACTION", label: "No Action", count: counts.noAction },
          { id: "INSUFFICIENT_EVIDENCE", label: "Insufficient Evidence", count: counts.insufficient },
          { id: "SUBMITTED", label: "Submitted", count: counts.submitted },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id as ClientFilterCategory)}
            className={`px-3.5 py-2 rounded-lg border transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
              activeFilter === f.id
                ? f.isHighlight
                  ? "bg-indigo-600 text-white font-bold border-indigo-500 shadow-sm"
                  : "bg-slate-800 text-slate-100 font-bold border-slate-600"
                : "bg-card text-muted-foreground border-border hover:border-slate-700 hover:text-foreground"
            }`}
          >
            <span>{f.label}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/20 font-mono">
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Search & Sort Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search findings by title or channel..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Findings List */}
      {filteredItems.length === 0 ? (
        <div className="p-8 rounded-xl border border-dashed border-border text-center space-y-2">
          <div className="text-sm font-semibold text-foreground">No findings match current filter</div>
          <div className="text-xs text-muted-foreground">
            No candidates found in category "{activeFilter}". Switch to "All Verified" or "Monitoring" to view all target records.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredItems.map((item) => (
            <YouTubeQueueCard
              key={item.id}
              item={item}
              onOpenReview={(it) => setSelectedReviewItem(it)}
              onOpenWorkflow={(it) => setSelectedWorkflowItem(it)}
              onToggleMonitoring={handleToggleMonitoring}
            />
          ))}
        </div>
      )}

      {/* Review Drawer Modal */}
      {selectedReviewItem && (
        <YouTubeReviewDrawer
          item={selectedReviewItem}
          onClose={() => setSelectedReviewItem(null)}
          onOpenWorkflow={(it) => {
            setSelectedReviewItem(null);
            setSelectedWorkflowItem(it);
          }}
          onUpdateStatus={handleUpdateItem}
        />
      )}

      {/* Guided Takedown Workflow Drawer Modal */}
      {selectedWorkflowItem && (
        <YouTubeTakedownWorkflowDrawer
          item={selectedWorkflowItem}
          onClose={() => setSelectedWorkflowItem(null)}
          onCompleteWorkflow={handleUpdateItem}
        />
      )}
    </div>
  );
}
