import { useMemo, useState } from "react";

/**
 * THREAT TERRAIN — animated topographic contour illustration with live threat
 * source flow. Contours are procedural; every source node, flow line, cluster
 * count and metric comes from real command-center findings passed in as props.
 */

type Peak = { cx: number; cy: number; amp: number; phase: number };

export type TerrainNode = {
  id: string;
  platform: string;
  severity: string;
  title?: string | null;
  riskType?: string | null;
  riskScore?: number | null;
  detectedAt?: string | null;
  permalink?: string | null;
};

const PEAKS: Peak[] = [
  { cx: 300, cy: 250, amp: 1, phase: 0.4 },
  { cx: 640, cy: 190, amp: 0.92, phase: 1.9 },
  { cx: 500, cy: 430, amp: 0.6, phase: 3.1 },
];

function contour(peak: Peak, ring: number, rings: number) {
  const steps = 96;
  const t = (ring + 1) / rings;
  const base = 26 + t * 250 * peak.amp;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wob =
      Math.sin(a * 3 + peak.phase + t * 2.2) * (10 + t * 26) +
      Math.sin(a * 5 - peak.phase * 2 + t * 3.4) * (5 + t * 14) +
      Math.cos(a * 2 + t * 5) * (4 + t * 10);
    const r = base + wob;
    const x = peak.cx + Math.cos(a) * r;
    const y = peak.cy + Math.sin(a) * r * 0.52; // flatten for perspective
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

/** Subtle platform identifier accents — the chart stays dark navy overall. */
const PLATFORM_COLOR: Record<string, string> = {
  YouTube: "#f87171",
  Reddit: "#fb923c",
  Facebook: "#60a5fa",
  Instagram: "#e879f9",
  X: "#e2e8f0",
  TikTok: "#22d3ee",
  News: "#38bdf8",
  Blogs: "#a5b4fc",
  Forums: "#fcd34d",
  Web: "#7dd3fc",
};
const platformColor = (p: string) => PLATFORM_COLOR[p] ?? "#7dd3fc";

const SEV_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Info: 0 };
const normSev = (s: string) => {
  const k = (s || "low").toLowerCase();
  return k === "critical"
    ? "Critical"
    : k === "high"
      ? "High"
      : k === "medium"
        ? "Medium"
        : k === "info"
          ? "Info"
          : "Low";
};
const SEV_COLOR: Record<string, string> = {
  Critical: "#f87171",
  High: "#fb923c",
  Medium: "#fbbf24",
  Low: "#34d399",
  Info: "#7dd3fc",
};

