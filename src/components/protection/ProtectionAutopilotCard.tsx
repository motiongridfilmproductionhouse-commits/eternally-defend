/**
 * Customer-facing status of continuous (automatic) protection.
 * Reads only the signed-in account's own autopilot state through the
 * owner-scoped server function — no cross-tenant data can appear here.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";

import {
  getProtectionAutopilot,
  activateProtection,
  setProtectionPaused,
} from "@/lib/protection/autopilot.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowRight,
  Facebook,
  Globe2,
  Instagram,
  MessageCircle,
  RefreshCw,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { useProtectionSummary } from "@/hooks/use-protection-summary";

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function ProtectionAutopilotCard() {
  const qc = useQueryClient();
  const fetchState = useServerFn(getProtectionAutopilot);
  const activate = useServerFn(activateProtection);
  const setPaused = useServerFn(setProtectionPaused);
  const protection = useProtectionSummary();

  const q = useQuery({
    queryKey: ["protection-autopilot"],
    queryFn: () => fetchState(),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["protection-autopilot"] });

  const activateMut = useMutation({
    mutationFn: () => activate(),
    onSuccess: (res) => {
      toast.success(
        res?.activated
          ? "Continuous protection is active."
          : (res?.reason ?? "Activation attempted."),
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => setPaused({ data: { paused } }),
    onSuccess: (res) => {
      toast.success(res?.paused ? "Automatic scanning paused." : "Automatic scanning resumed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profile = q.data?.profile as
    | { status?: string; paused?: boolean; auto_scan_enabled?: boolean; activated_at?: string | null }
    | null
    | undefined;
  const targets = (q.data?.targets ?? []) as Array<{
    id: string;
    label: string;
    target_kind: string;
    cadence_minutes: number;
    next_run_at: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    consecutive_failures?: number | null;
    active: boolean;
  }>;
  const runs = (q.data?.runs ?? []) as Array<{ started_at: string | null; status: string }>;

  const active =
    profile?.status === "ACTIVE" && !profile?.paused && profile?.auto_scan_enabled !== false;
  const activeTargets = targets.filter((t) => t.active);
  const nextRun = activeTargets
    .filter((t) => t.next_run_at)
    .map((t) => t.next_run_at as string)
    .sort()[0];
  const lastRun = runs[0]?.started_at ?? null;
  const scanning = runs.some((r) => r.status === "running");
  const backoff = activeTargets.some(
    (t) => (t.consecutive_failures ?? 0) > 0 || t.last_run_status === "failed",
  );
  const criticalCases = protection.data?.criticalCases ?? 0;
  const criticalThreats = protection.data?.criticalThreats ?? 0;
  const removalEscalations = protection.data?.takedownsSent ?? 0;
  const highAlertCount = removalEscalations > 0
    ? removalEscalations
    : criticalCases > 0
      ? criticalCases
      : criticalThreats;
  const highAlertLabel = removalEscalations > 0
    ? "threats escalated to removal"
    : criticalCases > 0
      ? "critical cases require review"
      : "high-risk findings detected";
  const sourceSignals = [
    { label: "Web", icon: Globe2 },
    { label: "Instagram", icon: Instagram },
    { label: "Facebook", icon: Facebook },
    { label: "YouTube", icon: Youtube },
    { label: "Reddit", icon: MessageCircle, clear: true },
  ];

  /*
   * Status must describe the automation, not the presence of a scan right now:
   * "waiting for the next scheduled sweep" is a healthy monitoring state and is
   * never reported as PAUSED.
   */
  const state = q.isLoading
    ? { label: "CHECKING…", tone: "muted" as const }
    : !profile
      ? { label: "NOT ACTIVATED", tone: "warn" as const }
      : profile.status !== "ACTIVE"
        ? { label: "AUTHORIZATION REQUIRED", tone: "warn" as const }
        : profile.paused || profile.auto_scan_enabled === false
          ? { label: "PAUSED", tone: "warn" as const }
          : scanning
            ? { label: "SCAN IN PROGRESS", tone: "ok" as const }
            : backoff
              ? { label: "ERROR / RETRY BACKOFF", tone: "warn" as const }
              : activeTargets.length === 0
                ? { label: "ACTIVE — NO TARGETS ENROLLED", tone: "warn" as const }
                : nextRun && new Date(nextRun).getTime() > Date.now()
                  ? { label: "ACTIVE — WAITING FOR NEXT SCAN", tone: "ok" as const }
                  : { label: "ACTIVE — MONITORING", tone: "ok" as const };

  return (
    <Card className={`autopilot-radar ${highAlertCount > 0 ? "has-alert" : ""}`}>
      {active ? <div className="autopilot-radar__beam" aria-hidden="true"><span /></div> : null}
      <div className="flex flex-wrap items-start justify-between gap-6 p-5 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={`autopilot-radar__shield ${active ? "is-active" : "is-paused"} ${highAlertCount > 0 ? "is-alert" : ""}`}
          >
            {active ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
            {active ? <span aria-hidden="true" /> : null}
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              CONTINUOUS PROTECTION
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Recurring identity &amp; asset sweeps run on their own. Evidence only — no external
              notice is ever sent automatically.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className={
                  state.tone === "ok"
                    ? "border-emerald-500/40 text-emerald-600"
                    : state.tone === "warn"
                      ? "border-amber-500/40 text-amber-600"
                      : "text-muted-foreground"
                }
              >
                {state.label}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground">
                Monitored targets: {targets.filter((t) => t.active).length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!profile || profile.status !== "ACTIVE" ? (
            <Button size="sm" onClick={() => activateMut.mutate()} disabled={activateMut.isPending}>
              <Radar className="mr-2 h-4 w-4" />
              Activate protection
            </Button>
          ) : (
            <Button
              size="sm"
              variant={profile.paused ? "default" : "outline"}
              onClick={() => pauseMut.mutate(!profile.paused)}
              disabled={pauseMut.isPending}
            >
              {profile.paused ? "Resume automatic scanning" : "Pause automatic scanning"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {highAlertCount > 0 ? (
        <div className="autopilot-radar__alert" role="alert">
          <div className="autopilot-radar__alert-icon"><AlertTriangle className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <strong>HIGH ALERT · {highAlertCount} {highAlertLabel}</strong>
            <span>Verified account data requires attention. Open the scan reports for evidence and next actions.</span>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10">
            <Link to="/reports">Investigate <ArrowRight className="ml-1 size-3.5" /></Link>
          </Button>
        </div>
      ) : null}

      {active ? (
        <div className="autopilot-radar__search" role="status">
          <Radar className="size-4" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <strong>
                {scanning
                  ? "Live sweep searching protected sources"
                  : highAlertCount > 0
                    ? "High-signal detection active"
                    : "Autonomous search standing by"}
              </strong>
              <span>{scanning ? "SCANNING" : highAlertCount > 0 ? "SIGNAL DETECTING" : "MONITORING"}</span>
            </div>
            <div className="autopilot-radar__search-track"><i /></div>
          </div>
        </div>
      ) : null}

      {active ? (
        <div className="autopilot-radar__sources" aria-label="Continuous source monitoring">
          {sourceSignals.map(({ label, icon: Icon, clear }, index) => (
            <div
              key={label}
              className={`autopilot-radar__source ${clear ? "is-clear" : highAlertCount > 0 ? "is-alert" : ""}`}
              style={{ "--signal-delay": `${index * 180}ms` } as React.CSSProperties}
            >
              <span className="autopilot-radar__source-icon">
                <Icon className="size-3.5" />
                <i aria-hidden="true" />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{clear ? "NO FINDINGS" : scanning ? "SCANNING" : highAlertCount > 0 ? "DETECTING" : "MONITORING"}</small>
              </span>
              <b aria-hidden="true"><i /></b>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-3">
        <div className={`autopilot-radar__metric ${highAlertCount > 0 ? "is-alert" : ""}`}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last sweep</p>
          <p className="mt-1 text-sm text-foreground">{fmt(lastRun)}</p>
        </div>
        <div className="autopilot-radar__metric is-next">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next sweep</p>
          <p className="mt-1 text-sm text-foreground">{active ? fmt(nextRun) : "Paused"}</p>
        </div>
        <div className="autopilot-radar__metric">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Activated
          </p>
          <p className="mt-1 text-sm text-foreground">{fmt(profile?.activated_at ?? null)}</p>
        </div>
      </div>

      {targets.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {targets.map((t) => (
            <span
              key={t.id}
              className="autopilot-radar__target"
            >
              <i className={highAlertCount > 0 ? "is-alert" : ""} aria-hidden="true" />
              {t.label} · every {Math.round(t.cadence_minutes / 60)}h
            </span>
          ))}
        </div>
      )}

      <div className="border-t px-5 py-4">
        <Link to="/reports" className="group inline-flex items-center text-xs font-semibold text-primary hover:underline">
          View scan reports <ArrowRight className="ml-1 size-3.5 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </Card>

  );
}
