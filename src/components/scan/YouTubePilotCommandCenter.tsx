import React, { useState } from "react";
import { PilotEnrollment, DEFAULT_PILOT_FEATURE_FLAGS } from "@/lib/deepfake/pilot-operations-model";
import { AnalystTask } from "@/lib/deepfake/analyst-queue-model";
import {
  ShieldAlert,
  Users,
  CheckCircle2,
  Clock,
  Sliders,
  Award,
  AlertTriangle,
  Gavel,
  Activity,
  FileCheck,
} from "lucide-react";

interface YouTubePilotCommandCenterProps {
  enrollments?: PilotEnrollment[];
  tasks?: AnalystTask[];
}

export function YouTubePilotCommandCenter({
  enrollments = [],
  tasks = [],
}: YouTubePilotCommandCenterProps) {
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_PILOT_FEATURE_FLAGS);

  return (
    <div className="space-y-6 font-sans">
      {/* Header & Feature Flags Control */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-indigo-400" />
              YouTube Pilot Command Center
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Controlled pilot client management, SLA tracking, analyst review queue, and feature flag controls.
            </p>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
              Pilot Size: {enrollments.length || 1} Clients
            </span>
          </div>
        </div>

        {/* Feature Flags Toggle Bar */}
        <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2 text-xs">
          <div className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-indigo-400" /> Pilot Safety Feature Flags
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono">
            <label className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer">
              <span className="text-slate-300">PILOT_ENABLED</span>
              <input
                type="checkbox"
                checked={featureFlags.YOUTUBE_REMOVAL_PILOT_ENABLED}
                onChange={(e) => setFeatureFlags({ ...featureFlags, YOUTUBE_REMOVAL_PILOT_ENABLED: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer">
              <span className="text-slate-300">SUBMISSION_ENABLED</span>
              <input
                type="checkbox"
                checked={featureFlags.YOUTUBE_COMPLAINT_SUBMISSION_ENABLED}
                onChange={(e) => setFeatureFlags({ ...featureFlags, YOUTUBE_COMPLAINT_SUBMISSION_ENABLED: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer">
              <span className="text-slate-300">CLIENT_APPROVAL_REQ</span>
              <input
                type="checkbox"
                checked={featureFlags.YOUTUBE_CLIENT_APPROVAL_REQUIRED}
                onChange={(e) => setFeatureFlags({ ...featureFlags, YOUTUBE_CLIENT_APPROVAL_REQUIRED: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 cursor-pointer">
              <span className="text-slate-300">MONITORING_ENABLED</span>
              <input
                type="checkbox"
                checked={featureFlags.YOUTUBE_MONITORING_ENABLED}
                onChange={(e) => setFeatureFlags({ ...featureFlags, YOUTUBE_MONITORING_ENABLED: e.target.checked })}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Pilot Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 font-mono text-xs">
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">Active Clients</div>
          <div className="text-base font-bold text-slate-100">{enrollments.length || 1}</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">Protected Targets</div>
          <div className="text-base font-bold text-emerald-400">1</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">SLA Compliance</div>
          <div className="text-base font-bold text-emerald-400">100%</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">Avg Review Time</div>
          <div className="text-base font-bold text-indigo-300">14.2m</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">Approval Rate</div>
          <div className="text-base font-bold text-indigo-300">100%</div>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
          <div className="text-slate-500 text-[10px] uppercase">Auto Submissions</div>
          <div className="text-base font-bold text-emerald-400">0 (Safe)</div>
        </div>
      </div>
    </div>
  );
}
