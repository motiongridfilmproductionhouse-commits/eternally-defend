import React from "react";
import { AlertTriangle, Clapperboard, Eye, Film, Users, ArrowRight } from "lucide-react";

export interface CopyrightFindingRiskPanelProps {
  findingId: string;
  piracyRiskScore?: number | null;
  trafficSignal?: string;
  audienceReach?: string;
  distributionType?: string;
  verificationStatus?: string | null;
  isLive?: boolean;
  viewCount?: number | null;
  engagementCount?: number | null;
  searchVisibility?: string | null;
  formattedTraffic?: string | null;
  canTakeAction?: boolean;
  onTakeAction?: () => void;
  onReviewEvidence?: () => void;
  className?: string;
}

/**
 * Returns dynamic risk status label and styling based on piracyRiskScore:
 * 85–100 = CRITICAL
 * 70–84 = HIGH RISK
 * 45–69 = MEDIUM RISK
 * 0–44 = LOW RISK
 * null = Risk Score: Unknown
 */
function getRiskMeta(score: number | null): { label: string; badgeCls: string; textCls: string } {
  if (score == null) {
    return {
      label: "RISK: UNKNOWN",
      badgeCls: "bg-slate-100 text-slate-600 border-slate-200",
      textCls: "text-slate-500",
    };
  }
  if (score >= 85) {
    return {
      label: "CRITICAL",
      badgeCls: "bg-red-50 text-red-600 border-red-200",
      textCls: "text-red-600",
    };
  }
  if (score >= 70) {
    return {
      label: "HIGH RISK",
      badgeCls: "bg-red-50 text-red-600 border-red-200",
      textCls: "text-red-600",
    };
  }
  if (score >= 45) {
    return {
      label: "MEDIUM RISK",
      badgeCls: "bg-amber-50 text-amber-600 border-amber-200",
      textCls: "text-amber-600",
    };
  }
  return {
    label: "LOW RISK",
    badgeCls: "bg-emerald-50 text-emerald-600 border-emerald-200",
    textCls: "text-emerald-600",
  };
}

/**
 * Generates context-sensitive alert message based on score and leak classification.
 */
function getAlertMessage(score: number | null, type: string): string {
  const t = type.toUpperCase();
  if (t.includes("CAM") || t.includes("THEATRE") || t.includes("HDTC")) {
    return "Theatre-recorded print detected with high distribution activity";
  }
  if (t.includes("STREAMING")) {
    return "Unauthorized streaming mirror showing elevated exposure";
  }
  if (t.includes("DOWNLOAD") || t.includes("TORRENT")) {
    return "Download copy detected across public distribution sources";
  }
  if (score != null) {
    if (score >= 85) return "Rapid distribution detected across high-exposure sources";
    if (score >= 70) return "High audience exposure detected for this print";
    if (score >= 45) return "Distribution activity requires review";
    return "Limited distribution signal detected";
  }
  return "Distribution activity requires review";
}

export function CopyrightFindingRiskPanel({
  piracyRiskScore = null,
  trafficSignal = "Unknown",
  audienceReach = "Unknown",
  distributionType = "UNKNOWN",
  isLive = false,
  formattedTraffic,
  canTakeAction = true,
  onTakeAction,
  onReviewEvidence,
  className = "",
}: CopyrightFindingRiskPanelProps) {
  const hasScore = typeof piracyRiskScore === "number" && !isNaN(piracyRiskScore);
  const score = hasScore ? Math.max(0, Math.min(100, piracyRiskScore!)) : null;
  const riskMeta = getRiskMeta(score);
  const alertMsg = getAlertMessage(score, distributionType);

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
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase ${riskMeta.badgeCls}`}
        >
          {riskMeta.label}
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

      {/* 2. FOUR COPYRIGHT METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-2 border-y border-slate-100 text-slate-700">
        {/* Metric 1: CAM / PRINT RISK SCORE */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Clapperboard className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            CAM RISK SCORE
          </span>
          <span className="text-xs font-bold text-slate-900">
            {score != null ? (
              <>
                <span className={riskMeta.textCls}>{score}</span>
                <span className="text-[10px] font-normal text-slate-400"> /100</span>
              </>
            ) : (
              <span className="text-xs font-semibold text-slate-500">Unknown</span>
            )}
          </span>
        </div>

        {/* Metric 2: TRAFFIC SIGNAL */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Users className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            {formattedTraffic ? "HIGH TRAFFIC" : "TRAFFIC SIGNAL"}
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[90px]" title={formattedTraffic || trafficSignal}>
            {formattedTraffic || trafficSignal}
          </span>
        </div>

        {/* Metric 3: AUDIENCE REACH */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Eye className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            AUDIENCE REACH
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[90px]" title={audienceReach}>
            {audienceReach}
          </span>
        </div>

        {/* Metric 4: PRINT / LEAK TYPE */}
        <div className="flex flex-col items-center text-center space-y-0.5">
          <Film className="h-4 w-4 text-slate-400" />
          <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
            PRINT CAM RISK
          </span>
          <span className="text-xs font-bold text-slate-900 truncate max-w-[90px]" title={distributionType}>
            {distributionType}
          </span>
        </div>
      </div>

      {/* 3. SEGMENTED GRADIENT RISK BAR */}
      <div className="relative pt-1 pb-3">
        <div className="flex items-center gap-[2px] w-full h-4">
          {Array.from({ length: 36 }).map((_, i) => {
            const pct = i / 35;
            if (score == null) {
              // Neutral unscored bar state
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

        {/* Dynamic Triangle Pointer (Hidden when score is unknown) */}
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
          <span className="truncate">{alertMsg}</span>
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
