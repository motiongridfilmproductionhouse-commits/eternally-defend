import { useEffect, useMemo, useState } from "react";
import { ScanFace, UserRound } from "lucide-react";
import {
  IDENTITY_SCAN_NODES,
  activeIdentityScanNodeIds,
  identityModelReadyCopy,
  identityScanProgressMetrics,
  identityScanStageMessage,
  identityScanStatusHeadline,
  resolveIdentityScanVizMode,
  type IdentityScanVizMode,
} from "@/lib/deepfake/identity-scan-viz";
import {
  resolveThreatAwareRingTone,
  shouldAnimateThreatAwareScan,
  shouldShowThreatAwareScanBeam,
  threatAlertCountLines,
  threatAwareStatusCopy,
  type ThreatAlertLevel,
  type ThreatAlertSummary,
} from "@/lib/deepfake/threat-alert";

export type IdentityScanVisualizationProps = {
  artistName: string;
  enrolledCount: number;
  thumbnailUrl?: string | null;
  scanStatus?: string | null;
  stage?: string | null;
  executedQueries?: number | null;
  plannedQueries?: number | null;
  pagesVerified?: number | null;
  threatsSaved?: number | null;
  errorMessage?: string | null;
  compact?: boolean;
  /** Live threat alert recomputed from selected-scan findings. */
  threatSummary?: ThreatAlertSummary | null;
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

function nodePosition(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: 50 + Math.cos(rad) * radius,
    y: 50 + Math.sin(rad) * radius,
  };
}

const MESH_POINTS = [
  [42, 38],
  [50, 34],
  [58, 38],
  [38, 48],
  [50, 46],
  [62, 48],
  [40, 58],
  [50, 62],
  [60, 58],
  [46, 70],
  [54, 70],
] as const;

const MESH_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [0, 3],
  [1, 4],
  [2, 5],
  [3, 4],
  [4, 5],
  [3, 6],
  [4, 7],
  [5, 8],
  [6, 7],
  [7, 8],
  [6, 9],
  [8, 10],
  [9, 10],
];

const RING_CLASS: Record<
  ReturnType<typeof resolveThreatAwareRingTone>,
  string
> = {
  cyan: "stroke-sky-400/80",
  amber: "stroke-amber-400/80",
  green: "stroke-emerald-400/90",
  red: "stroke-red-500/90",
  muted: "stroke-slate-400/40",
};

const GLOW_CLASS: Record<
  ReturnType<typeof resolveThreatAwareRingTone>,
  string
> = {
  cyan: "shadow-[0_0_40px_-8px_rgba(56,189,248,0.55)]",
  amber: "shadow-[0_0_36px_-8px_rgba(251,191,36,0.45)]",
  green: "shadow-[0_0_40px_-8px_rgba(52,211,153,0.5)]",
  red: "shadow-[0_0_36px_-8px_rgba(239,68,68,0.45)]",
  muted: "",
};

function lineStroke(
  active: boolean,
  threatLevel: ThreatAlertLevel,
): string {
  if (!active) return "rgba(148,163,184,0.18)";
  if (threatLevel === "multiple") return "rgba(248,113,113,0.55)";
  if (threatLevel === "single") return "rgba(251,191,36,0.5)";
  return "rgba(56,189,248,0.45)";
}

function nodeToneClasses(
  active: boolean,
  threatLevel: ThreatAlertLevel,
): string {
  if (!active) return "border-white/10 bg-slate-900/70 text-slate-400";
  if (threatLevel === "multiple") {
    return "border-red-300/50 bg-red-500/15 text-red-100";
  }
  if (threatLevel === "single") {
    return "border-amber-300/50 bg-amber-500/15 text-amber-100";
  }
  return "border-sky-300/50 bg-sky-400/15 text-sky-100";
}

const EMPTY_SUMMARY: ThreatAlertSummary = {
  level: "none",
  total: 0,
  verified: 0,
  probable: 0,
  domains: 0,
};

