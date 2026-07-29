import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runYoutubeMonitor, listYoutubeMonitor, updateYoutubeMonitorReview,
} from "@/lib/copyright/youtube-monitor.functions";
import { ReleaseDayReviewPanel } from "@/components/copyright/ReleaseDayReviewPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Youtube, ExternalLink, Eye, XCircle, Radar, ThumbsDown, ThumbsUp, Minus,
} from "lucide-react";

const USAGE_LABEL: Record<string, { label: string; cls: string }> = {
  movie_footage: { label: "Movie footage used", cls: "bg-red-600/15 text-red-400 border-red-600/40" },
  trailer_footage: { label: "Trailer footage used", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  poster_or_screenshot: { label: "Poster / screenshot used", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40" },
  promotional_material: { label: "Promo material used", cls: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  none: { label: "No visual reuse", cls: "bg-muted/40 text-muted-foreground border-border/60" },
};

function riskCls(score: number) {
  if (score >= 70) return "bg-red-600/15 text-red-400 border-red-600/40";
  if (score >= 45) return "bg-orange-500/15 text-orange-400 border-orange-500/40";
  return "bg-primary/10 text-primary border-primary/30";
}

function SentimentIcon({ s }: { s: string }) {
  if (s === "negative") return <ThumbsDown className="h-3 w-3 text-red-400" />;
  if (s === "positive") return <ThumbsUp className="h-3 w-3 text-emerald-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

const fmt = (n: number | null) =>
  n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

export function YoutubeMonitorPanel({ scanId }: { scanId: string }) {
  const runFn = useServerFn(runYoutubeMonitor);
  const listFn = useServerFn(listYoutubeMonitor);
  const reviewFn = useServerFn(updateYoutubeMonitorReview);
  const qc = useQueryClient();

  const videos = useQuery({
    queryKey: ["copyright-youtube", scanId],
    queryFn: () => listFn({ data: { scanId } }),
  });

  const run = useMutation({
    mutationFn: () => runFn({ data: { scanId } }),
    onSuccess: (r) => {
      toast.success(`Monitored ${r.scanned} YouTube videos · ${r.flagged} flagged`);
      qc.invalidateQueries({ queryKey: ["copyright-youtube", scanId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: (v: { videoRowId: string; reviewStatus: "evidence_ready" | "dismissed" }) => reviewFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copyright-youtube", scanId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (videos.data ?? []).filter((v) => !v.is_release_review);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Youtube className="h-4 w-4 text-primary" />YouTube Copyright &amp; Reputation Monitoring
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Public YouTube data only. Detects reuse of your footage, posters and promos, plus sentiment and reputation risk around the release window. Evidence collection only — nothing is reported or removed.
          </p>
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radar className="mr-2 h-4 w-4" />}
          Run YouTube monitoring
        </Button>
      </div>

      {videos.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {!videos.isLoading && !rows.length && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
          No monitored YouTube videos yet for this reference. Run monitoring to collect intelligence.
        </div>
      )}

      {rows.map((v) => {
        const usage = USAGE_LABEL[v.copyright_usage] ?? USAGE_LABEL.none;
        const ev = (v.evidence ?? {}) as Record<string, any>;
        const rek = (ev.recognition ?? {}) as Record<string, any>;
        const risks: string[] = Array.isArray(ev.reputation_risk) ? ev.reputation_risk : [];
        const signals: string[] = Array.isArray(v.copyright_signals) ? (v.copyright_signals as string[]) : [];
        return (
          <article key={v.id} className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
            <div className="flex gap-4">
              {v.thumbnail_url && (
                <img src={v.thumbnail_url} alt={`Thumbnail of monitored YouTube video ${v.title}`} loading="lazy"
                  className="h-24 w-40 shrink-0 rounded-lg border border-border/60 object-cover" />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={riskCls(v.risk_score)}>RISK {v.risk_score}</Badge>
                  <Badge variant="outline" className={usage.cls}>{usage.label}</Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">{v.content_category ?? "unknown"}</Badge>
                  <Badge variant="outline" className="flex items-center gap-1 text-[10px] capitalize">
                    <SentimentIcon s={v.sentiment} />{v.sentiment}
                  </Badge>
                  {v.same_day_release && <Badge variant="outline" className="text-[10px] text-primary">same-day release</Badge>}
                  {v.review_status !== "pending" && (
                    <Badge variant="outline" className="text-[10px]">{v.review_status.replace("_", " ")}</Badge>
                  )}
                </div>

                <a href={v.video_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-sm text-primary hover:underline">
                  {v.title} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>

                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  {v.channel_url ? (
                    <a href={v.channel_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {v.channel_title ?? "Unknown channel"}
                    </a>
                  ) : <span>{v.channel_title ?? "Unknown channel"}</span>}
                  <span>{v.published_at ? new Date(v.published_at).toLocaleDateString() : "—"}</span>
                  <span>{fmt(v.view_count as number | null)} views</span>
                  <span>{fmt(v.like_count as number | null)} likes</span>
                  <span>{fmt(v.comment_count as number | null)} comments</span>
                </div>

                {v.ai_summary && <p className="text-xs text-muted-foreground">{v.ai_summary}</p>}

                {(signals.length > 0 || risks.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {signals.map((s) => (
                      <span key={s} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                    ))}
                    {risks.map((s) => (
                      <span key={s} className="rounded border border-red-600/40 px-1.5 py-0.5 text-[10px] text-red-400">{s}</span>
                    ))}
                  </div>
                )}

                {Array.isArray(rek.signals) && rek.signals.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium">AWS Rekognition:</span> {rek.signals.join(" · ")}
                    {rek.actor_matches?.length ? ` · actors: ${rek.actor_matches.join(", ")}` : ""}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline"
                    onClick={() => review.mutate({ videoRowId: v.id, reviewStatus: "evidence_ready" })}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />Mark evidence ready
                  </Button>
                  <Button size="sm" variant="ghost"
                    onClick={() => review.mutate({ videoRowId: v.id, reviewStatus: "dismissed" })}>
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
