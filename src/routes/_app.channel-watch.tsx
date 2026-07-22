import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Plus, Play, Pause, Search, Trash2, ExternalLink, ShieldCheck, Activity, Users, Radar, RefreshCw, AlertTriangle, Eye } from "lucide-react";
import {
  addChannelWatch, getVerifiedUserSummary, listChannelWatches, listRecentEvents,
  addWatchVideoToRemovalCenter, analyzeCurrentChannelVideos,
  listWatchVideos, removeChannelWatch, resolveChannelSearch,
  scanChannelNow, setWatchStatus, submitReviewDecision,
} from "@/lib/channel-watch/channel-watch.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_app/channel-watch")({
  head: () => ({
    meta: [
      { title: "Channel Watch — Persistent Creator Monitoring | Eterna" },
      { name: "description", content: "Continuously monitor external YouTube creator channels for content concerning the verified user. Detect, analyze, and route potential violations to human review." },
      { property: "og:title", content: "Channel Watch — Persistent Creator Monitoring" },
      { property: "og:description", content: "Continuously monitor external YouTube creators for content concerning the verified user." },
    ],
  }),
  component: ChannelWatchPage,
});

const CYAN = "text-cyan-300/80";
const CORAL = "text-orange-300/90";

const summaryQO = () => queryOptions({ queryKey: ["cw", "summary"], queryFn: () => getVerifiedUserSummary() });
const watchesQO = () => queryOptions({ queryKey: ["cw", "watches"], queryFn: () => listChannelWatches() });
const videosQO = (watchId?: string) => queryOptions({
  queryKey: ["cw", "videos", watchId ?? "all"],
  queryFn: () => listWatchVideos({ data: { watchId, limit: 200 } }),
});
const eventsQO = () => queryOptions({ queryKey: ["cw", "events"], queryFn: () => listRecentEvents() });

function ChannelWatchPage() {
  const [selectedWatch, setSelectedWatch] = useState<string | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const summary = useQuery(summaryQO());
  const watches = useQuery(watchesQO());
  // Keep the complete video collection for per-channel card statistics.
  const allVideos = useQuery(videosQO());

  // Load a separate result set only for the channel whose videos are open.
  const selectedVideos = useQuery({
    ...videosQO(selectedWatch),
    enabled: Boolean(selectedWatch),
  });

  const events = useQuery(eventsQO());
  const selectedChannel = (watches.data ?? []).find(
    (watch) => watch.id === selectedWatch,
  );

  return (
    <div className="min-h-full text-slate-100" style={{
      background:
        "radial-gradient(1200px 600px at 15% -10%, rgba(56,189,248,0.08), transparent 60%)," +
        "radial-gradient(900px 500px at 90% 10%, rgba(148,163,184,0.06), transparent 60%)," +
        "linear-gradient(180deg, #0b1220 0%, #0a111d 100%)",
    }}>
      <div className="mx-auto max-w-[1400px] p-6 space-y-6">

        {/* Top intelligence bar */}
        <div className="grid grid-cols-12 gap-4">
          <VerifiedUserCard summary={summary.data} className="col-span-12 lg:col-span-5" />
          <Card className="col-span-12 lg:col-span-4 bg-slate-900/40 backdrop-blur border-slate-700/40 p-4 flex flex-col justify-between">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Add creator channel</div>
            <div className="mt-2 text-sm text-slate-300 leading-relaxed">
              Monitor new uploads only when they concern the assigned protected person or brand. Relevant risks are analyzed and routed into human-approved enforcement.
            </div>
            <Button onClick={() => setAddOpen(true)} className="mt-3 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 border border-cyan-400/30">
              <Plus className="size-4 mr-2" /> Add Risk Channel
            </Button>
          </Card>
          <GlobalStats summary={summary.data} className="col-span-12 lg:col-span-3" />
        </div>

        {/* Flow graph */}
        <FlowGraph
          channelCount={watches.data?.length ?? 0}
          videoCount={allVideos.data?.length ?? 0}
          reviewCount={(allVideos.data ?? []).filter(
            (video) => video.review_status === "pending",
          ).length}
        />

        <LiveMonitoringAnimation
          watches={watches.data ?? []}
          videos={allVideos.data ?? []}
        />

        {/* Monitored channels */}
        <section>
          <SectionHeader title="Monitored Creator Channels" subtitle="Persistent YouTube watch — historical baseline plus continuous future upload monitoring." />
          {watches.isLoading ? <SkeletonRow /> : (watches.data?.length ?? 0) === 0 ? (
            <Card className="p-8 bg-slate-900/30 border-slate-700/40 text-center text-slate-400">
              No creator channels yet. Add one to start persistent monitoring.
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(watches.data ?? []).map((w) => (
                <MonitoredChannelCard
                  key={w.id}
                  watch={w}
                  isSelected={selectedWatch === w.id}
                  onSelect={() => setSelectedWatch(selectedWatch === w.id ? undefined : w.id)}
                  videos={(allVideos.data ?? []).filter(
                    (video) => video.watch_id === w.id,
                  )}
                />
              ))}
            </div>
          )}
        </section>

        {/* Selected channel videos only */}
        {selectedWatch && (
          <section
            key={selectedWatch}
            className="scroll-mt-24 rounded-xl border border-cyan-500/20 bg-slate-950/30 p-4"
          >
            <SectionHeader
              title={`Fetched Videos — ${
                selectedChannel?.channel_title ??
                selectedChannel?.handle ??
                "Selected channel"
              }`}
              subtitle="Only videos fetched from this monitored channel are shown below."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-600 bg-slate-900 text-slate-200"
                  onClick={() => setSelectedWatch(undefined)}
                >
                  Hide channel videos
                </Button>
              }
            />
            <VideosTable
              rows={(selectedVideos.data ?? []).filter(
                (video) => video.watch_id === selectedWatch,
              )}
              loading={selectedVideos.isLoading}
            />
          </section>
        )}

        {/* Activity feed */}
        <section>
          <SectionHeader title="Creator Upload Activity" subtitle="Recent events across all monitored channels." />
          <ActivityFeed rows={events.data ?? []} />
        </section>

      </div>
      <AddChannelDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// -------- Sub-components --------


