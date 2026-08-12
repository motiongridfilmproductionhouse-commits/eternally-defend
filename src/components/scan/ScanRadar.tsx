/**
 * ScanRadar — live Web Scan loading visualization.
 *
 * IMPORTANT HONESTY CONSTRAINT: the scan pipeline (`POST /api/scan` in
 * src/routes/api/scan.ts) runs as a single synchronous request/response —
 * discovery, AI research/expansion, extraction, identity verification,
 * evidence classification, ranking, and persistence all happen server-side
 * inside one HTTP call with no incremental status channel back to the
 * client. That means the client can only ever know one of four *real*
 * states while a scan is in flight: not started / in flight / succeeded /
 * failed — never which of the twelve named pipeline stages is currently
 * executing.
 *
 * This component models the full `ScanStage` lifecycle so it is ready to be
 * driven by real incremental stage updates the moment the backend exposes
 * them (see the "RUNNING" case below for exactly what's missing). Until
 * then, callers must only ever pass "INITIALIZING", "RUNNING", "COMPLETE",
 * or "FAILED" — the other eight stage values exist for forward-compat and
 * must not be driven by a timer or guessed from elapsed time, which would
 * fabricate progress the caller does not actually have.
 */
import { useEffect, useRef, useState } from "react";
import {
  Youtube,
  MessageCircle,
  Newspaper,
  Globe,
  FileText,
  Search,
  Gem,
  Bot,
  Cpu,
  ShieldCheck,
  Users,
  Sparkles,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

export type ScanStage =
  | "INITIALIZING"
  | "QUERY_GENERATION"
  | "DISCOVERY"
  | "AI_RESEARCH"
  | "AI_EXPANSION"
  | "EXTRACTION"
  | "IDENTITY_VERIFICATION"
  | "EVIDENCE_ANALYSIS"
  | "RANKING"
  | "FINALIZING"
  | "COMPLETE"
  | "FAILED"
  /**
   * Coarse fallback for "a scan is genuinely in flight but we don't know
   * which named stage is executing right now." This is NOT one of the
   * backend's real pipeline phases — it exists only because today's
   * synchronous API gives the client no way to distinguish them.
   */
  | "RUNNING";

export type ScanNodeState = "waiting" | "active" | "complete" | "degraded" | "failed";

export interface ScanRadarProviderNode {
  key: string;
  label: string;
  state: ScanNodeState;
}

export interface ScanRadarMetrics {
  queriesPlanned?: number;
  queriesExecuted?: number;
  urlsDiscovered?: number;
  uniqueCandidates?: number;
  pagesExtracted?: number;
  verifiedSubjects?: number;
  needsReview?: number;
  findings?: number;
  aiExpansionUrls?: number;
}

const STAGE_COPY: Record<ScanStage, string> = {
  INITIALIZING: "Starting scan",
  QUERY_GENERATION: "Generating discovery queries",
  DISCOVERY: "Searching public sources",
  AI_RESEARCH: "Assessing coverage",
  AI_EXPANSION: "Expanding search coverage",
  EXTRACTION: "Extracting source evidence",
  IDENTITY_VERIFICATION: "Verifying subject identity",
  EVIDENCE_ANALYSIS: "Analyzing reputation evidence",
  RANKING: "Ranking findings",
  FINALIZING: "Building report",
  COMPLETE: "Scan complete",
  FAILED: "Scan interrupted",
  RUNNING: "Scanning public sources and analyzing evidence",
};

const METRIC_LABELS: Array<{ key: keyof ScanRadarMetrics; label: string }> = [
  { key: "queriesPlanned", label: "Queries planned" },
  { key: "queriesExecuted", label: "Queries executed" },
  { key: "urlsDiscovered", label: "URLs discovered" },
  { key: "uniqueCandidates", label: "Unique candidates" },
  { key: "pagesExtracted", label: "Pages extracted" },
  { key: "verifiedSubjects", label: "Verified subjects" },
  { key: "needsReview", label: "Needs review" },
  { key: "findings", label: "Findings" },
  { key: "aiExpansionUrls", label: "AI expansion URLs" },
];

const NODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  youtube: Youtube,
  reddit: MessageCircle,
  news: Newspaper,
  web: Globe,
  forums: Users,
  blogs: FileText,
  serpapi: Search,
  brave: ShieldCheck,
  gemini_grounding: Gem,
  openai_research: Bot,
  crawl4ai: Cpu,
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const NODE_STATE_STYLES: Record<ScanNodeState, { bg: string; ring: string; icon: string }> = {
  waiting: { bg: "bg-slate-700/50", ring: "ring-1 ring-slate-600/40", icon: "text-slate-400" },
  active: { bg: "bg-blue-500", ring: "ring-2 ring-blue-400/50", icon: "text-white" },
  complete: { bg: "bg-emerald-500", ring: "ring-2 ring-emerald-400/50", icon: "text-white" },
  degraded: { bg: "bg-amber-500", ring: "ring-2 ring-amber-400/50", icon: "text-white" },
  failed: { bg: "bg-rose-500/70", ring: "ring-1 ring-rose-500/40", icon: "text-white" },
};

function ProviderNode({
  node,
  angleDeg,
  radiusPct,
  reducedMotion,
}: {
  node: ScanRadarProviderNode;
  angleDeg: number;
  radiusPct: number;
  reducedMotion: boolean;
}) {
  const rad = (angleDeg * Math.PI) / 180;
  const left = 50 + radiusPct * Math.cos(rad);
  const top = 50 + radiusPct * Math.sin(rad);
  const Icon = NODE_ICONS[node.key] ?? Globe;
  const styles = NODE_STATE_STYLES[node.state];
  const shouldPulse = !reducedMotion && (node.state === "active" || node.state === "degraded");

  return (
    <div
      className="absolute flex flex-col items-center gap-1"
      style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" }}
      title={`${node.label} — ${node.state}`}
    >
      <div
        className={`relative size-8 sm:size-9 rounded-full flex items-center justify-center shadow-md ${styles.bg} ${styles.ring} ${shouldPulse ? "scan-radar-node-pulse" : ""}`}
      >
        <Icon className={`size-4 ${styles.icon}`} />
      </div>
      <span className="text-[8px] sm:text-[9px] font-medium tracking-wide text-slate-300/90 whitespace-nowrap">
        {node.label}
      </span>
    </div>
  );
}

export interface ScanRadarProps {
  stage: ScanStage;
  providers: ScanRadarProviderNode[];
  metrics?: ScanRadarMetrics;
  elapsedMs: number;
  errorMessage?: string | null;
  onRetry?: () => void;
}

export function ScanRadar({
  stage,
  providers,
  metrics,
  elapsedMs,
  errorMessage,
  onRetry,
}: ScanRadarProps) {
  const reducedMotion = useReducedMotion();
  const failed = stage === "FAILED";
  const complete = stage === "COMPLETE";
  const [burst, setBurst] = useState(false);
  const prevStage = useRef(stage);

  useEffect(() => {
    if (complete && prevStage.current !== "COMPLETE" && !reducedMotion) {
      setBurst(true);
      const t = setTimeout(() => setBurst(false), 800);
      return () => clearTimeout(t);
    }
    prevStage.current = stage;
  }, [complete, stage, reducedMotion]);

  const innerRing = providers.filter((_, i) => i % 2 === 0);
  const outerRing = providers.filter((_, i) => i % 2 === 1);

  const visibleMetrics = metrics
    ? METRIC_LABELS.filter(({ key }) => typeof metrics[key] === "number")
    : [];

  return (
    <div
      className="rounded-2xl border border-slate-800 overflow-hidden relative"
      style={{
        background:
          "radial-gradient(circle at 50% 30%, rgba(30, 64, 175, 0.18), rgba(5, 8, 16, 0.98) 55%), #05070f",
      }}
    >
      <style>{`
        @keyframes scan-radar-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes scan-radar-rotate-rev { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes scan-radar-core-pulse { 0%, 100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.08); opacity: 1; } }
        @keyframes scan-radar-node-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); } 50% { box-shadow: 0 0 0 6px rgba(59,130,246,0); } }
        @keyframes scan-radar-burst { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }
        .scan-radar-ring-slow { animation: scan-radar-rotate 40s linear infinite; }
        .scan-radar-ring-fast { animation: scan-radar-rotate-rev 26s linear infinite; }
        .scan-radar-core-pulse { animation: scan-radar-core-pulse 2.6s ease-in-out infinite; }
        .scan-radar-node-pulse { animation: scan-radar-node-pulse 1.8s ease-in-out infinite; }
        .scan-radar-burst { animation: scan-radar-burst 800ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .scan-radar-ring-slow, .scan-radar-ring-fast, .scan-radar-core-pulse, .scan-radar-node-pulse, .scan-radar-burst {
            animation: none !important;
          }
        }
      `}</style>

      {/* Dot-grid backdrop, matching the reference's ambient texture */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: "radial-gradient(rgba(148,163,184,0.35) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      <div className="relative px-6 py-8 sm:px-10 sm:py-10 flex flex-col items-center gap-6">
        <div className="relative w-full max-w-[380px] aspect-square mx-auto">
          <svg viewBox="0 0 360 360" className="absolute inset-0 w-full h-full" aria-hidden="true">
            <circle
              cx="180"
              cy="180"
              r="60"
              fill="none"
              stroke="rgba(255,138,61,0.25)"
              strokeWidth="1"
            />
            <g
              className={reducedMotion ? "" : "scan-radar-ring-fast"}
              style={{ transformOrigin: "180px 180px" }}
            >
              <circle
                cx="180"
                cy="180"
                r="105"
                fill="none"
                stroke="rgba(59,130,246,0.35)"
                strokeWidth="1"
                strokeDasharray="4 8"
              />
            </g>
            <g
              className={reducedMotion ? "" : "scan-radar-ring-slow"}
              style={{ transformOrigin: "180px 180px" }}
            >
              <circle
                cx="180"
                cy="180"
                r="150"
                fill="none"
                stroke="rgba(255,138,61,0.22)"
                strokeWidth="1"
                strokeDasharray="2 10"
              />
            </g>
          </svg>

          {/* Center core */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative flex items-center justify-center">
              {burst && (
                <div
                  className="absolute size-14 rounded-full scan-radar-burst"
                  style={{
                    background: "radial-gradient(circle, rgba(255,138,61,0.9), transparent 70%)",
                  }}
                />
              )}
              <div
                className={`relative size-14 sm:size-16 rounded-full flex items-center justify-center ${!reducedMotion && !failed ? "scan-radar-core-pulse" : ""}`}
                style={{
                  background: failed
                    ? "radial-gradient(circle, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.1) 70%)"
                    : "radial-gradient(circle, #ff8a3d 0%, #ff5e1a 45%, rgba(255,94,26,0.15) 75%)",
                  boxShadow: failed
                    ? "0 0 24px rgba(244,63,94,0.35)"
                    : "0 0 32px rgba(255,138,61,0.45)",
                }}
              >
                {failed ? (
                  <AlertTriangle className="size-6 text-white" />
                ) : (
                  <Sparkles className="size-6 text-white" />
                )}
              </div>
            </div>
          </div>

          {innerRing.map((node, i) => (
            <ProviderNode
              key={node.key}
              node={node}
              angleDeg={(360 / innerRing.length) * i - 90}
              radiusPct={29}
              reducedMotion={reducedMotion}
            />
          ))}
          {outerRing.map((node, i) => (
            <ProviderNode
              key={node.key}
              node={node}
              angleDeg={(360 / outerRing.length) * i - 90 + 180 / Math.max(outerRing.length, 1)}
              radiusPct={42}
              reducedMotion={reducedMotion}
            />
          ))}
        </div>

        <div className="text-center space-y-1.5">
          <div
            className={`text-sm sm:text-base font-semibold tracking-wide ${failed ? "text-rose-400" : complete ? "text-emerald-400" : "text-slate-100"}`}
          >
            {complete ? "SCAN COMPLETE" : failed ? "SCAN INTERRUPTED" : STAGE_COPY[stage]}
          </div>
          {!failed && (
            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
              {formatElapsed(elapsedMs)}
            </div>
          )}
        </div>

        {failed && (
          <div className="w-full max-w-sm text-center space-y-3">
            <p className="text-xs text-slate-400">
              {errorMessage ?? "Operation interrupted. Please try again."}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition"
              >
                <RotateCcw className="size-3.5" /> Retry
              </button>
            )}
          </div>
        )}

        {visibleMetrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 w-full max-w-md">
            {visibleMetrics.map(({ key, label }) => (
              <div key={key} className="text-center">
                <div className="text-sm font-bold text-slate-100 tabular-nums">{metrics![key]}</div>
                <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
