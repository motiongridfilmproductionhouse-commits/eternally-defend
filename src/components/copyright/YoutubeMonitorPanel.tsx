import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runYoutubeMonitor,
  listYoutubeMonitor,
  updateYoutubeMonitorReview,
} from "@/lib/copyright/youtube-monitor.functions";
import { ReleaseDayReviewPanel } from "@/components/copyright/ReleaseDayReviewPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Youtube,
  ExternalLink,
  Eye,
  XCircle,
  Radar,
  ThumbsDown,
  ThumbsUp,
  Minus,
} from "lucide-react";

const USAGE_LABEL: Record<string, { label: string; cls: string }> = {
  movie_footage: {
    label: "Movie footage used",
    cls: "bg-red-600/15 text-red-400 border-red-600/40",
  },
  trailer_footage: {
    label: "Trailer footage used",
    cls: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  },
  poster_or_screenshot: {
    label: "Poster / screenshot used",
    cls: "bg-amber-400/15 text-amber-300 border-amber-400/40",
  },
  promotional_material: {
    label: "Promo material used",
    cls: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  },
  none: { label: "No visual reuse", cls: "bg-muted/40 text-muted-foreground border-border/60" },
  // This workflow doesn't run visual-usage classification by design (see
  // MetadataMatchResult / decideVideoOutcomeFromEvidence) — "unknown" here
  // just means "no usage category applies", never a failure.
  unknown: {
    label: "No usage category",
    cls: "bg-muted/40 text-muted-foreground border-border/60",
  },
};

const METADATA_MATCH_LABEL: Record<string, { label: string; cls: string }> = {
  strong_match: {
    label: "Evidence match",
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  },
  weak_match: {
    label: "Partial evidence",
    cls: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  },
  no_match: {
    label: "No text evidence",
    cls: "bg-muted/40 text-muted-foreground border-border/60",
  },
};

const REVIEW_STATUS_STYLE: Record<string, string> = {
  needs_review: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  evidence_ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  dismissed: "bg-muted/40 text-muted-foreground border-border/60",
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
  n == null
    ? "—"
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n);

