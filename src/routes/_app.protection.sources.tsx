import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageCard } from "@/components/dashboard/PageCard";
import { Youtube, Loader2, Trash2, ExternalLink } from "lucide-react";
import {
  listApprovedSources,
  addApprovedYoutubeSource,
  removeApprovedSource,
} from "@/lib/protection/sources/approved-sources.functions";

export const Route = createFileRoute("/_app/protection/sources")({
  head: () => ({ meta: [{ title: "Approved YouTube Sources — Eterna AI" }] }),
  component: ApprovedSourcesPage,
});

interface SourceRow {
  id: string;
  source_kind: string;
  input_url: string;
  title: string | null;
  channel_title: string | null;
  thumbnail_url: string | null;
  status: string;
  youtube_video_id: string | null;
  youtube_channel_id: string | null;
}

interface VideoRow {
  id: string;
  source_id: string;
  title: string | null;
  thumbnail_url: string | null;
  url: string | null;
  classification: string | null;
  analysis_status: string;
  published_at: string | null;
}

const CLASSIFICATION_LABEL: Record<string, { label: string; className: string }> = {
  legitimate_appearance: {
    label: "Legitimate Appearance",
    className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
  },
  verified_deepfake: {
    label: "Verified Deepfake",
    className: "border-red-500/30 text-red-400 bg-red-500/10",
  },
  probable_deepfake: {
    label: "Probable Deepfake",
    className: "border-orange-500/30 text-orange-400 bg-orange-500/10",
  },
  not_subject: {
    label: "Not the Subject",
    className: "border-white/20 text-white/50 bg-white/5",
  },
  needs_review: {
    label: "Needs Review",
    className: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  },
};

function ClassificationBadge({ video }: { video: VideoRow }) {
  if (video.analysis_status === "pending" || video.analysis_status === "running") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] uppercase border-white/20 text-white/50 bg-white/5"
      >
        Analyzing…
      </Badge>
    );
  }
  if (video.analysis_status === "failed") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] uppercase border-red-500/30 text-red-400 bg-red-500/10"
      >
        Analysis Failed
      </Badge>
    );
  }
  const meta = video.classification ? CLASSIFICATION_LABEL[video.classification] : undefined;
  if (!meta) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] uppercase border-white/20 text-white/50 bg-white/5"
      >
        Pending
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={`text-[10px] uppercase ${meta.className}`}>
      {meta.label}
    </Badge>
  );
}

function ApprovedSourcesPage() {
  const fetchSources = useServerFn(listApprovedSources);
  const addSource = useServerFn(addApprovedYoutubeSource);
  const remove = useServerFn(removeApprovedSource);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["approved_youtube_sources"],
    queryFn: () => fetchSources(),
  });

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const sources = (data?.sources ?? []) as SourceRow[];
  const videos = (data?.videos ?? []) as VideoRow[];

  const handleAdd = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await addSource({ data: { url: url.trim() } });
      setUrl("");
      await refetch();
      toast.success("Source added and queued for analysis.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to add source");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Remove this approved source? Its discovered videos will also be removed."))
      return;
    setBusy(true);
    try {
      await remove({ data: { id } });
      await refetch();
      toast.success("Source removed");
    } catch {
      toast.error("Failed to remove source");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Approved YouTube Sources</h1>
        <p className="text-sm text-white/60 mt-1">
          Register YouTube channels or videos as known-legitimate. Approved channels are
          automatically checked for new uploads; every video is still run through face and deepfake
          matching — a genuine appearance is marked legitimate, a manipulated one is still flagged
          for review.
        </p>
      </div>

      <PageCard title="Add a source">
        <div className="flex gap-2">
          <Input
            placeholder="YouTube channel URL or video URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <Button onClick={handleAdd} disabled={!url.trim() || busy} className="shrink-0">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Add Source"}
          </Button>
        </div>
      </PageCard>

      {isLoading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </div>
      ) : sources.length === 0 ? (
        <div className="border border-dashed border-white/20 rounded-xl p-8 text-center text-white/50 text-sm">
          No approved sources yet. Add a channel or video URL above.
        </div>
      ) : (
        <div className="space-y-4">
          {sources.map((source) => {
            const sourceVideos = videos.filter((v) => v.source_id === source.id);
            const displayTitle = source.title ?? source.channel_title ?? source.input_url;
            return (
              <PageCard key={source.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {source.thumbnail_url ? (
                      <img
                        src={source.thumbnail_url}
                        alt=""
                        className="size-12 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="size-12 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
                        <Youtube className="size-5 text-red-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{displayTitle}</div>
                      <a
                        href={source.input_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 hover:underline flex items-center gap-1 truncate"
                      >
                        {source.input_url} <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase border-white/20 text-white/60 bg-white/5"
                    >
                      {source.source_kind}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${
                        source.status === "active"
                          ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                          : "border-white/20 text-white/60 bg-white/5"
                      }`}
                    >
                      {source.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-white/40 hover:text-red-400 hover:bg-white/10"
                      onClick={() => handleRemove(source.id)}
                      disabled={busy}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>

                {source.source_kind === "channel" && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="text-xs text-white/50 mb-2">
                      Discovered uploads ({sourceVideos.length})
                    </div>
                    {sourceVideos.length === 0 ? (
                      <div className="text-xs text-white/40">
                        No uploads discovered yet — checked automatically every 30–60 minutes.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {sourceVideos.map((v) => (
                          <div
                            key={v.id}
                            className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-lg p-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {v.thumbnail_url && (
                                <img
                                  src={v.thumbnail_url}
                                  alt=""
                                  className="size-8 rounded object-cover shrink-0"
                                />
                              )}
                              <span className="text-sm text-white/80 truncate">{v.title}</span>
                            </div>
                            <ClassificationBadge video={v} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {source.source_kind === "video" && sourceVideos[0] && (
                  <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                    <span className="text-xs text-white/50">Analysis result</span>
                    <ClassificationBadge video={sourceVideos[0]} />
                  </div>
                )}
              </PageCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
