import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listVideoTimestampFindings,
  updateFindingReview,
  analyzeYoutubeVideo,
} from "@/lib/video-analysis.functions";
import {
  Clock, ExternalLink, Loader2, RefreshCw, ShieldAlert, CheckCircle2,
  XCircle, Scale, PlayCircle, Users, Sparkles,
} from "lucide-react";

const CONTEXT_LABEL: Record<string, string> = {
  direct_allegation: "Direct allegation",
  quoted_allegation: "Quoted allegation",
  opinion: "Opinion",
  criticism: "Criticism",
  news_reporting: "News reporting",
  satire: "Satire",
  denial: "Denial",
  response_clarification: "Response / clarification",
  harassment: "Harassment",
  potentially_defamatory: "Potential defamation risk",
  insufficient_evidence: "Insufficient evidence",
};

const CONTEXT_COLOR: Record<string, string> = {
  direct_allegation: "oklch(0.6 0.24 25)",
  quoted_allegation: "oklch(0.7 0.18 55)",
  opinion: "oklch(0.6 0.05 275)",
  criticism: "oklch(0.7 0.15 90)",
  news_reporting: "oklch(0.6 0.12 220)",
  satire: "oklch(0.65 0.12 320)",
  denial: "oklch(0.65 0.14 155)",
  response_clarification: "oklch(0.65 0.14 155)",
  harassment: "oklch(0.55 0.24 25)",
  potentially_defamatory: "oklch(0.55 0.24 25)",
  insufficient_evidence: "oklch(0.6 0.03 275)",
};

const SEV_COLOR: Record<string, string> = {
  critical: "oklch(0.55 0.24 25)",
  high: "oklch(0.65 0.22 35)",
  medium: "oklch(0.72 0.17 70)",
  low: "oklch(0.68 0.12 155)",
};

export interface ExactMomentsPanelProps {
  videoId: string;
  scanId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  channelUrl?: string | null;
  entityTerms: string[];
  /** Set true when the parent has already fired analysis after scan; hides the auto-trigger. */
  analysisPending?: boolean;
}

