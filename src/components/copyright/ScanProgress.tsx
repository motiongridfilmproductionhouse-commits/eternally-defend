import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  ScanLine,
  Image as ImageIcon,
  Sparkles,
  Globe,
  FileCheck,
  CheckCircle2,
  Film,
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
  type SeenActivityThreatState,
} from "@/lib/copyright/scan-activity";
import { LiveWebsiteInvestigation } from "@/components/copyright/LiveWebsiteInvestigation";
import { brightDataTelemetryFromStats } from "@/lib/copyright/scan-activity";

export interface ScanProgressProps {
  previews: string[];
  title: string;
  kind: "image" | "video";
  scanStatus?: string | null;
  scanId?: string | null;
  stats?: Record<string, unknown> | null;
}

const WORKFLOW_ICONS = [
  ImageIcon,
  ScanLine,
  Sparkles,
  Search,
  Globe,
  Download,
  Scale,
  Save,
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

function badgeClasses(tone: ReturnType<typeof resolveCopyrightThreatBadge>["tone"]): string {
  switch (tone) {
    case "verified":
      return "border-red-500/50 bg-red-500/10 text-red-300";
    case "multiple":
      return "border-orange-500/50 bg-orange-500/10 text-orange-300";
    case "potential":
      return "border-amber-500/50 bg-amber-500/10 text-amber-300";
    case "provider_limited":
      return "border-amber-500/40 bg-slate-500/10 text-amber-200/90";
    case "failed":
      return "border-destructive/50 bg-destructive/10 text-destructive";
    case "partial":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    default:
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }
}

function currentStageLabel(
  stats: Record<string, unknown> | null | undefined,
  workflowIndex: number,
): string {
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
      { label: "Queries completed", value: counters.queries_completed },
      { label: "Candidate pages found", value: counters.candidate_pages },
      { label: "Websites checked", value: counters.websites_checked },
      { label: "Potential threats", value: counters.potential_threats },
      { label: "Verified findings", value: counters.verified_findings },
      { label: "Provider failures", value: counters.provider_failures },
      { label: "Search sweeps run", value: brightData.requests },
      { label: "Search sweeps returned", value: brightData.successes },
      { label: "Leads discovered", value: brightData.candidates },
      { label: "Unique candidate URLs", value: brightData.uniqueUrls },
    ],
    [counters, brightData],
  );

  const animate = !reducedMotion && tabVisible;

  return (
    <section className="relative overflow-hidden rounded-xl border border-primary/30 bg-card/60 p-5 backdrop-blur">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />

      <header className="relative flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/10">
            <Radar className={`h-5 w-5 text-primary ${animate ? "animate-pulse" : ""}`} />
            {animate && (
              <span className="absolute inset-0 animate-ping rounded-xl border border-primary/30" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              Scanning in progress · {title}
            </h2>
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

      <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full w-full rounded-full bg-gradient-to-r from-primary/30 via-primary/60 to-primary/30 ${
            animate ? "animate-[indeterminate_1.8s_ease-in-out_infinite]" : ""
          }`}
          style={{ transformOrigin: "left center" }}
        />
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {counterItems.map((c) => (
          <div
            key={c.label}
            className="rounded-lg border border-border/40 bg-background/25 px-2.5 py-2"
          >
            <p className="text-[10px] text-muted-foreground">{c.label}</p>
            <p className="text-sm font-semibold tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="relative mt-5 grid gap-5 lg:grid-cols-[minmax(0,240px)_1fr]">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {kind === "video" ? "Extracted frames" : "Reference material"}
          </p>
          <div className="relative overflow-hidden rounded-lg border border-border/60 bg-background/40">
            {previews[0] ? (
              <img
                src={previews[0]}
                alt={`Reference material for ${title}`}
                className="h-36 w-full object-cover sm:h-40"
              />
            ) : (
              <div className="grid h-36 w-full place-items-center text-muted-foreground sm:h-40">
                {kind === "video" ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
              </div>
            )}
            {animate && (
              <span className="pointer-events-none absolute inset-x-0 top-0 h-10 animate-[scanSweep_2.4s_ease-in-out_infinite] bg-gradient-to-b from-primary/40 to-transparent" />
            )}
          </div>
          {previews.length > 1 && (
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
          )}
        </div>

        <div className="space-y-4">
          <ol className="space-y-1.5">
            {COPYRIGHT_WORKFLOW_STAGES.map((s, i) => {
              const Icon = WORKFLOW_ICONS[i] ?? FileCheck;
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : done
                        ? "border-border/50 bg-background/30 text-muted-foreground"
                        : "border-border/40 bg-background/10 text-muted-foreground/60"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Icon className={`h-3.5 w-3.5 ${active && animate ? "animate-pulse text-primary" : ""}`} />
                  )}
                  <span className="min-w-0 truncate">{s.label}</span>
                  {active && animate && (
                    <Loader2 className="ml-auto h-3 w-3 animate-spin text-primary" />
                  )}
                </li>
              );
            })}
          </ol>

          <LiveWebsiteInvestigation
            stats={stats}
            scanStatus={scanStatus}
            scanId={scanId}
            isScanning
          />
        </div>
      </div>

      <style>{`
        @keyframes scanSweep {
          0% { transform: translateY(0); opacity: 0.15; }
          50% { transform: translateY(150px); opacity: 0.55; }
          100% { transform: translateY(0); opacity: 0.15; }
        }
        @keyframes indeterminate {
          0% { transform: translateX(-100%) scaleX(0.35); }
          50% { transform: translateX(10%) scaleX(0.65); }
          100% { transform: translateX(100%) scaleX(0.35); }
        }
        @keyframes threatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          40% { box-shadow: 0 0 0 3px rgba(239,68,68,0.35); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-pulse, .animate-ping, .animate-spin,
          .animate-\\[scanSweep_2\\.4s_ease-in-out_infinite\\],
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
