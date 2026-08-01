import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getDistributionMonitor,
  runDistributionMonitorNow,
  setDistributionSourceMonitoring,
} from "@/lib/copyright/distribution-monitor.functions";
import {
  monitoredSourceAttribution,
  PREVIOUSLY_MONITORED_SOURCES_LABEL,
} from "@/lib/copyright/scan-scope";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Radar, RefreshCw, ExternalLink, AlertTriangle, Loader2, Pause, Play,
  Globe, Send, MessageSquare, Server, Files, Magnet, Clock, ShieldAlert,
} from "lucide-react";

const RISK: Record<string, string> = {
  high: "bg-red-600/15 text-red-400 border-red-600/40",
  medium: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
};

const KIND_ICON: Record<string, typeof Globe> = {
  website: Globe,
  mirror_domain: Server,
  telegram_channel: Send,
  discord_server: MessageSquare,
  reddit_community: MessageSquare,
  forum: MessageSquare,
  file_sharing: Files,
  torrent_index: Magnet,
  video_platform: Globe,
};

const TIMING_LABEL: Record<string, string> = {
  same_day: "Same-day leak",
  next_day: "+1 day",
  first_week: "First week",
  first_month: "First month",
  later: "Post-window",
  unknown: "Unknown timing",
};

const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

/**
 * Global previously-monitored sources panel.
 * NEVER presents these rows as findings for the currently selected scan.
 */
