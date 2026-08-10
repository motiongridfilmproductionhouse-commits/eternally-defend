import React from "react";
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
  const hasScore = typeof piracyRiskScore === "number" && !isNaN(piracyRiskScore);
  const score = hasScore ? Math.max(0, Math.min(100, piracyRiskScore!)) : null;

  const effectiveThreatLabel: ThreatLabel = threatLabel ?? "HIGH RISK";
  const effectiveThreatLevel: ThreatLevel = threatLevel ?? "High";
  const badgeStyle = getBadgeStyle(effectiveThreatLabel);

  // Formatted metric values
  const displayDistActivity = distributionActivityFormatted || (trafficSignal ?? "High");
  const displayExposure = exposureLevelFormatted || (audienceReach ?? "Not Established");
  const displayCopyType = copyType || (distributionType ?? "UNKNOWN");

  // High risk sits toward RED (left, 0-25%), Low risk toward GREEN (right, 75-100%).
  // Pointer position percentage formula: 100 - score (clamped between 6% and 94%).
  const pointerPercent = score != null ? Math.max(6, Math.min(94, 100 - score)) : null;

  return (
    <div
      className={`w-full rounded-xl border border-slate-200/90 bg-white p-3.5 text-slate-900 shadow-sm flex flex-col justify-between space-y-3 ${className}`}
    >
      {/* 1. TOP STATUS ROW */}
      <div className="flex items-center justify-between">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase ${badgeStyle.badgeCls}`}
        >
          {effectiveThreatLabel}
        </span>
        {isLive ? (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />● Live
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
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Clapperboard className="h-4 w-4 text-slate-400" />
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
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Activity className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            DISTRIBUTION ACTIVITY
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayDistActivity}>
            {displayDistActivity}
          </span>
        </div>

        {/* Metric 3: EXPOSURE LEVEL */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Eye className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            EXPOSURE LEVEL
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayExposure}>
            {displayExposure}
          </span>
        </div>

        {/* Metric 4: COPY TYPE */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Film className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            COPY TYPE
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[100px]" title={displayCopyType}>
            {displayCopyType}
          </span>
        </div>
      </div>

      {/* 3. SEGMENTED GRADIENT RISK BAR */}
      <div className="relative pt-1 pb-3">
        <div className="flex items-center gap-[2px] w-full h-4">
          {Array.from({ length: 36 }).map((_, i) => {
            const pct = i / 35;
            if (score == null) {
              // Unscored bar rendering: segment highlights around threat level region or neutral opacity
              return (
                <div
                  key={i}
                  className="flex-1 h-full rounded-[1px] bg-slate-200 opacity-60"
                />
              );
            }
            // 0% (left) = RED -> 33% = ORANGE -> 66% = YELLOW -> 100% (right) = GREEN
            let bg = "bg-red-500";
            if (pct > 0.72) bg = "bg-emerald-500";
            else if (pct > 0.48) bg = "bg-amber-400";
            else if (pct > 0.24) bg = "bg-orange-500";

            return (
              <div
                key={i}
                className={`flex-1 h-full rounded-[1px] ${bg} opacity-90 transition-opacity hover:opacity-100`}
              />
            );
          })}
        </div>

        {/* Dynamic Triangle Pointer (Hidden when score is unknown/null) */}
        {pointerPercent != null && (
          <div
            className="absolute bottom-0 transition-all duration-300 transform -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${pointerPercent}%` }}
            data-testid="risk-gradient-pointer"
          >
            <div className="w-0 h-0 border-x-[5px] border-x-transparent border-b-[7px] border-b-red-600" />
          </div>
        )}
      </div>

      {/* 4. ALERT MESSAGE & ACTION ROW */}
      <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 min-h-[24px]">
        <div className="flex items-center gap-1.5 min-w-0 font-medium text-slate-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
          <span className="truncate">{alertMessage}</span>
        </div>

        {canTakeAction ? (
          <button
            type="button"
            onClick={onTakeAction}
            className="shrink-0 font-semibold text-red-600 hover:text-red-700 hover:underline flex items-center gap-0.5 ml-2 transition"
          >
            Take action now <ArrowRight className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onReviewEvidence}
            className="shrink-0 font-medium text-slate-600 hover:text-slate-900 hover:underline flex items-center gap-0.5 ml-2 transition"
          >
            Review evidence <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export default CopyrightFindingRiskPanel;