function relTime(iso?: string | null) {
  if (!iso) return "unknown";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// Risk regions the flows terminate in, keyed by dominant severity.
const REGION: Record<string, { x: number; y: number }> = {
  Critical: { x: 300, y: 250 },
  High: { x: 300, y: 250 },
  Medium: { x: 640, y: 190 },
  Low: { x: 500, y: 430 },
  Info: { x: 500, y: 430 },
};

// Perimeter slots for platform clusters (upper arc first — labels stay legible).
const SLOT_ANGLES = [
  -150, -30, -108, -72, -168, -12, -128, -52, 168, 12, 148, 32,
].map((d) => (d * Math.PI) / 180);

export function ThreatTerrainPanel({
  totalFindings,
  criticalFindings,
  highFindings = 0,
  threatLevel,
  nodes = [],
  onSelect,
}: {
  totalFindings: number;
  criticalFindings: number;
  highFindings?: number;
  threatLevel: string;
  nodes?: TerrainNode[];
  onSelect?: (node: TerrainNode) => void;
}) {
  const RINGS = 13;
  const [filter, setFilter] = useState<string>("All");
  const [hover, setHover] = useState<{ node: TerrainNode; x: number; y: number } | null>(null);

  const paths = useMemo(
    () =>
      PEAKS.flatMap((p, pi) =>
        Array.from({ length: RINGS }, (_, r) => ({
          d: contour(p, r, RINGS),
          key: `${pi}-${r}`,
          depth: r / RINGS,
          peak: pi,
        })),
      ),
    [],
  );

  /** Real clusters: one node per platform, carrying its own findings. */
  const clusters = useMemo(() => {
    const byPlatform = new Map<string, TerrainNode[]>();
    for (const n of nodes) {
      const p = n.platform || "Web";
      const list = byPlatform.get(p) ?? [];
      list.push(n);
      byPlatform.set(p, list);
    }
    const entries = [...byPlatform.entries()].sort((a, b) => b[1].length - a[1].length);
    return entries.slice(0, SLOT_ANGLES.length).map(([platform, items], i) => {
      const sorted = [...items].sort(
        (a, b) => SEV_RANK[normSev(b.severity)] - SEV_RANK[normSev(a.severity)],
      );
      const top = sorted[0]!;
      const sev = normSev(top.severity);
      const a = SLOT_ANGLES[i]!;
      const x = 470 + Math.cos(a) * 408;
      const y = 300 + Math.sin(a) * 236;
      const target = REGION[sev] ?? REGION.Low!;
      const mx = (x + target.x) / 2;
      const my = (y + target.y) / 2;
      const nx = -(target.y - y);
      const ny = target.x - x;
      const len = Math.hypot(nx, ny) || 1;
      const bow = 42 + (i % 3) * 16;
      const cx = mx + (nx / len) * bow;
      const cy = my + (ny / len) * bow * 0.5;
      return {
        platform,
        items: sorted,
        top,
        sev,
        count: items.length,
        x,
        y,
        d: `M ${x.toFixed(1)} ${y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${target.x} ${target.y}`,
        labelLeft: Math.cos(a) < 0,
        idx: i,
      };
    });
  }, [nodes]);

  const platforms = useMemo(() => clusters.map((c) => c.platform), [clusters]);
  const visible = useMemo(
    () => (filter === "All" ? clusters : clusters.filter((c) => c.platform === filter)),
    [clusters, filter],
  );

  const topSources = clusters.slice(0, 4);

  return (
    <section
      className="relative overflow-hidden rounded-[22px] border border-white/10"
      style={{
        background: "radial-gradient(120% 90% at 50% 120%, #0c1a33 0%, #071021 45%, #04080f 100%)",
      }}
      aria-label="Threat terrain visualization"
    >
      <div className="absolute inset-0 cyber-grid opacity-[0.16]" />

      <svg viewBox="0 0 940 560" className="relative w-full h-[320px] sm:h-[420px]">
        <defs>
          <radialGradient id="tt-vig" cx="50%" cy="60%" r="70%">
            <stop offset="55%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.75" />
          </radialGradient>
          <clipPath id="tt-dome">
            <ellipse cx="470" cy="300" rx="470" ry="290" />
          </clipPath>
        </defs>

        <g clipPath="url(#tt-dome)">
          {/* orbital reference rings */}
          {[420, 340, 250, 165].map((r, i) => (
            <ellipse
              key={r}
              cx="470"
              cy="300"
              rx={r}
              ry={r * 0.62}
              fill="none"
              stroke={i % 2 ? "rgba(251,146,60,0.28)" : "rgba(56,189,248,0.18)"}
              strokeWidth="1"
              strokeDasharray={i % 2 ? "3 10" : "2 14"}
              className="tt-orbit"
              style={{ animationDuration: `${26 + i * 9}s`, transformOrigin: "470px 300px" }}
            />
          ))}

          {/* contour terrain */}
          <g className="tt-drift">
            {paths.map((p) => (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={
                  p.peak === 1
                    ? `rgba(147,197,253,${0.5 - p.depth * 0.34})`
                    : p.peak === 2
                      ? `rgba(251,146,60,${0.38 - p.depth * 0.26})`
                      : `rgba(125,211,252,${0.55 - p.depth * 0.38})`
                }
                strokeWidth={p.depth < 0.25 ? 1.3 : 0.9}
                className="tt-line"
                style={{ animationDelay: `${(p.peak * RINGS + p.depth * RINGS) * 0.09}s` }}
              />
            ))}
          </g>

          {/* radar sweep */}
          <g className="tt-sweep" style={{ transformOrigin: "470px 300px" }}>
            <line
              x1="470"
              y1="300"
              x2="470"
              y2="20"
              stroke="rgba(125,211,252,0.35)"
              strokeWidth="1.5"
            />
          </g>

          {/* measurement ticks */}
          {Array.from({ length: 40 }).map((_, i) => {
            const a = (i / 40) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={470 + Math.cos(a) * 440}
                y1={300 + Math.sin(a) * 272}
                x2={470 + Math.cos(a) * 424}
                y2={300 + Math.sin(a) * 262}
                stroke="rgba(226,232,240,0.22)"
                strokeWidth="1"
              />
            );
          })}

          {/* risk regions reacting to inbound flow */}
          {visible.length > 0 &&
            Object.entries(REGION)
              .filter(([sev]) => sev === "Critical" || sev === "Medium" || sev === "Low")
              .map(([sev, r]) => {
                const inbound = visible.filter((c) => (REGION[c.sev] ?? REGION.Low) === r).length;
                if (!inbound) return null;
                return (
                  <ellipse
                    key={sev}
                    cx={r.x}
                    cy={r.y}
                    rx={34 + inbound * 5}
                    ry={(34 + inbound * 5) * 0.55}
                    fill="none"
                    stroke={`${SEV_COLOR[sev]}55`}
                    strokeWidth="1"
                    className="tt-region"
                  />
                );
              })}

          {/* threat flows: source node -> animated path -> risk region */}
          {visible.map((c) => {
            const stroke = SEV_COLOR[c.sev]!;
            const pc = platformColor(c.platform);
            const hot = c.sev === "Critical" || c.sev === "High";
            const pathId = `tt-flow-${c.idx}`;
            const dur = `${4.6 + (c.idx % 4) * 0.8}s`;
            return (
              <g key={c.platform}>
                <path
                  id={pathId}
                  d={c.d}
                  fill="none"
                  stroke={`${stroke}3d`}
                  strokeWidth="1.1"
                  strokeDasharray="4 10"
                  className="tt-flow"
                  style={{ animationDuration: dur }}
                />
                <circle r="2.6" fill={stroke} opacity="0.9">
                  <animateMotion dur={dur} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>
                <circle r="5.5" fill={stroke} opacity="0.14">
                  <animateMotion dur={dur} repeatCount="indefinite" begin="-0.12s">
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </circle>

                {/* source node */}
                <g
                  className="cursor-pointer"
                  onMouseEnter={() => setHover({ node: c.top, x: c.x, y: c.y })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect?.(c.top)}
                >
                  <circle cx={c.x} cy={c.y} r="14" fill="transparent" />
                  <circle
                    cx={c.x}
                    cy={c.y}
                    r="5"
                    fill={pc}
                    stroke="rgba(4,8,15,0.9)"
                    strokeWidth="1.5"
                  />
                  {hot && (
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r="5"
                      fill="none"
                      stroke={`${stroke}99`}
                      className="tt-ping"
                      style={{ animationDelay: `${c.idx * 0.4}s` }}
                    />
                  )}
                  <text
                    x={c.labelLeft ? c.x + 11 : c.x - 11}
                    y={c.y - 9}
                    textAnchor={c.labelLeft ? "start" : "end"}
                    className="font-mono"
                    fontSize="10"
                    letterSpacing="1.6"
                    fill="rgba(226,232,240,0.72)"
                  >
                    {c.platform.toUpperCase()}
                  </text>
                  <text
                    x={c.labelLeft ? c.x + 11 : c.x - 11}
                    y={c.y + 12}
                    textAnchor={c.labelLeft ? "start" : "end"}
                    className="font-mono"
                    fontSize="9"
                    fill={`${stroke}cc`}
                  >
                    {c.count} · {c.sev.toUpperCase()}
                  </text>
                </g>
              </g>
            );
          })}

          <rect
            x="0"
            y="0"
            width="940"
            height="560"
            fill="url(#tt-vig)"
            className="pointer-events-none"
          />
        </g>
      </svg>

      {/* header + top sources + metrics */}
      <div className="pointer-events-none absolute inset-0 p-5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono tracking-[0.28em] text-sky-300/70">THREAT TERRAIN</p>
            <h3 className="mt-1 text-lg sm:text-xl font-semibold text-white/90">
              Exposure topography
            </h3>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] font-mono tracking-[0.2em] text-amber-300">
              {String(threatLevel || "—").toUpperCase()}
            </span>
            {topSources.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-black/45 px-3 py-2 backdrop-blur-sm">
                <p className="text-[9px] font-mono tracking-[0.22em] text-white/40">TOP SOURCES</p>
                <div className="mt-1 space-y-0.5">
                  {topSources.map((s) => (
                    <div
                      key={s.platform}
                      className="flex items-center gap-2 text-[11px] font-mono text-white/70"
                    >
                      <span
                        className="inline-block size-1.5 rounded-full"
                        style={{ background: platformColor(s.platform) }}
                      />
                      <span className="min-w-[68px]">{s.platform}</span>
                      <span className="ml-auto text-white/90">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-white/55">
          <span>SURFACES · {clusters.length}</span>
          <span>FINDINGS · {totalFindings}</span>
          <span className="text-amber-300/80">HIGH · {highFindings}</span>
          <span className="text-red-300/80">CRITICAL · {criticalFindings}</span>
        </div>
      </div>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 rounded-xl border border-white/12 bg-[#050b17]/95 p-3 shadow-xl"
          style={{
            left: `calc(${(hover.x / 940) * 100}% + 12px)`,
            top: `calc(${(hover.y / 560) * 100}% - 8px)`,
            transform: hover.x > 620 ? "translateX(-110%)" : undefined,
          }}
        >
          <p className="text-xs font-semibold text-white/90">{hover.node.platform}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-white/60">
            {hover.node.riskType || hover.node.title || "Finding"}
          </p>
          <p className="mt-1 text-[11px] font-mono" style={{ color: SEV_COLOR[normSev(hover.node.severity)] }}>
            Risk: {normSev(hover.node.severity)}
            {hover.node.riskScore ? ` · ${Math.round(hover.node.riskScore)}` : ""}
          </p>
          <p className="text-[11px] text-white/45">Detected: {relTime(hover.node.detectedAt)}</p>
          <p className="mt-1 text-[11px] text-sky-300">View finding →</p>
        </div>
      )}

      {/* source filters */}
      <div className="relative flex flex-wrap items-center gap-1.5 border-t border-white/10 px-5 py-3">
        {["All", ...platforms].map((p) => {
          const active = filter === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setFilter(p)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-mono tracking-[0.14em] transition ${
                active
                  ? "border-sky-400/50 bg-sky-400/15 text-sky-200"
                  : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80"
              }`}
            >
              {p.toUpperCase()}
              {p !== "All" && (
                <span className="ml-1 text-white/40">
                  {clusters.find((c) => c.platform === p)?.count ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