export function DistributionMonitorPanel() {
  const listFn = useServerFn(getDistributionMonitor);
  const runFn = useServerFn(runDistributionMonitorNow);
  const toggleFn = useServerFn(setDistributionSourceMonitoring);
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const monitor = useQuery({
    queryKey: ["distribution-monitor"],
    queryFn: () => listFn({}),
    refetchInterval: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["distribution-monitor"] });

  const sweep = useMutation({
    mutationFn: (v: { sourceId?: string }) => runFn({ data: v }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`${r.checked} source(s) re-crawled · ${r.incidents} new incident(s)`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (v: { sourceId: string; monitorEnabled: boolean }) => toggleFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const allSources = monitor.data?.sources ?? [];
  // Active monitor never shows deactivated YouTube/Plex FPs — audit rows remain in DB only.
  const sources = useMemo(
    () => allSources.filter((s) => s.status !== "deactivated"),
    [allSources],
  );
  const incidents = (monitor.data?.incidents ?? []).filter((i) => {
    const ev = (i.evidence ?? {}) as Record<string, unknown>;
    return ev.active !== false;
  });
  const runs = monitor.data?.runs ?? [];
  const stats = monitor.data?.stats;

  const runsBySource = useMemo(() => {
    const map = new Map<string, typeof runs>();
    for (const r of runs) {
      const list = map.get(r.source_id) ?? [];
      list.push(r);
      map.set(r.source_id, list);
    }
    return map;
  }, [runs]);

  const incidentsBySource = useMemo(() => {
    const map = new Map<string, typeof incidents>();
    for (const i of incidents) {
      const list = map.get(i.source_id) ?? [];
      list.push(i);
      map.set(i.source_id, list);
    }
    return map;
  }, [incidents]);

  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border/70 bg-background/20 p-4">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
            <Radar className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{PREVIOUSLY_MONITORED_SOURCES_LABEL}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Global history across prior scans — not findings for the selected scan.
              Each source shows the work/title and originating scan that registered it.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => sweep.mutate({})} disabled={sweep.isPending}>
            {sweep.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Run monitor now
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Sources", value: stats?.total ?? 0 },
          { label: "High risk", value: stats?.high ?? 0 },
          { label: "Status active", value: stats?.active ?? 0 },
          { label: "Auto-monitored", value: stats?.monitored ?? 0 },
          { label: "Incidents (24h)", value: stats?.incidents24h ?? 0 },
          { label: "Deactivated", value: stats?.deactivated ?? 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border/50 bg-background/30 p-3">
            <div className="text-lg font-semibold">{s.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {monitor.isLoading && (
        <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Loading monitored sources…</p>
      )}
      {!monitor.isLoading && !sources.length && (
        <p className="text-sm text-muted-foreground">
          No previously monitored unauthorized distribution sources. Sources are added only when a scan finds hard
          distribution evidence for a specific work.
        </p>
      )}

      <div className="space-y-3">
        {sources.map((s) => {
          const Icon = KIND_ICON[s.source_kind] ?? Globe;
          const ev = (s.evidence ?? {}) as Record<string, unknown>;
          const timing = (ev.release_timing as string) ?? "unknown";
          const links = (ev.distribution_links as string[] | undefined) ?? [];
          const indicators = (s.indicators as string[] | null) ?? [];
          const open = openId === s.id;
          const srcRuns = runsBySource.get(s.id) ?? [];
          const srcIncidents = incidentsBySource.get(s.id) ?? [];
          const attribution = monitoredSourceAttribution(s);
          const deactivated = s.status === "deactivated";

          return (
            <article key={s.id} className={`overflow-hidden rounded-xl border border-border/60 bg-card/40 backdrop-blur ${deactivated ? "opacity-60" : ""}`}>
              <div className="flex flex-col gap-3 p-4 md:flex-row">
                {s.screenshot_url ? (
                  <img
                    src={s.screenshot_url}
                    alt={`Evidence screenshot of ${s.domain}`}
                    loading="lazy"
                    className="h-28 w-full shrink-0 rounded-lg border border-border/50 object-cover object-top md:w-48"
                  />
                ) : (
                  <div className="grid h-28 w-full shrink-0 place-items-center rounded-lg border border-dashed border-border/50 bg-background/30 text-[11px] text-muted-foreground md:w-48">
                    No screenshot
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-semibold">{s.domain}</span>
                    <Badge variant="outline" className={`text-[10px] uppercase ${RISK[s.risk_level] ?? RISK.low}`}>
                      {s.risk_level} risk · {s.risk_score}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{label(s.source_kind)}</Badge>
                    <Badge variant="outline" className="text-[10px]">{label(s.content_type)}</Badge>
                    <Badge variant="outline" className="text-[10px]"><Clock className="mr-1 h-3 w-3" />{TIMING_LABEL[timing] ?? timing}</Badge>
                    {deactivated && <Badge variant="outline" className="text-[10px]">Deactivated</Badge>}
                    {s.status !== "active" && s.status !== "deactivated" && (
                      <Badge variant="outline" className="text-[10px]">{label(s.status)}</Badge>
                    )}
                  </div>

                  <p className="text-xs text-foreground/90">
                    <span className="font-medium">Work:</span> {attribution.workTitle}
                    {(s.tracked_titles ?? []).length > 1
                      ? ` (+${(s.tracked_titles ?? []).length - 1} more)`
                      : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium">Originating scan:</span>{" "}
                    {attribution.originatingScanId
                      ? attribution.originatingScanId.slice(0, 8) + "…"
                      : "unknown"}
                    {" · "}Registered from a prior scan — not a result of the currently selected scan.
                  </p>

                  <p className="line-clamp-2 text-xs text-muted-foreground">{(ev.reason as string) ?? s.page_title ?? s.url}</p>

                  <div className="flex flex-wrap gap-1">
                    {indicators.slice(0, 6).map((i) => (
                      <span key={i} className="rounded border border-border/50 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {label(i)}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>Tracked titles: {(s.tracked_titles ?? []).join(", ") || "—"}</span>
                    <span>Checked {ago(s.last_checked_at)} · {s.check_count} run(s)</span>
                    <span>{srcIncidents.length} active incident(s)</span>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(open ? null : s.id)}>
                      {open ? "Hide" : "History & evidence"}
                    </Button>
                    {!deactivated && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => sweep.mutate({ sourceId: s.id })} disabled={sweep.isPending}>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Re-crawl
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggle.mutate({ sourceId: s.id, monitorEnabled: !s.monitor_enabled })}
                        >
                          {s.monitor_enabled ? <><Pause className="mr-1.5 h-3.5 w-3.5" />Pause</> : <><Play className="mr-1.5 h-3.5 w-3.5" />Resume</>}
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" asChild>
                      <a href={s.url} target="_blank" rel="noreferrer noopener">
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open source
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              {open && (
                <div className="grid gap-4 border-t border-border/50 bg-background/20 p-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Incidents</h4>
                    {!srcIncidents.length && <p className="text-xs text-muted-foreground">No active incidents.</p>}
                    {srcIncidents.slice(0, 8).map((i) => (
                      <div key={i.id} className="rounded-lg border border-border/50 bg-card/40 p-2.5">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                          <span className="text-xs font-medium">{label(i.incident_type)}</span>
                          <Badge variant="outline" className={`text-[10px] ${RISK[i.severity] ?? RISK.low}`}>{i.severity}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{i.summary}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground/70">
                          {i.work_title ? `${i.work_title} · ` : ""}{new Date(i.detected_at).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Monitoring history</h4>
                    {!srcRuns.length && <p className="text-xs text-muted-foreground">No monitoring runs yet.</p>}
                    {srcRuns.slice(0, 8).map((r) => (
                      <div key={r.id} className="rounded-lg border border-border/50 bg-card/40 p-2.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{label(r.run_type)}</span>
                          <span className={r.reachable ? "text-emerald-400" : "text-red-400"}>
                            {r.reachable ? "reachable" : "unreachable"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-muted-foreground">
                          {((r.changes as string[] | null) ?? []).map(label).join(", ") || "no change"} · {r.incidents_created} incident(s)
                        </p>
                        <p className="text-muted-foreground/70">{new Date(r.started_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4>
                    <div className="rounded-lg border border-border/50 bg-card/40 p-2.5 text-[11px] text-muted-foreground">
                      <p><ShieldAlert className="mr-1 inline h-3 w-3" />Quality tags: {((ev.quality_tags as string[] | undefined) ?? []).join(", ") || "—"}</p>
                      <p className="mt-1">Linked hosts: {((ev.link_domains as string[] | undefined) ?? []).slice(0, 6).join(", ") || "—"}</p>
                      {typeof ev.deactivation_reason === "string" && (
                        <p className="mt-1 text-amber-500/90">{ev.deactivation_reason}</p>
                      )}
                    </div>
                    {links.slice(0, 6).map((l) => (
                      <a key={l} href={l} target="_blank" rel="noreferrer noopener"
                        className="block truncate rounded border border-border/50 bg-card/40 px-2 py-1 text-[11px] text-primary hover:underline">
                        {l}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