function LiveMonitoringAnimation({
  watches,
  videos,
}: {
  watches: Awaited<ReturnType<typeof listChannelWatches>>;
  videos: Awaited<ReturnType<typeof listWatchVideos>>;
}) {
  const stream = useMemo(
    () =>
      [...videos]
        .sort(
          (a, b) =>
            new Date(b.detected_at).getTime() -
            new Date(a.detected_at).getTime(),
        )
        .slice(0, 30),
    [videos],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (stream.length <= 1) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % stream.length);
    }, 2400);

    return () => window.clearInterval(timer);
  }, [stream.length]);

  useEffect(() => {
    if (activeIndex >= stream.length) setActiveIndex(0);
  }, [activeIndex, stream.length]);

  const current = stream[activeIndex];
  const watch = watches.find((item) => item.id === current?.watch_id);

  const isScanning =
    current?.analysis_status === "pending" ||
    current?.analysis_status === "running";

  const isFailed = current?.analysis_status === "failed";

  const isReview =
    current?.review_status === "pending" ||
    current?.review_status === "escalated" ||
    (current?.risk_score ?? 0) >= 55;

  const state = isFailed
    ? "failed"
    : isScanning
      ? "scanning"
      : isReview
        ? "review"
        : "safe";

  const stateLabel =
    state === "failed"
      ? "Analysis failed"
      : state === "scanning"
        ? "Scanning"
        : state === "review"
          ? "Review"
          : "Safe";

  const stateDescription =
    state === "failed"
      ? current?.analysis_error ?? "Analysis could not be completed"
      : state === "scanning"
        ? "Checking title, aliases, captions and identity signals"
        : state === "review"
          ? "Potential subject risk routed for human review"
          : current?.classification === "informational"
            ? "Subject mention detected — no actionable risk confirmed"
            : "No actionable subject risk detected";

  const activeCount = watches.filter(
    (item) => item.status === "active",
  ).length;

  const completedCount = videos.filter(
    (video) => video.analysis_status === "completed",
  ).length;

  const reviewCount = videos.filter(
    (video) =>
      video.review_status === "pending" ||
      video.review_status === "escalated",
  ).length;

  const recent = stream.slice(0, 5);

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-950/55 p-5 shadow-[0_0_50px_rgba(8,145,178,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-400">
              Live threat monitoring
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              {activeCount > 0 ? "Monitoring active" : "Monitoring paused"}
            </span>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Real fetched videos move through subject analysis and review.
          </p>
        </div>

        <div className="flex gap-5 text-right">
          <div>
            <div className="text-xl font-semibold text-cyan-200">
              {completedCount}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Analyzed
            </div>
          </div>
          <div>
            <div className="text-xl font-semibold text-amber-300">
              {reviewCount}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Review
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-5 grid min-h-[260px] grid-cols-1 items-center gap-5 lg:grid-cols-[1fr_1.1fr_1fr]">
        <div className="relative flex min-h-[210px] flex-col items-center justify-center rounded-2xl border border-cyan-500/15 bg-cyan-950/10">
          <div className="absolute inset-6 animate-pulse rounded-full border border-cyan-400/10" />
          <div className="absolute inset-10 rounded-full border border-dashed border-cyan-300/20" />

          <div className="relative grid size-24 place-items-center rounded-full border border-cyan-300/40 bg-cyan-500/10 shadow-[0_0_45px_rgba(34,211,238,0.25)]">
            <div className="absolute inset-2 animate-ping rounded-full border border-cyan-300/20" />
            <ShieldCheck className="size-10 text-cyan-300" />
          </div>

          <div className="relative mt-4 text-center">
            <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-300/70">
              Protected identity
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Continuous subject protection
            </div>
          </div>
        </div>

        <div className="relative flex min-h-[230px] flex-col items-center justify-center">
          <div className="absolute left-0 right-0 top-1/2 h-px overflow-hidden bg-cyan-400/20">
            <div className="h-full w-1/3 animate-pulse bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
          </div>

          <div className="absolute left-3 top-[42%] size-2 animate-ping rounded-full bg-cyan-300" />
          <div className="absolute right-3 top-[57%] size-2 animate-ping rounded-full bg-blue-400 [animation-delay:700ms]" />

          <div className="relative z-10 flex items-center gap-3">
            {stream.slice(activeIndex, activeIndex + 3).map((video, index) => (
              <div
                key={`${video.id}-${index}`}
                className={`overflow-hidden rounded-lg border bg-slate-900 shadow-lg transition-all duration-700 ${
                  index === 0
                    ? "size-16 scale-110 border-cyan-300/70 shadow-cyan-500/20"
                    : "size-12 border-slate-600/50 opacity-60"
                }`}
              >
                {video.thumbnail_url ? (
                  <img
                    src={video.thumbnail_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="grid size-full place-items-center">
                    <Play className="size-4 text-slate-500" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="relative z-10 mt-5 max-w-[300px] text-center">
            <div className="truncate text-sm font-semibold text-slate-100">
              {watch?.channel_title ?? "Waiting for fetched videos"}
            </div>
            <div className="mt-1 truncate text-[10px] text-slate-500">
              {current?.title ?? "New uploads will enter the analysis stream"}
            </div>
          </div>
        </div>

        <div className="relative flex min-h-[210px] flex-col items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-900/35">
          <div className="relative grid size-28 place-items-center rounded-full border border-cyan-400/30">
            <div className="absolute inset-2 animate-spin rounded-full border border-dashed border-cyan-300/30 [animation-duration:5s]" />
            <div className="absolute inset-5 animate-ping rounded-full border border-blue-400/20" />
            <Radar className="size-10 animate-pulse text-cyan-300" />
          </div>

          <div className="mt-4 text-center">
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
              AI analysis engine
            </div>
            <div className="mt-1 text-xs text-slate-300">
              Alias + identity + captions
            </div>
          </div>
        </div>
      </div>

      <div
        className={`mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition-colors duration-500 ${
          state === "review"
            ? "border-amber-400/30 bg-amber-500/10"
            : state === "failed"
              ? "border-red-400/30 bg-red-500/10"
              : state === "scanning"
                ? "border-cyan-400/30 bg-cyan-500/10"
                : "border-emerald-400/30 bg-emerald-500/10"
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`grid size-10 shrink-0 place-items-center rounded-full ${
              state === "review"
                ? "bg-amber-400/15 text-amber-300"
                : state === "failed"
                  ? "bg-red-400/15 text-red-300"
                  : state === "scanning"
                    ? "bg-cyan-400/15 text-cyan-300"
                    : "bg-emerald-400/15 text-emerald-300"
            }`}
          >
            {state === "review" || state === "failed" ? (
              <AlertTriangle className="size-5" />
            ) : state === "scanning" ? (
              <Radar className="size-5 animate-spin" />
            ) : (
              <ShieldCheck className="size-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-semibold uppercase tracking-wider text-slate-100">
              {stateLabel}
            </div>
            <div className="truncate text-[10px] text-slate-400">
              {stateDescription}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-lg font-semibold text-slate-100">
            {current?.risk_score ?? 0}
            <span className="text-[10px] text-slate-500">/100</span>
          </div>
          <div className="text-[8px] uppercase tracking-wider text-slate-500">
            Current risk
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-5">
          {recent.map((video) => {
            const needsReview =
              video.review_status === "pending" ||
              video.review_status === "escalated" ||
              (video.risk_score ?? 0) >= 55;

            return (
              <div
                key={video.id}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-2"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    needsReview
                      ? "bg-amber-400"
                      : video.analysis_status === "completed"
                        ? "bg-emerald-400"
                        : "animate-pulse bg-cyan-400"
                  }`}
                />
                <div className="min-w-0">
                  <div className="truncate text-[9px] text-slate-300">
                    {video.title ?? "Untitled video"}
                  </div>
                  <div className="text-[8px] uppercase tracking-wider text-slate-600">
                    {needsReview
                      ? "Review"
                      : video.analysis_status === "completed"
                        ? "Cleared"
                        : video.analysis_status}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VerifiedUserCard({ summary, className }: { summary: Awaited<ReturnType<typeof getVerifiedUserSummary>> | undefined; className?: string }) {
  return (
    <Card className={`bg-slate-900/40 backdrop-blur border-slate-700/40 p-4 flex items-center gap-4 ${className ?? ""}`}>
      <div className="size-14 rounded-full bg-gradient-to-br from-cyan-500/30 to-slate-700/40 grid place-items-center overflow-hidden border border-slate-600/40">
        {summary?.avatarUrl ? <img src={summary.avatarUrl} alt="" className="size-full object-cover" /> : <ShieldCheck className="size-6 text-cyan-300" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold truncate">{summary?.displayName ?? "…"}</div>
          {summary?.verified && <Badge variant="outline" className="border-cyan-400/40 text-cyan-200 text-[10px]">VERIFIED</Badge>}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">Verified Eterna User</div>
        <div className="mt-3 grid grid-cols-4 gap-3 text-center">
          <Metric label="Channels" value={summary?.monitoredChannels ?? 0} />
          <Metric label="Active" value={summary?.activeChannels ?? 0} accent />
          <Metric label="Analyzed" value={summary?.videosAnalyzed ?? 0} />
          <Metric label="Review" value={summary?.newMatches ?? 0} coral={!!summary?.newMatches} />
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, accent, coral }: { label: string; value: number; accent?: boolean; coral?: boolean }) {
  return (
    <div>
      <div className={`text-lg font-semibold ${coral ? CORAL : accent ? CYAN : "text-slate-100"}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function GlobalStats({ summary, className }: { summary: Awaited<ReturnType<typeof getVerifiedUserSummary>> | undefined; className?: string }) {
  return (
    <Card className={`bg-slate-900/40 backdrop-blur border-slate-700/40 p-4 ${className ?? ""}`}>
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Exposure index</div>
      <div className="mt-2 flex items-end gap-2">
        <div className="text-4xl font-semibold text-slate-100">{summary?.exposureScore ?? 0}</div>
        <div className="text-xs text-slate-400 pb-1">/ 100</div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-cyan-400/50 via-cyan-300/60 to-orange-300/70" style={{ width: `${Math.min(100, summary?.exposureScore ?? 0)}%` }} />
      </div>
      <div className="mt-3 text-xs text-slate-400 leading-relaxed">
        Weighted from open review items across monitored channels. Human review confirms actual basis before enforcement.
      </div>
    </Card>
  );
}

function FlowGraph({ channelCount, videoCount, reviewCount }: { channelCount: number; videoCount: number; reviewCount: number }) {
  const nodes: Array<{ label: string; caption: string; color: string }> = [
    { label: "Verified User", caption: "1 protected identity", color: "#7dd3fc" },
    { label: "Monitored Channels", caption: `${channelCount} creators`, color: "#67e8f9" },
    { label: "Fetched Videos", caption: `${videoCount} tracked`, color: "#cbd5e1" },
    { label: "Analysis", caption: "Alias + face + captions", color: "#a5f3fc" },
    { label: "Review Queue", caption: `${reviewCount} pending`, color: reviewCount ? "#fdba74" : "#94a3b8" },
    { label: "Evidence + Continuous Watch", caption: "Loops back to channels", color: "#86efac" },
  ];
  return (
    <Card className="bg-slate-900/30 border-slate-700/40 p-6 relative overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-400 mb-4">Intelligence flow</div>
      <div className="relative">
        <svg viewBox="0 0 1200 120" className="w-full h-24">
          <defs>
            <linearGradient id="cwline" x1="0" x2="1">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#fdba74" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <path d="M 60 60 C 250 20, 400 100, 600 60 S 950 20, 1140 60" stroke="url(#cwline)" strokeWidth="1" fill="none" strokeDasharray="3 4" />
          <path d="M 1140 60 C 900 110, 400 120, 60 80" stroke="#67e8f9" strokeOpacity="0.15" strokeWidth="1" fill="none" strokeDasharray="2 6" />
        </svg>
        <div className="absolute inset-0 grid grid-cols-6 gap-2 px-2">
          {nodes.map((n) => (
            <div key={n.label} className="flex flex-col items-center justify-center text-center">
              <div className="size-3 rounded-full mb-2" style={{ background: n.color, boxShadow: `0 0 12px ${n.color}` }} />
              <div className="text-[11px] font-medium text-slate-200 leading-tight">{n.label}</div>
              <div className="text-[9px] uppercase tracking-[0.15em] text-slate-500 mt-1 leading-tight">{n.caption}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{subtitle ?? " "}</div>
        <div className="text-lg font-semibold text-slate-100">{title}</div>
      </div>
      {action}
    </div>
  );
}

function SkeletonRow() {
  return <Card className="p-6 bg-slate-900/30 border-slate-700/40 text-slate-500 text-sm">Loading…</Card>;
}

function MonitoredChannelCard({ watch, isSelected, onSelect, videos }: {
  watch: Awaited<ReturnType<typeof listChannelWatches>>[number];
  isSelected: boolean;
  onSelect: () => void;
  videos: Awaited<ReturnType<typeof listWatchVideos>>;
}) {
  const qc = useQueryClient();
  const scanFn = useServerFn(scanChannelNow);
  const historyFn = useServerFn(analyzeCurrentChannelVideos);
  const statusFn = useServerFn(setWatchStatus);
  const removeFn = useServerFn(removeChannelWatch);

  const scanMut = useMutation({
    mutationFn: () => scanFn({ data: { watchId: watch.id } }),
    onSuccess: (r) => { toast.success(`Scan complete — ${(r as { inserted?: number }).inserted ?? 0} new video(s)`); qc.invalidateQueries({ queryKey: ["cw"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const historyMut = useMutation({
    mutationFn: () => historyFn({
      data: {
        watchId: watch.id,
        count: 200,
      },
    }),
    onSuccess: (result) => {
      toast.success(
        `Analysis complete — ${
          (result as { analyzed?: number }).analyzed ?? 0
        } new video(s) analyzed from ${
          (result as { checked?: number }).checked ?? 0
        } checked`,
      );
      qc.invalidateQueries({ queryKey: ["cw"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const statusMut = useMutation({
    mutationFn: (status: "active" | "paused") => statusFn({ data: { watchId: watch.id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cw"] }),
  });
  const removeMut = useMutation({
    mutationFn: () => removeFn({ data: { watchId: watch.id } }),
    onSuccess: () => { toast.success("Channel removed"); qc.invalidateQueries({ queryKey: ["cw"] }); },
  });

  const statusColor = watch.status === "active" ? "text-emerald-300 border-emerald-500/40"
    : watch.status === "paused" ? "text-slate-400 border-slate-500/40"
      : "text-orange-300 border-orange-500/40";

  const analyzed = videos.filter((video) => video.analysis_status === "completed");
  const relevant = analyzed.filter(
    (video) =>
      video.classification &&
      video.classification !== "not_relevant" &&
      video.classification !== "informational" &&
      video.classification !== "commentary_no_violation",
  );

  // Mentions include informational subject matches. They are displayed
  // separately and are not automatically treated as violations.
  const subjectMentions = analyzed.filter(
    (video) =>
      video.classification &&
      video.classification !== "not_relevant",
  );

  const suspectedViolations = relevant.filter(
    (video) =>
      video.classification === "potential_impersonation" ||
      video.classification === "potential_harm" ||
      (video.risk_score ?? 0) >= 55,
  );

  const confirmedViolations = relevant.filter(
    (video) =>
      video.review_status === "approved" ||
      video.review_status === "escalated",
  );

  const criticalCount = relevant.filter((video) => (video.risk_score ?? 0) >= 85).length;
  const highCount = relevant.filter((video) => {
    const score = video.risk_score ?? 0;
    return score >= 70 && score < 85;
  }).length;
  const mediumCount = relevant.filter((video) => {
    const score = video.risk_score ?? 0;
    return score >= 40 && score < 70;
  }).length;
  const lowCount = relevant.filter((video) => {
    const score = video.risk_score ?? 0;
    return score > 0 && score < 40;
  }).length;

  const maximumRisk = relevant.reduce(
    (maximum, video) => Math.max(maximum, video.risk_score ?? 0),
    0,
  );

  // Evidence-based enforcement readiness. This is not a removal guarantee.
  const removalStrength = Math.min(
    100,
    Math.round(
      maximumRisk * 0.35 +
      confirmedViolations.length * 14 +
      suspectedViolations.length * 5 +
      criticalCount * 8 +
      highCount * 4,
    ),
  );

  const strengthLevel =
    removalStrength >= 85 ? "Critical" :
    removalStrength >= 70 ? "Very Strong" :
    removalStrength >= 50 ? "Strong" :
    removalStrength >= 30 ? "Moderate" :
    "Low";

  const strengthColor =
    removalStrength >= 85 ? "bg-red-800" :
    removalStrength >= 70 ? "bg-red-500" :
    removalStrength >= 50 ? "bg-orange-400" :
    removalStrength >= 30 ? "bg-yellow-400" :
    "bg-slate-500";

  const latestViolation = [...relevant]
    .filter((video) => video.detected_at)
    .sort(
      (a, b) =>
        new Date(b.detected_at).getTime() -
        new Date(a.detected_at).getTime(),
    )[0];

  return (
    <Card className={`relative bg-slate-900/40 backdrop-blur border p-4 transition-colors ${isSelected ? "border-cyan-400/60" : "border-slate-700/40"}`}>
      {(scanMut.isPending || historyMut.isPending) && (
        <ChannelScanOverlay
          channelName={watch.channel_title ?? watch.channel_id}
          subject={watch.reason}
          mode={historyMut.isPending ? "historical" : "new"}
        />
      )}
      <div className="flex items-start gap-3">
        <div className="size-11 rounded-lg overflow-hidden bg-slate-800 shrink-0">
          {watch.avatar_url ? <img src={watch.avatar_url} alt="" className="size-full object-cover" /> : <Users className="size-full p-2 text-slate-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{watch.channel_title ?? watch.channel_id}</div>
            <Badge variant="outline" className={`text-[9px] ${statusColor}`}>{watch.status.toUpperCase()}</Badge>
          </div>
          <div className="text-[11px] text-slate-500 truncate">{watch.handle ?? watch.channel_id}</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-400">
            <div>Subs: <span className="text-slate-200">{formatNumber(watch.subscriber_count)}</span></div>
            <div>Videos: <span className="text-slate-200">{formatNumber(watch.video_count)}</span></div>
            <div>Priority: <span className="text-slate-200 uppercase">{watch.priority}</span></div>
          </div>
          <div className="mt-2 text-[10px] text-cyan-200/80 truncate" title={watch.reason}>
            Monitoring for: {watch.reason}
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            Last checked {watch.last_checked_at ? formatDistanceToNow(new Date(watch.last_checked_at), { addSuffix: true }) : "never"}
            {watch.next_check_at && ` · next ${formatDistanceToNow(new Date(watch.next_check_at), { addSuffix: true })}`}
          </div>
          {watch.last_error && (
            <div className="mt-1 text-[10px] text-orange-300 flex items-center gap-1"><AlertTriangle className="size-3" />{watch.last_error}</div>
          )}
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/45 p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-lg font-semibold text-cyan-200">
              {subjectMentions.length}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Subject mentions
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold text-orange-200">
              {suspectedViolations.length}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Suspected risk
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold text-red-300">
              {confirmedViolations.length}
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Confirmed
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold text-cyan-200">
              {removalStrength}
              <span className="text-[10px] text-slate-500">/100</span>
            </div>
            <div className="text-[8px] uppercase tracking-wider text-slate-500">
              Removal strength
            </div>
          </div>
        </div>

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${strengthColor}`}
            style={{ width: `${removalStrength}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px]">
          <span className="font-semibold uppercase tracking-wider text-slate-300">
            {strengthLevel}
          </span>
          <span className="text-slate-500">
            Critical {criticalCount} · High {highCount} · Medium {mediumCount} · Low {lowCount}
          </span>
        </div>

        {latestViolation && (
          <div className="mt-1 text-[9px] text-slate-500">
            Latest relevant risk{" "}
            {formatDistanceToNow(new Date(latestViolation.detected_at), {
              addSuffix: true,
            })}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="border-slate-700 h-7 text-[11px]" onClick={onSelect}>
          <Eye className="size-3 mr-1" />{isSelected ? "Hide" : "View"} videos
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 border text-[11px] font-semibold shadow-sm hover:brightness-125 disabled:opacity-50"
          style={{
            backgroundColor: "#083344",
            color: "#a5f3fc",
            borderColor: "#0891b2",
          }}
          disabled={scanMut.isPending || historyMut.isPending}
          onClick={() => scanMut.mutate()}
        >
          <RefreshCw className={`size-3 mr-1 ${scanMut.isPending ? "animate-spin" : ""}`} />
          Scan new
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-8 border text-[11px] font-semibold shadow-sm hover:brightness-125 disabled:opacity-50"
          style={{
            backgroundColor: "#2e1065",
            color: "#ddd6fe",
            borderColor: "#8b5cf6",
          }}
          disabled={historyMut.isPending || scanMut.isPending}
          onClick={() => historyMut.mutate()}
        >
          <Radar className={`size-3 mr-1 ${historyMut.isPending ? "animate-pulse" : ""}`} />
          {historyMut.isPending ? "Analyzing captions…" : "Analyze next 10"}
        </Button>
        {watch.status === "active" ? (
          <Button size="sm" variant="outline" className="border-slate-700 h-7 text-[11px]" onClick={() => statusMut.mutate("paused")}>
            <Pause className="size-3 mr-1" />Pause
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="border-slate-700 h-7 text-[11px]" onClick={() => statusMut.mutate("active")}>
            <Play className="size-3 mr-1" />Resume
          </Button>
        )}
        <a href={watch.channel_url ?? "#"} target="_blank" rel="noreferrer">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]">
            <ExternalLink className="size-3 mr-1" />Open
          </Button>
        </a>
        <Button size="sm" variant="ghost" className="h-7 text-[11px] text-orange-300 hover:text-orange-200" onClick={() => { if (confirm("Remove this channel?")) removeMut.mutate(); }}>
          <Trash2 className="size-3 mr-1" />
        </Button>
      </div>
    </Card>
  );
}

function ChannelScanOverlay({
  channelName,
  subject,
  mode,
}: {
  channelName: string;
  subject: string;
  mode: "new" | "historical";
}) {
  const dots = Array.from({ length: 48 });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#030712]/95 backdrop-blur-xl">
      <div className="absolute inset-0 opacity-30" style={{
        background:
          "radial-gradient(circle at 50% 45%, rgba(34,211,238,.18), transparent 32%)," +
          "radial-gradient(circle at 35% 60%, rgba(59,130,246,.13), transparent 30%)",
      }} />

      <div className="relative flex w-full max-w-4xl flex-col items-center px-6 text-center">
        <div className="mb-6 text-[10px] uppercase tracking-[0.4em] text-cyan-300/70">
          Eterna continuous intelligence
        </div>

        <div className="relative size-[330px] sm:size-[430px]">
          <div className="absolute inset-0 rounded-full border border-cyan-300/10" />
          <div className="absolute inset-5 animate-[spin_14s_linear_infinite] rounded-full border border-dashed border-cyan-300/30" />
          <div className="absolute inset-10 animate-[spin_9s_linear_infinite_reverse] rounded-full border border-blue-400/25" />

          <div
            className="absolute inset-16 animate-pulse rounded-full"
            style={{
              background:
                "radial-gradient(circle at 40% 35%, rgba(255,255,255,.18), transparent 8%)," +
                "radial-gradient(circle at 45% 45%, rgba(34,211,238,.30), rgba(30,64,175,.20) 42%, rgba(2,6,23,.94) 72%)",
              boxShadow:
                "0 0 80px rgba(34,211,238,.18), inset 0 0 55px rgba(59,130,246,.22)",
            }}
          />

          <div className="absolute inset-12 animate-[spin_24s_linear_infinite]">
            {dots.map((_, index) => {
              const angle = (index / dots.length) * 360;
              const size = index % 5 === 0 ? 4 : 2;
              return (
                <span
                  key={index}
                  className="absolute left-1/2 top-1/2 rounded-full bg-cyan-200"
                  style={{
                    width: size,
                    height: size,
                    opacity: 0.25 + (index % 7) * 0.08,
                    transform:
                      `rotate(${angle}deg) translateY(-135px) rotate(-${angle}deg)`,
                    boxShadow: "0 0 8px rgba(103,232,249,.8)",
                  }}
                />
              );
            })}
          </div>

          <div className="absolute inset-[27%] animate-[spin_4s_linear_infinite] rounded-full border-t-2 border-r border-cyan-300/80" />
          <div className="absolute inset-[31%] animate-[spin_3s_linear_infinite_reverse] rounded-full border-b-2 border-l border-blue-400/70" />

          <div className="absolute inset-0 flex flex-col items-center justify-center px-16">
            <ShieldCheck className="mb-3 size-8 animate-pulse text-cyan-200" />
            <div className="text-[10px] uppercase tracking-[0.32em] text-cyan-300/70">
              {mode === "historical" ? "Historical channel analysis" : "Live channel scan"}
            </div>
            <div className="mt-3 max-w-[210px] truncate text-lg font-semibold text-white">
              {channelName}
            </div>
            <div className="mt-1 max-w-[220px] truncate text-xs text-cyan-100/70">
              Detecting content about {subject}
            </div>
          </div>

          <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-slate-950 px-3 py-1 text-[9px] uppercase tracking-widest text-cyan-200">
            Upload discovery
          </div>
          <div className="absolute bottom-8 left-0 rounded-full border border-blue-400/30 bg-slate-950 px-3 py-1 text-[9px] uppercase tracking-widest text-blue-200">
            Identity match
          </div>
          <div className="absolute bottom-8 right-0 rounded-full border border-violet-400/30 bg-slate-950 px-3 py-1 text-[9px] uppercase tracking-widest text-violet-200">
            Risk analysis
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-5 text-[10px] uppercase tracking-[0.18em] text-slate-400">
          <span className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-cyan-300" />
            {mode === "historical"
              ? "Fetching current channel videos"
              : "Fetching newest uploads"}
          </span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-blue-400 [animation-delay:300ms]" />
            Matching protected identity
          </span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-violet-400 [animation-delay:600ms]" />
            Preparing risk evidence
          </span>
        </div>

        <div className="mt-6 h-1 w-full max-w-md overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-1/2 animate-[scan-progress_2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500" />
        </div>

        <style>{`
          @keyframes scan-progress {
            0% { transform: translateX(-110%); }
            50% { transform: translateX(100%); }
            100% { transform: translateX(220%); }
          }
        `}</style>
      </div>
    </div>
  );
}

function VideosTable({ rows, loading }: { rows: Awaited<ReturnType<typeof listWatchVideos>>; loading: boolean }) {
  const [filter, setFilter] = useState<"all" | "baseline" | "new" | "review">("all");
  const filtered = useMemo(() => {
    if (filter === "baseline") return rows.filter((r) => r.is_baseline);
    if (filter === "new") return rows.filter((r) => !r.is_baseline);
    if (filter === "review") return rows.filter((r) => r.review_status === "pending");
    return rows;
  }, [rows, filter]);

  if (loading) return <SkeletonRow />;
  return (
    <Card className="bg-slate-900/30 border-slate-700/40 p-3">
      <div className="flex gap-1 mb-3">
        {(["all", "new", "baseline", "review"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full border ${filter === k ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-100" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}
          >
            {k}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 text-sm py-8">No videos yet.</div>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {filtered.map((v) => <VideoRow key={v.id} v={v} />)}
        </div>
      )}
    </Card>
  );
}

function VideoRow({ v }: { v: Awaited<ReturnType<typeof listWatchVideos>>[number] }) {
  const qc = useQueryClient();
  const reviewFn = useServerFn(submitReviewDecision);
  const removalFn = useServerFn(addWatchVideoToRemovalCenter);

  const removalMut = useMutation({
    mutationFn: () => removalFn({ data: { videoRowId: v.id } }),
    onSuccess: (result) => {
      toast.success(
        result.existing
          ? "Already available in Removal Center"
          : "Added to Removal Center with evidence",
      );
      qc.invalidateQueries({ queryKey: ["cw"] });
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const reviewMut = useMutation({
    mutationFn: (decision: "approved" | "dismissed" | "escalated") => reviewFn({ data: { videoRowId: v.id, decision } }),
    onSuccess: () => { toast.success("Review saved"); qc.invalidateQueries({ queryKey: ["cw"] }); },
  });
  const classColor = classificationColor(v.classification);
  return (
    <div className="flex gap-3 py-3 items-start">
      <img src={v.thumbnail_url ?? ""} alt="" className="w-32 h-18 object-cover rounded bg-slate-800 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a href={v.url ?? "#"} target="_blank" rel="noreferrer" className="text-sm font-medium truncate hover:text-cyan-200">{v.title ?? v.video_id}</a>
          {v.is_baseline ? (
            <Badge variant="outline" className="text-[9px] border-slate-500/40 text-slate-400">BASELINE</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] border-cyan-400/50 text-cyan-100">NEW</Badge>
          )}
          {v.classification && (
            <Badge variant="outline" className={`text-[9px] ${classColor}`}>{v.classification.replace(/_/g, " ").toUpperCase()}</Badge>
          )}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          {v.published_at ? `Published ${formatDistanceToNow(new Date(v.published_at), { addSuffix: true })}` : ""}
          {" · "}Views {formatNumber(v.view_count)} · Likes {formatNumber(v.like_count)}
          {typeof v.risk_score === "number" && <> · Risk <span className="text-slate-300">{v.risk_score}</span></>}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Analysis: <span className="text-slate-300">{v.analysis_status}</span>
          {v.analysis_error && <span className="text-orange-300"> — {v.analysis_error}</span>}
        </div>
        {v.analysis_status === "completed" &&
          v.classification &&
          v.classification !== "not_relevant" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-7 bg-cyan-500/20 border border-cyan-400/30 text-[10px] text-cyan-100 hover:bg-cyan-500/30"
                disabled={removalMut.isPending}
                onClick={() => removalMut.mutate()}
              >
                <ShieldCheck className="mr-1 size-3" />
                {removalMut.isPending
                  ? "Adding evidence…"
                  : "Add to Removal Center"}
              </Button>
              <a href="/removals">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-slate-700 text-[10px]"
                >
                  Open Removal Center
                </Button>
              </a>
            </div>
          )}

        {v.review_status === "pending" && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" className="h-6 text-[10px] bg-emerald-500/20 border border-emerald-400/30 text-emerald-100 hover:bg-emerald-500/30" onClick={() => reviewMut.mutate("approved")}>Confirm violation</Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] border-slate-700" onClick={() => reviewMut.mutate("dismissed")}>Dismiss</Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] border-orange-400/40 text-orange-200" onClick={() => reviewMut.mutate("escalated")}>Escalate legal</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFeed({ rows }: { rows: Awaited<ReturnType<typeof listRecentEvents>> }) {
  if (rows.length === 0) return <Card className="p-6 bg-slate-900/30 border-slate-700/40 text-slate-500 text-sm text-center">No activity yet.</Card>;
  return (
    <Card className="bg-slate-900/30 border-slate-700/40 p-3">
      <div className="divide-y divide-slate-800/60">
        {rows.map((e) => (
          <div key={e.id} className="py-2 flex items-center gap-3 text-xs">
            <Activity className="size-3 text-cyan-300/70" />
            <div className="flex-1 text-slate-300">{humanizeEvent(e.event_type)}</div>
            <div className="text-[10px] text-slate-500">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// -------- Add Channel Dialog --------

type Candidate = Awaited<ReturnType<typeof resolveChannelSearch>>[number];

function AddChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const searchFn = useServerFn(resolveChannelSearch);
  const addFn = useServerFn(addChannelWatch);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "standard" | "low">("standard");
  const [notes, setNotes] = useState("");
  const [analyzeExisting, setAnalyzeExisting] = useState(true);
  const [existingCount, setExistingCount] = useState(25);

  const searchMut = useMutation({
    mutationFn: () => searchFn({ data: { query: query.trim() } }),
    onSuccess: (r) => {
      setCandidates(r);
      if (r.length === 0) toast.error("No channel matched. Try a URL, @handle, or channel ID.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const addMut = useMutation({
    mutationFn: () => addFn({ data: {
      channelId: selected!.channelId, reason, priority, notes: notes || undefined,
      analyzeExisting, existingCount: analyzeExisting ? existingCount : 0,
    } }),
    onSuccess: () => {
      toast.success("Channel added. Baseline fetch running…");
      qc.invalidateQueries({ queryKey: ["cw"] });
      onOpenChange(false);
      reset();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function reset() {
    setQuery(""); setCandidates([]); setSelected(null); setReason(""); setNotes("");
    setPriority("standard"); setAnalyzeExisting(true); setExistingCount(25);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl bg-slate-950 border-slate-700 text-slate-100">
        <DialogHeader>
          <DialogTitle>Add Risk Channel</DialogTitle>
          <DialogDescription className="text-slate-400">
            Confirm the exact channel before adding — Eterna never monitors a channel from an uncertain name match.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            <Label>Channel name, @handle, YouTube URL or channel ID</Label>
            <div className="flex gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="@channelhandle or https://youtube.com/channel/UC…" className="bg-slate-900 border-slate-700" />
              <Button onClick={() => searchMut.mutate()} disabled={!query.trim() || searchMut.isPending} className="bg-cyan-500/20 border border-cyan-400/30 text-cyan-100">
                <Search className="size-4 mr-1" />{searchMut.isPending ? "Resolving…" : "Resolve"}
              </Button>
            </div>
            <div className="space-y-2">
              {candidates.map((c) => (
                <button key={c.channelId} onClick={() => setSelected(c)} className="w-full text-left p-3 rounded-lg border border-slate-700 hover:border-cyan-400/50 bg-slate-900/40 flex gap-3 items-center">
                  <img src={c.avatarUrl ?? ""} alt="" className="size-12 rounded-lg object-cover bg-slate-800" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{c.title}</div>
                      {c.handle && <span className="text-xs text-slate-400">{c.handle}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 line-clamp-2">{c.description}</div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {c.channelId} · Subs {formatNumber(c.subscriberCount ?? null)} · Videos {formatNumber(c.videoCount ?? null)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {c.recentThumbnails.slice(0, 3).map((t, i) => (
                      <img key={i} src={t} alt="" className="w-10 h-10 rounded object-cover" />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-900/60 border border-cyan-400/30">
              <img src={selected.avatarUrl ?? ""} alt="" className="size-12 rounded-lg" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{selected.title} {selected.handle && <span className="text-xs text-slate-400">{selected.handle}</span>}</div>
                <div className="text-[10px] text-slate-500">{selected.channelId}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Change</Button>
            </div>
            <div>
              <Label>Protected person/brand and aliases</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Renu Sudhi, Renu, രേണു സുധി"
                className="bg-slate-900 border-slate-700"
              />
              <div className="mt-1 text-[10px] text-slate-500">
                Separate English, Malayalam, Manglish names, brand names and handles with commas.
                Only uploads matching these identities will enter risk analysis.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monitoring priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
                  <SelectTrigger className="bg-slate-900 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical (30 min)</SelectItem>
                    <SelectItem value="high">High (60 min)</SelectItem>
                    <SelectItem value="standard">Standard (4 h)</SelectItem>
                    <SelectItem value="low">Low (12 h)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-slate-900 border-slate-700" />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-900/40 rounded border border-slate-700">
              <Switch checked={analyzeExisting} onCheckedChange={setAnalyzeExisting} />
              <div className="flex-1">
                <div className="text-sm">Fetch existing videos as baseline</div>
                <div className="text-[10px] text-slate-500">Historical videos are labelled BASELINE and are not presented as newly detected.</div>
              </div>
              {analyzeExisting && (
                <Input type="number" min={1} max={200} value={existingCount} onChange={(e) => setExistingCount(Math.max(1, Math.min(200, Number(e.target.value) || 25)))} className="w-20 bg-slate-900 border-slate-700" />
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => addMut.mutate()} disabled={!reason.trim() || addMut.isPending} className="bg-cyan-500/20 border border-cyan-400/30 text-cyan-100">
                <Radar className="size-4 mr-1" />{addMut.isPending ? "Adding…" : "Start monitoring"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -------- helpers --------

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function classificationColor(c: string | null | undefined): string {
  if (!c) return "border-slate-600/40 text-slate-400";
  if (c === "not_relevant") return "border-slate-600/40 text-slate-400";
  if (c === "informational" || c === "commentary_no_violation") return "border-slate-500/40 text-slate-300";
  return "border-orange-400/40 text-orange-200";
}

function humanizeEvent(t: string): string {
  const map: Record<string, string> = {
    channel_added: "Creator channel added",
    baseline_video_fetched: "Existing video fetched (baseline)",
    new_video_detected: "Creator uploaded new video",
    analysis_completed: "Analysis completed",
    historical_analysis_completed: "Current channel videos analyzed and scoring updated",
    enforcement_draft_created: "Relevant risk analyzed — takedown draft created",
    poll_failed: "Poll failed",
    watch_paused: "Monitoring paused",
    watch_resumed: "Monitoring resumed",
    review_approved: "Human review confirmed violation",
    review_dismissed: "Human review dismissed",
    review_escalated: "Escalated to legal review",
    added_to_removal_center: "Monitored evidence added to Removal Center",
  };
  return map[t] ?? t;
}
