import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  clusterFindings,
  listNarrativeClusters,
  getClusterDetail,
  reviewNarrativeFinding,
  createNarrativeRemovalDraft,
} from "@/lib/mm/narrative.functions";
import { PageCard, StatCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/use-session";
import {
  Network,
  Sparkles,
  TrendingUp,
  Radio,
  Clock,
  CheckCircle2,
  SearchCheck,
  XCircle,
  Send,
  ShieldCheck,
} from "lucide-react";

export const Route = createFileRoute("/_app/narrative-intelligence")({
  head: () => ({ meta: [{ title: "Narrative Intelligence — Eterna AI" }] }),
  component: NarrativeIntelligencePage,
});

function NarrativeIntelligencePage() {
  const qc = useQueryClient();
  const { session } = useSession();
  const listFn = useServerFn(listNarrativeClusters);
  const clusterFn = useServerFn(clusterFindings);
  const q = useQuery({ queryKey: ["narrative-clusters"], queryFn: () => listFn(), enabled: !!session });
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
            Clustered {mut.data.linked} multimedia findings and {mut.data.importedChannelWatch} Channel Watch findings into {mut.data.clusters} narratives ({mut.data.created} new, {mut.data.updated} updated).
          </div>
        )}
        {q.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> :
         clusters.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Network className="size-8 mx-auto mb-2 opacity-50" />
            No eligible narratives clustered yet. Analyze review-level content in Channel Watch or Intelligence, then click <b>Recompute clusters</b>.
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
  const { session } = useSession();
  const qc = useQueryClient();
  const getFn = useServerFn(getClusterDetail);
  const reviewFn = useServerFn(reviewNarrativeFinding);
  const removalFn = useServerFn(createNarrativeRemovalDraft);

  const q = useQuery({
    queryKey: ["cluster", clusterId],
    queryFn: () => getFn({ data: { clusterId } }),
    enabled: !!session,
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      videoId,
      decision,
    }: {
      videoId: string;
      decision: "approved" | "dismissed" | "escalated";
    }) => reviewFn({ data: { videoId, decision } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["cluster", clusterId] });
      await qc.invalidateQueries({ queryKey: ["narrative-clusters"] });
    },
  });

  const removalMutation = useMutation({
    mutationFn: (videoId: string) =>
      removalFn({ data: { videoId, clusterId } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["cluster", clusterId] });
    },
  });
  if (q.isLoading) return <div className="border border-border rounded-xl p-4 text-sm text-muted-foreground">Loading…</div>;
  const c: any = q.data?.cluster;
  if (!c) return null;
  const findings = q.data?.findings ?? [];
  const channelWatchFindings = q.data?.channelWatchFindings ?? [];
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
        <div className="text-[10px] uppercase text-muted-foreground mb-1">
          Evidence in cluster ({findings.length + channelWatchFindings.length})
        </div>

        <ul className="text-xs space-y-1 max-h-80 overflow-auto">
          {channelWatchFindings.map((finding: any) => (
            <li
              key={`channel-${finding.id}`}
              className="border border-border rounded p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[9px]">
                  Channel Watch
                </Badge>
                <span className="text-[9px] text-amber-600">
                  Unverified — human review required
                </span>
              </div>

              <div className="mt-1 font-medium">
                {finding.title ?? "Untitled video"}
              </div>

              <div className="mt-1 text-[10px] text-muted-foreground">
                Risk {finding.risk_score ?? 0} · {finding.classification} · {finding.review_status}
              </div>

              <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[10px] font-medium">
                    <ShieldCheck className="size-3" />
                    Evidence strength
                  </span>
                  <span className="text-[10px] font-semibold">
                    {finding.evidence_strength ?? 0}/100
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      (finding.evidence_strength ?? 0) >= 70
                        ? "bg-emerald-500"
                        : (finding.evidence_strength ?? 0) >= 40
                          ? "bg-amber-500"
                          : "bg-slate-400"
                    }`}
                    style={{
                      width: `${Math.min(100, finding.evidence_strength ?? 0)}%`,
                    }}
                  />
                </div>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-1.5">
                <div className="grid grid-cols-3 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={finding.review_status === "approved" ? "default" : "outline"}
                    className="h-7 px-1 text-[9px]"
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({
                        videoId: finding.id,
                        decision: "approved",
                      })
                    }
                  >
                    <CheckCircle2 className="mr-1 size-3" />
                    Confirm
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant={finding.review_status === "escalated" ? "default" : "outline"}
                    className="h-7 px-1 text-[9px]"
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({
                        videoId: finding.id,
                        decision: "escalated",
                      })
                    }
                  >
                    <SearchCheck className="mr-1 size-3" />
                    Investigate
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant={finding.review_status === "dismissed" ? "destructive" : "outline"}
                    className="h-7 px-1 text-[9px]"
                    disabled={reviewMutation.isPending}
                    onClick={() =>
                      reviewMutation.mutate({
                        videoId: finding.id,
                        decision: "dismissed",
                      })
                    }
                  >
                    <XCircle className="mr-1 size-3" />
                    Not relevant
                  </Button>
                </div>

                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-[10px]"
                  disabled={
                    finding.review_status !== "approved" ||
                    removalMutation.isPending
                  }
                  onClick={() => removalMutation.mutate(finding.id)}
                >
                  <Send className="mr-1 size-3" />
                  {removalMutation.isPending
                    ? "Creating draft…"
                    : "Send to Removal Center"}
                </Button>

                {finding.review_status !== "approved" && (
                  <div className="text-[9px] text-muted-foreground">
                    Human confirmation is required before creating a removal draft.
                  </div>
                )}

                {removalMutation.isSuccess && (
                  <div className="text-[9px] text-emerald-600">
                    Removal Center draft created. Submission still requires approval.
                  </div>
                )}

                {(reviewMutation.error || removalMutation.error) && (
                  <div className="text-[9px] text-destructive">
                    {(reviewMutation.error as Error | null)?.message ??
                      (removalMutation.error as Error | null)?.message}
                  </div>
                )}
              </div>

              {finding.url && (
                <a
                  href={finding.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-[10px] text-primary hover:underline"
                >
                  {finding.url}
                </a>
              )}
            </li>
          ))}

          {findings.map((finding: any) => (
            <li
              key={`multimedia-${finding.id}`}
              className="border border-border rounded p-2"
            >
              <Badge variant="outline" className="text-[9px]">
                Multimedia Intelligence
              </Badge>

              <div className="mt-1 font-medium">
                {finding.title}
              </div>

              <div className="text-[10px] text-muted-foreground">
                {finding.severity} · {finding.human_review_status}
              </div>
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
