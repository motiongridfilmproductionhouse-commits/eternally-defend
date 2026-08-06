import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runReleaseDayReviewAnalysis,
  listReleaseDayReviews,
  updateYoutubeMonitorReview,
} from "@/lib/copyright/youtube-monitor.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  CalendarClock,
  ExternalLink,
  Eye,
  XCircle,
  AlertTriangle,
  ThumbsDown,
  ThumbsUp,
  Minus,
  Clock,
  MessageSquare,
} from "lucide-react";

const IMPACT: Record<string, { label: string; cls: string }> = {
  high: { label: "High impact", cls: "bg-red-600/15 text-red-400 border-red-600/40" },
  medium: { label: "Medium impact", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  low: { label: "Low impact", cls: "bg-primary/10 text-primary border-primary/30" },
};

const STATEMENT_CLS: Record<string, string> = {
  misleading: "border-red-600/40 text-red-400",
  fact_claim: "border-amber-400/40 text-amber-300",
  exaggerated: "border-orange-500/40 text-orange-400",
  spoiler: "border-sky-500/40 text-sky-300",
  opinion: "border-border/60 text-muted-foreground",
};

const USAGE_LABEL: Record<string, string> = {
  movie_footage: "Movie clips used",
  trailer_footage: "Trailer footage used",
  poster_or_screenshot: "Poster / screenshots used",
  promotional_material: "Promo material used",
  none: "No visual reuse",
};

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

interface KeyStatement {
  statement: string;
  kind: string;
  timestamp?: string | null;
}

export function ReleaseDayReviewPanel({ scanId }: { scanId: string }) {
  const runFn = useServerFn(runReleaseDayReviewAnalysis);
  const listFn = useServerFn(listReleaseDayReviews);
  const reviewFn = useServerFn(updateYoutubeMonitorReview);
  const qc = useQueryClient();

  const reviews = useQuery({
    queryKey: ["copyright-release-reviews", scanId],
    queryFn: () => listFn({ data: { scanId } }),
  });

  const run = useMutation({
    mutationFn: () => runFn({ data: { scanId } }),
    onSuccess: (r) => {
      toast.success(`Analysed ${r.scanned} videos · ${r.reviews} reviews · ${r.high} high impact`);
      qc.invalidateQueries({ queryKey: ["copyright-release-reviews", scanId] });
      qc.invalidateQueries({ queryKey: ["copyright-youtube", scanId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mark = useMutation({
    mutationFn: (v: { videoRowId: string; reviewStatus: "evidence_ready" | "dismissed" }) =>
      reviewFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copyright-release-reviews", scanId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = reviews.data ?? [];
  const counts = {
    high: rows.filter((r) => r.reputation_impact === "high").length,
    medium: rows.filter((r) => r.reputation_impact === "medium").length,
    low: rows.filter((r) => r.reputation_impact === "low").length,
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" />
            Release Day Review &amp; Reputation Analysis
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Monitors reviews and reaction videos published around the release window — same-day
            reviews, first reactions, early access, critics and regional-language coverage — for
            misleading claims, false statements and harmful narratives. Monitoring insight and
            evidence only; nothing is reported, removed or sent to creators.
          </p>
          {rows.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <Badge variant="outline" className={IMPACT.high.cls}>
                {counts.high} high
              </Badge>
              <Badge variant="outline" className={IMPACT.medium.cls}>
                {counts.medium} medium
              </Badge>
              <Badge variant="outline" className={IMPACT.low.cls}>
                {counts.low} low
              </Badge>
            </div>
          )}
        </div>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CalendarClock className="mr-2 h-4 w-4" />
          )}
          Run release-day analysis
        </Button>
      </div>

      {reviews.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {!reviews.isLoading && !rows.length && (
        <div className="rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
          No release-window reviews analysed yet. Run the analysis to collect reputation
          intelligence.
        </div>
      )}

      {rows.map((v) => {
        const impact = IMPACT[v.reputation_impact] ?? IMPACT.low;
        const statements = (Array.isArray(v.key_statements)
          ? v.key_statements
          : []) as unknown as KeyStatement[];
        const signals = (Array.isArray(v.misleading_signals)
          ? v.misleading_signals
          : []) as unknown as string[];
        const stamps = (Array.isArray(v.evidence_timestamps)
          ? v.evidence_timestamps
          : []) as unknown as string[];
        const comments = (Array.isArray(v.comment_samples)
          ? v.comment_samples
          : []) as unknown as string[];
        return (
          <article
            key={v.id}
            className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur"
          >
            <div className="flex gap-4">
              {v.thumbnail_url && (
                <img
                  src={v.thumbnail_url}
                  alt={`Thumbnail of release-window review video ${v.title}`}
                  loading="lazy"
                  className="h-24 w-40 shrink-0 rounded-lg border border-border/60 object-cover"
                />
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={impact.cls}>
                    {impact.label} · {v.reputation_impact_score}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {(v.review_type ?? "review").replace(/_/g, " ")}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="flex items-center gap-1 text-[10px] capitalize"
                  >
                    <SentimentIcon s={v.sentiment} />
                    {v.sentiment} {v.sentiment_score ?? 0}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {USAGE_LABEL[v.copyright_usage] ?? USAGE_LABEL.none}
                  </Badge>
                  {v.same_day_release && (
                    <Badge variant="outline" className="text-[10px] text-primary">
                      same-day release
                    </Badge>
                  )}
                  {v.review_status !== "pending" && (
                    <Badge variant="outline" className="text-[10px]">
                      {v.review_status.replace("_", " ")}
                    </Badge>
                  )}
                </div>

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

                {signals.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                    {signals.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-red-600/40 px-1.5 py-0.5 text-[10px] text-red-400"
                      >
                        {s.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}

                {statements.length > 0 && (
                  <ul className="space-y-1">
                    {statements.map((s, i) => (
                      <li
                        key={`${i}-${s.statement.slice(0, 12)}`}
                        className={`rounded border px-2 py-1 text-[11px] ${STATEMENT_CLS[s.kind] ?? STATEMENT_CLS.opinion}`}
                      >
                        <span className="font-medium uppercase tracking-wide">
                          {s.kind.replace(/_/g, " ")}
                        </span>
                        {s.timestamp ? (
                          <span className="ml-1 opacity-70">@{s.timestamp}</span>
                        ) : null}
                        <span className="ml-2 text-muted-foreground">{s.statement}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {stamps.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> Evidence timestamps: {stamps.join(" · ")}
                  </p>
                )}

                {comments.length > 0 && (
                  <details className="text-[11px] text-muted-foreground">
                    <summary className="flex cursor-pointer items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> Public comment sample ({comments.length}
                      )
                    </summary>
                    <ul className="mt-1 space-y-1 pl-4">
                      {comments.map((c, i) => (
                        <li key={i} className="list-disc">
                          {c}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      mark.mutate({ videoRowId: v.id, reviewStatus: "evidence_ready" })
                    }
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Mark evidence ready
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => mark.mutate({ videoRowId: v.id, reviewStatus: "dismissed" })}
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
    </section>
  );
}
