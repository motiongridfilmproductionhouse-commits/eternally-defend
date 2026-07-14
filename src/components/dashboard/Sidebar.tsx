import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Package, Radar, Activity, Brain, ShieldCheck,
  Briefcase, Trash2, FileText, Settings, Bell, Sparkles, ChevronDown, ShieldHalf, Search, HeartPulse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

type NavItem = { icon: typeof LayoutDashboard; label: string; to: string; badge?: string };
const nav: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/" },
  { icon: Package, label: "Assets", to: "/assets" },
  { icon: Search, label: "Web Scan", to: "/scan", badge: "LIVE" },
  { icon: Radar, label: "Threat Radar", to: "/threat-radar" },
  { icon: Activity, label: "Threat Monitoring", to: "/threat-monitoring" },
  { icon: Brain, label: "Intelligence", to: "/intelligence" },
  { icon: ShieldCheck, label: "Enforcement", to: "/enforcement" },
  { icon: Briefcase, label: "Case Management", to: "/cases", badge: "2" },
  { icon: Trash2, label: "Removal Center", to: "/removals" },
  { icon: FileText, label: "Reports", to: "/reports" },
  { icon: HeartPulse, label: "MM Health", to: "/admin/multimedia-health", badge: "ADMIN" },
];

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col p-4 gap-4">
      <Link to="/" className="flex items-center gap-3 px-2 pt-2">
        <div className="size-11 rounded-2xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-elev)" }}>
          <ShieldHalf className="size-6" />
        </div>
        <div>
          <div className="font-display font-bold text-lg leading-tight">Eterna AI</div>
          <div className="text-[10px] tracking-[0.18em] text-muted-foreground font-semibold">DIGITAL PROTECTION</div>
        </div>
      </Link>

      <nav className="flex flex-col gap-1 mt-2">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = pathname === n.to;
          return (
            <Link
              key={n.label}
              to={n.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              }`}
            >
              <Icon className="size-[18px]" />
              <span className="flex-1">{n.label}</span>
              {n.badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">{n.badge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-2">
        <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground px-3 mb-1">PLATFORM</div>
        <Link
          to="/settings"
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium w-full ${pathname === "/settings" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"}`}
        >
          <Settings className="size-[18px]" /> Settings
        </Link>
      </div>

      <div className="mt-auto space-y-3">
        <div className="rounded-2xl p-4 border border-sidebar-border" style={{ background: "var(--gradient-soft)" }}>
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>
              <Sparkles className="size-5" />
            </div>
            <div>
              <div className="font-semibold text-sm">Elite Protection</div>
              <Badge variant="secondary" className="text-[10px] mt-0.5 bg-white/60">Active Plan</Badge>
            </div>
          </div>
          <Link to="/settings" className="mt-3 w-full block text-center text-sm py-2 rounded-lg bg-white/70 hover:bg-white transition font-medium">View Plan</Link>
        </div>

        <Link to="/notifications" className={`rounded-2xl p-3 flex items-center gap-3 border border-sidebar-border ${pathname === "/notifications" ? "bg-sidebar-accent" : "bg-white/60"}`}>
          <Bell className="size-5" />
          <div className="flex-1 text-sm font-semibold">Notifications</div>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">3</span>
        </Link>

        <div className="rounded-2xl p-2.5 pr-3 flex items-center gap-3 border border-sidebar-border bg-white">
          <div className="size-9 rounded-full bg-gradient-to-br from-orange-300 to-pink-400 grid place-items-center text-white text-xs font-bold">S</div>
          <div className="flex-1">
            <div className="text-sm font-semibold leading-tight">Sreehari</div>
            <div className="text-xs text-muted-foreground">Elite Plan</div>
          </div>
          <ChevronDown className="size-4 text-muted-foreground" />
        </div>
      </div>
    </aside>
  );
}
