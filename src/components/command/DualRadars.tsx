import { useEffect, useMemo, useState } from "react";
import { Compass, ExternalLink, Radar as RadarIcon } from "lucide-react";
import type { getCommandCenterStats } from "@/lib/command-center.functions";

type CmdData = Awaited<ReturnType<typeof getCommandCenterStats>>;
type DeepMarker = CmdData["radarDeepScope"]["markers"][number];
type ExposureMarker = CmdData["radarExposure"]["markers"][number];

const SEV_HUE: Record<string, string> = {
  Critical: "oklch(0.63 0.24 25)",
  High: "oklch(0.72 0.18 55)",
  Medium: "oklch(0.78 0.15 85)",
  Low: "oklch(0.7 0.14 155)",
  Info: "oklch(0.68 0.09 240)",
};

function sevColor(sev: string) {
  return SEV_HUE[sev] ?? SEV_HUE["Info"]!;
}

function fmtReach(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleString();
}

function Shell({
  icon,
  label,
  sub,
  status,
  statusTone = "primary",
  footer,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  status: string;
  statusTone?: "primary" | "muted";
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-background/60 p-5 backdrop-blur-md shadow-[0_10px_40px_-15px_oklch(0.2_0.1_260_/_0.4)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </div>
            <div className="text-[11px] text-muted-foreground/80">{sub}</div>
          </div>
        </div>
        <span
          className={
            statusTone === "primary"
              ? "rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary"
              : "rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
          }
        >
          {status}
        </span>
      </div>
      <div className="mt-4">{children}</div>
      {footer}
    </div>
  );
}

/** Compact detail card for a selected marker — the drill-down surface. */
function MarkerDetail({
  title,
  rows,
  url,
  onClose,
}: {
  title: string;
  rows: Array<[string, string]>;
  url: string | null;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-snug text-foreground">{title}</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Close finding details"
        >
          ✕
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="uppercase tracking-wider opacity-70">{k}</dt>
            <dd className="truncate text-foreground/90">{v}</dd>
          </div>
        ))}
      </dl>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary hover:underline"
        >
          Open evidence source <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

