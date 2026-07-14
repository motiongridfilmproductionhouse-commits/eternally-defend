import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, Bell, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from "lucide-react";
import { AuthorizationBadge } from "@/components/AuthorizationBadge";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";

const titles: Record<string, { title: string; sub: string }> = {
  "/": { title: "Protection Command Center", sub: "Real-time reputation protection & threat intelligence" },
  "/assets": { title: "Protected Assets", sub: "Register, monitor and manage your digital assets" },
  "/scan": { title: "Web Scan", sub: "Deep, surface and social web reconnaissance" },
  "/threat-radar": { title: "Threat Radar", sub: "Live threat stream across every monitored surface" },
  "/threat-monitoring": { title: "Threat Monitoring", sub: "Continuous AI monitoring across platforms" },
  "/intelligence": { title: "Evidence Analysis", sub: "AI insights and predictive risk analytics" },
  "/narrative-intelligence": { title: "Narrative Intelligence", sub: "Coordinated claims and narrative spread" },
  "/enforcement": { title: "Enforcement Center", sub: "Automated takedowns, reports and legal escalations" },
  "/cases": { title: "Case Management", sub: "Track and coordinate active protection cases" },
  "/removals": { title: "Removal Center", sub: "Submitted takedowns and removal status" },
  "/reports": { title: "Reports", sub: "Exportable protection and enforcement reports" },
  "/settings": { title: "Settings", sub: "Account, plan, security and preferences" },
  "/notifications": { title: "Notifications", sub: "Alerts, mentions and system messages" },
};

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = titles[pathname] ?? titles["/"];
  const { session, ready } = useSession();
  const userId = session?.user.id;

  const statusQuery = useQuery({
    queryKey: ["protection-status", userId],
    enabled: ready && !!userId,
    queryFn: async () => {
      const [assets, threats, cases] = await Promise.all([
        supabase.from("protected_assets").select("id", { count: "exact", head: true }),
        supabase.from("scan_hits").select("id", { count: "exact", head: true }).in("severity", ["Critical", "High"] as never),
        supabase.from("cases").select("id", { count: "exact", head: true }).eq("status", "open" as never),
      ]);
      return {
        assets: assets.count ?? 0,
        criticalThreats: threats.count ?? 0,
        openCases: cases.count ?? 0,
      };
    },
  });

  const status = protectionStatus(statusQuery.data);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 px-8 py-5 bg-background/80 backdrop-blur border-b border-border">
      <div className="min-w-0">
        <h1 className="text-[22px] font-display font-bold tracking-tight text-foreground">{meta.title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{meta.sub}</p>
      </div>

      <div className="flex-1 max-w-xl ml-auto">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            placeholder="Search assets, threats, cases, URLs…"
            className="w-full pl-11 pr-4 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition shadow-sm"
          />
        </div>
      </div>

      <StatusPill status={status} loading={statusQuery.isLoading} />
      <AuthorizationBadge />

      <button className="relative size-10 grid place-items-center rounded-xl border border-border bg-card hover:border-primary/30 transition shadow-sm">
        <Bell className="size-4 text-foreground/70" />
        {status.level === "critical" && (
          <span className="absolute top-2 right-2 size-2 rounded-full bg-danger animate-pulse" />
        )}
      </button>
    </header>
  );
}


type Status = { level: "protected" | "monitoring" | "at-risk" | "critical" | "unknown"; label: string };

function protectionStatus(data: { assets: number; criticalThreats: number; openCases: number } | undefined): Status {
  if (!data) return { level: "unknown", label: "Loading" };
  if (data.criticalThreats > 5 || data.openCases > 3) return { level: "critical", label: "Action Required" };
  if (data.criticalThreats > 0 || data.openCases > 0) return { level: "at-risk", label: "At Risk" };
  if (data.assets > 0) return { level: "protected", label: "Protected" };
  return { level: "monitoring", label: "Monitoring" };
}

function StatusPill({ status, loading }: { status: Status; loading: boolean }) {
  const map = {
    protected: { color: "text-success", bg: "bg-success/15 border-success/30", icon: ShieldCheck },
    monitoring: { color: "text-info", bg: "bg-info/15 border-info/30", icon: ShieldQuestion },
    "at-risk": { color: "text-warning", bg: "bg-warning/15 border-warning/30", icon: ShieldAlert },
    critical: { color: "text-danger", bg: "bg-danger/15 border-danger/40", icon: ShieldAlert },
    unknown: { color: "text-muted-foreground", bg: "bg-muted/40 border-border", icon: ShieldQuestion },
  } as const;
  const c = map[status.level];
  const Icon = c.icon;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] font-semibold ${c.bg} ${c.color}`}>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      <span className="uppercase tracking-wider">{status.label}</span>
    </div>
  );
}
