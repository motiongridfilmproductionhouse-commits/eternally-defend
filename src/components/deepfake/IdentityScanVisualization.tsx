import { useEffect, useMemo, useRef, useState } from "react";
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
  buildThreatDomainLabels,
  isElevatedThreatTone,
  isRedThreatTone,
  resolveNewThreatFindingPulse,
  resolveThreatAwareRingTone,
  shouldAnimateThreatAwareScan,
  shouldShowThreatAwareScanBeam,
  threatAlertBadgeLabel,
  threatAlertCountLines,
  threatAwareStatusCopy,
  type SeenThreatFindingsState,
  type ThreatAlertSummary,
} from "@/lib/deepfake/threat-alert";
import type { ClientFinding } from "@/lib/deepfake/results-dashboard";

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
  /** Complete client-visible findings for domain labels (pre-filter). */
  threatFindings?: ClientFinding[] | null;
  scanId?: string | null;
  /** True once the selected scan’s findings payload has loaded (may be empty). */
  threatFindingsReady?: boolean;
  onSelectThreatDomain?: (domain: string) => void;
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

const RING_CLASS = {
  cyan: "stroke-sky-400/80",
  amber: "stroke-amber-400/80",
  orange: "stroke-orange-500/85",
  green: "stroke-emerald-400/90",
  red: "stroke-red-500/90",
  muted: "stroke-slate-400/40",
} as const;

const INNER_RING_CLASS = {
  cyan: "stroke-sky-300/70",
  amber: "stroke-amber-300/75",
  orange: "stroke-orange-400/80",
  green: "stroke-emerald-300/80",
  red: "stroke-red-700/90",
  muted: "stroke-slate-400/30",
} as const;

const GLOW_CLASS = {
  cyan: "shadow-[0_0_40px_-8px_rgba(56,189,248,0.55)]",
  amber: "shadow-[0_0_36px_-8px_rgba(251,191,36,0.45)]",
  orange: "shadow-[0_0_36px_-8px_rgba(249,115,22,0.5)]",
  green: "shadow-[0_0_40px_-8px_rgba(52,211,153,0.5)]",
  red: "shadow-[0_0_36px_-8px_rgba(239,68,68,0.55)]",
  muted: "",
} as const;

function lineStroke(
  active: boolean,
  tone: ThreatAlertSummary["tone"],
): string {
  if (!active) return "rgba(148,163,184,0.18)";
  if (tone === "red") return "rgba(248,113,113,0.65)";
  if (tone === "orange") return "rgba(251,146,60,0.6)";
  if (tone === "amber") return "rgba(251,191,36,0.5)";
  return "rgba(56,189,248,0.45)";
}

function nodeToneClasses(
  active: boolean,
  tone: ThreatAlertSummary["tone"],
): string {
  if (!active) return "border-white/10 bg-slate-900/70 text-slate-400";
  if (tone === "red") return "border-red-300/50 bg-red-500/15 text-red-100";
  if (tone === "orange") {
    return "border-orange-300/50 bg-orange-500/15 text-orange-100";
  }
  if (tone === "amber") {
    return "border-amber-300/50 bg-amber-500/15 text-amber-100";
  }
  return "border-sky-300/50 bg-sky-400/15 text-sky-100";
}

const EMPTY_SUMMARY: ThreatAlertSummary = {
  tone: "cyan",
  level: "cyan",
  total: 0,
  verified: 0,
  probable: 0,
  domains: 0,
  findingIds: [],
};

