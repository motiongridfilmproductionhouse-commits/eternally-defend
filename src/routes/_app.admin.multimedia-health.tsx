import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMultimediaHealth, testAllMultimediaProviders, testOneProvider } from "@/lib/mm/health.functions";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, CheckCircle2, Clock, PlayCircle, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";

export const Route = createFileRoute("/_app/admin/multimedia-health")({
  head: () => ({ meta: [{ title: "Multimedia Health — Eterna AI" }] }),
  component: HealthPage,
});

const STATUS_STYLE: Record<string, { label: string; cls: string; icon: any }> = {
  active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
  stubbed: { label: "Stubbed", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30", icon: ShieldAlert },
  misconfigured: { label: "Misconfigured", cls: "bg-red-500/10 text-red-600 border-red-500/30", icon: XCircle },
  disabled: { label: "Disabled", cls: "bg-muted text-muted-foreground border-border", icon: Clock },
  quota_limited: { label: "Quota limited", cls: "bg-orange-500/10 text-orange-600 border-orange-500/30", icon: AlertTriangle },
  temporarily_unavailable: { label: "Unavailable", cls: "bg-red-500/10 text-red-600 border-red-500/30", icon: AlertTriangle },
  up: { label: "Up", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
  down: { label: "Down", cls: "bg-red-500/10 text-red-600 border-red-500/30", icon: XCircle },
  unknown: { label: "Unknown", cls: "bg-muted text-muted-foreground border-border", icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.unknown;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.cls}`}>
      <Icon className="size-3" /> {s.label}
    </span>
  );
}

function HealthPage() {
  const qc = useQueryClient();
  const healthFn = useServerFn(getMultimediaHealth);
  const testAllFn = useServerFn(testAllMultimediaProviders);
  const testOneFn = useServerFn(testOneProvider);

  const q = useQuery({ queryKey: ["mm-health"], queryFn: () => healthFn(), retry: 0 });

  const testAll = useMutation({
    mutationFn: () => testAllFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mm-health"] }),
  });
  const testOne = useMutation({
    mutationFn: (provider: string) => testOneFn({ data: { provider } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mm-health"] }),
  });

  if (q.isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (q.isError) {
    return (
      <PageCard title="ADMIN ACCESS REQUIRED" sub="Multimedia Health is restricted to users with the admin role">
        <div className="py-8 text-center">
          <ShieldAlert className="size-10 mx-auto text-amber-500" />
          <p className="mt-3 text-sm">{(q.error as Error).message}</p>
          <p className="mt-2 text-xs text-muted-foreground">Ask a workspace admin to grant your account the <code className="bg-muted px-1 rounded">admin</code> role in <code className="bg-muted px-1 rounded">user_roles</code>.</p>
        </div>
      </PageCard>
    );
  }
  const data = q.data!;
  const providers = data.providers as any[];
  const stats = data.stats as Record<string, any>;
  const limits = data.limits as any;
  const usage = data.usageTotals as any;

  return (
    <div className="space-y-5">
      <PageCard title="MULTIMEDIA INTELLIGENCE HEALTH" sub="Live provider status, self-tests, quota and cost snapshot"
        actions={
          <Button onClick={() => testAll.mutate()} disabled={testAll.isPending}>
            <PlayCircle className="size-4 mr-2" />
            {testAll.isPending ? "Running…" : "Run Provider Health Check"}
          </Button>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="ANALYSES TODAY" value={usage.analyses} sub={`Limit ${limits.dailyAnalysisLimit}/day`} accent="oklch(0.65 0.18 260)" />
          <StatCard label="TODAY'S SPEND" value={`$${(usage.cost_cents / 100).toFixed(2)}`} sub={`Cap $${limits.monthlyCostLimitUsd}/month`} accent="oklch(0.65 0.17 155)" />
          <StatCard label="API CALLS TODAY" value={usage.api_calls} sub="All providers combined" accent="oklch(0.72 0.14 70)" />
          <StatCard label="MAX UPLOAD" value={`${limits.maxUploadMb} MB`} sub={`Video ≤ ${limits.maxVideoMinutes} min · retention ${limits.evidenceRetentionDays}d`} accent="oklch(0.6 0.2 30)" />
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left p-2">Provider</th>
                <th className="text-left p-2">Mode</th>
                <th className="text-left p-2">Feature flag</th>
                <th className="text-left p-2">Credential</th>
                <th className="text-left p-2">Availability</th>
                <th className="text-left p-2">Success 24h</th>
                <th className="text-left p-2">Avg latency</th>
                <th className="text-left p-2">Errors 24h</th>
                <th className="text-left p-2">Last OK</th>
                <th className="text-left p-2">Last fail</th>
                <th className="text-right p-2">Test</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const s = stats[p.key] ?? {};
                return (
                  <tr key={p.key} className="border-t border-border">
                    <td className="p-2 font-medium">{p.label}</td>
                    <td className="p-2 text-xs"><Badge variant="outline">{p.mode}</Badge></td>
                    <td className="p-2 text-[11px] text-muted-foreground font-mono">{p.flag}</td>
                    <td className="p-2 text-xs">
                      {p.credential === "configured"
                        ? <span className="text-emerald-600">Configured</span>
                        : <span className="text-amber-600">Missing</span>}
                    </td>
                    <td className="p-2"><StatusBadge status={s.currentAvailability ?? "unknown"} /></td>
                    <td className="p-2 text-xs">{s.successRate === null ? "—" : `${s.successRate}%`}</td>
                    <td className="p-2 text-xs">{s.avgLatencyMs === null ? "—" : `${s.avgLatencyMs} ms`}</td>
                    <td className="p-2 text-xs">{s.errorCount ?? 0}</td>
                    <td className="p-2 text-xs text-muted-foreground">{s.lastSuccessAt ? new Date(s.lastSuccessAt).toLocaleString() : "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{s.lastFailureAt ? new Date(s.lastFailureAt).toLocaleString() : "—"}</td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => testOne.mutate(p.key)}
                        disabled={testOne.isPending}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-accent inline-flex items-center gap-1"
                      >
                        <Activity className="size-3" /> Test
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(testAll.data || testOne.data) && (
          <div className="mt-4 text-xs text-muted-foreground">
            <ShieldCheck className="inline size-3.5 mr-1 text-emerald-500" />
            Latest test recorded. Refresh will show updated statistics.
          </div>
        )}
      </PageCard>

      <PageCard title="ENVIRONMENT LIMITS" sub="Set MM_* environment variables to override">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          {[
            ["MM_MAX_VIDEO_MINUTES", `${limits.maxVideoMinutes} min`],
            ["MM_MAX_UPLOAD_MB", `${limits.maxUploadMb} MB`],
            ["MM_DAILY_ANALYSIS_LIMIT", `${limits.dailyAnalysisLimit} / day`],
            ["MM_MONTHLY_COST_LIMIT_USD", `$${limits.monthlyCostLimitUsd}`],
            ["MM_EVIDENCE_RETENTION_DAYS", `${limits.evidenceRetentionDays} days`],
          ].map(([k, v]) => (
            <div key={k} className="border border-border rounded-lg p-3">
              <div className="font-mono text-[10px] text-muted-foreground">{k}</div>
              <div className="mt-1 font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </PageCard>
    </div>
  );
}
