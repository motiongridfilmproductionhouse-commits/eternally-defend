import { Shield, AlertTriangle, Clock, Send, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

function Spark({ color, data }: { color: string; data: number[] }) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={d} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`g-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#g-${color})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ReputationRing() {
  const value = 92;
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <div className="relative size-[140px]">
      <svg viewBox="0 0 140 140" className="size-full -rotate-90">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.6 0.24 295)" />
            <stop offset="100%" stopColor="oklch(0.7 0.2 320)" />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={r} strokeWidth="12" stroke="oklch(0.94 0.02 295)" fill="none" />
        <circle cx="70" cy="70" r={r} strokeWidth="12" stroke="url(#ringGrad)" fill="none"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center rotate-0">
        <div className="text-center">
          <div className="text-3xl font-bold font-display leading-none">92</div>
          <div className="text-[10px] text-muted-foreground mt-1">/100</div>
        </div>
      </div>
    </div>
  );
}

const stats = [
  { icon: Shield, label: "PROTECTED ASSETS", value: "47", delta: "12%", sub: "Total Assets Protected", color: "oklch(0.6 0.24 295)", spark: [4,6,5,8,7,9,10,11,10,12] },
  { icon: AlertTriangle, label: "ACTIVE THREATS", value: "12", delta: "5%", sub: "Across all platforms", color: "oklch(0.63 0.24 25)", spark: [3,5,4,6,5,7,6,8,7,9] },
  { icon: Clock, label: "CRITICAL CASES", value: "3", delta: "3%", sub: "Require immediate action", color: "oklch(0.7 0.2 35)", spark: [2,3,2,4,3,5,4,6,5,4] },
  { icon: Send, label: "TAKEDOWNS SENT", value: "1,247", delta: "18%", sub: "Successful takedowns", color: "oklch(0.65 0.18 240)", spark: [10,12,11,14,13,15,14,17,16,18] },
];

export function StatsRow() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
      {/* Reputation score */}
      <div className="card-surface p-5 flex flex-col items-center">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">REPUTATION SCORE</div>
        <div className="my-2"><ReputationRing /></div>
        <div className="text-sm font-semibold" style={{ color: "oklch(0.55 0.22 295)" }}>Excellent</div>
        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <TrendingUp className="size-3 text-emerald-600" /> <span className="text-emerald-600 font-semibold">8%</span> vs last 14 days
        </div>
      </div>

      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="card-surface p-5 flex flex-col">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl grid place-items-center" style={{ background: `color-mix(in oklab, ${s.color} 12%, white)`, color: s.color }}>
                <Icon className="size-5" />
              </div>
              <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">{s.label}</div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <div className="text-4xl font-bold font-display">{s.value}</div>
              <div className="text-xs font-semibold flex items-center gap-0.5" style={{ color: s.color }}>
                <TrendingUp className="size-3" />{s.delta}
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
            <div className="mt-3 -mx-2"><Spark color={s.color} data={s.spark} /></div>
          </div>
        );
      })}
    </div>
  );
}
