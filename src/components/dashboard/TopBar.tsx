import { useRouterState, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  Bell,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  FlaskConical,
} from "lucide-react";
import { AuthorizationBadge } from "@/components/AuthorizationBadge";
import { useSession } from "@/hooks/use-session";
import { useSidebarLayout } from "@/lib/layout-context";
import { getNotifications } from "@/lib/command-center.functions";
import { useProtectionSummary } from "@/hooks/use-protection-summary";
import { pageMetaFor } from "@/lib/navigation/page-meta";
import type { ProtectionSummary } from "@/lib/protection-summary.functions";

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const DEMO_USER_EMAIL = (import.meta.env.VITE_DEMO_USER_EMAIL ?? "").trim().toLowerCase();

export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const meta = pageMetaFor(pathname);
  const { session } = useSession();

  const summaryQuery = useProtectionSummary();
  const summary = summaryQuery.data;

  const { hidden, toggleHidden } = useSidebarLayout();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 px-8 py-5 bg-background/80 backdrop-blur border-b border-border">
      <button
        onClick={toggleHidden}
        title={hidden ? "Show sidebar (⌘/Ctrl+B)" : "Hide sidebar (⌘/Ctrl+B)"}
        aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
        className="size-9 grid place-items-center rounded-lg border border-border bg-card hover:border-primary/30 transition text-foreground/70"
      >
        {hidden ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
      </button>
      <div className="min-w-0">
        <h1 className="text-[22px] font-display font-bold tracking-tight text-foreground">
          {meta.title}
        </h1>
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

      <StatusPill summary={summary} loading={summaryQuery.isLoading} />
      <AuthorizationBadge />

      <NotificationsBell />
      {DEMO_MODE && session?.user.email?.toLowerCase() === DEMO_USER_EMAIL && <DemoBadge />}
    </header>
  );
}

function DemoBadge() {
  return (
    <div
      title="Demo Mode active — onboarding bypassed for this account only"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/60 bg-amber-400/10 text-amber-400 text-[11px] font-bold uppercase tracking-widest animate-pulse select-none"
    >
      <FlaskConical className="size-3.5 shrink-0" />
      Demo Mode
    </div>
  );
}

function NotificationsBell() {
  const fetchNotes = useServerFn(getNotifications);
  const { session, ready } = useSession();
  const q = useQuery({
    queryKey: ["notifications-badge", session?.user.id ?? "anon"],
    queryFn: () => fetchNotes(),
    enabled: ready && !!session,
    refetchInterval: 60_000,
  });

  const unread = q.data?.unread ?? 0;
  return (
    <Link
      to="/notifications"
      className="relative size-10 grid place-items-center rounded-xl border border-border bg-card hover:border-primary/30 transition shadow-sm"
    >
      <Bell className="size-4 text-foreground/70" />
      {unread > 0 && (
        <span className="alert-edge absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

const STATUS_STYLES = {
  protected: { color: "text-success", bg: "bg-success/15 border-success/30", icon: ShieldCheck },
  monitoring: { color: "text-info", bg: "bg-info/15 border-info/30", icon: ShieldQuestion },
  "at-risk": { color: "text-warning", bg: "bg-warning/15 border-warning/30", icon: ShieldAlert },
  critical: { color: "text-danger", bg: "bg-danger/15 border-danger/40", icon: ShieldAlert },
  unknown: {
    color: "text-muted-foreground",
    bg: "bg-muted/40 border-border",
    icon: ShieldQuestion,
  },
} as const;

/**
 * "ACTION REQUIRED" used to be a dead label derived from an unrelated query.
 * It now reads the shared protection summary, explains what is wrong on hover,
 * and links to the first surface that can clear it.
 */
function StatusPill({
  summary,
  loading,
}: {
  summary: ProtectionSummary | undefined;
  loading: boolean;
}) {
  const level = summary?.level ?? "unknown";
  const c = STATUS_STYLES[level];
  const Icon = c.icon;
  const items = summary?.actionRequired ?? [];
  const target = items[0]?.to ?? "/";
  const tooltip =
    items.length > 0
      ? items.map((i) => `• ${i.label} — ${i.detail}`).join("\n")
      : summary
        ? "No outstanding actions on this account."
        : "Loading protection posture…";

  const body = (
    <>
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      <span className="uppercase tracking-wider">{summary?.label ?? "Loading"}</span>
      {items.length > 0 && (
        <span className="ml-0.5 rounded-full bg-current/20 px-1.5 text-[10px] font-bold">
          {items.length}
        </span>
      )}
    </>
  );

  const alertEdge = level === "critical" || level === "at-risk" || items.length > 0 ? "alert-edge" : "";
  const cls = `inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] font-semibold ${c.bg} ${c.color} ${alertEdge}`;

  if (items.length === 0) {
    return (
      <div className={cls} title={tooltip}>
        {body}
      </div>
    );
  }
  return (
    <Link to={target} title={tooltip} className={`${cls} hover:brightness-110 transition`}>
      {body}
    </Link>
  );
}
