import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  ScanLine,
  Image as ImageIcon,
  Sparkles,
  Globe,
  FileCheck,
  CheckCircle2,
  Radar,
  Search,
  Download,
  Scale,
  Save,
} from "lucide-react";
import {
  COPYRIGHT_WORKFLOW_STAGES,
  activityCountersFromStats,
  resolveCopyrightThreatBadge,
  resolveNewVerifiedActivityPulse,
  resolveWorkflowStageFromStats,
  workflowStageIndex,
  parseRecentActivity,
  brightDataTelemetryFromStats,
  type SeenActivityThreatState,
} from "@/lib/copyright/scan-activity";
import { LiveWebsiteInvestigation } from "@/components/copyright/LiveWebsiteInvestigation";
import { LiveFindingsProcessing } from "@/components/copyright/LiveFindingsProcessing";
import { ReferenceMaterialReel } from "@/components/copyright/ReferenceMaterialReel";

export interface ScanProgressProps {
  previews: string[];
  title: string;
  kind: "image" | "video";
  scanStatus?: string | null;
  scanId?: string | null;
  stats?: Record<string, unknown> | null;
  matches?: Array<Record<string, unknown>> | null;
}

const WORKFLOW_ICONS = [
  ImageIcon,
  Search,
  Globe,
  ScanLine,
  Sparkles,
  Scale,
  Save,
  CheckCircle2,
] as const;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

function badgeClasses(tone: string): string {
  switch (tone) {
    case "verified":
      return "border-red-500/60 bg-red-500/15 text-red-300 shadow-[0_0_12px_rgba(239,68,68,0.25)] animate-pulse";
    case "purple":
      return "border-purple-500/50 bg-purple-500/10 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]";
    case "potential":
    case "multiple":
      return "border-orange-500/50 bg-orange-500/10 text-orange-300 shadow-[0_0_10px_rgba(249,115,22,0.2)]";
    case "no_threat":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-destructive/60 bg-destructive/15 text-destructive";
    case "partial":
    case "scanning":
    default:
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }
}

function currentStageLabel(
  stats: Record<string, unknown> | null | undefined,
  workflowIndex: number,
): string {
  if (stats?.scan_bootstrap === true) {
    return "Starting copyright investigation";
  }
  const wf = resolveWorkflowStageFromStats(stats);
  const idx = workflowStageIndex(wf);
  return COPYRIGHT_WORKFLOW_STAGES[Math.min(idx, COPYRIGHT_WORKFLOW_STAGES.length - 1)]!.label;
}