export function YoutubeMonitorPanel({ scanId }: { scanId: string }) {
  const runFn = useServerFn(runYoutubeMonitor);
  const listFn = useServerFn(listYoutubeMonitor);
  const reviewFn = useServerFn(updateYoutubeMonitorReview);
  const qc = useQueryClient();

  const videos = useQuery({
    queryKey: ["copyright-youtube", scanId],
    queryFn: () => listFn({ data: { scanId } }),
  });

  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => runFn({ data: { scanId } }),
    onSuccess: (r) => {
      // Discovery + evidence scoring always completes (metadata matching has
      // no external dependency) — a candidate is never dropped just because
      // no automatic category could be assigned, so there's no "provider
      // failed" state to report here, only what was actually found.
      const summary =
        r.discovered === 0
          ? "No YouTube results found for this reference."
          : r.kept === 0 && r.needsReview === 0
            ? `Checked ${r.discovered} public videos — no relevant candidates found.`
            : `Checked ${r.discovered} public videos — ${r.kept} evidence match${r.kept === 1 ? "" : "es"}, ${r.needsReview} need${r.needsReview === 1 ? "s" : ""} review.`;
      setLastRunSummary(summary);
      toast.success(summary);
      qc.invalidateQueries({ queryKey: ["copyright-youtube", scanId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: (v: { videoRowId: string; reviewStatus: "evidence_ready" | "dismissed" }) =>
      reviewFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copyright-youtube", scanId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (videos.data ?? []).filter((v) => !v.is_release_review);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Youtube className="h-4 w-4 text-primary" />
            Public Video Copyright &amp; Reputation Monitoring
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Public video platform data only. Finds videos whose title, description, or channel
            reference your protected work, corroborated with facial recognition where applicable.
            Uncertain matches are queued for your review — evidence collection only, nothing is
            reported or removed.
          </p>
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Radar className="mr-2 h-4 w-4" />
          )}
          Run video monitoring
        </Button>
      </div>

      {lastRunSummary && (
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/50 p-3 text-xs text-muted-foreground">
          <Radar className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{lastRunSummary}</span>
        </div>
      )}

      {videos.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {!videos.isLoading && !rows.length && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
          No relevant candidates found yet for this reference. Run monitoring to check YouTube.
        </div>
      )}

      {rows.map((v) => {
        const ev = (v.evidence ?? {}) as Record<string, any>;
        const rek = (ev.recognition ?? {}) as Record<string, any>;
        const risks: string[] = Array.isArray(ev.reputation_risk) ? ev.reputation_risk : [];
        const signals: string[] = Array.isArray(v.copyright_signals)
          ? (v.copyright_signals as string[])
          : [];
        // Rows produced by the deterministic (non-AI) pipeline carry
        // evidence.classification_mode; older rows predate this change and
        // still show their original AI-derived usage/category/sentiment.
        const isDeterministic = ev.classification_mode === "deterministic";
        const usage = USAGE_LABEL[v.copyright_usage] ?? USAGE_LABEL.none;
        const metadataMatchStatus: string | undefined = ev.metadata_match?.status;
        const metadataMatch = metadataMatchStatus
          ? (METADATA_MATCH_LABEL[metadataMatchStatus] ?? METADATA_MATCH_LABEL.no_match)
          : null;
        return (
          <article
            key={v.id}
            className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur"
          >
            <div className="flex gap-4">
              {v.thumbnail_url && (
                <img
                  src={v.thumbnail_url}
                  alt={`Thumbnail of monitored public video ${v.title}`}
                  loading="lazy"
                  className="h-24 w-40 shrink-0 rounded-lg border border-border/60 object-cover"
                />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={riskCls(v.risk_score)}>
                    RISK {v.risk_score}
                  </Badge>
                  {isDeterministic ? (
                    metadataMatch && (
                      <Badge variant="outline" className={metadataMatch.cls}>
                        {metadataMatch.label}
                      </Badge>
                    )
                  ) : (
                    <>
                      <Badge variant="outline" className={usage.cls}>
                        {usage.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {v.content_category ?? "unknown"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="flex items-center gap-1 text-[10px] capitalize"
                      >
                        <SentimentIcon s={v.sentiment} />
                        {v.sentiment}
                      </Badge>
                    </>
                  )}
                  {rek.status === "checked" && (
                    <Badge variant="outline" className="text-[10px]">
                      Rekognition {rek.score}
                    </Badge>
                  )}
                  {v.same_day_release && (
                    <Badge variant="outline" className="text-[10px] text-primary">
                      same-day release
                    </Badge>
                  )}
                  {v.review_status !== "pending" && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${REVIEW_STATUS_STYLE[v.review_status] ?? ""}`}
                    >
                      {v.review_status.replace("_", " ")}
                    </Badge>
                  )}
                </div>

                {v.review_status === "needs_review" && (
                  <p className="text-[11px] text-amber-400">
                    Automatic evidence was inconclusive for this video — human review requested.
                  </p>
                )}

                <a
                  href={v.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 truncate text-sm text-primary hover:underline"
                >
                  {v.title} <ExternalLink className="h-3 w-3 shrink-0" />
                </a>

                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  {v.channel_url ? (
                    <a
                      href={v.channel_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {v.channel_title ?? "Unknown channel"}
                    </a>
                  ) : (
                    <span>{v.channel_title ?? "Unknown channel"}</span>
                  )}
                  <span>
                    {v.published_at ? new Date(v.published_at).toLocaleDateString() : "—"}
                  </span>
                  <span>{fmt(v.view_count as number | null)} views</span>
                  <span>{fmt(v.like_count as number | null)} likes</span>
                  <span>{fmt(v.comment_count as number | null)} comments</span>
                </div>

                {v.ai_summary && <p className="text-xs text-muted-foreground">{v.ai_summary}</p>}

                {(signals.length > 0 || risks.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {signals.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {s}
                      </span>
                    ))}
                    {risks.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-red-600/40 px-1.5 py-0.5 text-[10px] text-red-400"
                      >
                        {s}
                      </span>
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      review.mutate({ videoRowId: v.id, reviewStatus: "evidence_ready" })
                    }
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Mark evidence ready
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => review.mutate({ videoRowId: v.id, reviewStatus: "dismissed" })}
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </article>
        );
      })}

      <div className="pt-2">
        <ReleaseDayReviewPanel scanId={scanId} />
      </div>
    </div>
  );
}