/* ============ Radar 1 — Deep Scope (real detections) ============ */
export function HudSweepRadar({ d }: { d: CmdData }) {
  const size = 360;
  const c = size / 2;
  const rMax = c - 26;
  const data = d.radarDeepScope;
  const sweeping = d.sweep.scanning;
  const [angle, setAngle] = useState(0);
  const [selected, setSelected] = useState<DeepMarker | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !sweeping) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      setAngle((a) => (a + dt * 0.075) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweeping]);

  // Positions come straight from the server-computed, documented geometry.
  const nodes = useMemo(
    () =>
      data.markers.map((m) => {
        const r = rMax * m.radiusFactor;
        const rad = (m.angleDeg * Math.PI) / 180;
        return { m, x: c + Math.cos(rad) * r, y: c + Math.sin(rad) * r };
      }),
    [data.markers, rMax, c],
  );

  const sev = data.severityCounts;

  return (
    <Shell
      icon={<RadarIcon className="size-4" />}
      label="Deep Scope Radar"
      sub={`${data.signalCount} tracked signals · ${data.platformCount} platforms · ${data.markerCount} markers plotted`}
      status={d.sweep.status}
      statusTone={sweeping ? "primary" : "muted"}
      footer={
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-3">
            {(["Critical", "High", "Medium", "Low", "Info"] as const).map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
              >
                <span className="size-2 rounded-full" style={{ background: sevColor(s) }} />
                {s} · {sev[s]}
              </span>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Angle = platform sector. Distance from centre = detection priority (severity + recency) —
            highest priority sits nearest the core. Last updated {fmtTime(data.queriedAt)}.
          </p>
        </div>
      }
    >
      <div className="relative grid place-items-center">
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }}>
          <defs>
            <radialGradient id="hud-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="oklch(0.85 0.16 230)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="oklch(0.55 0.2 245)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="hud-beam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="oklch(0.85 0.15 230)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="oklch(0.85 0.15 230)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <circle
            cx={c}
            cy={c}
            r={rMax + 18}
            fill="none"
            stroke="oklch(0.7 0.17 235 / 0.35)"
            strokeWidth={2}
          />
          <circle cx={c} cy={c} r={rMax + 10} fill="oklch(0.2 0.07 255 / 0.55)" />

          {Array.from({ length: 8 }).map((_, i) => (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={rMax * ((i + 1) / 8)}
              fill="none"
              stroke="oklch(0.7 0.15 235 / 0.16)"
              strokeWidth={1}
            />
          ))}

          {/* one spoke + label per real platform sector */}
          {data.sectors.map((s) => {
            const rad = (s.angleDeg * Math.PI) / 180;
            return (
              <g key={s.platform}>
                <line
                  x1={c}
                  y1={c}
                  x2={c + Math.cos(rad) * rMax}
                  y2={c + Math.sin(rad) * rMax}
                  stroke="oklch(0.7 0.15 235 / 0.18)"
                  strokeWidth={1}
                />
                <text
                  x={c + Math.cos(rad) * (rMax + 12)}
                  y={c + Math.sin(rad) * (rMax + 12)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8"
                  fill="oklch(0.8 0.06 235 / 0.75)"
                >
                  {s.platform}
                </text>
              </g>
            );
          })}

          {sweeping && (
            <g transform={`rotate(${angle} ${c} ${c})`}>
              <path
                d={`M ${c} ${c} L ${c + rMax} ${c - 26} A ${rMax} ${rMax} 0 0 1 ${c + rMax} ${c + 26} Z`}
                fill="url(#hud-beam)"
              />
              <line
                x1={c}
                y1={c}
                x2={c + rMax}
                y2={c}
                stroke="oklch(0.9 0.14 225)"
                strokeWidth={1.6}
                opacity={0.9}
              />
            </g>
          )}

          {nodes.map(({ m, x, y }) => {
            const col = sevColor(m.severity);
            const active = selected?.id === m.id;
            return (
              <g
                key={m.id}
                onClick={() => setSelected(m)}
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelected(m);
                }}
              >
                <title>{`${m.severity} · ${m.platform} · ${m.findingType} · ${m.title}`}</title>
                <circle cx={x} cy={y} r={active ? 10 : 6} fill={col} opacity={active ? 0.4 : 0.16} />
                <circle cx={x} cy={y} r={active ? 4 : 3} fill={col} />
              </g>
            );
          })}

          <circle cx={c} cy={c} r={22} fill="url(#hud-core)" />
          <circle cx={c} cy={c} r={4} fill="oklch(0.9 0.14 225)" />
        </svg>

        {data.signalCount === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-white/10 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
              No active threat signals detected
            </span>
          </div>
        )}
      </div>

      {selected && (
        <MarkerDetail
          title={selected.title}
          url={selected.url}
          onClose={() => setSelected(null)}
          rows={[
            ["Finding", selected.findingId.slice(0, 8)],
            ["Platform", selected.platform],
            ["Domain", selected.domain ?? "unknown"],
            ["Type", selected.findingType],
            ["Severity", selected.severity],
            [
              "Confidence",
              selected.confidence === null ? "not stored" : `${selected.confidence}/100`,
            ],
            ["Detected", fmtTime(selected.detectedAt)],
            ["Status", selected.status],
          ]}
        />
      )}
    </Shell>
  );
}

