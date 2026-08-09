import React, { useState } from "react";
import { AnalystTask, ClientDecision, processClientDecision } from "@/lib/deepfake/analyst-queue-model";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  MessageSquare,
  HelpCircle,
  FileText,
  AlertTriangle,
  Send,
  ExternalLink,
  Gavel,
} from "lucide-react";

interface YouTubeClientApprovalCenterProps {
  tasks: AnalystTask[];
  onDecision?: (updatedTask: AnalystTask) => void;
}

export function YouTubeClientApprovalCenter({
  tasks,
  onDecision,
}: YouTubeClientApprovalCenterProps) {
  const [selectedTask, setSelectedTask] = useState<AnalystTask | null>(tasks[0] || null);
  const [decisionNotes, setDecisionNotes] = useState("");

  const handleDecision = (task: AnalystTask, decision: ClientDecision) => {
    const updated = processClientDecision(task, decision, decisionNotes);
    if (onDecision) onDecision(updated);
    setSelectedTask(updated);
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-2">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-400" />
          Client Decision Center
        </h2>
        <p className="text-xs text-muted-foreground">
          Review findings requiring explicit client approval prior to platform workflow execution.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="p-8 rounded-xl border border-dashed border-border text-center space-y-2">
          <div className="text-sm font-semibold text-foreground">No cases requiring client approval</div>
          <div className="text-xs text-muted-foreground">
            All findings are under active monitoring or have been resolved.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <div
              key={task.task_id}
              className="p-5 rounded-xl border border-border bg-card hover:border-slate-700 transition-all space-y-4 font-sans"
            >
              {/* Top Header */}
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-b border-border pb-3">
                <div className="font-semibold text-slate-200">
                  Target: <strong className="text-indigo-300">{task.target_name}</strong> ({task.client_name})
                </div>
                <div className="font-mono text-[11px] px-2.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  SLA Priority: {task.priority}
                </div>
              </div>

              {/* Finding Title & Ground */}
              <div className="space-y-1">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider text-[11px]">What Eterna Found</div>
                <h3 className="text-sm font-bold text-foreground line-clamp-2">{task.video_id}</h3>
              </div>

              {/* Recommended Action */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">Recommended Action</div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 font-bold font-mono">
                    {task.human_action_recommendation || task.ai_action_recommendation}
                  </span>
                  <span className="text-slate-400 font-mono text-[11px]">
                    (Authorization State: {task.authorization_state})
                  </span>
                </div>
              </div>

              {/* Client Decision Actions */}
              {task.client_decision ? (
                <div className="p-3.5 rounded-lg bg-indigo-950/40 border border-indigo-700/60 text-xs text-indigo-200 font-mono flex items-center justify-between">
                  <span>Client Decision Recorded: <strong>{task.client_decision}</strong></span>
                  <span>{new Date(task.client_decision_at || "").toLocaleString()}</span>
                </div>
              ) : (
                <div className="pt-2 border-t border-border space-y-3">
                  <textarea
                    rows={2}
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Add notes or instructions for analyst..."
                    className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-slate-100 text-xs"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleDecision(task, "APPROVE")}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer shadow"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Approve Takedown Notice
                    </button>
                    <button
                      onClick={() => handleDecision(task, "REQUEST_CHANGES")}
                      className="px-3.5 py-2 rounded-lg border border-amber-500/50 bg-amber-950/30 hover:bg-amber-950/60 text-amber-300 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <MessageSquare className="w-4 h-4" /> Request Changes
                    </button>
                    <button
                      onClick={() => handleDecision(task, "DECLINE")}
                      className="px-3.5 py-2 rounded-lg border border-rose-500/50 bg-rose-950/30 hover:bg-rose-950/60 text-rose-300 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" /> Decline
                    </button>
                    <button
                      onClick={() => handleDecision(task, "ASK_FOR_REVIEW")}
                      className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer ml-auto"
                    >
                      <HelpCircle className="w-4 h-4" /> Ask for Analyst Review
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
