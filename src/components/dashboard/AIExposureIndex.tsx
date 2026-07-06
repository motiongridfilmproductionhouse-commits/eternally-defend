import { Area, AreaChart, ResponsiveContainer } from "recharts";

function Ring() {
  const v = 87, r = 36, c = 2 * Math.PI * r, off = c - (v / 100) * c;
  return (
    <div className="relative size-[96px]">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <defs>
          <linearGradient id="expGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="oklch(0.75 0.16 70)" />
            <stop offset="100%" stopColor="oklch(0.63 0.24 25)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} strokeWidth="9" stroke="oklch(0.94 0.02 295)" fill="none" />
        <circle cx="50" cy="50" r={r} strokeWidth="9" stroke="url(#expGrad)" fill="none" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold font-display leading-none">8.7</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">/10</div>
        </div>
      </div>
    </div>
  );
}

const chart = [4,6,5,7,6,8,7,9,8,10,9,11].map((v,i)=>({i,v}));

export function AIExposureIndex() {
  return (
    <div className="card-surface p-5">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">AI EXPOSURE INDEX</div>
      <div className="text-xs text-muted-foreground/80 mb-3">Overall damage assessment</div>

      <div className="flex items-center gap-4">
        <Ring />
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] flex-1">
          <div><div className="text-muted-foreground mb-1">Estimated Reach</div><div className="text-sm font-bold">2.4M</div><div className="text-[10px] text-muted-foreground">Views</div></div>
          <div><div className="text-muted-foreground mb-1">Reputation Impact</div><div className="text-sm font-bold text-rose-500">-14%</div><div className="text-[10px] text-muted-foreground">High Impact</div></div>
          <div><div className="text-muted-foreground mb-1">Trust Loss</div><div className="text-sm font-bold text-rose-500">High</div><div className="text-[10px] text-muted-foreground">Risk</div></div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm font-semibold" style={{ color: "oklch(0.63 0.24 25)" }}>High Severity</div>
        <div className="h-8 w-28">
          <ResponsiveContainer><AreaChart data={chart}>
            <Area dataKey="v" stroke="oklch(0.63 0.24 25)" strokeWidth={2} fill="oklch(0.63 0.24 25 / 0.15)" />
          </AreaChart></ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
