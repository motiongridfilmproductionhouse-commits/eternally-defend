import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getDashboardStats } from "@/lib/mm/dashboard.functions";
import { useSession } from "@/hooks/use-session";

const TAG_COLOR: Record<string, string> = {
  Critical: "oklch(0.63 0.24 25)",
  High: "oklch(0.7 0.2 35)",
  Medium: "oklch(0.75 0.16 70)",
  Low: "oklch(0.68 0.16 155)",
};

export function TopActiveThreats() {
  const fn = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => fn({}),
    refetchInterval: 30_000,
  });
  const items = data?.topThreats ?? [];

  return (
    <div className="card-surface p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">TOP ACTIVE THREATS</div>
        <Link to="/intelligence" className="text-xs font-semibold text-primary">View All</Link>
      </div>
      <div className="text-xs text-muted-foreground/80 mb-4">By severity</div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">
          No active threats detected.
          <br />
          <Link to="/intelligence" className="text-primary font-semibold">Start an analysis →</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((t, i) => {
            const color = TAG_COLOR[t.tag] ?? "oklch(0.68 0.16 155)";
            return (
              <div key={t.jobId} className="flex items-center gap-3">
                <div
                  className="size-6 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: color }}
                >
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold leading-tight truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.platform}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold" style={{ color }}>{t.score.toFixed(1)}</div>
                  <div className="text-[10px] text-muted-foreground">{t.tag}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
