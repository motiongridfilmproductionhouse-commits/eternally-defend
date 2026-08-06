import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  uploadCopyrightReference,
  runCopyrightScan,
  listCopyrightScans,
  getCopyrightScan,
  updateCopyrightMatch,
} from "@/lib/copyright.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ScanProgress, SCAN_STAGES } from "@/components/copyright/ScanProgress";
import { YoutubeMonitorPanel } from "@/components/copyright/YoutubeMonitorPanel";
import { DistributionMonitorPanel } from "@/components/copyright/DistributionMonitorPanel";

import InvestigationModal from "@/components/investigation/InvestigationModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  Copyright,
  Upload,
  Loader2,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Eye,
  XCircle,
  FileSearch,
  Film,
  Image as ImageIcon,
  Mail,
} from "lucide-react";

type MatchRow = {
  id: string;
  confidence: number;
  confidence_band: string;
  review_status: string;
  detection_type: string;
  platform?: string | null;
  thumbnail_url?: string | null;
  source_url: string;
  page_title?: string | null;
  reason?: string | null;
  transformations?: string[];
  ocr_text?: string | null;
  evidence?: Record<string, unknown>;
  contact?: Record<string, string | null>;
};

export const Route = createFileRoute("/_app/copyright-intel")({
  head: () => ({
    meta: [
      { title: "Copyright Intelligence Detection — Eterna" },
      {
        name: "description",
        content:
          "Detect unauthorized re-uploads, ripped copies, screenshots and edited derivatives of your protected artwork and video, with graded evidence for takedown preparation.",
      },
      { property: "og:title", content: "Copyright Intelligence Detection — Eterna" },
      {
        property: "og:description",
        content: "Evidence-graded detection of unauthorized copies of your protected visual works.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CopyrightIntelPage,
});

const BAND: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "90-100% EXACT", cls: "bg-red-600/15 text-red-400 border-red-600/40" },
  probable: {
    label: "70-89% PROBABLE",
    cls: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  },
  review: { label: "50-69% REVIEW", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40" },
};

const TYPE_LABEL: Record<string, string> = {
  reuploaded_artwork: "Re-uploaded artwork",
  poster_copy: "Poster copy",
  movie_screenshot: "Movie screenshot",
  trailer_copy: "Trailer copy",
  video_clip: "Video clip",
  cam_recording: "Leaked cam recording",
  ripped_copy: "Ripped copy",
  edited_derivative: "Edited derivative",
};

/** Sample frames from a video file entirely in the browser. */
async function extractFrames(file: File, count = 4): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not read the video file."));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const canvas = document.createElement("canvas");
  const frames: Blob[] = [];
  for (let i = 0; i < count; i++) {
    const t = duration > 0 ? ((i + 1) * duration) / (count + 1) : 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = t;
    });
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare video frame extraction.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (blob) frames.push(blob);
  }
  URL.revokeObjectURL(url);
  if (!frames.length) throw new Error("No frames could be extracted from this video.");
  return frames;
}