export function ScanProgress({
  previews,
  title,
  kind,
  scanStatus,
  scanId,
  stats,
  matches,
}: ScanProgressProps) {
  const reducedMotion = usePrefersReducedMotion();
  const tabVisible = useTabVisible();
  const [visibleFrames, setVisibleFrames] = useState(1);

  const workflowKey = resolveWorkflowStageFromStats(stats ?? {});
  const stageIndex = workflowStageIndex(workflowKey);
  const counters = activityCountersFromStats(stats);
  const badge = resolveCopyrightThreatBadge({ scanStatus, stats });
  const stageNote = currentStageLabel(stats, stageIndex);
  const brightData = brightDataTelemetryFromStats(stats, scanStatus ?? "running");

  const seenRef = useRef<SeenActivityThreatState | null>(null);
  const [badgePulse, setBadgePulse] = useState(false);

  // Counter animation & highlight tracking
  const prevCountersRef = useRef<Record<string, number>>({});
  const [pulsingKeys, setPulsingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const pulse = resolveNewVerifiedActivityPulse({
      scanId: scanId ?? null,
      events: parseRecentActivity(stats).filter((e) => e.threat === "verified_finding"),
      previous: seenRef.current,
    });
    seenRef.current = pulse.next;
    if (!pulse.isInitialSeed && pulse.pulseIds.length && !reducedMotion && tabVisible) {
      setBadgePulse(true);
      const t = window.setTimeout(() => setBadgePulse(false), 1_000);
      return () => window.clearTimeout(t);
    }
  }, [stats, scanId, reducedMotion, tabVisible]);

  useEffect(() => {
    if (visibleFrames >= previews.length) return;
    const id = setTimeout(() => setVisibleFrames((n) => n + 1), 550);
    return () => clearTimeout(id);
  }, [visibleFrames, previews.length]);

  const counterItems = useMemo(
    () => [
      { key: "queries_completed", label: "Queries completed", value: counters.queries_completed, color: "blue" },
      { key: "candidate_pages", label: "Candidate pages found", value: counters.candidate_pages, color: "blue" },
      { key: "websites_checked", label: "Websites checked", value: counters.websites_checked, color: "purple" },
      { key: "potential_threats", label: "Potential threats", value: counters.potential_threats, color: "orange" },
      { key: "verified_findings", label: "Verified findings", value: counters.verified_findings, color: "red" },
      { key: "provider_failures", label: "Discovery errors", value: counters.provider_failures, color: "amber" },
      { key: "expanded_sweeps", label: "Expanded discovery sweeps", value: brightData.requests, color: "blue" },
      { key: "sweeps_results", label: "Sweeps with results", value: brightData.successes, color: "purple" },
      { key: "leads_discovered", label: "Leads discovered", value: brightData.candidates, color: "blue" },
      { key: "unique_urls", label: "Unique candidate URLs", value: brightData.uniqueUrls, color: "purple" },
    ],
    [counters, brightData],
  );

  // Pulse updated counters
  useEffect(() => {
    const updated = new Set<string>();
    for (const c of counterItems) {
      const prev = prevCountersRef.current[c.key];
      if (prev !== undefined && c.value > prev) {
        updated.add(c.key);
      }
      prevCountersRef.current[c.key] = c.value;
    }
    if (updated.size > 0) {
      setPulsingKeys(updated);
      const timer = setTimeout(() => setPulsingKeys(new Set()), 1_200);
      return () => clearTimeout(timer);
    }
  }, [counterItems]);

  const animate = !reducedMotion && tabVisible;

  // Determine stage progress bar color tone based on state & findings
  const hasVerified = counters.verified_findings > 0 || badge.tone === "verified";
  const hasPotential = counters.potential_threats > 0;
  const isAnalyzing = stageIndex >= 3 && stageIndex <= 4;
  const isVerifying = stageIndex >= 5;

  let progressBarGradient = "from-sky-500/40 via-sky-400 to-sky-500/40";
  if (hasVerified) {
    progressBarGradient = "from-red-500/50 via-red-400 to-red-600";
  } else if (hasPotential || isVerifying) {
    progressBarGradient = "from-orange-500/50 via-orange-400 to-orange-500/50";
  } else if (isAnalyzing) {
    progressBarGradient = "from-purple-500/50 via-purple-400 to-purple-500/50";
  }

  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/30 bg-card/60 p-5 backdrop-blur space-y-5">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />

      {/* Header */}
      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-colors ${
            hasVerified
              ? "border-red-500/50 bg-red-500/10 text-red-400"
              : isAnalyzing
                ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
                : "border-primary/40 bg-primary/10 text-primary"
          }`}>
            <Radar className={`h-5 w-5 ${animate ? "animate-pulse" : ""}`} />
            {animate && (
              <span className="absolute inset-0 animate-ping rounded-xl border border-current/30" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">Scanning in progress · {title}</h2>
            <p className="text-xs text-muted-foreground">{stageNote}</p>
          </div>
          <Loader2
            className={`ml-auto hidden h-4 w-4 shrink-0 text-primary sm:block ${animate ? "animate-spin" : ""}`}
          />
        </div>
        <div
          className={`shrink-0 self-start rounded-md border px-2.5 py-1 text-[10px] font-semibold tracking-wide ${badgeClasses(badge.tone)} ${
            badgePulse && animate ? "animate-[threatPulse_0.9s_ease-out_once]" : ""
          }`}
        >
          {badge.label}
        </div>
      </header>

      {/* Dynamic Smooth Animated Progress Bar */}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full w-full rounded-full bg-gradient-to-r ${progressBarGradient} transition-colors duration-500 ${
            animate ? "animate-[indeterminate_1.8s_ease-in-out_infinite]" : ""
          }`}
          style={{ transformOrigin: "left center" }}
        />
      </div>

      {/* Top Metric Cards Grid */}
      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {counterItems.map((c) => {
          const isPulsing = pulsingKeys.has(c.key);
          return (
            <div
              key={c.label}
              className={`rounded-lg border px-3 py-2 transition-all duration-300 ${
                isPulsing
                  ? c.color === "red"
                    ? "border-red-500/60 bg-red-500/10 shadow-[0_0_12px_rgba(239,68,68,0.3)] scale-[1.02]"
                    : c.color === "orange"
                      ? "border-orange-500/60 bg-orange-500/10 shadow-[0_0_12px_rgba(249,115,22,0.3)] scale-[1.02]"
                      : c.color === "purple"
                        ? "border-purple-500/60 bg-purple-500/10 shadow-[0_0_12px_rgba(168,85,247,0.3)] scale-[1.02]"
                        : "border-sky-500/60 bg-sky-500/10 shadow-[0_0_12px_rgba(56,189,248,0.3)] scale-[1.02]"
                  : "border-border/40 bg-background/25"
              }`}
            >
              <p className="text-[10px] text-muted-foreground truncate">{c.label}</p>
              <p className={`text-sm font-semibold tabular-nums ${
                c.color === "red" && c.value > 0 ? "text-red-400" : c.color === "orange" && c.value > 0 ? "text-orange-400" : ""
              }`}>
                {c.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Main Section */}
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,240px)_1fr]">
        <div className="space-y-3">
          <ReferenceMaterialReel
            originalPreview={previews[0] ?? null}
            title={title}
            stats={stats}
            scanStatus={scanStatus}
            reducedMotion={reducedMotion}
            forceLive
          />
          {kind === "video" && previews.length > 1 && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Extracted frames
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {previews.map((src, i) => (
                  <div
                    key={src}
                    className={`relative overflow-hidden rounded border transition-all duration-500 ${
                      i < visibleFrames
                        ? "border-primary/40 opacity-100"
                        : "border-border/40 opacity-0"
                    }`}
                  >
                    <img src={src} alt={`Frame ${i + 1}`} className="h-12 w-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Reference Intelligence Workflow Stage Timeline */}
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Reference Intelligence Timeline
            </h3>
            <ol className="space-y-1.5">
              {COPYRIGHT_WORKFLOW_STAGES.map((s, i) => {
                const Icon = WORKFLOW_ICONS[i] ?? FileCheck;
                const done = i < stageIndex || scanStatus === "completed";
                const active = i === stageIndex && scanStatus !== "completed";
                return (
                  <li
                    key={s.key}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-all duration-300 ${
                      active
                        ? "border-purple-500/50 bg-purple-500/10 text-foreground font-medium shadow-[0_0_10px_rgba(168,85,247,0.15)]"
                        : done
                          ? "border-border/50 bg-background/30 text-muted-foreground"
                          : "border-border/40 bg-background/10 text-muted-foreground/40"
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Icon
                        className={`h-3.5 w-3.5 ${active && animate ? "animate-pulse text-purple-400" : ""}`}
                      />
                    )}
                    <span className="min-w-0 truncate">{s.label}</span>
                    {active && animate && (
                      <Loader2 className="ml-auto h-3 w-3 animate-spin text-purple-400" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* LIVE FINDINGS PROCESSING SECTION */}
          <LiveFindingsProcessing
            stats={stats}
            scanStatus={scanStatus}
            scanId={scanId}
            matches={matches}
          />

          {/* Live Website Telemetry */}
          <LiveWebsiteInvestigation
            stats={stats}
            scanStatus={scanStatus}
            scanId={scanId}
            isScanning
          />
        </div>
      </div>

      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%) scaleX(0.35); }
          50% { transform: translateX(10%) scaleX(0.65); }
          100% { transform: translateX(100%) scaleX(0.35); }
        }
        @keyframes threatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          40% { box-shadow: 0 0 0 4px rgba(239,68,68,0.35); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse, .animate-ping, .animate-spin,
          .animate-\\[indeterminate_1\\.8s_ease-in-out_infinite\\],
          .animate-\\[threatPulse_0\\.9s_ease-out_once\\] {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}

/** @deprecated Use COPYRIGHT_WORKFLOW_STAGES from scan-activity instead. */
export const SCAN_STAGES = COPYRIGHT_WORKFLOW_STAGES.map((s) => ({
  key: s.key,
  label: s.label,
}));
