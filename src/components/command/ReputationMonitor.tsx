import { useMemo } from "react";
import { AlertTriangle, Activity, ShieldCheck, Radio } from "lucide-react";

/**
 * Big "wall monitor" panel: reputation score + live threat exposure.
 * Presentation only — every number is passed in from the command-center read.
 */

type MonitorProps = {
  score: number; // 0-100 reputation
  threatLevel: string;
  totalFindings: number;
  criticalFindings: number;
  newToday: number;
  resolvedPct: number;
  sources: { platform: string; severity: string; title: string }[];
  spark: number[];
  feed: { time: string; type: string; label: string; sub?: string }[];
};

const SEV_TONE: Record<string, string> = {
  Critical: "oklch(0.63 0.24 25)",
  High: "oklch(0.72 0.18 55)",
  Medium: "oklch(0.78 0.15 85)",
  Low: "oklch(0.7 0.14 155)",
  Info: "oklch(0.68 0.09 240)",
};

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = polar(cx, cy, r, from);
  const b = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const pts = values.length ? values : [0, 0];
  const max = Math.max(1, ...pts);
  const d = pts
    .map((v, i) => `${(i / Math.max(1, pts.length - 1)) * 100},${28 - (v / max) * 24}`)
    .join(" ");
  const last = polar(0, 0, 0, 0);
  void last;
  return (
    <svg viewBox="0 0 100 30" className="w-full h-8" preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ReputationMonitor({
  score,
  threatLevel,
  totalFindings,
  criticalFindings,
  newToday,
  resolvedPct,
  sources,
  spark,
  feed,
}: MonitorProps) {
  const cx = 460;
  const cy = 330;
  const START = 180;
  const SWEEP = 180;

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tone =
    clamped >= 80
      ? "oklch(0.7 0.16 155)"
      : clamped >= 60
        ? "oklch(0.72 0.17 200)"
        : clamped >= 40
          ? "oklch(0.78 0.15 85)"
          : "oklch(0.63 0.24 25)";

  const ticks = useMemo(
    () =>
      Array.from({ length: 61 }, (_, i) => {
        const deg = START + (i / 60) * SWEEP;
        const active = i / 60 <= clamped / 100;
        return { deg, active, major: i % 10 === 0 };
      }),
    [clamped],
  );

  // Distinct platforms placed along the mid arc, worst severity first.
  const nodes = useMemo(() => {
    const map = new Map<string, { platform: string; severity: string; count: number }>();
    for (const s of sources) {
      const cur = map.get(s.platform);
      if (!cur) map.set(s.platform, { platform: s.platform, severity: s.severity, count: 1 });
      else {
        cur.count += 1;
        if ((SEV_ORDER[s.severity] ?? 0) > (SEV_ORDER[cur.severity] ?? 0)) cur.severity = s.severity;
      }
    }
    const list = [...map.values()]
      .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0) || b.count - a.count)
      .slice(0, 7);
    return list.map((n, i) => {
      const deg = START + ((i + 1) / (list.length + 1)) * SWEEP;
      const r = i % 2 === 0 ? 250 : 205;
      return { ...n, ...polar(cx, cy, r, deg) };
    });
  }, [sources]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,oklch(0.19_0.05_260_/_0.9),oklch(0.14_0.04_260_/_0.9))] p-5 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(700px_320px_at_50%_100%,oklch(0.55_0.2_260_/_0.25),transparent_70%)]" />

      <div className="relative flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.22em] font-semibold text-muted-foreground">
            REPUTATION &amp; THREAT MONITOR
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            Live exposure across every monitored surface
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          <Radio className="size-3.5 animate-pulse" style={{ color: tone }} />
          <span style={{ color: tone }}>{threatLevel?.toUpperCase() || "MONITORING"}</span>
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* left rail */}
        <div className="xl:col-span-3 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] tracking-[0.18em] text-muted-foreground">TOTAL FINDINGS</div>
            <div className="mt-1 flex items-end gap-2">
              <div className="text-5xl font-bold font-display leading-none">{totalFindings}</div>
              <div className="text-xs text-muted-foreground pb-1">Total</div>
            </div>
            <Sparkline values={spark} tone={tone} />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-[10px] tracking-[0.18em] text-muted-foreground">OPEN SEVERITY</div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {(["Critical", "High", "Medium", "Low"] as const).map((s) => {
                const n = sources.filter((x) => x.severity === s).length;
                return (
                  <div key={s} className="text-center">
                    <div
                      className="h-14 rounded-md flex items-end justify-center"
                      style={{ background: `color-mix(in oklab, ${SEV_TONE[s]} 14%, transparent)` }}
                    >
                      <div
                        className="w-full rounded-md"
                        style={{
                          height: `${Math.min(100, n * 22 + (n ? 18 : 0))}%`,
                          background: SEV_TONE[s],
                        }}
                      />
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{s[0]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* center arc monitor */}
        <div className="xl:col-span-6">
          <svg viewBox="0 60 920 300" className="w-full">
            {/* tick ring */}
            {ticks.map((t, i) => {
              const inner = polar(cx, cy, t.major ? 292 : 300, t.deg);
              const outer = polar(cx, cy, 320, t.deg);
              return (
                <line
                  key={i}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={t.active ? tone : "oklch(0.75 0.02 260 / 0.18)"}
                  strokeWidth={t.major ? 2.5 : 1.5}
                />
              );
            })}

            {/* faint guide arcs the nodes sit on */}
            <path d={arcPath(cx, cy, 250, START, START + SWEEP)} fill="none" stroke="oklch(0.8 0.02 260 / 0.12)" />
            <path d={arcPath(cx, cy, 205, START, START + SWEEP)} fill="none" stroke="oklch(0.8 0.02 260 / 0.12)" />

            {/* progress arc */}
            <path
              d={arcPath(cx, cy, 160, START, START + (SWEEP * clamped) / 100 || START + 0.01)}
              fill="none"
              stroke={tone}
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.85"
            />

            {/* inner dome — resolved share */}
            <path
              d={`${arcPath(cx, cy, 120, START, START + SWEEP)} L ${cx} ${cy} Z`}
              fill="oklch(0.28 0.06 265 / 0.65)"
            />
            <path
              d={arcPath(cx, cy, 104, START, START + (SWEEP * Math.max(2, resolvedPct)) / 100)}
              fill="none"
              stroke="oklch(0.95 0.02 260 / 0.9)"
              strokeWidth="8"
              strokeLinecap="round"
            />

            {/* center readout */}
            <text x={cx} y={cy - 190} textAnchor="middle" className="fill-foreground" fontSize="46" fontWeight="700">
              {clamped}
            </text>
            <text x={cx} y={cy - 168} textAnchor="middle" fontSize="12" fill="oklch(0.8 0.02 260 / 0.7)">
              Reputation Score
            </text>
            <text x={cx} y={cy - 60} textAnchor="middle" fontSize="26" fontWeight="700" fill={SEV_TONE.Critical}>
              {criticalFindings}
            </text>
            <text x={cx} y={cy - 40} textAnchor="middle" fontSize="11" fill="oklch(0.8 0.02 260 / 0.7)">
              Critical Threats
            </text>

            {/* side labels */}
            <text x={cx - 300} y={cy + 26} textAnchor="middle" fontSize="11" fill="oklch(0.8 0.02 260 / 0.6)">
              +{newToday} today
            </text>
            <text x={cx + 300} y={cy + 26} textAnchor="middle" fontSize="11" fill="oklch(0.8 0.02 260 / 0.6)">
              {resolvedPct}% resolved
            </text>

            {/* platform nodes */}
            {nodes.map((n) => (
              <g key={n.platform}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={n.x}
                  y2={n.y}
                  stroke={`color-mix(in oklab, ${SEV_TONE[n.severity] ?? SEV_TONE.Info} 35%, transparent)`}
                  strokeDasharray="3 5"
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r="16"
                  fill="oklch(0.2 0.05 262 / 0.95)"
                  stroke={SEV_TONE[n.severity] ?? SEV_TONE.Info}
                />
                <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={SEV_TONE[n.severity] ?? SEV_TONE.Info}>
                  {n.count}
                </text>
                <text x={n.x} y={n.y - 24} textAnchor="middle" fontSize="10" fill="oklch(0.85 0.02 260 / 0.75)">
                  {n.platform}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* right rail — live feed */}
        <div className="xl:col-span-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] tracking-[0.18em] text-muted-foreground flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-[oklch(0.7_0.16_155)] animate-pulse" /> LIVE FEED
            </div>
            <div className="text-[10px] text-muted-foreground">24h</div>
          </div>
          <div className="mt-3 space-y-2 max-h-[300px] overflow-auto pr-1">
            {feed.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">No events yet.</div>
            ) : (
              feed.slice(0, 8).map((ev, i) => {
                const Icon =
                  ev.type === "threat" ? AlertTriangle : ev.type === "evidence" ? ShieldCheck : Activity;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2"
                  >
                    <Icon className="size-3.5 mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] truncate">{ev.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {ev.sub ? `${ev.sub} · ` : ""}
                        {timeAgo(ev.time)} ago
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const SEV_ORDER: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Info: 0,
};
