import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";

function Ring({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(10, value));
  const pct = (clamped / 10) * 100;
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
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
          <div className="text-2xl font-bold font-display leading-none">{clamped.toFixed(1)}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">/10</div>
        </div>
      </div>
    </div>
  );
}

function formatReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function AIExposureIndex() {
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    refetchInterval: 30_000,
  });
  const e = data?.exposure;
  const chart = Array.from({ length: 12 }, (_, i) => ({ i, v: (e?.score ?? 0) + Math.sin(i / 2) * 0.6 }));

  return (
    <div className="card-surface p-5 flex flex-col">
      <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">AI EXPOSURE INDEX</div>
      <div className="text-xs text-muted-foreground/80 mb-4">Overall damage assessment</div>

      <div className="flex flex-col items-center gap-3">
        <Ring value={e?.score ?? 0} />
        <div className="text-sm font-semibold" style={{ color: "oklch(0.63 0.24 25)" }}>
          {isLoading ? "…" : e?.severityLabel ?? "No Data"}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground truncate">Est. Reach</div>
          <div className="text-sm font-bold mt-1">{formatReach(e?.reach ?? 0)}</div>
          <div className="text-[10px] text-muted-foreground truncate">Views</div>
        </div>
        <div className="min-w-0 border-x border-border">
          <div className="text-[10px] text-muted-foreground truncate">Rep. Impact</div>
          <div className="text-sm font-bold text-rose-500 mt-1">{(e?.reputationImpact ?? 0) > 0 ? "+" : ""}{e?.reputationImpact ?? 0}%</div>
          <div className="text-[10px] text-muted-foreground truncate">vs. baseline</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground truncate">Trust Loss</div>
          <div className="text-sm font-bold text-rose-500 mt-1">{e?.trustLoss ?? "None"}</div>
          <div className="text-[10px] text-muted-foreground truncate">Risk</div>
        </div>
      </div>

      <div className="mt-4 h-10 w-full">
        <ResponsiveContainer>
          <AreaChart data={chart}>
            <Area dataKey="v" stroke="oklch(0.63 0.24 25)" strokeWidth={2} fill="oklch(0.63 0.24 25 / 0.15)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