function CopyrightIntelPage() {
  const uploadFn = useServerFn(uploadCopyrightReference);
  const runFn = useServerFn(runCopyrightScan);
  const listFn = useServerFn(listCopyrightScans);
  const getFn = useServerFn(getCopyrightScan);
  const updFn = useServerFn(updateCopyrightMatch);
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [stageIndex, setStageIndex] = useState(0);
  const [previews, setPreviews] = useState<string[]>([]);
  const [scanMeta, setScanMeta] = useState<{ title: string; kind: "image" | "video" } | null>(null);
  const [summary, setSummary] = useState<{
    candidates: number;
    matches: number;
    graded: number;
  } | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [investigationOpen, setInvestigationOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<unknown>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "verified" | "review_required" | "rejected"
  >("all");
  const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };

  const scans = useQuery({ queryKey: ["copyright-scans"], queryFn: () => listFn({}) });

  // Auto-select the latest scan if none is manually selected yet
  useEffect(() => {
    if (!selectedScanId && scans.data && scans.data.length > 0) {
      setSelectedScanId(scans.data[0].id);
    }
  }, [scans.data, selectedScanId]);

  const detail = useQuery({
    queryKey: ["copyright-scan", selectedScanId],
    queryFn: () => {
      if (!selectedScanId) throw new Error("No scan selected.");
      return getFn({ data: { scanId: selectedScanId } });
    },
    enabled: !!selectedScanId,
  });

  const matches = useMemo(() => (detail.data?.matches ?? []) as MatchRow[], [detail.data]);

  // Diagnostic warning if stats.matches > 0 but 0 rows returned
  useEffect(() => {
    if (selectedScanId && detail.data) {
      const sStats = (detail.data.scan?.stats ?? {}) as Record<string, unknown>;
      const expectedMatches = Number(sStats.matches ?? 0);
      const returnedRows = detail.data.matches?.length ?? 0;
      if (expectedMatches > 0 && returnedRows === 0) {
        console.warn(
          `[CopyrightIntel] Diagnostic Warning: scan_id="${selectedScanId}" (title: "${detail.data.scan?.title}") has stats.matches=${expectedMatches} but copyright_matches query returned 0 rows.`,
        );
      }
    }
  }, [selectedScanId, detail.data]);

  const filteredMatches = useMemo(() => {
    if (statusFilter === "pending") return matches.filter((m) => m.review_status === "pending");
    if (statusFilter === "verified")
      return matches.filter((m) => m.confidence >= 90 || m.confidence_band === "confirmed");
    if (statusFilter === "review_required")
      return matches.filter(
        (m) => m.confidence_band === "probable" || m.review_status === "evidence_ready",
      );
    if (statusFilter === "rejected") return matches.filter((m) => m.review_status === "dismissed");
    return matches;
  }, [matches, statusFilter]);

  const scan = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Upload a reference image or video first.");
      if (!title.trim()) throw new Error("Name the protected work.");
      const isVideo = file.type.startsWith("video/");

      // Close the registration modal and switch to the live scanning interface.
      setRegisterOpen(false);
      setSelectedScanId(null);
      setSummary(null);
      setScanMeta({ title: title.trim(), kind: isVideo ? "video" : "image" });
      setStageIndex(0);
      setStage(isVideo ? "Extracting video frames…" : "Preparing reference…");

      const blobs: Blob[] = isVideo ? await extractFrames(file) : [file];
      setPreviews((old) => {
        old.forEach((u) => URL.revokeObjectURL(u));
        return blobs.map((b) => URL.createObjectURL(b));
      });

      const keys: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        setStage(`Uploading reference ${i + 1}/${blobs.length}…`);
        const contentType = isVideo
          ? "image/jpeg"
          : (file.type as "image/jpeg" | "image/png" | "image/webp");
        const base64 = await blobToBase64(blobs[i]);
        const { key } = await uploadFn({
          data: {
            fileName: isVideo ? `frame-${i}.jpg` : file.name,
            contentType,
            base64,
          },
        });
        keys.push(key);
      }

      setStageIndex(1);
      setStage("Analyzing visual content…");
      // Advance the visible stage while the server call runs.
      const timers = [
        setTimeout(() => {
          setStageIndex(2);
          setStage("Extracting important details…");
        }, 4000),
        setTimeout(() => {
          setStageIndex(3);
          setStage("Comparing online matches…");
        }, 12000),
        setTimeout(() => {
          setStageIndex(4);
          setStage("Generating report…");
        }, 30000),
      ];

      try {
        return await runFn({
          data: {
            title: title.trim(),
            referenceKind: isVideo ? "video" : "image",
            contentType: isVideo ? "image/jpeg" : (file.type as "image/jpeg"),
            keys,
          },
        });
      } finally {
        timers.forEach(clearTimeout);
      }
    },
    onSuccess: (res) => {
      setStage("");
      setStageIndex(SCAN_STAGES.length);
      setSummary({
        candidates: res.stats.candidates ?? 0,
        matches: res.stats.matches ?? 0,
        graded: res.stats.graded ?? 0,
      });
      setSelectedScanId(res.scanId);
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      toast.success(
        `${res.stats.matches} evidence-backed match(es) from ${res.stats.candidates} candidates`,
      );
    },
    onError: (e: Error) => {
      setStage("");
      setScanMeta(null);
      toast.error(e.message);
    },
  });

  const review = useMutation({
    mutationFn: (v: {
      matchId: string;
      reviewStatus: "pending" | "evidence_ready" | "dismissed";
    }) => updFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copyright-scan", selectedScanId] }),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5">
          <Copyright className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Copyright Intelligence Detection</h1>
        </div>
      </header>

      <section className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/60 p-5 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Register a protected work</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Register your original poster, artwork, image or video, then run evidence-graded
            detection for unauthorized copies.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setRegisterOpen(true)}>
          <Copyright className="mr-2 h-4 w-4" />
          Register copyright work
        </Button>
      </section>

      {scan.isPending && scanMeta && (
        <div className="animate-fade-in">
          <ScanProgress
            previews={previews}
            title={scanMeta.title}
            kind={scanMeta.kind}
            stageIndex={stageIndex}
            note={stage}
          />
        </div>
      )}

      {!scan.isPending && summary && scanMeta && (
        <section className="animate-fade-in rounded-xl border border-primary/30 bg-card/60 p-5 backdrop-blur">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Analysis complete · {scanMeta.title}</h2>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Sources checked", value: summary.candidates },
              { label: "Evidence graded", value: summary.graded },
              { label: "Matches found", value: summary.matches },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-border/50 bg-background/30 p-3"
              >
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          {previews.length > 0 && (
            <div className="mt-3 flex gap-1.5">
              {previews.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt={`Reference frame for ${scanMeta.title}`}
                  className="h-12 w-16 rounded border border-border/50 object-cover"
                />
              ))}
            </div>
          )}
        </section>
      )}

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-3xl overflow-hidden border-border/60 bg-card/95 p-0 backdrop-blur">
          <div className="grid md:grid-cols-[0.85fr_1fr]">
            <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary/30 via-primary/10 to-transparent p-6 md:flex">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/25 blur-3xl" />
              <div className="relative space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">
                    Eterna
                  </span>
                </div>
                <h3 className="text-2xl font-semibold leading-tight tracking-tight">
                  Register your copyright material
                </h3>
                <p className="text-xs text-muted-foreground">
                  Movie posters, artwork, trailers and full videos are supported as reference
                  sources.
                </p>
              </div>
              <ol className="relative mt-6 space-y-2">
                {[
                  "Name the protected work",
                  "Upload the original file",
                  "Run evidence-graded detection",
                ].map((s, i) => (
                  <li
                    key={s}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs backdrop-blur"
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span className="min-w-0 truncate">{s}</span>
                  </li>
                ))}
              </ol>
            </aside>

            <div className="space-y-4 p-6">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg">Upload Original Copyright Material</DialogTitle>
                <DialogDescription className="text-xs">
                  Upload the original poster, artwork, image, or video you want to protect. This
                  file will be used as a reference sample to identify possible unauthorized copies
                  and matches.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Protected work
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Vasantham — Official Poster"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Reference file
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => fileRef.current?.click()}
                >
                  {file ? (
                    <>
                      {file.type.startsWith("video/") ? (
                        <Film className="mr-2 h-4 w-4" />
                      ) : (
                        <ImageIcon className="mr-2 h-4 w-4" />
                      )}
                      <span className="truncate">{file.name}</span>
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Reference File
                    </>
                  )}
                </Button>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                  Poster • Artwork • Image • Video
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                You must upload the original copyrighted content as the reference source for
                detection. Videos are sampled into 4 keyframes in your browser before upload.
                Matches below 50% confidence, plus reviews, news and commentary, are discarded
                automatically.
              </p>
              {stage && <p className="text-xs text-muted-foreground">{stage}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setRegisterOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
                  {scan.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileSearch className="mr-2 h-4 w-4" />
                  )}
                  Run detection
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scans
          </h2>
          {(scans.data ?? []).map((s) => {
            const st = (s.stats ?? {}) as Record<string, number>;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedScanId(s.id)}
                className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                  selectedScanId === s.id
                    ? "border-primary/50 bg-primary/10"
                    : "border-border/60 bg-card/50 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{s.title}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {s.status}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.reference_kind} · {st.matches ?? 0} matches ·{" "}
                  {new Date(s.created_at).toLocaleDateString()}
                </div>
              </button>
            );
          })}
          {!scans.isLoading && !(scans.data ?? []).length && (
            <p className="text-xs text-muted-foreground">No detections yet.</p>
          )}
        </aside>

        <section className="space-y-3">
          {!selectedScanId && (
            <p className="text-sm text-muted-foreground">
              Select a scan to review graded evidence.
            </p>
          )}
          {selectedScanId && (
            <div className="space-y-4">
              {(() => {
                const sDetail = detail.data?.scan;
                const sStats = (sDetail?.stats ?? {}) as Record<string, unknown>;
                const verifiedCnt = matches.filter(
                  (m) => m.confidence >= 90 || m.confidence_band === "confirmed",
                ).length;
                const pendingCnt = matches.filter((m) => m.review_status === "pending").length;
                const reviewReqCnt = matches.filter(
                  (m) => m.confidence_band === "probable" || m.review_status === "evidence_ready",
                ).length;
                const rejectedCnt = matches.filter((m) => m.review_status === "dismissed").length;
                const candPages = sStats.candidate_pages ?? sStats.candidates ?? matches.length;
                const crwPages = sStats.crawled_pages ?? sStats.graded ?? matches.length;

                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5 backdrop-blur">
                      <div>
                        <div className="text-lg font-semibold">{matches.length}</div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Detected Threats
                        </div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-emerald-400">{verifiedCnt}</div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Verified
                        </div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-amber-400">{pendingCnt}</div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Pending Review
                        </div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold">{String(candPages)}</div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Candidate Pages
                        </div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold">{String(crwPages)}</div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Crawled Pages
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      {[
                        { id: "all", label: "All Findings", count: matches.length },
                        { id: "pending", label: "Pending Review", count: pendingCnt },
                        { id: "verified", label: "Verified", count: verifiedCnt },
                        { id: "review_required", label: "Review Required", count: reviewReqCnt },
                        { id: "rejected", label: "Rejected", count: rejectedCnt },
                      ].map((tab) => (
                        <Button
                          key={tab.id}
                          size="sm"
                          variant={statusFilter === tab.id ? "default" : "outline"}
                          onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                          className="h-7 text-xs"
                        >
                          {tab.label} ({tab.count})
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <Tabs defaultValue="sources">
                <TabsList>
                  <TabsTrigger value="sources">Suspicious sources</TabsTrigger>
                  <TabsTrigger value="youtube">YouTube monitoring</TabsTrigger>
                </TabsList>
                <TabsContent value="youtube" className="mt-3">
                  <YoutubeMonitorPanel scanId={selectedScanId} />
                </TabsContent>
                <TabsContent value="sources" className="mt-3 space-y-3">
                  {detail.isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {selectedScanId && !detail.isLoading && !filteredMatches.length && (
                    <div className="rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
                      No matches found under this filter for this reference.
                    </div>
                  )}

                  {filteredMatches.map((m) => {
                    const band = BAND[m.confidence_band] ?? BAND.review;
                    const ev = (m.evidence ?? {}) as Record<string, unknown>;
                    const contact = (m.contact ?? {}) as Record<string, string | null>;
                    const dist = (ev.distribution ?? null) as null | {
                      domain_risk?: string;
                      content_type?: string;
                      release_timing?: string;
                      release_offset_days?: number | null;
                      piracy_indicators?: Array<{ key: string; detail: string; strong?: boolean }>;
                      distribution_links?: string[];
                      quality_tags?: string[];
                    };
                    const riskCls =
                      dist?.domain_risk === "high"
                        ? "border-destructive/50 text-destructive"
                        : dist?.domain_risk === "medium"
                          ? "border-amber-500/50 text-amber-500"
                          : "text-muted-foreground";

                    return (
                      <article
                        key={m.id}
                        className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur"
                      >
                        <div className="flex gap-4">
                          {m.thumbnail_url && (
                            <img
                              src={m.thumbnail_url}
                              alt={`Matched evidence frame from ${m.platform ?? "source"}`}
                              loading="lazy"
                              className="h-24 w-24 shrink-0 rounded-lg border border-border/60 object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className={band.cls}>
                                {m.confidence}% · {band.label}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {TYPE_LABEL[m.detection_type] ?? m.detection_type}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {m.platform ?? "Unknown platform"}
                              </Badge>
                              {String(ev.discovery) === "piracy_lead" && (
                                <Badge variant="outline" className="text-[10px] text-primary">
                                  piracy lead
                                </Badge>
                              )}
                              {dist && (
                                <>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] uppercase ${riskCls}`}
                                  >
                                    {dist.domain_risk} risk domain
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]">
                                    {(dist.content_type ?? "").replace(/_/g, " ")}
                                  </Badge>
                                  {dist.release_timing && dist.release_timing !== "unknown" && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {dist.release_timing.replace(/_/g, " ")}
                                      {typeof dist.release_offset_days === "number"
                                        ? ` · +${dist.release_offset_days}d`
                                        : ""}
                                    </Badge>
                                  )}
                                </>
                              )}
                              {m.review_status !== "pending" && (
                                <Badge variant="outline" className="text-[10px]">
                                  {m.review_status.replace("_", " ")}
                                </Badge>
                              )}
                            </div>
                            <a
                              href={m.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 truncate text-sm text-primary hover:underline"
                            >
                              {m.page_title || m.source_url}{" "}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                            {m.reason && (
                              <p className="text-xs text-muted-foreground">{m.reason}</p>
                            )}
                            {dist?.piracy_indicators?.length ? (
                              <ul className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2">
                                {dist.piracy_indicators.slice(0, 6).map((i) => (
                                  <li
                                    key={i.key}
                                    className="flex gap-1.5 text-[11px] text-muted-foreground"
                                  >
                                    <span
                                      className={i.strong ? "text-destructive" : "text-primary"}
                                    >
                                      ●
                                    </span>
                                    <span>
                                      <span className="font-medium">
                                        {i.key.replace(/_/g, " ")}:
                                      </span>{" "}
                                      {i.detail}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {dist?.distribution_links?.length ? (
                              <p className="text-[11px] text-muted-foreground">
                                <span className="font-medium">Distribution links:</span>{" "}
                                {dist.distribution_links.length} detected
                                {" · "}
                                {dist.distribution_links.slice(0, 2).join(", ").slice(0, 120)}
                              </p>
                            ) : null}

                            {Array.isArray(m.transformations) && m.transformations.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {(m.transformations as string[]).map((t) => (
                                  <span
                                    key={t}
                                    className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                            {m.ocr_text && (
                              <p className="line-clamp-2 text-[11px] text-muted-foreground">
                                <span className="font-medium">OCR:</span> {m.ocr_text}
                              </p>
                            )}
                            {typeof ev.watermark === "string" && ev.watermark && (
                              <p className="text-[11px] text-muted-foreground">
                                <span className="font-medium">Watermark:</span> {ev.watermark}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                              {contact.abuseEmail && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {contact.abuseEmail}
                                </span>
                              )}
                              {contact.reportUrl && (
                                <a
                                  href={contact.reportUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 hover:underline"
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  Abuse / DMCA page
                                </a>
                              )}
                              {contact.note && (
                                <span className="flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {contact.note}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  review.mutate({ matchId: m.id, reviewStatus: "evidence_ready" })
                                }
                              >
                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                Mark evidence ready
                              </Button>

                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setSelectedMatch(m);
                                  setInvestigationOpen(true);
                                }}
                              >
                                Website Details
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  review.mutate({
                                    matchId: m.id,
                                    reviewStatus: "dismissed",
                                  })
                                }
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
                </TabsContent>
              </Tabs>
            </div>
          )}
        </section>
      </div>

      <section className="space-y-3 pt-6 border-t border-border/60">
        <div>
          <h2 className="text-sm font-semibold">
            Previously Monitored Sources & Automated Distribution Radar
          </h2>
          <p className="text-xs text-muted-foreground">
            Registered sources automatically re-crawled across background monitoring runs.
          </p>
        </div>
        <DistributionMonitorPanel />
      </section>

      <InvestigationModal
        open={investigationOpen}
        onOpenChange={setInvestigationOpen}
        match={selectedMatch}
      />
    </div>
  );
}