export function ExactMomentsPanel({
  videoId,
  scanId,
  channelId,
  channelName,
  channelUrl,
  entityTerms,
  analysisPending,
}: ExactMomentsPanelProps) {
  const qc = useQueryClient();
  const listFn = useServerFn(listVideoTimestampFindings);
  const analyzeFn = useServerFn(analyzeYoutubeVideo);
  const reviewFn = useServerFn(updateFindingReview);
  const q = useQuery({
    queryKey: ["video-findings", videoId],
    queryFn: () => listFn({ data: { videoId } }),
    refetchInterval: (query) => {
      const state = (query.state.data as { job?: { analysis_state?: string } } | undefined)?.job?.analysis_state;
      if (analysisPending && !state) return 3000;
      if (state === "running" || state === "queued") return 2500;
      return false;
    },
  });

  const analyze = useMutation({
    mutationFn: () =>
      analyzeFn({
        data: {
          videoId,
          scanId: scanId ?? null,
          entityTerms,
          channelId: channelId ?? null,
          channelName: channelName ?? null,
          channelUrl: channelUrl ?? null,
        },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["video-findings", videoId] }),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "false_positive" | "legal_review" }) =>
      reviewFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-findings", videoId] }),
  });

  const findings = q.data?.findings ?? [];
  const job = q.data?.job;
  const captionsState = job?.captions_state ?? (analysisPending ? "queued" : null);

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Clock className="size-3.5" /> Exact video moments
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {captionsState === "captions_analysed" && `${findings.length} finding${findings.length === 1 ? "" : "s"} · ${job?.transcript_segment_count ?? 0} caption segments · ${job?.caption_language ?? "?"}`}
            {captionsState === "partial_captions" && `${findings.length} finding${findings.length === 1 ? "" : "s"} · partial captions`}
            {captionsState === "captions_unavailable" && "Captions unavailable for this video."}
            {captionsState === "metadata_only" && "Metadata-only analysis — exact spoken-content timestamps are unavailable."}
            {(captionsState === "queued" || captionsState === "running") && "Analyzing captions…"}
            {!captionsState && !analyze.isPending && "Not analyzed yet."}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            title="Available after Speech-to-Text activation"
            className="text-[11px] px-2 py-1 rounded-md border border-dashed border-border text-muted-foreground cursor-not-allowed"
          >
            Run Deep Audio Analysis
          </button>
          <button
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending || q.isFetching}
            className="text-[11px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-60"
          >
            {analyze.isPending || (analysisPending && !job) ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Re-analyze
          </button>
        </div>
      </div>

      {(captionsState === "captions_unavailable" || captionsState === "metadata_only") && findings.length === 0 && (
        <div className="text-[11px] rounded-lg border border-dashed border-border bg-background/50 px-3 py-2 text-muted-foreground">
          Exact timestamp unavailable. This video has no publicly accessible timestamped captions. Enable
          Speech-to-Text (coming soon) to process audio when authorised.
        </div>
      )}

      {q.isLoading && !findings.length && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      )}

      {findings.length > 0 && (
        <div className="space-y-2">
          {findings.map((f: {
            id: string;
            start_seconds: number;
            end_seconds: number;
            start_time_display: string | null;
            end_time_display: string | null;
            speaker_label: string | null;
            original_text: string;
            original_language: string | null;
            translated_text: string | null;
            context_before: string | null;
            context_after: string | null;
            matched_entity: string | null;
            claim_summary: string | null;
            context_type: string;
            speaker_stance: string | null;
            risk_category: string | null;
            severity: string | null;
            confidence: number | null;
            evidence_source: string | null;
            watch_exact_moment_url: string | null;
            review_status: string;
          }) => {
            const ctxColor = CONTEXT_COLOR[f.context_type] ?? "oklch(0.6 0.05 275)";
            const sevColor = SEV_COLOR[f.severity ?? "low"] ?? "oklch(0.6 0.05 275)";
            return (
              <div key={f.id} className="rounded-lg border border-border bg-background/70 p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={f.watch_exact_moment_url ?? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(f.start_seconds)}s`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700"
                  >
                    <PlayCircle className="size-3" />
                    {f.start_time_display ?? formatSec(f.start_seconds)} – {f.end_time_display ?? formatSec(f.end_seconds)}
                  </a>
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-white"
                    style={{ background: ctxColor }}
                  >
                    {CONTEXT_LABEL[f.context_type] ?? f.context_type}
                  </span>
                  {f.severity && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-white"
                      style={{ background: sevColor }}
                    >
                      {f.severity.toUpperCase()}
                    </span>
                  )}
                  {typeof f.confidence === "number" && (
                    <span className="text-[10px] text-muted-foreground">
                      Confidence {Math.round(f.confidence)}%
                    </span>
                  )}
                  {f.review_status !== "pending" && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted">
                      {f.review_status.replace("_", " ")}
                    </span>
                  )}
                </div>

                {f.claim_summary && (
                  <div className="text-xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Summary · </span>
                    {f.claim_summary}
                  </div>
                )}

                <div className="text-[11px] rounded-md bg-muted/40 border border-border px-2 py-1.5">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    Original {f.original_language ? `(${f.original_language})` : ""}
                  </div>
                  <div className="whitespace-pre-wrap">{f.original_text}</div>
                </div>
                {f.translated_text && (
                  <div className="text-[11px] rounded-md bg-background border border-border px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Translation (EN)</div>
                    <div className="whitespace-pre-wrap">{f.translated_text}</div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                  {f.matched_entity && <div><span className="font-semibold text-foreground">Entity:</span> {f.matched_entity}</div>}
                  {f.speaker_stance && <div><span className="font-semibold text-foreground">Stance:</span> {f.speaker_stance}</div>}
                  {f.risk_category && <div><span className="font-semibold text-foreground">Risk:</span> {f.risk_category}</div>}
                  {f.evidence_source && <div><span className="font-semibold text-foreground">Source:</span> {f.evidence_source.replace("_", " ")}</div>}
                </div>

                <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                  <a
                    href={f.watch_exact_moment_url ?? `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(f.start_seconds)}s`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
                  >
                    <ExternalLink className="size-3" /> Watch exact moment
                  </a>
                  <button
                    onClick={() => review.mutate({ id: f.id, status: "approved" })}
                    className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="size-3" /> Approve evidence
                  </button>
                  <button
                    onClick={() => review.mutate({ id: f.id, status: "false_positive" })}
                    className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
                  >
                    <XCircle className="size-3" /> False positive
                  </button>
                  <button
                    onClick={() => review.mutate({ id: f.id, status: "legal_review" })}
                    className="text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
                  >
                    <Scale className="size-3" /> Request legal review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {job?.error && captionsState !== "captions_unavailable" && captionsState !== "metadata_only" && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <ShieldAlert className="size-3" /> Analysis note: {job.error}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground italic border-t border-dashed border-border pt-2">
        Automated classification only — not a legal determination. Categories such as "potential defamation risk" require review by qualified counsel.
      </div>
    </div>
  );
}

function formatSec(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/* ---- Compact chip row for use inside a result card header ---- */
export function ExactMomentsSummaryChips({ videoId }: { videoId: string }) {
  const listFn = useServerFn(listVideoTimestampFindings);
  const q = useQuery({
    queryKey: ["video-findings", videoId],
    queryFn: () => listFn({ data: { videoId } }),
    staleTime: 30_000,
  });
  const findings = q.data?.findings ?? [];
  const job = q.data?.job;
  if (!findings.length && !job) return null;
  const critical = findings.filter((f: { severity: string | null }) => f.severity === "critical" || f.severity === "high").length;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted border border-border">
        <Sparkles className="size-3" /> {findings.length} exact
      </span>
      {critical > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600 text-white">
          <ShieldAlert className="size-3" /> {critical} risk
        </span>
      )}
      {job?.captions_state === "metadata_only" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
          <Users className="size-3" /> metadata-only
        </span>
      )}
    </div>
  );
}
