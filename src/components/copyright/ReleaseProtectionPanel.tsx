import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Loader2, Pause, Play, Radar, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getReleaseProtection,
  pauseReleaseProtection,
  runReleaseProtectionNow,
} from "@/lib/copyright/release-protection.functions";
import {
  daysUntilRelease,
  formatCadenceLabel,
  MONITORING_DISCLAIMER,
  type ReleaseProtectionSettings,
} from "@/lib/copyright/release-protection";

export function ReleaseProtectionPanel({ protectionId }: { protectionId?: string }) {
  const getFn = useServerFn(getReleaseProtection);
  const pauseFn = useServerFn(pauseReleaseProtection);
  const runFn = useServerFn(runReleaseProtectionNow);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["release-protection", protectionId ?? "all"],
    queryFn: () => getFn({ data: protectionId ? { protectionId } : {} }),
    refetchInterval: 30_000,
  });

  const pause = useMutation({
    mutationFn: (v: { protectionId: string; paused: boolean }) => pauseFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["release-protection"] }),
  });

  const runNow = useMutation({
    mutationFn: (protectionId: string) => runFn({ data: { protectionId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["release-protection"] }),
  });

  const protection = (query.data?.protections ?? [])[0] as
    | {
        id: string;
        title: string;
        settings: ReleaseProtectionSettings;
        readiness_score: number;
        readiness_level: string;
        paused: boolean;
        monitoring_start_at: string | null;
        monitoring_end_at: string | null;
        next_scan_at: string | null;
        last_scan_at: string | null;
        stats: Record<string, unknown>;
      }
    | undefined;

  if (query.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading release protection…
      </p>
    );
  }

  if (!protection) {
    return (
      <section className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Shield className="h-4 w-4 text-primary" />
          Release Protection
        </p>
        <p className="mt-2 text-xs">
          Enable automatic release protection when registering a protected work to schedule
          public-source monitoring around the release date. {MONITORING_DISCLAIMER}
        </p>
      </section>
    );
  }

  const settings = protection.settings;
  const countdownDays = settings.release_date ? daysUntilRelease(settings.release_date) : null;
  const cadenceMinutes =
    typeof protection.stats.cadence_minutes === "number" ? protection.stats.cadence_minutes : null;
  const runs = query.data?.runs ?? [];
  const incidents = query.data?.incidents ?? [];
  const verified = incidents.filter((i) =>
    ["critical", "high"].includes(String((i as { risk_level?: string }).risk_level)),
  );

  return (
    <section className="space-y-4 rounded-xl border border-primary/25 bg-card/50 p-4 backdrop-blur">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            Release Protection · {protection.title}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{MONITORING_DISCLAIMER}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pause.isPending}
            onClick={() =>
              pause.mutate({ protectionId: protection.id, paused: !protection.paused })
            }
          >
            {protection.paused ? (
              <Play className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Pause className="mr-1 h-3.5 w-3.5" />
            )}
            {protection.paused ? "Resume" : "Pause"}
          </Button>
          <Button
            size="sm"
            disabled={runNow.isPending || protection.paused}
            onClick={() => runNow.mutate(protection.id)}
          >
            {runNow.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Radar className="mr-1 h-3.5 w-3.5" />
            )}
            Run now
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Release countdown"
          value={
            countdownDays == null
              ? "—"
              : countdownDays > 0
                ? `${countdownDays}d before`
                : countdownDays === 0
                  ? "Release day"
                  : `${Math.abs(countdownDays)}d after`
          }
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <Metric
          label="Monitoring status"
          value={protection.paused ? "Paused" : settings.enabled ? "Active" : "Disabled"}
        />
        <Metric
          label="Current cadence"
          value={cadenceMinutes ? formatCadenceLabel(cadenceMinutes) : "—"}
        />
        <Metric
          label="Readiness"
          value={`${protection.readiness_score}% · ${protection.readiness_level.replace(/_/g, " ")}`}
        />
      </div>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <p>Monitoring starts: {formatTs(protection.monitoring_start_at)}</p>
        <p>Monitoring ends: {formatTs(protection.monitoring_end_at)}</p>
        <p>Last completed scan: {formatTs(protection.last_scan_at)}</p>
        <p>Next scheduled scan: {formatTs(protection.next_scan_at)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total scans" value={runs.length} />
        <Stat label="Verified incidents" value={verified.length} />
        <Stat
          label="Pre-release incidents"
          value={
            incidents.filter(
              (i) => (i as { release_timing?: string }).release_timing === "pre_release",
            ).length
          }
        />
        <Stat
          label="Candidates (last run)"
          value={
            runs[0] ? String((runs[0] as { candidates_found?: number }).candidates_found ?? 0) : "0"
          }
        />
      </div>

      {incidents.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent incidents (review required)
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {incidents.slice(0, 8).map((row) => {
              const inc = row as {
                id: string;
                source_url: string;
                risk_level: string;
                incident_type: string;
                first_seen_at: string;
              };
              return (
                <li
                  key={inc.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/40 bg-background/30 px-2 py-1.5"
                >
                  <span className="truncate">{inc.source_url}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {inc.risk_level}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/20 px-2.5 py-2 text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function formatTs(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
