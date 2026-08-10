import React, { useState, useEffect } from "react";
import { AlertTriangle, Clapperboard, Eye, Film, Activity, ArrowRight } from "lucide-react";
import type {
  ThreatLevel,
  ThreatLabel,
  DistributionActivity,
  ExposureLevel,
} from "@/lib/copyright/risk-mapping";

export interface CopyrightFindingRiskPanelProps {
  findingId: string;
  piracyRiskScore?: number | null;
  threatLevel?: ThreatLevel;
  threatLabel?: ThreatLabel;
  distributionActivity?: DistributionActivity;
  distributionActivityFormatted?: string;
  exposureLevel?: ExposureLevel;
  exposureLevelFormatted?: string;
  copyType?: string;
  isLive?: boolean;
  canTakeAction?: boolean;
  alertMessage?: string;
  onTakeAction?: () => void;
  onReviewEvidence?: () => void;
  className?: string;
  // Compatibility props
  trafficSignal?: string;
  audienceReach?: string;
  distributionType?: string;
}

function getBadgeStyle(label: ThreatLabel): { badgeCls: string; textCls: string } {
  switch (label) {
    case "CRITICAL":
      return {
        badgeCls: "bg-red-50 text-red-600 border-red-200",
        textCls: "text-red-600",
      };
    case "HIGH RISK":
      return {
        badgeCls: "bg-red-50 text-red-600 border-red-200",
        textCls: "text-red-600",
      };
    case "MEDIUM RISK":
      return {
        badgeCls: "bg-amber-50 text-amber-600 border-amber-200",
        textCls: "text-amber-600",
      };
    case "LOW RISK":
      return {
        badgeCls: "bg-emerald-50 text-emerald-600 border-emerald-200",
        textCls: "text-emerald-600",
      };
  }
}

