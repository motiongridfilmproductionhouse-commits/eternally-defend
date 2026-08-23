/**
 * Customer-facing status of continuous (automatic) protection.
 * Reads only the signed-in account's own autopilot state through the
 * owner-scoped server function — no cross-tenant data can appear here.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getProtectionAutopilot,
  activateProtection,
  setProtectionPaused,
} from "@/lib/protection/autopilot.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, RefreshCw, Radar } from "lucide-react";
import { toast } from "sonner";

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
    <Card className="border-border/60 bg-card/70 p-5 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              active ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
            }`}
          >
            {active ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground">
              CONTINUOUS PROTECTION
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Recurring identity &amp; asset sweeps run on their own. Evidence only — no external
              notice is ever sent automatically.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <span className="text-[11px] text-muted-foreground">
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

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last sweep</p>
          <p className="mt-1 text-sm text-foreground">{fmt(lastRun)}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next sweep</p>
          <p className="mt-1 text-sm text-foreground">{active ? fmt(nextRun) : "Paused"}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Activated
          </p>
          <p className="mt-1 text-sm text-foreground">{fmt(profile?.activated_at ?? null)}</p>
        </div>
      </div>

      {targets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((t) => (
            <span
              key={t.id}
              className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground"
            >
              {t.label} · every {Math.round(t.cadence_minutes / 60)}h
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Link to="/reports" className="text-xs font-semibold text-primary hover:underline">
          View scan reports →
        </Link>
      </div>
    </Card>

  );
}
