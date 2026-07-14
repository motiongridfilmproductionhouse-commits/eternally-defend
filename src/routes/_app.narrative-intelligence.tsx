import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { clusterFindings, listNarrativeClusters, getClusterDetail } from "@/lib/mm/narrative.functions";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Sparkles, TrendingUp, Radio, Clock } from "lucide-react";

export const Route = createFileRoute("/_app/narrative-intelligence")({
  head: () => ({ meta: [{ title: "Narrative Intelligence — Eterna AI" }] }),
  component: NarrativeIntelligencePage,
});

function NarrativeIntelligencePage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listNarrativeClusters);
  const clusterFn = useServerFn(clusterFindings);
  const q = useQuery({ queryKey: ["narrative-clusters"], queryFn: () => listFn() });
  const mut = useMutation({
    mutationFn: () => clusterFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["narrative-clusters"] }),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const clusters = q.data?.clusters ?? [];
  const totalReach = clusters.reduce((s, c) => s + (c.combined_reach ?? 0), 0);
  const topVelocity = clusters.reduce((m, c) => Math.max(m, c.narrative_velocity ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ACTIVE NARRATIVES" value={String(clusters.length)} sub="Clusters detected" accent="oklch(0.55 0.24 305)" />
        <StatCard label="COMBINED REACH" value={totalReach.toLocaleString()} sub="Across all sources" accent="oklch(0.6 0.2 30)" />
        <StatCard label="PEAK VELOCITY" value={topVelocity.toFixed(2)} sub="Sources per day" accent="oklch(0.72 0.14 70)" />
        <StatCard label="HIGH THREAT" value={String(clusters.filter((c) => c.threat_score >= 60).length)} sub="Score ≥ 60" accent="oklch(0.6 0.22 25)" />
      </div>

      <PageCard title="NARRATIVE INTELLIGENCE" sub="Findings automatically grouped by claim, entity, source and content similarity"
        actions={<Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          <Sparkles className="size-4 mr-2" />{mut.isPending ? "Clustering…" : "Recompute clusters"}
        </Button>}>
        {mut.data && (
          <div className="mb-3 text-xs text-emerald-600">
            Clustered {mut.data.linked} findings into {mut.data.clusters} narratives ({mut.data.created} new, {mut.data.updated} updated).
          </div>
        )}
        {q.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
         clusters.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Network className="size-8 mx-auto mb-2 opacity-50" />
            No narratives clustered yet. Run one or more analyses in Intelligence, then click <b>Recompute clusters</b>.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            <div className="space-y-2">
              {clusters.map((c) => (
                <button key={c.id} onClick={() => setSelected(c.id)}
                  className={`w-full text-left border rounded-xl p-3 hover:bg-accent transition-colors ${selected === c.id ? "border-primary bg-accent/50" : "border-border"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="font-mono text-[10px]">{c.cluster_key.split(":")[0]}</Badge>
                        <span className="text-xs text-muted-foreground">{c.target_name}</span>
                      </div>
                      <div className="mt-1 font-medium text-sm truncate">{c.narrative_summary ?? "(no summary)"}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground truncate">Cluster {c.cluster_key}</div>
                    </div>
                    <ThreatDot score={c.threat_score} />
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
                    <Metric icon={Radio} label="Sources" value={String(c.source_count)} />
                    <Metric icon={TrendingUp} label="Reach" value={(c.combined_reach ?? 0).toLocaleString()} />
                    <Metric icon={TrendingUp} label="Velocity" value={`${c.narrative_velocity}/d`} />
                    <Metric icon={Clock} label="Age" value={ageOf(c.first_detected_at)} />
                  </div>
                </button>
              ))}
            </div>
            {selected && <ClusterDetail clusterId={selected} />}
          </div>
        )}
      </PageCard>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: any) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3" />
      <span className="uppercase text-[9px] tracking-wider">{label}</span>
      <span className="text-foreground font-medium ml-auto">{value}</span>
    </div>
  );
}

function ThreatDot({ score }: { score: number }) {
  const c = score >= 60 ? "bg-red-500" : score >= 30 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="shrink-0 text-right">
      <div className={`size-2.5 rounded-full ${c} ml-auto`} />
      <div className="text-[10px] text-muted-foreground mt-1">Threat {score}</div>
    </div>
  );
}

function ClusterDetail({ clusterId }: { clusterId: string }) {
  const getFn = useServerFn(getClusterDetail);
  const q = useQuery({ queryKey: ["cluster", clusterId], queryFn: () => getFn({ data: { clusterId } }) });
  if (q.isLoading) return <div className="border border-border rounded-xl p-4 text-sm text-muted-foreground">Loading…</div>;
  const c: any = q.data?.cluster;
  if (!c) return null;
  const findings = q.data?.findings ?? [];
  return (
    <div className="border border-border rounded-xl p-4 space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cluster detail</div>
        <div className="font-medium text-sm">{c.narrative_summary ?? c.cluster_key}</div>
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Target</dt><dd>{c.target_name}</dd>
        <dt className="text-muted-foreground">Sources</dt><dd>{c.source_count}</dd>
        <dt className="text-muted-foreground">Combined reach</dt><dd>{(c.combined_reach ?? 0).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Dominant source</dt><dd className="truncate">{c.dominant_source ?? "—"}</dd>
        <dt className="text-muted-foreground">First detected</dt><dd>{new Date(c.first_detected_at).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Latest detected</dt><dd>{new Date(c.latest_detected_at).toLocaleString()}</dd>
      </dl>
      <div>
        <div className="text-[10px] uppercase text-muted-foreground mb-1">Source URLs</div>
        <ul className="text-xs space-y-0.5">
          {(c.sources ?? []).slice(0, 12).map((s: string) => (
            <li key={s} className="truncate"><a href={s} target="_blank" rel="noopener noreferrer" className="hover:underline">{s}</a></li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[10px] uppercase text-muted-foreground mb-1">Findings in cluster ({findings.length})</div>
        <ul className="text-xs space-y-1 max-h-64 overflow-auto">
          {findings.map((f: any) => (
            <li key={f.id} className="border border-border rounded p-1.5">
              <div className="font-medium">{f.title}</div>
              <div className="text-[10px] text-muted-foreground">{f.severity} · {f.human_review_status}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ageOf(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return `${Math.round(d * 24)}h`;
  return `${Math.round(d)}d`;
}