export function IdentityScanVisualization({
  artistName,
  enrolledCount,
  thumbnailUrl,
  scanStatus,
  stage,
  executedQueries,
  plannedQueries,
  pagesVerified,
  threatsSaved,
  errorMessage,
  compact = false,
  threatSummary = null,
}: IdentityScanVisualizationProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const summary = threatSummary ?? EMPTY_SUMMARY;
  const threatLevel = summary.level;
  const mode: IdentityScanVizMode = resolveIdentityScanVizMode({
    hasSelectedProfile: true,
    scanStatus,
  });
  const animate = shouldAnimateThreatAwareScan({
    mode,
    threatLevel,
    prefersReducedMotion,
  });
  const showBeam = shouldShowThreatAwareScanBeam({
    mode,
    prefersReducedMotion,
  });
  const ringTone = resolveThreatAwareRingTone({ mode, threatLevel });
  const activeNodes = useMemo(
    () =>
      new Set(
        activeIdentityScanNodeIds(stage, mode === "empty" ? "idle" : mode),
      ),
    [stage, mode],
  );
  const stageMessage = threatAwareStatusCopy({
    mode,
    threatLevel,
    stage,
    stageMessage:
      mode === "running"
        ? identityScanStageMessage(stage) ?? "Searching public sources"
        : null,
    statusHeadline: identityScanStatusHeadline(mode),
  });
  const threatLines =
    threatLevel === "multiple" ? threatAlertCountLines(summary) : [];
  const { enrollmentLine, modelLine } = identityModelReadyCopy(enrolledCount);
  const metrics = identityScanProgressMetrics({
    executedQueries,
    plannedQueries,
    pagesVerified,
    threatsSaved,
  });
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [thumbnailUrl]);

  const showPhoto = Boolean(thumbnailUrl) && !imageFailed;
  const sizeClass = compact
    ? "min-h-[280px] max-w-md mx-auto"
    : "min-h-[420px] lg:min-h-[520px]";

  const badge =
    threatLevel === "multiple"
      ? {
          label: "Threats",
          className: "border-red-400/40 bg-red-500/10 text-red-300",
        }
      : threatLevel === "single"
        ? {
            label: "Threat",
            className: "border-amber-400/40 bg-amber-500/10 text-amber-300",
          }
        : mode === "completed"
          ? {
              label: "Verified",
              className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
            }
          : mode === "failed"
            ? {
                label: "Failed",
                className: "border-red-400/40 bg-red-500/10 text-red-300",
              }
            : mode === "partial"
              ? {
                  label: "Paused",
                  className: "border-amber-400/40 bg-amber-500/10 text-amber-300",
                }
              : mode === "running"
                ? {
                    label: "Scanning",
                    className: "border-sky-400/40 bg-sky-500/10 text-sky-300",
                  }
                : {
                    label: "Ready",
                    className: "border-sky-400/40 bg-sky-500/10 text-sky-300",
                  };

  const ringAnimation =
    animate && threatLevel === "multiple"
      ? mode === "running"
        ? {
            transformOrigin: "50% 50%",
            transformBox: "fill-box" as const,
            animation: "identityThreatRadar 4.8s ease-in-out infinite",
          }
        : {
            transformOrigin: "50% 50%",
            transformBox: "fill-box" as const,
            animation: "identityThreatBreath 3.8s ease-in-out infinite",
          }
      : animate && mode === "running"
        ? {
            transformOrigin: "50% 50%",
            transformBox: "fill-box" as const,
            animation: "identityRingSpin 10s linear infinite",
          }
        : animate
          ? {
              transformOrigin: "50% 50%",
              transformBox: "fill-box" as const,
              animation: "identityBreath 3.6s ease-in-out infinite",
            }
          : { transformOrigin: "50% 50%", transformBox: "fill-box" as const };

  const innerRingAnimation =
    animate && threatLevel === "multiple"
      ? {
          transformOrigin: "50% 50%",
          transformBox: "fill-box" as const,
          animation: "identityThreatBreath 3.2s ease-in-out infinite",
        }
      : animate
        ? mode === "running"
          ? {
              transformOrigin: "50% 50%",
              transformBox: "fill-box" as const,
              animation: "identityRingSpin 7s linear infinite reverse",
            }
          : {
              transformOrigin: "50% 50%",
              transformBox: "fill-box" as const,
              animation: "identityBreath 3.6s ease-in-out infinite",
            }
        : { transformOrigin: "50% 50%", transformBox: "fill-box" as const };

  return (
    <section
      aria-label={`Identity scan visualization for ${artistName || "selected profile"}`}
      data-testid="identity-scan-visualization"
      data-threat-level={threatLevel}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      className={`relative overflow-hidden rounded-[22px] border ${
        threatLevel === "multiple"
          ? "border-red-500/35"
          : threatLevel === "single"
            ? "border-amber-500/30"
            : "border-sky-500/20"
      } bg-[radial-gradient(ellipse_at_center,_rgba(14,30,56,0.96)_0%,_rgba(7,14,28,0.98)_70%)] text-slate-100 ${sizeClass} ${GLOW_CLASS[ringTone]}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            threatLevel === "multiple"
              ? "radial-gradient(rgba(248,113,113,0.14) 1px, transparent 1px)"
              : "radial-gradient(rgba(56,189,248,0.12) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      />

      <div className="relative z-[1] flex h-full flex-col px-4 py-5 sm:px-6">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                threatLevel === "multiple"
                  ? "text-red-300/85"
                  : threatLevel === "single"
                    ? "text-amber-300/85"
                    : "text-sky-300/80"
              }`}
            >
              Identity lock
            </div>
            <h2 className="truncate font-display text-xl font-semibold text-white sm:text-2xl">
              {artistName || "Protected identity"}
            </h2>
            <p className="mt-1 text-xs text-slate-300/90">{enrollmentLine}</p>
            {modelLine && (
              <p className="text-xs font-medium text-emerald-300/90">{modelLine}</p>
            )}
          </div>
          <div
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${badge.className}`}
          >
            {badge.label}
          </div>
        </header>

        <div className="relative mx-auto aspect-square w-full max-w-[360px] flex-1">
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-hidden
          >
            <defs>
              <linearGradient id="identity-scan-beam" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(56,189,248,0)" />
                <stop offset="45%" stopColor="rgba(56,189,248,0.55)" />
                <stop offset="100%" stopColor="rgba(56,189,248,0)" />
              </linearGradient>
              <linearGradient id="identity-threat-beam" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(248,113,113,0)" />
                <stop offset="50%" stopColor="rgba(248,113,113,0.7)" />
                <stop offset="100%" stopColor="rgba(248,113,113,0)" />
              </linearGradient>
            </defs>

            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              strokeWidth="0.35"
              className={RING_CLASS[ringTone]}
              strokeDasharray="4 3.5"
              style={ringAnimation}
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              strokeWidth="0.5"
              className={RING_CLASS[ringTone]}
              opacity={mode === "idle" && threatLevel === "none" ? 0.55 : 0.85}
              style={innerRingAnimation}
            />

            {IDENTITY_SCAN_NODES.map((node) => {
              const pos = nodePosition(node.angleDeg, 42);
              const active = activeNodes.has(node.id);
              return (
                <line
                  key={`line-${node.id}`}
                  x1="50"
                  y1="50"
                  x2={pos.x}
                  y2={pos.y}
                  stroke={lineStroke(active, threatLevel)}
                  strokeWidth={active ? 0.45 : 0.25}
                  style={
                    active && animate && (mode === "running" || threatLevel === "multiple")
                      ? {
                          animation:
                            threatLevel === "multiple"
                              ? "identityThreatLine 2.8s ease-in-out infinite"
                              : "identityPulse 2s ease-in-out infinite",
                        }
                      : undefined
                  }
                />
              );
            })}

            {(mode === "running" ||
              mode === "idle" ||
              mode === "completed" ||
              threatLevel !== "none") &&
              MESH_EDGES.map(([a, b], index) => {
                const [x1, y1] = MESH_POINTS[a]!;
                const [x2, y2] = MESH_POINTS[b]!;
                return (
                  <line
                    key={`mesh-${index}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={
                      threatLevel === "multiple"
                        ? "rgba(248,113,113,0.4)"
                        : threatLevel === "single"
                          ? "rgba(251,191,36,0.4)"
                          : "rgba(125,211,252,0.35)"
                    }
                    strokeWidth="0.25"
                    style={
                      animate && mode === "running"
                        ? { animation: "identityPulse 2.4s ease-in-out infinite" }
                        : undefined
                    }
                  />
                );
              })}
            {(mode === "running" ||
              mode === "idle" ||
              mode === "completed" ||
              threatLevel !== "none") &&
              MESH_POINTS.map(([x, y], index) => (
                <circle
                  key={`dot-${index}`}
                  cx={x}
                  cy={y}
                  r={mode === "running" ? 0.7 : 0.45}
                  fill={
                    threatLevel === "multiple"
                      ? "rgba(248,113,113,0.9)"
                      : threatLevel === "single"
                        ? "rgba(251,191,36,0.9)"
                        : "rgba(125,211,252,0.85)"
                  }
                  style={
                    animate && mode === "running"
                      ? {
                          animation: "identityPulse 1.8s ease-in-out infinite",
                          animationDelay: `${index * 90}ms`,
                        }
                      : undefined
                  }
                />
              ))}
          </svg>

          <div
            className={`absolute inset-[18%] overflow-hidden rounded-full border bg-slate-900/80 ${
              threatLevel === "multiple"
                ? "border-red-300/40"
                : threatLevel === "single"
                  ? "border-amber-300/35"
                  : "border-sky-300/30"
            }`}
          >
            {showPhoto ? (
              <img
                src={thumbnailUrl!}
                alt={`Reference portrait of ${artistName}`}
                className="h-full w-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <div
                className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-800 to-slate-950 text-slate-400"
                aria-label="No reference thumbnail available"
              >
                <UserRound className="size-12 opacity-70" strokeWidth={1.25} />
                <span className="text-[10px] uppercase tracking-[0.18em]">
                  No thumbnail
                </span>
              </div>
            )}

            {showBeam && (
              <div
                aria-hidden
                className={`pointer-events-none absolute inset-x-0 top-0 h-1/3 ${
                  threatLevel === "multiple"
                    ? "bg-gradient-to-b from-red-300/0 via-red-300/35 to-red-300/0"
                    : "bg-gradient-to-b from-sky-300/0 via-sky-300/35 to-sky-300/0"
                }`}
                style={{ animation: "identityBeam 2.8s ease-in-out infinite" }}
              />
            )}
            {mode === "idle" && animate && threatLevel === "none" && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-sky-400/10"
                style={{ animation: "identityBreath 3.6s ease-in-out infinite" }}
              />
            )}
            {threatLevel === "multiple" &&
              !prefersReducedMotion &&
              (mode === "running" || mode === "partial") && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-full border-2 border-red-400/30"
                  style={{ animation: "identityThreatBreath 3.8s ease-in-out infinite" }}
                />
              )}
            {threatLevel === "multiple" && prefersReducedMotion && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-red-400/45"
                data-testid="static-red-threat-ring"
              />
            )}
          </div>

          {IDENTITY_SCAN_NODES.map((node) => {
            const pos = nodePosition(node.angleDeg, 46);
            const active = activeNodes.has(node.id);
            return (
              <div
                key={node.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <div
                  className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] shadow-sm backdrop-blur-sm sm:text-[10px] ${nodeToneClasses(active, threatLevel)}`}
                  style={
                    active &&
                    animate &&
                    (mode === "running" || threatLevel === "multiple")
                      ? {
                          animation:
                            threatLevel === "multiple"
                              ? "identityThreatPulse 2.6s ease-in-out infinite"
                              : "identityPulse 2s ease-in-out infinite",
                        }
                      : undefined
                  }
                >
                  {node.label}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="mt-4 space-y-2 text-center">
          <div
            className={`flex items-center justify-center gap-2 text-sm font-medium ${
              threatLevel === "multiple"
                ? "text-red-100"
                : threatLevel === "single"
                  ? "text-amber-100"
                  : "text-sky-100"
            }`}
          >
            {(mode === "running" || mode === "idle" || threatLevel !== "none") && (
              <ScanFace
                className={`size-4 ${
                  threatLevel === "multiple"
                    ? "text-red-300"
                    : threatLevel === "single"
                      ? "text-amber-300"
                      : "text-sky-300"
                } ${
                  animate && mode === "running" && !prefersReducedMotion
                    ? "animate-pulse"
                    : ""
                }`}
              />
            )}
            <span aria-live="polite" data-testid="identity-scan-status-copy">
              {stageMessage}
            </span>
          </div>

          {mode === "partial" && threatLevel === "multiple" && (
            <p className="text-xs text-amber-200/90">Verified progress saved.</p>
          )}

          {threatLevel === "multiple" && threatLines.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-center gap-2 pt-1"
              data-testid="threat-alert-count-lines"
            >
              {threatLines.map((line) => (
                <span
                  key={line}
                  className="rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[10px] text-red-100"
                >
                  {line}
                </span>
              ))}
            </div>
          )}

          {mode === "failed" && errorMessage && (
            <p className="mx-auto max-w-md text-xs text-red-300" role="alert">
              {errorMessage}
            </p>
          )}

          {mode === "completed" &&
            threatLevel === "none" &&
            typeof threatsSaved === "number" && (
              <p className="text-xs text-emerald-300">
                {threatsSaved} verified result{threatsSaved === 1 ? "" : "s"} saved
              </p>
            )}

          {metrics.length > 0 && (mode === "running" || mode === "partial") && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {metrics.map((item) => (
                <span
                  key={item.key}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-200"
                >
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </footer>
      </div>

      <style>{`
        @keyframes identityRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes identityBeam {
          0% { transform: translateY(-30%); opacity: 0.2; }
          50% { transform: translateY(160%); opacity: 0.85; }
          100% { transform: translateY(260%); opacity: 0.15; }
        }
        @keyframes identityPulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 1; }
        }
        @keyframes identityBreath {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.8; }
        }
        @keyframes identityThreatRadar {
          0%, 100% { opacity: 0.4; transform: scale(0.98); }
          50% { opacity: 0.95; transform: scale(1.03); }
        }
        @keyframes identityThreatBreath {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.85; }
        }
        @keyframes identityThreatLine {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.95; }
        }
        @keyframes identityThreatPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          section[aria-label^="Identity scan visualization"] * {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  );
}