export function CopyrightFindingRiskPanel({
  piracyRiskScore = null,
  threatLevel = "High",
  threatLabel = "HIGH RISK",
  distributionActivity = "HIGH",
  distributionActivityFormatted,
  exposureLevel = "NOT ESTABLISHED",
  exposureLevelFormatted,
  copyType = "UNKNOWN",
  isLive = false,
  canTakeAction = true,
  alertMessage = "Unauthorized piracy copy detected on public source",
  onTakeAction,
  onReviewEvidence,
  className = "",
  trafficSignal,
  audienceReach,
  distributionType,
}: CopyrightFindingRiskPanelProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const hasScore = typeof piracyRiskScore === "number" && !isNaN(piracyRiskScore);
  const score = hasScore ? Math.max(0, Math.min(100, piracyRiskScore!)) : null;

  const effectiveThreatLabel: ThreatLabel = threatLabel ?? "HIGH RISK";
  const effectiveThreatLevel: ThreatLevel = threatLevel ?? "High";
  const badgeStyle = getBadgeStyle(effectiveThreatLabel);

  // Formatted metric values
  const displayDistActivity = distributionActivityFormatted || (trafficSignal ?? "High");
  const displayExposure = exposureLevelFormatted || (audienceReach ?? "Not Established");
  const displayCopyType = copyType || (distributionType ?? "UNKNOWN");

  // Pointer position percentage formula: 100 - score (clamped between 6% and 94%).
  const targetPointerPercent = score != null ? Math.max(6, Math.min(94, 100 - score)) : null;
  // Animate pointer from 100% to target location on mount
  const currentPointerPercent = mounted ? targetPointerPercent : targetPointerPercent != null ? 94 : null;

  return (
    <div
      className={`w-full rounded-xl border border-slate-200/90 bg-white p-3.5 text-slate-900 shadow-sm flex flex-col justify-between space-y-3 transition-all duration-300 ${className}`}
    >
      {/* 1. TOP STATUS ROW */}
      <div className="flex items-center justify-between">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase transition-all duration-300 ${badgeStyle.badgeCls}`}
        >
          {effectiveThreatLabel}
        </span>
        {isLive ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            ● Live
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <span className="h-2 w-2 rounded-full bg-slate-400" />● Offline
          </span>
        )}
      </div>

      {/* 2. FOUR REFINED COPYRIGHT METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 border-y border-slate-100 text-slate-700">
        {/* Metric 1: PIRACY RISK */}
        <div className="flex flex-col items-center text-center space-y-0.5 group cursor-default">
          <Clapperboard className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            PIRACY RISK
          </span>
          <span className="text-xs font-bold text-slate-900">
            <span className={badgeStyle.textCls}>{effectiveThreatLevel}</span>
            {score != null ? (
              <span className="text-[10px] font-normal text-slate-400"> · {score}/100</span>
            ) : (
              <span className="text-[10px] font-normal text-slate-400"> · Not scored</span>
            )}
          </span>
        </div>

        {/* Metric 2: DISTRIBUTION ACTIVITY */}
        <div className="flex flex-col items-center text-center space-y-0.5 group cursor-default">
          <Activity className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            DISTRIBUTION ACTIVITY
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayDistActivity}>
            {displayDistActivity}
          </span>
        </div>

        {/* Metric 3: EXPOSURE LEVEL */}
        <div className="flex flex-col items-center text-center space-y-0.5 group cursor-default">
          <Eye className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            EXPOSURE LEVEL
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayExposure}>
            {displayExposure}
          </span>
        </div>

        {/* Metric 4: COPY TYPE */}
        <div className="flex flex-col items-center text-center space-y-0.5 group cursor-default">
          <Film className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            COPY TYPE
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayCopyType}>
            {displayCopyType}
          </span>
        </div>
      </div>

      {/* 3. SEGMENTED GRADIENT RISK BAR WITH ANIMATED SLIDING POINTER */}
      <div className="relative pt-1 pb-3 overflow-hidden">
        <div className="flex items-center gap-[2px] w-full h-4">
          {Array.from({ length: 36 }).map((_, i) => {
            const pct = i / 35;
            if (score == null) {
              return (
                <div
                  key={i}
                  className="flex-1 h-full rounded-[1px] bg-slate-200 opacity-60 transition-all duration-300"
                />
              );
            }
            // 0% (left) = RED -> 33% = ORANGE -> 66% = YELLOW -> 100% (right) = GREEN
            let bg = "bg-red-500";
            if (pct > 0.72) bg = "bg-emerald-500";
            else if (pct > 0.48) bg = "bg-amber-400";
            else if (pct > 0.24) bg = "bg-orange-500";

            const segmentPointerDist = currentPointerPercent != null ? Math.abs((100 - pct * 100) - (100 - currentPointerPercent)) : 100;
            const isPointerSegment = segmentPointerDist < 3.5;

            return (
              <div
                key={i}
                style={{
                  transitionDelay: `${i * 10}ms`,
                  transform: mounted ? "scaleY(1)" : "scaleY(0.4)",
                  opacity: mounted ? (isPointerSegment ? 1 : 0.85) : 0.2,
                }}
                className={`flex-1 h-full rounded-[1px] ${bg} transition-all duration-500 hover:scale-y-125 hover:opacity-100 ${
                  isPointerSegment ? "brightness-110 scale-y-110 shadow-sm" : ""
                }`}
              />
            );
          })}
        </div>

        {/* Dynamic Animated Triangle Pointer */}
        {currentPointerPercent != null && (
          <div
            className="absolute bottom-0 transition-all duration-700 ease-out transform -translate-x-1/2 flex flex-col items-center z-10"
            style={{ left: `${currentPointerPercent}%` }}
            data-testid="risk-gradient-pointer"
          >
            <div className="w-0 h-0 border-x-[5px] border-x-transparent border-b-[7px] border-b-red-600 drop-shadow-[0_2px_5px_rgba(220,38,38,0.6)] animate-pulse" />
          </div>
        )}
      </div>

      {/* 4. ALERT MESSAGE & ACTION ROW */}
      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 min-h-[24px]">
        <div className="flex items-center gap-1.5 min-w-0 font-medium text-slate-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500 animate-pulse" />
          <span className="truncate">{alertMessage}</span>
        </div>

        {canTakeAction ? (
          <button
            type="button"
            onClick={onTakeAction}
            className="shrink-0 font-semibold text-red-600 hover:text-red-700 hover:underline flex items-center gap-0.5 ml-2 transition-all duration-200 hover:translate-x-0.5"
          >
            Take action now <ArrowRight className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onReviewEvidence}
            className="shrink-0 font-medium text-slate-600 hover:text-slate-900 hover:underline flex items-center gap-0.5 ml-2 transition-all duration-200 hover:translate-x-0.5"
          >
            Review evidence <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export default CopyrightFindingRiskPanel;
