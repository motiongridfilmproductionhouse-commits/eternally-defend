import { useMemo } from "react";
import { Loader2, Satellite, ShieldAlert, CheckCircle2, CircleSlash } from "lucide-react";
import {
  brightDataTelemetryFromStats,
  type BrightDataProviderStatus,
} from "@/lib/copyright/scan-activity";

export type BrightDataProviderPanelProps = {
  stats: Record<string, unknown> | null | undefined;
  scanStatus?: string | null;
  className?: string;
};

function statusTone(status: BrightDataProviderStatus): string {
  switch (status) {
    case "running":
      return "border-sky-500/50 bg-sky-500/10 text-sky-300";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "error":
      return "border-destructive/50 bg-destructive/10 text-destructive";
    case "not_configured":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    default:
      return "border-border/50 bg-background/30 text-muted-foreground";
  }
}

function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}

/**
 * Provider diagnostics for Bright Data. Shows only presence/configuration
 * metadata — never a secret value.
 */
export function BrightDataProviderPanel({
  stats,
  scanStatus,
  className,
}: BrightDataProviderPanelProps) {
  const t = useMemo(() => brightDataTelemetryFromStats(stats, scanStatus), [stats, scanStatus]);

  const metrics = [
    { label: "Requests", value: t.requests },
    { label: "Successes", value: t.successes },
    { label: "Failures", value: t.failures },
    { label: "Candidates", value: t.candidates },
    { label: "Unique URLs", value: t.uniqueUrls },
    {
      label: "Queries",
      value: t.queriesGenerated ? `${t.queriesCompleted}/${t.queriesGenerated}` : t.queriesCompleted,
    },
  ];

  const Icon =
    t.status === "running"
      ? Loader2
      : t.status === "error"
        ? ShieldAlert
        : t.status === "not_configured"
          ? CircleSlash
          : t.status === "completed"
            ? CheckCircle2
            : Satellite;

  return (
    <section
      className={`rounded-xl border border-border/60 bg-card/50 p-4 backdrop-blur ${className ?? ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg border border-primary/30 bg-primary/10">
          <Icon
            className={`h-4 w-4 text-primary ${t.status === "running" ? "animate-spin" : ""}`}
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Bright Data · discovery provider</h3>
          <p className="text-[11px] text-muted-foreground">
            Copyright Intelligence only · SERP candidates require full verification
          </p>
        </div>
        <span
          className={`ml-auto rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(t.status)}`}
        >
          {t.statusLabel}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border/40 bg-background/25 px-2.5 py-2">
            <p className="text-[10px] text-muted-foreground">{m.label}</p>
            <p className="text-sm font-semibold tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>

      <dl className="mt-3 grid gap-1.5 text-[11px] sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Configured</dt>
          <dd className="font-medium">
            {t.status === "pending" ? "—" : t.configured ? "Yes" : "No"}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">API key present</dt>
          <dd className="font-medium">
            {t.status === "pending" ? "—" : t.apiKeyPresent ? "Yes" : "No"}
          </dd>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="truncate font-mono text-[10px]">{t.endpoint ?? "—"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Zone</dt>
          <dd className="font-mono text-[10px]">{t.zone ?? "—"}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="font-medium tabular-nums">{formatDuration(t.durationMs)}</dd>
        </div>
        {t.lastQuery && (
          <div className="flex min-w-0 items-center gap-2 sm:col-span-2">
            <dt className="shrink-0 text-muted-foreground">Last query</dt>
            <dd className="truncate font-mono text-[10px]">{t.lastQuery}</dd>
          </div>
        )}
      </dl>

      {t.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Provider errors
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/90">
            {t.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
