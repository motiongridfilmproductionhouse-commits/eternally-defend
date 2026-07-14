import { useRouterState } from "@tanstack/react-router";
import { Search, Sparkles, Bell, MoreVertical, ChevronDown } from "lucide-react";
import { AuthorizationBadge } from "@/components/AuthorizationBadge";


const titles: Record<string, { title: string; sub: string }> = {
  "/": { title: "Protection Command Center", sub: "Real-time reputation protection & threat intelligence" },
  "/assets": { title: "Protected Assets", sub: "Register, monitor, and manage your digital assets" },
  "/threat-radar": { title: "Threat Radar", sub: "Live scanning of surface, deep, and social web" },
  "/threat-monitoring": { title: "Threat Monitoring", sub: "Continuous AI monitoring across platforms" },
  "/intelligence": { title: "Intelligence", sub: "AI insights and predictive risk analytics" },
  "/enforcement": { title: "Enforcement", sub: "Automated actions and takedown workflows" },
  "/cases": { title: "Case Management", sub: "Track and coordinate active protection cases" },
  "/removals": { title: "Removal Center", sub: "Submitted takedowns and removal status" },
  "/reports": { title: "Reports", sub: "Exportable protection and enforcement reports" },
  "/settings": { title: "Settings", sub: "Account, plan, security, and preferences" },
  "/notifications": { title: "Notifications", sub: "Alerts, mentions, and system messages" },
};

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = titles[pathname] ?? titles["/"];
  return (
    <header className="flex items-center gap-4 px-6 py-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-display font-bold tracking-tight">{meta.title}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{meta.sub}</p>
      </div>
      <div className="flex-1 max-w-xl ml-auto">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            placeholder="Search assets, cases, URLs, identities..."
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-card border border-border text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      <AuthorizationBadge />
      <button className="flex items-center gap-2 px-4 py-3 rounded-2xl border border-border bg-card text-sm font-semibold hover:bg-accent transition">
        <Sparkles className="size-4 text-primary" /> Quick Action <ChevronDown className="size-4 text-muted-foreground" />
      </button>

      <button className="relative size-11 grid place-items-center rounded-2xl border border-border bg-card">
        <Bell className="size-[18px]" />
      </button>

      <button className="size-11 grid place-items-center rounded-2xl border border-border bg-card">
        <MoreVertical className="size-[18px]" />
      </button>
    </header>
  );
}
