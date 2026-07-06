import { TrendingDown, Heart } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

function Ring() {
  const v = 92, r = 40, c = 2 * Math.PI * r, off = c - (v / 100) * c;
  return (
    <div className="relative size-[110px]">
      <svg viewBox="0 0 110 110" className="size-full -rotate-90">
        <defs>
          <linearGradient id="pulseGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.68 0.16 155)" />
            <stop offset="100%" stopColor="oklch(0.6 0.24 295)" />
          </linearGradient>
        </defs>
        <circle cx="55" cy="55" r={r} strokeWidth="10" stroke="oklch(0.94 0.02 295)" fill="none" />
        <circle cx="55" cy="55" r={r} strokeWidth="10" stroke="url(#pulseGrad)" fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold font-display leading-none">92</div>
          <div className="text-[10px] text-muted-foreground mt-1">/100</div>
        </div>
      </div>
    </div>
  );
}

const forecastData = [3,5,4,6,5,7,6,8,9,10].map((v, i) => ({ i, v }));

export function ReputationPulse() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">REPUTATION PULSE</div>
          <div className="text-xs text-muted-foreground/80">Your reputation health</div>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-5 items-center">
        <div className="flex flex-col items-center">
          <Ring />
          <Heart className="size-4 mt-2 text-rose-400 fill-rose-100" />
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">Forecast</div>
            <div className="flex items-end gap-2">
              <div className="text-xl font-bold font-display">87</div>
              <div className="text-xs text-muted-foreground pb-1">in next 7 days</div>
              <div className="ml-auto h-8 w-16">
                <ResponsiveContainer><AreaChart data={forecastData}>
                  <Area dataKey="v" stroke="oklch(0.68 0.16 155)" strokeWidth={2} fill="oklch(0.68 0.16 155 / 0.15)" />
                </AreaChart></ResponsiveContainer>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Risk Level</div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-amber-400" /><span className="text-sm font-semibold">Medium</span></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Sentiment</div>
            <div className="text-sm font-semibold" style={{ color: "oklch(0.55 0.22 295)" }}>62% Positive</div>
            <div className="h-1.5 rounded-full bg-secondary mt-1 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: "62%", background: "var(--gradient-brand)" }} />
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <TrendingDown className="size-4 text-rose-500" />
          <div><div className="text-[11px] text-muted-foreground">Negative Trend</div><div className="text-sm font-semibold text-rose-500">-14%</div></div>
        </div>
        <div className="flex items-center gap-2">
          <Heart className="size-4 text-rose-400" />
          <div><div className="text-[11px] text-muted-foreground">Viral Velocity</div><div className="text-sm font-semibold text-rose-500">High</div></div>
        </div>
      </div>
    </div>
  );
}
