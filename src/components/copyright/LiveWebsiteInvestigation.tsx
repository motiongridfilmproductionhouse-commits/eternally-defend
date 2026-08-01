import { useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Globe,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Loader2,
  Ban,
  CircleAlert,
} from "lucide-react";
import {
  formatRelativeActivityTime,
  parseRecentActivity,
  providerDisplayLabel,
  resolveNewVerifiedActivityPulse,
  sortActivityNewestFirst,
  type ScanActivityEvent,
  type ScanActivityThreat,
  type SeenActivityThreatState,
} from "@/lib/copyright/scan-activity";

export type LiveWebsiteInvestigationProps = {
  stats: Record<string, unknown> | null | undefined;
  scanStatus?: string | null;
  scanId?: string | null;
  isScanning?: boolean;
};

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

function threatToneClasses(threat: ScanActivityThreat): string {
  switch (threat) {
    case "checking":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "no_threat":
      return "border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90";
    case "potential":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "high_risk":
      return "border-orange-500/45 bg-orange-500/10 text-orange-300";
    case "verified_finding":
      return "border-red-500/50 bg-red-500/10 text-red-300";
    case "retrieval_failed":
      return "border-slate-500/40 bg-slate-500/10 text-slate-400";
    case "blocked_safety":
      return "border-red-500/30 bg-slate-500/10 text-slate-400 ring-1 ring-red-500/30";
    case "excluded":
      return "border-emerald-500/25 bg-background/30 text-muted-foreground";
    default:
      return "border-border/40 bg-background/20 text-muted-foreground";
  }
}

function ThreatIcon({ threat, animate }: { threat: ScanActivityThreat; animate: boolean }) {
  const pulse = animate ? "animate-pulse" : "";
  switch (threat) {
    case "checking":
      return <Loader2 className={`h-3.5 w-3.5 ${pulse} text-sky-400`} />;
    case "verified_finding":
    case "high_risk":
      return <ShieldAlert className={`h-3.5 w-3.5 ${pulse} text-red-400`} />;
    case "potential":
      return <CircleAlert className={`h-3.5 w-3.5 ${pulse} text-amber-400`} />;
    case "blocked_safety":
      return <Ban className="h-3.5 w-3.5 text-red-400/80" />;
    case "retrieval_failed":
      return <ShieldX className="h-3.5 w-3.5 text-slate-400" />;
    case "excluded":
    case "no_threat":
      return <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />;
    default:
      return <Globe className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function ActivityRow({
  event,
  pulse,
  animateEntry,
  reducedMotion,
}: {
  event: ScanActivityEvent;
  pulse: boolean;
  animateEntry: boolean;
  reducedMotion: boolean;
}) {
  const entryClass =
    animateEntry && !reducedMotion
      ? "animate-[activityEnter_0.45s_ease-out]"
      : "";
  const pulseClass =
    pulse && !reducedMotion ? "animate-[threatPulse_0.9s_ease-out_once]" : "";

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${threatToneClasses(event.threat)} ${entryClass} ${pulseClass}`}
      data-activity-id={event.id}
    >
      <div className="flex items-start gap-2">
        <ThreatIcon threat={event.threat} animate={event.threat === "checking"} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium truncate">{event.hostname}</span>
            <span className="text-[10px] uppercase tracking-wide opacity-70">
              {providerDisplayLabel(event.provider)}
            </span>
            <span className="ml-auto shrink-0 text-[10px] opacity-60">
              {formatRelativeActivityTime(event.occurred_at)}
            </span>
          </div>
          <p className="truncate text-[11px] opacity-80">{event.page_label}</p>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="rounded border border-current/20 px-1.5 py-0.5">
              {event.stage_label}
            </span>
            <span className="font-semibold tracking-wide">{event.threat_label}</span>
          </div>
          {event.evidence_href && event.threat === "verified_finding" && (
            <a
              href={event.evidence_href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              Open verified evidence page
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export function LiveWebsiteInvestigation({
  stats,
  scanStatus,
  scanId,
  isScanning,
}: LiveWebsiteInvestigationProps) {
  const reducedMotion = usePrefersReducedMotion();
  const tabVisible = useTabVisible();
  const events = useMemo(
    () => sortActivityNewestFirst(parseRecentActivity(stats)),
    [stats],
  );

  const seenRef = useRef<SeenActivityThreatState | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const [entryIds, setEntryIds] = useState<Set<string>>(new Set());
  const [pulseIds, setPulseIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const pulse = resolveNewVerifiedActivityPulse({
      scanId: scanId ?? null,
      events,
      previous: seenRef.current,
    });
    seenRef.current = pulse.next;

    const newOrChanged = events.filter((e) => !knownIdsRef.current.has(e.id));
    if (newOrChanged.length) {
      const nextKnown = new Set(knownIdsRef.current);
      for (const e of events) nextKnown.add(e.id);
      knownIdsRef.current = nextKnown;
      setEntryIds(new Set(newOrChanged.map((e) => e.id)));
    }

    if (!pulse.isInitialSeed && pulse.pulseIds.length) {
      setPulseIds(new Set(pulse.pulseIds));
      const timer = window.setTimeout(() => setPulseIds(new Set()), 1_200);
      return () => window.clearTimeout(timer);
    }
  }, [events, scanId]);

  useEffect(() => {
    if (scanId) {
      knownIdsRef.current = new Set();
      seenRef.current = null;
      setEntryIds(new Set());
      setPulseIds(new Set());
    }
  }, [scanId]);

  const scanning = isScanning ?? (scanStatus === "running" || scanStatus === "pending");
  const emptyMessage = scanning
    ? "Waiting for the first real website candidate…"
    : "No website investigation activity recorded for this scan.";

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Live website investigation
      </h3>
      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/50 bg-background/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <ul
          className={`max-h-[min(420px,50vh)] space-y-1.5 overflow-y-auto pr-0.5 ${
            !tabVisible || reducedMotion ? "" : ""
          }`}
          aria-live="polite"
          aria-relevant="additions text"
        >
          {events.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              pulse={pulseIds.has(event.id)}
              animateEntry={entryIds.has(event.id)}
              reducedMotion={reducedMotion || !tabVisible}
            />
          ))}
        </ul>
      )}
      <style>{`
        @keyframes activityEnter {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes threatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          40% { box-shadow: 0 0 0 3px rgba(239,68,68,0.35); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[activityEnter_0\\.45s_ease-out\\],
          .animate-\\[threatPulse_0\\.9s_ease-out_once\\] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
