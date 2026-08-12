import { useEffect, useMemo, useState } from "react";
import { Compass, Radar as RadarIcon } from "lucide-react";
import type { getCommandCenterStats } from "@/lib/command-center.functions";

type CmdData = Awaited<ReturnType<typeof getCommandCenterStats>>;
type Node = CmdData["radar"][number];

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

/** Deterministic hash → 0..1, so a node never jumps between renders. */
function hash01(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function fmtReach(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Shell({
  icon,
  label,
  sub,
  status,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  status: string;
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
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-primary">
          {status}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/* ============ Radar 1 — Deep HUD sweep scope ============ */
export function HudSweepRadar({ d }: { d: CmdData }) {
  const size = 360;
  const c = size / 2;
  const rMax = c - 26;
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
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
  }, []);

  const nodes = useMemo(
    () =>
      d.radar.slice(0, 40).map((n) => {
        const score = Math.min(100, Math.max(0, n.threatScore || 0));
        // higher threat sits closer to the centre (like the reference scope)
        const radius = rMax * (0.16 + (1 - score / 100) * 0.78);
        const a = hash01(n.id) * 360;
        return {
          n,
          a,
          x: c + Math.cos((a * Math.PI) / 180) * radius,
          y: c + Math.sin((a * Math.PI) / 180) * radius,
        };
      }),
    [d.radar, rMax, c],
  );

  const platforms = useMemo(() => new Set(d.radar.map((r) => r.platform)).size, [d.radar]);

  return (
    <Shell
      icon={<RadarIcon className="size-4" />}
      label="Deep Scope Radar"
      sub={`${d.radar.length} tracked signals · ${platforms} platforms`}
      status="Sweeping"
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

          {/* outer bezel */}
          <circle
            cx={c}
            cy={c}
            r={rMax + 18}
            fill="none"
            stroke="oklch(0.7 0.17 235 / 0.35)"
            strokeWidth={2}
          />
          <circle cx={c} cy={c} r={rMax + 10} fill="oklch(0.2 0.07 255 / 0.55)" />

          {/* concentric grid */}
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
          {/* radial spokes */}
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i * 15 * Math.PI) / 180;
            return (
              <line
                key={i}
                x1={c}
                y1={c}
                x2={c + Math.cos(a) * rMax}
                y2={c + Math.sin(a) * rMax}
                stroke="oklch(0.7 0.15 235 / 0.12)"
                strokeWidth={1}
              />
            );
          })}

          {/* sweep beam */}
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

          {/* range scale */}
          {Array.from({ length: 9 }).map((_, i) => (
            <line
              key={i}
              x1={c + rMax + 4}
              y1={c - rMax + (i * rMax * 2) / 8}
              x2={c + rMax + 14 - (i % 2 ? 5 : 0)}
              y2={c - rMax + (i * rMax * 2) / 8}
              stroke="oklch(0.75 0.14 230 / 0.5)"
              strokeWidth={1}
            />
          ))}

          {/* nodes */}
          {nodes.map(({ n, x, y }) => {
            const col = sevColor(n.severity);
            const lit = Math.abs(((angle - hash01(n.id) * 360 + 540) % 360) - 180) > 150;
            return n.permalink ? (
              <a key={n.id} href={n.permalink} target="_blank" rel="noreferrer">
                <title>{`${n.severity} · ${n.platform} · ${n.title}`}</title>
                <circle cx={x} cy={y} r={lit ? 8 : 5} fill={col} opacity={lit ? 0.28 : 0.14} />
                <circle cx={x} cy={y} r={3} fill={col} />
              </a>
            ) : (
              <g key={n.id}>
                <title>{`${n.severity} · ${n.platform} · ${n.title}`}</title>
                <circle cx={x} cy={y} r={lit ? 8 : 5} fill={col} opacity={lit ? 0.28 : 0.14} />
                <circle cx={x} cy={y} r={3} fill={col} />
              </g>
            );
          })}

          {/* core */}
          <circle cx={c} cy={c} r={22} fill="url(#hud-core)" />
          <circle cx={c} cy={c} r={4} fill="oklch(0.9 0.14 225)" />
        </svg>

        {d.radar.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-white/10 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
              No signals detected
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {Object.keys(SEV_HUE).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: sevColor(s) }} />
            {s}
          </span>
        ))}
      </div>
    </Shell>
  );
}

/* ============ Radar 2 — Directional exposure scope ============ */
export function DirectionalRadar({ d }: { d: CmdData }) {
  const size = 360;
  const c = size / 2;
  const rMax = c - 30;
  const [angle, setAngle] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => setAngle((a) => (a + 6) % 360), 90);
    return () => window.clearInterval(id);
  }, []);

  const maxReach = useMemo(
    () => Math.max(1, ...d.radar.map((r) => r.reach || 0)),
    [d.radar],
  );
  const markers = useMemo(() => {
    const top = [...d.radar].sort((a, b) => (b.reach || 0) - (a.reach || 0)).slice(0, 6);
    return top.map((n: Node) => {
      const a = hash01(`${n.id}:dir`) * 360;
      const radius = rMax * (0.3 + 0.62 * ((n.reach || 0) / maxReach));
      return {
        n,
        a,
        x: c + Math.cos((a * Math.PI) / 180) * radius,
        y: c + Math.sin((a * Math.PI) / 180) * radius,
      };
    });
  }, [d.radar, maxReach, rMax, c]);

  return (
    <Shell
      icon={<Compass className="size-4" />}
      label="Exposure Bearing Radar"
      sub={`Top ${markers.length} highest-reach threats · ${fmtReach(d.danger.totalReach ?? 0)} total reach`}
      status={`Zone ${d.danger.zone}`}
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

          {/* north marker */}
          <g>
            <circle
              cx={c + rMax * 0.86}
              cy={c - rMax * 0.5}
              r={13}
              fill="oklch(0.2 0.05 200)"
              stroke="oklch(0.82 0.17 175)"
              strokeWidth={2}
            />
            <text
              x={c + rMax * 0.86}
              y={c - rMax * 0.5 + 4}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill="oklch(0.9 0.1 180)"
            >
              N
            </text>
          </g>

          {/* cone sweep with stepped arcs */}
          <g transform={`rotate(${angle - 90} ${c} ${c})`}>
            {Array.from({ length: 7 }).map((_, i) => {
              const r = rMax * (0.22 + i * 0.1);
              const spread = 15 + i * 1.2;
              const a1 = ((-spread) * Math.PI) / 180;
              const a2 = ((spread) * Math.PI) / 180;
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

          {/* reach markers */}
          {markers.map(({ n, x, y }) => {
            const col = sevColor(n.severity);
            const right = x >= c;
            return (
              <g key={n.id}>
                <title>{`${n.platform} · ${n.severity} · reach ${fmtReach(n.reach || 0)}`}</title>
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
                  {fmtReach(n.reach || 0)}
                </text>
              </g>
            );
          })}

          <circle cx={c} cy={c} r={9} fill="oklch(0.82 0.17 175 / 0.25)" />
          <circle cx={c} cy={c} r={4} fill="oklch(0.88 0.16 175)" />
        </svg>

        {markers.length === 0 && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-white/10 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground">
              No reach data yet
            </span>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Bearing shows platform spread; distance from centre is audience reach. Marker colour is the
        finding&apos;s recorded severity.
      </p>
    </Shell>
  );
}
