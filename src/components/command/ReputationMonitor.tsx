import { useMemo } from "react";
import { AlertTriangle, Activity, ShieldCheck, Radio, TrendingUp } from "lucide-react";

/**
 * Big light "wall monitor" panel: reputation score + live threat exposure.
 * Presentation only — every number is passed in from the command-center read.
 * Intentionally light-on-white (independent of the surrounding dark shell).
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

const INK = "#0f1b33";
const MUTED = "#6b7896";

const SEV: Record<string, { tone: string; soft: string; label: string }> = {
  Critical: { tone: "#e0492f", soft: "#fde8e2", label: "Critical" },
  High: { tone: "#f0862a", soft: "#fdeedd", label: "High" },
  Medium: { tone: "#e5b02b", soft: "#fdf6dd", label: "Medium" },
  Low: { tone: "#2fa36b", soft: "#e3f6ec", label: "Low" },
  Info: { tone: "#3b82f6", soft: "#e6efff", label: "Info" },
};
const SEV_ORDER: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Info: 0 };

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
  const pts = values.length > 1 ? values : [0, 0];
  const max = Math.max(1, ...pts);
  const coords = pts.map(
    (v, i) => [(i / (pts.length - 1)) * 100, 30 - (v / max) * 24] as [number, number],
  );
  const line = coords.map((c) => c.join(",")).join(" ");
  const area = `0,32 ${line} 100,32`;
  const tip = coords[coords.length - 1];
  return (
    <svg viewBox="0 0 100 34" className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#sparkFill)" />
      <polyline
        points={line}
        fill="none"
        stroke={tone}
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={tip[0]} cy={tip[1]} r="1.6" fill={tone} vectorEffect="non-scaling-stroke" />
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
    clamped >= 80 ? "#2fa36b" : clamped >= 60 ? "#2f7fe0" : clamped >= 40 ? "#e5a52b" : "#e0492f";

  // length of the drawn reputation arc — drives the draw-in animation
  const arcLen = Math.round(Math.PI * 162 * (Math.max(clamped, 0.5) / 100));



  const ticks = useMemo(
    () =>
      Array.from({ length: 61 }, (_, i) => {
        const deg = START + (i / 60) * SWEEP;
        return { deg, active: i / 60 <= clamped / 100, major: i % 10 === 0 };
      }),
    [clamped],
  );

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
      .sort(
        (a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0) || b.count - a.count,
      )
      .slice(0, 7);
    return list.map((n, i) => {
      const deg = START + ((i + 1) / (list.length + 1)) * SWEEP;
      const r = i % 2 === 0 ? 252 : 202;
      return { ...n, ...polar(cx, cy, r, deg) };
    });
  }, [sources]);

  const sevCounts = (["Critical", "High", "Medium", "Low"] as const).map((s) => ({
    key: s,
    n: sources.filter((x) => x.severity === s).length,
  }));
  const sevMax = Math.max(1, ...sevCounts.map((s) => s.n));

  return (
    <div
      className="rounded-[28px] border p-6 relative overflow-hidden"
      style={{
        borderColor: "rgba(15,27,51,0.07)",
        background:
          "radial-gradient(900px 420px at 8% 0%, #fdeee6 0%, transparent 62%), radial-gradient(760px 420px at 96% 4%, #eaf4ec 0%, transparent 60%), linear-gradient(180deg,#ffffff 0%,#f8f9fc 100%)",
        boxShadow: "0 24px 60px -32px rgba(15,27,51,0.25)",
        color: INK,
      }}
    >
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <div
            className="text-[10px] tracking-[0.24em] font-semibold"
            style={{ color: "#9aa4bd" }}
          >
            REPUTATION &amp; THREAT MONITOR
          </div>
          <div className="text-[22px] font-semibold font-display mt-1 leading-tight">
            Live exposure across every monitored surface
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: "#ffffff", boxShadow: "0 2px 10px -4px rgba(15,27,51,0.25)" }}
          >
            <Radio className="size-3.5 animate-pulse" style={{ color: tone }} />
            <span style={{ color: tone }}>{threatLevel?.toUpperCase() || "MONITORING"}</span>
          </div>
          <div
            className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{ background: "#ffffff", color: MUTED, boxShadow: "0 2px 10px -4px rgba(15,27,51,0.2)" }}
          >
            24h
          </div>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* left rail */}
        <div className="xl:col-span-3 space-y-4">
          <div
            className="rounded-2xl p-4"
            style={{
              background: "linear-gradient(160deg,#fff6f1 0%,#ffffff 70%)",
              border: "1px solid rgba(15,27,51,0.06)",
            }}
          >
            <div className="text-[10px] tracking-[0.18em] font-semibold" style={{ color: "#9aa4bd" }}>
              TOTAL FINDINGS
            </div>
            <div className="mt-1 flex items-end gap-2">
              <div className="text-[52px] font-bold font-display leading-none">{totalFindings}</div>
              <div className="text-xs pb-2" style={{ color: MUTED }}>
                Total
              </div>
            </div>
            <Sparkline values={spark} tone="#f0862a" />
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#2fa36b" }}>
              <TrendingUp className="size-3.5" /> +{newToday} today
            </div>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{ background: "#ffffff", border: "1px solid rgba(15,27,51,0.06)" }}
          >
            <div className="text-[10px] tracking-[0.18em] font-semibold" style={{ color: "#9aa4bd" }}>
              OPEN SEVERITY
            </div>
            <div className="mt-3 space-y-2.5">
              {sevCounts.map(({ key, n }) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-14 text-[11px] font-medium" style={{ color: MUTED }}>
                    {SEV[key].label}
                  </div>
                  <div
                    className="flex-1 h-2 rounded-full overflow-hidden"
                    style={{ background: SEV[key].soft }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(n ? 8 : 0, (n / sevMax) * 100)}%`,
                        background: `linear-gradient(90deg, ${SEV[key].tone}, color-mix(in oklab, ${SEV[key].tone} 70%, white))`,
                      }}
                    />
                  </div>
                  <div className="w-6 text-right text-[12px] font-bold">{n}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* center arc monitor */}
        <div className="xl:col-span-6">
          <svg viewBox="0 80 920 290" className="w-full">
            <defs>
              <linearGradient id="repArc" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={tone} stopOpacity="0.45" />
                <stop offset="100%" stopColor={tone} />
              </linearGradient>
              <linearGradient id="domeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="55%" stopColor="#f6f9ff" stopOpacity="0.9" />
                <stop offset="100%" stopColor={tone} stopOpacity="0.14" />
              </linearGradient>
            </defs>

            {/* tick ring */}
            {ticks.map((t, i) => {
              const inner = polar(cx, cy, t.major ? 288 : 298, t.deg);
              const outer = polar(cx, cy, 320, t.deg);
              return (
                <line
                  key={i}
                  className="rep-tick"
                  style={{ animationDelay: `${i * 18}ms` }}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={t.active ? tone : "rgba(15,27,51,0.13)"}
                  strokeWidth={t.major ? 2.6 : 1.4}
                  strokeLinecap="round"
                />
              );
            })}

            {/* node guide arcs */}
            <path d={arcPath(cx, cy, 252, START, START + SWEEP)} fill="none" stroke="rgba(15,27,51,0.08)" />
            <path d={arcPath(cx, cy, 202, START, START + SWEEP)} fill="none" stroke="rgba(15,27,51,0.08)" />

            {/* slow radar sweep across the dial */}
            <g className="rep-sweep" opacity="0.5">
              <line
                x1={cx}
                y1={cy}
                x2={cx - 300}
                y2={cy}
                stroke={tone}
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.35"
              />
            </g>

            {/* reputation progress arc */}
            <path
              d={arcPath(cx, cy, 162, START, START + SWEEP)}
              fill="none"
              stroke="rgba(15,27,51,0.07)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            <path
              className="rep-arc"
              style={{ ["--rep-arc-len" as string]: `${arcLen}` }}
              strokeDasharray={arcLen}
              d={arcPath(cx, cy, 162, START, START + (SWEEP * Math.max(clamped, 0.5)) / 100)}
              fill="none"
              stroke="url(#repArc)"
              strokeWidth="12"
              strokeLinecap="round"
            />


            {/* inner dome — resolved share */}
            <path
              d={`${arcPath(cx, cy, 118, START, START + SWEEP)} L ${cx} ${cy} Z`}
              fill="url(#domeFill)"
              stroke="rgba(15,27,51,0.08)"
            />
            <path
              d={arcPath(cx, cy, 100, START, START + SWEEP)}
              fill="none"
              stroke="rgba(15,27,51,0.06)"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d={arcPath(cx, cy, 100, START, START + (SWEEP * Math.max(2, resolvedPct)) / 100)}
              fill="none"
              stroke={tone}
              strokeOpacity="0.75"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <text x={cx} y={cy - 52} textAnchor="middle" fontSize="26" fontWeight="700" fill={INK}>
              {resolvedPct}%
            </text>
            <text x={cx} y={cy - 32} textAnchor="middle" fontSize="11" fill={MUTED}>
              Resolved
            </text>

            {/* center readout */}
            <text x={cx} y={cy - 196} textAnchor="middle" fontSize="52" fontWeight="700" fill={INK}>
              {clamped}
            </text>
            <text x={cx} y={cy - 174} textAnchor="middle" fontSize="12" fill={MUTED}>
              Reputation Score
            </text>
            <text x={cx} y={cy - 140} textAnchor="middle" fontSize="13" fontWeight="700" fill={SEV.Critical.tone}>
              {criticalFindings} critical threats
            </text>

            {/* platform nodes */}
            {nodes.map((n, i) => {
              const s = SEV[n.severity] ?? SEV.Info;
              const hot = n.severity === "Critical" || n.severity === "High";
              return (
                <g key={n.platform} className="rep-node" style={{ animationDelay: `${i * 420}ms` }}>
                  <line
                    className="rep-link"
                    x1={cx}
                    y1={cy}
                    x2={n.x}
                    y2={n.y}
                    stroke="rgba(15,27,51,0.12)"
                  />
                  {hot && (
                    <circle
                      className="rep-node-halo"
                      style={{ animationDelay: `${i * 300}ms` }}
                      cx={n.x}
                      cy={n.y}
                      r="22"
                      fill="none"
                      stroke={s.tone}
                      strokeWidth="2"
                    />
                  )}
                  <circle cx={n.x} cy={n.y} r="19" fill="#ffffff" stroke={s.tone} strokeWidth="2" />
                  <circle cx={n.x} cy={n.y} r="24" fill="none" stroke={s.soft} strokeWidth="4" />
                  <text
                    x={n.x}
                    y={n.y + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="700"
                    fill={s.tone}
                  >
                    {n.count}
                  </text>
                  <text x={n.x} y={n.y - 32} textAnchor="middle" fontSize="11" fontWeight="600" fill={INK}>
                    {n.platform}
                  </text>
                </g>
              );
            })}

          </svg>
        </div>

        {/* right rail — live feed */}
        <div
          className="xl:col-span-3 rounded-2xl p-4"
          style={{
            background: "linear-gradient(180deg,#f3faf5 0%,#ffffff 60%)",
            border: "1px solid rgba(15,27,51,0.06)",
          }}
        >
          <div className="flex items-center justify-between">
            <div
              className="text-[10px] tracking-[0.18em] font-semibold flex items-center gap-1.5"
              style={{ color: "#9aa4bd" }}
            >
              <span className="size-1.5 rounded-full animate-pulse" style={{ background: "#2fa36b" }} />
              LIVE FEED
            </div>
          </div>
          <div className="mt-3 space-y-2 max-h-[300px] overflow-auto pr-1">
            {feed.length === 0 ? (
              <div className="text-xs py-6 text-center" style={{ color: MUTED }}>
                No events yet.
              </div>
            ) : (
              feed.slice(0, 8).map((ev, i) => {
                const Icon =
                  ev.type === "threat" ? AlertTriangle : ev.type === "evidence" ? ShieldCheck : Activity;
                const t =
                  ev.type === "threat" ? SEV.High : ev.type === "evidence" ? SEV.Low : SEV.Info;
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 ${ev.type === "threat" ? "alert-edge-soft" : ""}`}
                    style={{
                      background: "#ffffff",
                      border: "1px solid rgba(15,27,51,0.06)",
                      boxShadow: "0 6px 18px -14px rgba(15,27,51,0.4)",
                    }}
                  >
                    <span
                      className="mt-0.5 grid place-items-center size-6 rounded-lg shrink-0"
                      style={{ background: t.soft, color: t.tone }}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] truncate font-medium">{ev.label}</div>
                      <div className="text-[10px]" style={{ color: MUTED }}>
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