const LABEL_SLOTS = [
  { angle: -55, radius: 47 },
  { angle: 35, radius: 48 },
  { angle: 145, radius: 47 },
] as const;

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
  threatFindings = null,
  scanId = null,
  threatFindingsReady = true,
  onSelectThreatDomain,
}: IdentityScanVisualizationProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const summary = threatSummary ?? EMPTY_SUMMARY;
  const tone = summary.tone ?? summary.level ?? "cyan";
  const mode: IdentityScanVizMode = resolveIdentityScanVizMode({
    hasSelectedProfile: true,
    scanStatus,
  });
  const animate = shouldAnimateThreatAwareScan({
    mode,
    tone,
    prefersReducedMotion,
  });
  const showBeam = shouldShowThreatAwareScanBeam({
    mode,
    prefersReducedMotion,
  });
  const ringTone = resolveThreatAwareRingTone({ mode, tone });
  const elevated = isElevatedThreatTone(tone);
  const red = isRedThreatTone(tone);
  const activeNodes = useMemo(
    () =>
      new Set(
        activeIdentityScanNodeIds(stage, mode === "empty" ? "idle" : mode),
      ),
    [stage, mode],
  );
  const stageMessage = threatAwareStatusCopy({
    mode,
    tone,
    stage,
    stageMessage:
      mode === "running"
        ? identityScanStageMessage(stage) ?? "Searching public sources"
        : null,
    statusHeadline: identityScanStatusHeadline(mode),
  });
  const threatLines = elevated ? threatAlertCountLines(summary) : [];
  const domainLabels = useMemo(
    () => buildThreatDomainLabels(threatFindings ?? [], 3),
    [threatFindings],
  );
  const { enrollmentLine, modelLine } = identityModelReadyCopy(enrolledCount);
  const metrics = identityScanProgressMetrics({
    executedQueries,
    plannedQueries,
    pagesVerified,
    threatsSaved: summary.total > 0 ? summary.total : threatsSaved,
  });
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [thumbnailUrl]);

  const seenRef = useRef<SeenThreatFindingsState | null>(null);
  const [pulseIds, setPulseIds] = useState<string[]>([]);
  const [revealedCount, setRevealedCount] = useState(3);
  const seededScanRef = useRef<string | null>(null);
  const findingIdsKey = summary.findingIds.join("|");
  const domainLabelsKey = domainLabels.map((row) => row.domain).join("|");

  // Show ranked labels immediately (SSR/history). Sequential reveal only expands
  // the count when new domains arrive during a live poll.
  const renderedLabels = domainLabels.slice(0, Math.max(0, revealedCount));

  useEffect(() => {
    seenRef.current = null;
    seededScanRef.current = null;
    setPulseIds([]);
    setRevealedCount(3);
  }, [scanId]);

  useEffect(() => {
    // Wait until the selected scan findings have loaded so we don't seed an
    // empty seen-set and then pulse the entire backlog as "new".
    if (!scanId || !threatFindingsReady) return;
    const pulse = resolveNewThreatFindingPulse({
      scanId,
      findingIds: summary.findingIds,
      previous: seenRef.current,
    });
    seenRef.current = pulse.next;
    if (pulse.isInitialSeed) {
      seededScanRef.current = scanId;
      setPulseIds([]);
      setRevealedCount(3);
      return;
    }
    if (pulse.newIds.length) {
      setPulseIds(pulse.newIds);
      if (!prefersReducedMotion) {
        const timer = window.setTimeout(() => setPulseIds([]), 1600);
        return () => window.clearTimeout(timer);
      }
    }
    return undefined;
  }, [scanId, findingIdsKey, prefersReducedMotion, threatFindingsReady]);

  useEffect(() => {
    if (prefersReducedMotion) {
      setRevealedCount(3);
      return;
    }
    if (seededScanRef.current !== scanId) return;
    // After seed, newly ranked domains can enter via a short reveal queue.
    if (domainLabels.length <= revealedCount) {
      setRevealedCount(Math.min(3, domainLabels.length || 3));
      return;
    }
    if (revealedCount >= 3) return;
    const timer = window.setTimeout(() => {
      setRevealedCount((value) => Math.min(3, value + 1));
    }, 380);
    return () => window.clearTimeout(timer);
  }, [
    domainLabelsKey,
    domainLabels.length,
    prefersReducedMotion,
    revealedCount,
    scanId,
  ]);

  const showPhoto = Boolean(thumbnailUrl) && !imageFailed;
  const sizeClass = compact
    ? "min-h-[280px] max-w-md mx-auto"
    : "min-h-[420px] lg:min-h-[520px]";
  const badgeLabel = threatAlertBadgeLabel({ mode, tone });
  const badgeClass =
    tone === "red"
      ? "border-red-400/50 bg-red-500/15 text-red-200"
      : tone === "orange"
        ? "border-orange-400/45 bg-orange-500/12 text-orange-200"
        : tone === "amber"
          ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
          : mode === "completed"
            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
            : mode === "failed"
              ? "border-red-400/40 bg-red-500/10 text-red-300"
              : mode === "partial"
                ? "border-amber-400/40 bg-amber-500/10 text-amber-300"
                : "border-sky-400/40 bg-sky-500/10 text-sky-300";

  const ringPulse = pulseIds.length > 0 && !prefersReducedMotion;
  const outerRingAnimation =
    ringPulse
      ? {
          transformOrigin: "50% 50%" as const,
          transformBox: "fill-box" as const,
          animation: "identityNewThreatPulse 1.4s ease-out 1",
        }
      : animate && elevated
        ? mode === "running"
          ? {
              transformOrigin: "50% 50%" as const,
              transformBox: "fill-box" as const,
              animation: "identityThreatRadar 4.8s ease-in-out infinite",
            }
          : {
              transformOrigin: "50% 50%" as const,
              transformBox: "fill-box" as const,
              animation: "identityThreatBreath 3.8s ease-in-out infinite",
            }
        : animate && mode === "running"
          ? {
              transformOrigin: "50% 50%" as const,
              transformBox: "fill-box" as const,
              animation: "identityRingSpin 10s linear infinite",
            }
          : animate
            ? {
                transformOrigin: "50% 50%" as const,
                transformBox: "fill-box" as const,
                animation: "identityBreath 3.6s ease-in-out infinite",
              }
            : {
                transformOrigin: "50% 50%" as const,
                transformBox: "fill-box" as const,
              };

  const innerRingAnimation =
    animate && elevated
      ? {
          transformOrigin: "50% 50%" as const,
          transformBox: "fill-box" as const,
          animation: "identityThreatBreath 3.2s ease-in-out infinite",
        }
      : animate
        ? mode === "running"
          ? {
              transformOrigin: "50% 50%" as const,
              transformBox: "fill-box" as const,
              animation: "identityRingSpin 7s linear infinite reverse",
            }
          : {
              transformOrigin: "50% 50%" as const,
              transformBox: "fill-box" as const,
              animation: "identityBreath 3.6s ease-in-out infinite",
            }
        : {
            transformOrigin: "50% 50%" as const,
            transformBox: "fill-box" as const,
          };

  return (
    <section
      aria-label={`Identity scan visualization for ${artistName || "selected profile"}`}
      data-testid="identity-scan-visualization"
      data-threat-tone={tone}
      data-threat-level={tone}
      data-reduced-motion={prefersReducedMotion ? "true" : "false"}
      className={`relative overflow-hidden rounded-[22px] border ${
        red
          ? "border-red-500/40"
          : tone === "orange"
            ? "border-orange-500/35"
            : tone === "amber"
              ? "border-amber-500/30"
              : "border-sky-500/20"
      } bg-[radial-gradient(ellipse_at_center,_rgba(14,30,56,0.96)_0%,_rgba(7,14,28,0.98)_70%)] text-slate-100 ${sizeClass} ${GLOW_CLASS[ringTone]}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: red
            ? "radial-gradient(rgba(248,113,113,0.16) 1px, transparent 1px)"
            : tone === "orange"
              ? "radial-gradient(rgba(251,146,60,0.14) 1px, transparent 1px)"
              : "radial-gradient(rgba(56,189,248,0.12) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          animation:
            animate && elevated && !prefersReducedMotion
              ? "identityThreatBreath 4.5s ease-in-out infinite"
              : undefined,
        }}
      />

      <div className="relative z-[1] flex h-full flex-col px-4 py-5 sm:px-6">
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                red
                  ? "text-red-300/85"
                  : tone === "orange"
                    ? "text-orange-300/85"
                    : tone === "amber"
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
            className={`max-w-[9.5rem] rounded-full border px-2.5 py-1 text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.12em] sm:text-[10px] ${badgeClass}`}
            data-testid="identity-scan-badge"
          >
            {badgeLabel}
          </div>
        </header>

        <div className="relative mx-auto aspect-square w-full max-w-[360px] flex-1">
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              strokeWidth="0.4"
              className={RING_CLASS[ringTone]}
              strokeDasharray="4 3.5"
              style={outerRingAnimation}
              data-testid="identity-outer-ring"
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              strokeWidth="0.55"
              className={INNER_RING_CLASS[ringTone]}
              opacity={mode === "idle" && tone === "cyan" ? 0.55 : 0.9}
              style={innerRingAnimation}
              data-testid="identity-inner-ring"
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
                  stroke={lineStroke(active, tone)}
                  strokeWidth={active ? 0.5 : 0.25}
                  style={
                    active && animate && (mode === "running" || elevated)
                      ? {
                          animation: elevated
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
              tone !== "cyan") &&
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
                      red
                        ? "rgba(248,113,113,0.4)"
                        : tone === "orange"
                          ? "rgba(251,146,60,0.4)"
                          : tone === "amber"
                            ? "rgba(251,191,36,0.4)"
                            : "rgba(125,211,252,0.35)"
                    }
                    strokeWidth="0.25"
                  />
                );
              })}
          </svg>

          <div
            className={`absolute inset-[18%] overflow-hidden rounded-full border bg-slate-900/80 ${
              red
                ? "border-red-300/45"
                : tone === "orange"
                  ? "border-orange-300/40"
                  : tone === "amber"
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
                data-testid="identity-scan-beam"
                className={`pointer-events-none absolute inset-x-0 top-0 h-1/3 ${
                  red
                    ? "bg-gradient-to-b from-red-300/0 via-red-300/35 to-red-300/0"
                    : "bg-gradient-to-b from-sky-300/0 via-sky-300/35 to-sky-300/0"
                }`}
                style={{ animation: "identityBeam 2.8s ease-in-out infinite" }}
              />
            )}
            {red && prefersReducedMotion && (
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
                  className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] shadow-sm backdrop-blur-sm sm:text-[10px] ${nodeToneClasses(active, tone)}`}
                  style={
                    active && animate && (mode === "running" || elevated)
                      ? {
                          animation: elevated
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

          {/* High-risk domain intelligence labels (max 3) */}
          {renderedLabels.map((label, index) => {
            const slot = LABEL_SLOTS[index] ?? LABEL_SLOTS[0]!;
            const pos = nodePosition(slot.angle, slot.radius);
            return (
              <button
                key={label.domain}
                type="button"
                data-testid="threat-domain-label"
                data-domain={label.domain}
                title={`${label.wording} · ${label.detailLabel}`}
                className={`absolute z-[2] max-w-[9.5rem] -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-left text-[9px] font-semibold uppercase leading-tight tracking-[0.08em] shadow-md backdrop-blur-sm transition hover:scale-[1.02] ${
                  label.tone === "red"
                    ? "border-red-400/50 bg-red-950/80 text-red-100"
                    : "border-orange-400/45 bg-orange-950/80 text-orange-100"
                }`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                onClick={() =>
                  onSelectThreatDomain?.(label.filterKey || label.domain)
                }
              >
                <span className="block truncate">{label.chipLabel}</span>
                <span className="mt-0.5 block truncate text-[8px] font-medium normal-case tracking-normal opacity-80">
                  {label.wording}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="mt-4 space-y-2 text-center">
          <div
            className={`flex items-center justify-center gap-2 text-sm font-medium ${
              red
                ? "text-red-100"
                : tone === "orange"
                  ? "text-orange-100"
                  : tone === "amber"
                    ? "text-amber-100"
                    : "text-sky-100"
            }`}
          >
            <ScanFace
              className={`size-4 ${
                red
                  ? "text-red-300"
                  : tone === "orange"
                    ? "text-orange-300"
                    : tone === "amber"
                      ? "text-amber-300"
                      : "text-sky-300"
              }`}
            />
            <span aria-live="polite" data-testid="identity-scan-status-copy">
              {stageMessage}
            </span>
          </div>

          {mode === "partial" && (
            <p className="text-xs text-amber-200/90" data-testid="partial-progress-copy">
              Verified progress saved.
            </p>
          )}

          {elevated && threatLines.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-center gap-2 pt-1"
              data-testid="threat-alert-count-lines"
            >
              {threatLines.map((line) => (
                <span
                  key={line}
                  className={`rounded-full border px-2.5 py-1 text-[10px] ${
                    red
                      ? "border-red-400/30 bg-red-500/10 text-red-100"
                      : "border-orange-400/30 bg-orange-500/10 text-orange-100"
                  }`}
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
        @keyframes identityNewThreatPulse {
          0% { opacity: 0.35; transform: scale(0.96); }
          40% { opacity: 1; transform: scale(1.06); }
          100% { opacity: 0.7; transform: scale(1); }
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
