import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Package, Radar, Activity, Brain, ShieldCheck,
  Briefcase, Trash2, FileText, Settings, Bell, Sparkles, ChevronDown, ShieldHalf, Search, HeartPulse, Network, PlugZap, LogOut, User as UserIcon,
} from "lucide-react";
import { useUserRoles } from "@/hooks/use-user-roles";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavItem = { icon: typeof LayoutDashboard; label: string; to: string; badge?: string };

const mainNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", to: "/" },
  { icon: Package, label: "Assets", to: "/assets" },
  { icon: Search, label: "Web Scan", to: "/scan", badge: "LIVE" },
  { icon: Radar, label: "Threat Radar", to: "/threat-radar" },
  { icon: Activity, label: "Threat Monitoring", to: "/threat-monitoring" },
  { icon: Brain, label: "Evidence Analysis", to: "/intelligence" },
  { icon: Network, label: "Narrative Intelligence", to: "/narrative-intelligence" },
  { icon: ShieldCheck, label: "Enforcement", to: "/enforcement" },
  { icon: Briefcase, label: "Cases", to: "/cases" },
  { icon: Trash2, label: "Removal Center", to: "/removals" },
  { icon: FileText, label: "Reports", to: "/reports" },
];

const adminSystemNav: NavItem[] = [
  { icon: HeartPulse, label: "MM Health", to: "/admin/multimedia-health", badge: "ADMIN" },
  { icon: PlugZap, label: "Provider Activation", to: "/admin/provider-activation", badge: "ADMIN" },
];

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isAdmin } = useUserRoles();
  const { session } = useSession();
  const navigate = useNavigate();

  const user = session?.user;
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string; avatar_url?: string };
  const displayName = meta.full_name || meta.name || user?.email?.split("@")[0] || "Account";
  const email = user?.email ?? "";
  const initial = (displayName[0] ?? "?").toUpperCase();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col p-4 gap-3 text-sidebar-foreground">
      <Link to="/" className="flex items-center gap-3 px-2 pt-2 pb-2">
        <div
          className="size-10 rounded-xl grid place-items-center text-white"
          style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-glow)" }}
        >
          <ShieldHalf className="size-5" />
        </div>
        <div>
          <div className="font-display font-bold text-[15px] leading-tight tracking-tight">Eterna AI</div>
          <div className="text-[9px] tracking-[0.22em] text-sidebar-foreground/60 font-semibold">SECURITY CLOUD</div>
        </div>
      </Link>

      <NavGroup items={mainNav} pathname={pathname} />

      {isAdmin && (
        <>
          <SectionLabel>ADMIN · SYSTEM</SectionLabel>
          <NavGroup items={adminSystemNav} pathname={pathname} />
        </>
      )}

      <div className="mt-1">
        <SectionLabel>PLATFORM</SectionLabel>
        <Link
          to="/settings"
          className={navClass(pathname === "/settings")}
        >
          <Settings className="size-[18px]" /> <span className="flex-1">Settings</span>
        </Link>
      </div>

      <div className="mt-auto space-y-3">
        <div
          className="rounded-xl p-3.5 border border-sidebar-border/80"
          style={{ background: "linear-gradient(135deg, oklch(0.58 0.20 260 / 0.18), oklch(0.51 0.20 262 / 0.08))" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[13px] text-white/95">Elite Protection</div>
              <div className="text-[10px] text-sidebar-foreground/70 uppercase tracking-wider">Active</div>
            </div>
          </div>
        </div>

        <Link
          to="/notifications"
          className={`rounded-xl p-2.5 flex items-center gap-3 border ${pathname === "/notifications" ? "border-primary/40 bg-sidebar-accent" : "border-sidebar-border/60 bg-sidebar-accent/30 hover:bg-sidebar-accent/60"}`}
        >
          <Bell className="size-4" />
          <div className="flex-1 text-[13px] font-medium">Notifications</div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="w-full rounded-xl p-2 pr-3 flex items-center gap-2.5 border border-sidebar-border/60 bg-sidebar-accent/20 hover:bg-sidebar-accent/50 transition text-left">
            {meta.avatar_url ? (
              <img src={meta.avatar_url} alt={displayName} className="size-8 rounded-lg object-cover" />
            ) : (
              <div className="size-8 rounded-lg grid place-items-center text-white text-xs font-bold" style={{ background: "var(--gradient-brand)" }}>
                {initial}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">{displayName}</div>
              <div className="text-[10px] text-sidebar-foreground/60 truncate uppercase tracking-wider">{isAdmin ? "Admin" : email ? "Signed in" : ""}</div>
            </div>
            <ChevronDown className="size-3.5 text-sidebar-foreground/60 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{email || displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
              <UserIcon className="size-4 mr-2" /> Account settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
              <LogOut className="size-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] tracking-[0.22em] font-semibold text-sidebar-foreground/50 px-3 mt-2 mb-1">
      {children}
    </div>
  );
}

function navClass(active: boolean) {
  return `relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 ${
    active
      ? "bg-sidebar-accent text-white shadow-[inset_2px_0_0_0_var(--brand-glow),0_0_20px_-6px_rgba(30,123,255,0.5)]"
      : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-white hover:translate-x-0.5"
  }`;
}


function NavGroup({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((n) => {
        const Icon = n.icon;
        const active = pathname === n.to;
        return (
          <Link key={n.label} to={n.to} className={navClass(active)}>
            <Icon className={`size-[17px] ${active ? "text-brand-glow" : ""}`} />
            <span className="flex-1">{n.label}</span>
            {n.badge && (
              <span
                className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  n.badge === "LIVE"
                    ? "bg-success/20 text-success"
                    : n.badge === "ADMIN"
                    ? "bg-warning/20 text-warning"
                    : "bg-primary/25 text-brand-glow"
                }`}
              >
                {n.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
