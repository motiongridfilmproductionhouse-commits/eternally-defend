import { Shield, AlertTriangle, Clock, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";

interface Counts {
  assets: number;
  criticalCases: number;
  takedowns: number;
}

function ReputationRing({ value }: { value: number | null }) {
  const v = value ?? 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
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
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-3xl font-bold font-display leading-none">{value === null ? "—" : v}</div>
          <div className="text-[10px] text-muted-foreground mt-1">/100</div>
        </div>
      </div>
    </div>
  );
}

export function StatsRow() {
  const { session } = useSession();
  const enabled = !!session;

  const dashFn = useServerFn(getDashboardStats);
  const dash = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => dashFn({}),
    enabled,
    refetchInterval: 30_000,
  });

  const counts = useQuery({
    queryKey: ["stats-row-counts", session?.user.id],
    enabled,
    queryFn: async (): Promise<Counts> => {
      const [assetsRes, casesRes, takedownsRes] = await Promise.all([
        supabase.from("protected_assets").select("id", { count: "exact", head: true }),
        supabase.from("cases").select("id", { count: "exact", head: true }).in("status", ["Open", "In Progress", "Escalated"]).in("priority", ["Critical", "High"]),
        supabase.from("enforcement_requests").select("id", { count: "exact", head: true }).neq("status", "Queued"),
      ]);
      return {
        assets: assetsRes.count ?? 0,
        criticalCases: casesRes.count ?? 0,
        takedowns: takedownsRes.count ?? 0,
      };
    },
    refetchInterval: 30_000,
  });

  const activeThreats = dash.data?.totals.findings ?? 0;
  const reputation = dash.data?.exposure.score != null && dash.data.totals.findings > 0
    ? Math.max(0, Math.min(100, Math.round(100 - dash.data.exposure.score * 10)))
    : null;

  const stats: { icon: typeof Shield; label: string; value: string | number; sub: string; color: string }[] = [
    { icon: Shield, label: "PROTECTED ASSETS", value: counts.data?.assets ?? 0, sub: "Assets registered", color: "#A78BFA" },
    { icon: AlertTriangle, label: "ACTIVE THREATS", value: activeThreats, sub: "Findings across platforms", color: "#F87171" },
    { icon: Clock, label: "CRITICAL CASES", value: counts.data?.criticalCases ?? 0, sub: "High-priority cases open", color: "#FB923C" },
    { icon: Send, label: "TAKEDOWNS SENT", value: counts.data?.takedowns ?? 0, sub: "Submitted requests", color: "#3B82F6" },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-5">
      <div className="card-surface p-5 flex flex-col items-center">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">REPUTATION SCORE</div>
        <div className="my-2"><ReputationRing value={reputation} /></div>
        <div className="text-sm font-semibold" style={{ color: "oklch(0.55 0.22 295)" }}>
          {reputation === null ? "No data yet" : reputation >= 80 ? "Excellent" : reputation >= 60 ? "Healthy" : reputation >= 40 ? "At Risk" : "Critical"}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {reputation === null ? "Run your first scan" : `From ${dash.data?.totals.findings ?? 0} findings`}
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
            </div>
            <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
