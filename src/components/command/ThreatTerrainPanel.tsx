import { useMemo } from "react";

/**
 * THREAT TERRAIN — animated topographic contour illustration.
 * Purely presentational: contours are generated procedurally, labels come from
 * the live command-center numbers passed in as props.
 */

type Peak = { cx: number; cy: number; amp: number; phase: number };

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

export function ThreatTerrainPanel({
  totalFindings,
  criticalFindings,
  threatLevel,
  sources = [],
}: {
  totalFindings: number;
  criticalFindings: number;
  threatLevel: string;
  sources?: { platform: string; severity: string }[];
}) {
  const RINGS = 13;

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

  const blips = useMemo(() => {
    const seeds = [
      [230, 150],
      [400, 300],
      [560, 380],
      [700, 250],
      [330, 420],
      [640, 130],
      [500, 200],
      [790, 330],
    ] as const;
    return seeds.map(([x, y], i) => {
      const s = sources[i];
      const hot = s?.severity === "Critical" || s?.severity === "High";
      return { x, y, hot, platform: s?.platform, i };
    });
  }, [sources]);

  return (
    <section
      className="relative overflow-hidden rounded-[22px] border border-white/10"
      style={{
        background:
          "radial-gradient(120% 90% at 50% 120%, #0c1a33 0%, #071021 45%, #04080f 100%)",
      }}
      aria-label="Threat terrain visualization"
    >
      <div className="absolute inset-0 cyber-grid opacity-[0.16]" />

      <svg viewBox="0 0 940 560" className="relative w-full h-[300px] sm:h-[380px]">
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

          {/* threat blips */}
          {blips.map((b) => (
            <g key={b.i}>
              <circle
                cx={b.x}
                cy={b.y}
                r="4"
                fill={b.hot ? "rgb(251 146 60)" : "rgb(125 211 252)"}
                className="tt-blip"
                style={{ animationDelay: `${b.i * 0.45}s` }}
              />
              <circle
                cx={b.x}
                cy={b.y}
                r="4"
                fill="none"
                stroke={b.hot ? "rgba(251,146,60,0.6)" : "rgba(125,211,252,0.5)"}
                className="tt-ping"
                style={{ animationDelay: `${b.i * 0.45}s` }}
              />
            </g>
          ))}

          <rect x="0" y="0" width="940" height="560" fill="url(#tt-vig)" />
        </g>
      </svg>

      {/* overlay readouts */}
      <div className="pointer-events-none absolute inset-0 p-5 flex flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono tracking-[0.28em] text-sky-300/70">
              THREAT TERRAIN
            </p>
            <h3 className="mt-1 text-lg sm:text-xl font-semibold text-white/90">
              Exposure topography
            </h3>
          </div>
          <span className="rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[10px] font-mono tracking-[0.2em] text-amber-300">
            {String(threatLevel || "—").toUpperCase()}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-white/55">
          <span>SURFACES · {sources.length}</span>
          <span>FINDINGS · {totalFindings}</span>
          <span className="text-amber-300/80">CRITICAL · {criticalFindings}</span>
        </div>
      </div>
    </section>
  );
}