/* ============ Radar 2 — Exposure Bearing (real reach) ============ */
export function DirectionalRadar({ d }: { d: CmdData }) {
  const size = 360;
  const c = size / 2;
  const rMax = c - 30;
  const data = d.radarExposure;
  const sweeping = d.sweep.scanning;
  const [angle, setAngle] = useState(0);
  const [selected, setSelected] = useState<ExposureMarker | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !sweeping) return;
    const id = window.setInterval(() => setAngle((a) => (a + 6) % 360), 90);
    return () => window.clearInterval(id);
  }, [sweeping]);

  const markers = useMemo(
    () =>
      data.markers.map((m) => {
        const r = rMax * m.radiusFactor;
        const rad = (m.angleDeg * Math.PI) / 180;
        return { m, x: c + Math.cos(rad) * r, y: c + Math.sin(rad) * r };
      }),
    [data.markers, rMax, c],
  );

  const hasFindings = d.radarDeepScope.signalCount > 0;

  return (
    <Shell
      icon={<Compass className="size-4" />}
      label="Exposure Bearing Radar"
      sub={
        data.qualifyingCount === 0
          ? hasFindings
            ? "Exposure data unavailable for these findings"
            : "No active threat signals detected"
          : `Top ${markers.length} of ${data.qualifyingCount} findings with reach · ${fmtReach(data.totalReach)} measured reach`
      }
      status={sweeping ? d.sweep.status : "MONITORING"}
      statusTone={sweeping ? "primary" : "muted"}
      footer={
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["Provider-reported", data.provenanceBreakdown.PROVIDER_REPORTED],
                ["Verified", data.provenanceBreakdown.VERIFIED],
                ["Estimated", data.provenanceBreakdown.ESTIMATED],
                ["Unknown", data.provenanceBreakdown.UNKNOWN],
              ] as Array<[string, number]>
            ).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <div className="text-sm font-semibold text-foreground">{n}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Bearing = platform sector; distance from centre = normalised platform-reported reach (log
            scale), so the highest-reach finding sits furthest out. Total reach sums{" "}
            {data.qualifyingCount} URL-deduplicated findings ({data.duplicatesCollapsed} duplicates
            merged); {data.unknownReachCount} findings have unknown reach and are excluded, not
            counted as zero. Last updated {fmtTime(data.queriedAt)}.
          </p>
        </div>
      }
    >
      <div className="relative grid place-items-center">
        <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }}>
          <defs>
            <radialGradient id="dir-dish" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="oklch(0.35 0.09 175 / 0.55)" />
              <stop offset="100%" stopColor="oklch(0.22 0.05 200 / 0.35)" />
            </radialGradient>
          </defs>

          <circle cx={c} cy={c} r={rMax + 22} fill="url(#dir-dish)" />
          <circle
            cx={c}
            cy={c}
            r={rMax}
            fill="none"
            stroke="oklch(0.82 0.17 175)"
            strokeWidth={3}
            opacity={0.9}
          />
          {[0.72, 0.5, 0.3, 0.14].map((f, i) => (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={rMax * f}
              fill="none"
              stroke="oklch(0.85 0.05 190 / 0.28)"
              strokeDasharray="2 6"
              strokeWidth={1}
            />
          ))}

          {/* reach scale labels tied to the real max */}
          {data.maxReach > 0 &&
            [1, 0.5].map((f) => (
              <text
                key={f}
                x={c + 4}
                y={c - rMax * (0.28 + 0.68 * f) - 4}
                fontSize="8"
                fill="oklch(0.85 0.06 190 / 0.7)"
              >
                {fmtReach(Math.round(data.maxReach * f))}
              </text>
            ))}

          {sweeping && (
            <g transform={`rotate(${angle - 90} ${c} ${c})`}>
              {Array.from({ length: 7 }).map((_, i) => {
                const r = rMax * (0.22 + i * 0.1);
                const spread = 15 + i * 1.2;
                const a1 = (-spread * Math.PI) / 180;
                const a2 = (spread * Math.PI) / 180;
                return (
                  <path
                    key={i}
                    d={`M ${c + Math.cos(a1) * r} ${c + Math.sin(a1) * r} A ${r} ${r} 0 0 1 ${c + Math.cos(a2) * r} ${c + Math.sin(a2) * r}`}
                    fill="none"
                    stroke="oklch(0.82 0.15 175)"
                    strokeWidth={3}
                    opacity={0.42 - i * 0.045}
                  />
                );
              })}
            </g>
          )}

          {markers.map(({ m, x, y }) => {
            const col = sevColor(m.severity);
            const right = x >= c;
            return (
              <g
                key={m.id}
                onClick={() => setSelected(m)}
                style={{ cursor: "pointer" }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelected(m);
                }}
              >
                <title>{`${m.platform} · ${m.severity} · reach ${fmtReach(m.reach)} (${m.reachProvenance})`}</title>
                <polygon
                  points={`${x - 7},${y - 6} ${x + 7},${y} ${x - 7},${y + 6}`}
                  fill={col}
                  transform={right ? undefined : `rotate(180 ${x} ${y})`}
                />
                <text
                  x={right ? x + 12 : x - 12}
                  y={y + 4}
                  textAnchor={right ? "start" : "end"}
                  fontSize="10"
                  fontWeight="600"
                  fill={col}
                >
                  {fmtReach(m.reach)}
                </text>
              </g>
            );
          })}

          <circle cx={c} cy={c} r={9} fill="oklch(0.82 0.17 175 / 0.25)" />
          <circle cx={c} cy={c} r={4} fill="oklch(0.88 0.16 175)" />
        </svg>

        {markers.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-white/10 bg-background/70 px-3 py-1 text-center text-[11px] text-muted-foreground">
              {hasFindings
                ? "Exposure data unavailable for these findings"
                : "No active threat signals detected"}
            </span>
          </div>
        )}
      </div>

      {selected && (
        <MarkerDetail
          title={selected.title}
          url={selected.url}
          onClose={() => setSelected(null)}
          rows={[
            ["Finding", selected.findingId.slice(0, 8)],
            ["Platform", selected.platform],
            ["Domain", selected.domain ?? "unknown"],
            ["Severity", selected.severity],
            ["Reach", selected.reach.toLocaleString()],
            ["Provenance", selected.reachProvenance],
            ["Merged", `${selected.duplicatesMerged} URL match(es)`],
            ["Detected", fmtTime(selected.detectedAt)],
          ]}
        />
      )}
    </Shell>
  );
}
