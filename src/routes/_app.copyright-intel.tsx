import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  uploadCopyrightReference, runCopyrightScan, listCopyrightScans,
  getCopyrightScan, updateCopyrightMatch,
} from "@/lib/copyright.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ScanProgress } from "@/components/copyright/ScanProgress";
import { BrightDataProviderPanel } from "@/components/copyright/BrightDataProviderPanel";
import { YoutubeMonitorPanel } from "@/components/copyright/YoutubeMonitorPanel";
import { DistributionMonitorPanel } from "@/components/copyright/DistributionMonitorPanel";

import InvestigationModal from "@/components/investigation/InvestigationModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  diagnosticsFromStats,
  explainZeroMatchFunnel,
  providerFailureCategoryLines,
  summarizeProviderFailures,
} from "@/lib/copyright/scan-diagnostics";
import { PROVIDER_FAILURE_CATEGORIES } from "@/lib/copyright/provider-failures";
import {
  scopedScanMatches,
  shouldShowAnalysisBanner,
} from "@/lib/copyright/scan-scope";
import { CRAWL_FAILURE_CATEGORIES } from "@/lib/copyright/crawl-failure";

import {
  Copyright, Upload, Loader2, ExternalLink, ShieldCheck, AlertTriangle,
  Eye, XCircle, FileSearch, Film, Image as ImageIcon, Mail,
} from "lucide-react";

export const Route = createFileRoute("/_app/copyright-intel")({
  head: () => ({
    meta: [
      { title: "Copyright Intelligence Detection — Eterna" },
      { name: "description", content: "Detect unauthorized re-uploads, ripped copies, screenshots and edited derivatives of your protected artwork and video, with graded evidence for takedown preparation." },
      { property: "og:title", content: "Copyright Intelligence Detection — Eterna" },
      { property: "og:description", content: "Evidence-graded detection of unauthorized copies of your protected visual works." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CopyrightIntelPage,
});

const BAND: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "90-100% EXACT", cls: "bg-red-600/15 text-red-400 border-red-600/40" },
  probable: { label: "70-89% PROBABLE", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  review: { label: "50-69% REVIEW", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40" },
};

const TYPE_LABEL: Record<string, string> = {
  VERIFIED_UNAUTHORIZED_STREAM: "Verified unauthorized stream",
  PROBABLE_UNAUTHORIZED_STREAM: "Probable unauthorized stream",
  DOWNLOAD_PAGE: "Download page",
  FILE_HOST_DISTRIBUTION: "File-host distribution",
  TORRENT_OR_MAGNET: "Torrent or magnet",
  VIDEO_HOST_REUPLOAD: "Video-host reupload",
  THEATRE_PRINT_DISTRIBUTION: "Theatre-print distribution",
  MIRROR_OR_REDIRECT: "Mirror or redirect",
  DUPLICATE_ARTWORK_ONLY: "Duplicate artwork only",
  OFFICIAL_OR_AUTHORIZED: "Official or authorized",
  TRAILER_OR_PROMO: "Trailer or promo",
  CINEMA_OR_SHOWTIME: "Cinema or showtime",
  REVIEW_OR_NEWS: "Review or news",
  CAST_OR_INFORMATION: "Cast or information",
  SOCIAL_DISCUSSION: "Social discussion",
  CATALOG_OR_LISTING: "Catalog or listing",
  OFFICIAL_OR_AUTHORIZED_PAGE: "Official or authorized page",
  TRAILER_OR_PROMOTIONAL: "Trailer or promotional",
  INVESTIGATION_LEAD: "Investigation lead",
  UNVERIFIED_LEAD: "Unverified lead",
  UNRELATED: "Unrelated",
  // Legacy rows (should not appear as client-visible piracy)
  reuploaded_artwork: "Re-uploaded artwork",
  poster_copy: "Poster copy",
  movie_screenshot: "Movie screenshot",
  trailer_copy: "Trailer or promo",
  video_clip: "Video clip",
  cam_recording: "Theatre-print distribution",
  ripped_copy: "Unverified lead",
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
  const [knownUrlsText, setKnownUrlsText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const [scanMeta, setScanMeta] = useState<{ title: string; kind: "image" | "video" } | null>(null);
  const [summary, setSummary] = useState<{ candidates: number; matches: number; graded: number } | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [investigationOpen, setInvestigationOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  };

  const scans = useQuery({
    queryKey: ["copyright-scans"],
    queryFn: () => listFn({}),
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((s) => s.status === "queued" || s.status === "running" || s.status === "pending") ? 2500 : false;
    },
  });
  const detail = useQuery({
    queryKey: ["copyright-scan", selectedScanId],
    queryFn: () => {
      if (!selectedScanId) throw new Error("No scan selected.");
      return getFn({ data: { scanId: selectedScanId } });
    },
    enabled: !!selectedScanId,
    // Never reuse a previous scan's findings while a new selection is loading.
    placeholderData: undefined,
    refetchInterval: (q) => {
      const status = q.state.data?.scan?.status;
      return status === "queued" || status === "running" || status === "pending" ? 2500 : false;
    },
  });

  const selectedScanRow = (scans.data ?? []).find((s) => s.id === selectedScanId) ?? null;
  const selectedScanStatus = selectedScanRow?.status ?? detail.data?.scan?.status ?? null;

  // Bind banner/summary only for terminal selected-scan stats — never flash zeros as "complete".
  useEffect(() => {
    if (!selectedScanId) return;
    const selected = (scans.data ?? []).find((s) => s.id === selectedScanId);
    if (!selected) return;
    setScanMeta((prev) =>
      prev && prev.title === selected.title
        ? prev
        : { title: selected.title, kind: selected.reference_kind === "video" ? "video" : "image" },
    );
    if (selected.status === "queued" || selected.status === "running" || selected.status === "pending") {
      setSummary(null);
      return;
    }
    const st = (selected.stats ?? {}) as Record<string, number>;
    setSummary({
      candidates: st.candidates ?? st.provider_candidates ?? 0,
      matches: st.matches ?? st.client_visible_findings ?? 0,
      graded: st.graded ?? 0,
    });
  }, [selectedScanId, scans.data]);

  const selectScan = (scanId: string) => {
    // Reset result state immediately so prior findings cannot flash.
    setSelectedScanId(scanId);
    setSelectedMatch(null);
    setInvestigationOpen(false);
    setSummary(null);
  };

  const scan = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Upload a reference image or video first.");
      if (!title.trim()) throw new Error("Name the protected work.");
      const isVideo = file.type.startsWith("video/");

      // Close the registration modal and switch to the live scanning interface.
      // Reset selected result state immediately when a new scan starts.
      setRegisterOpen(false);
      setSelectedScanId(null);
      setSummary(null);
      setSelectedMatch(null);
      setInvestigationOpen(false);
      setScanMeta({ title: title.trim(), kind: isVideo ? "video" : "image" });
      setStage(isVideo ? "Extracting video frames…" : "Preparing reference…");

      const blobs: Blob[] = isVideo ? await extractFrames(file) : [file];
      setPreviews((old) => {
        old.forEach((u) => URL.revokeObjectURL(u));
        return blobs.map((b) => URL.createObjectURL(b));
      });

      const keys: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        setStage(`Uploading reference ${i + 1}/${blobs.length}…`);
        const contentType = isVideo ? "image/jpeg" : (file.type as "image/jpeg" | "image/png" | "image/webp");
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

      setStage("Starting copyright scan…");

      const knownUrls = knownUrlsText
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter(Boolean)
        .slice(0, 10);

      // Immediate scan ID — does NOT mean discovery completed.
      return await runFn({
        data: {
          title: title.trim(),
          referenceKind: isVideo ? "video" : "image",
          contentType: isVideo ? "image/jpeg" : (file.type as "image/jpeg"),
          keys,
          ...(knownUrls.length ? { knownUrls } : {}),
        },
      });
    },
    onSuccess: (res: { scanId: string; started?: boolean; status?: string }) => {
      setSelectedScanId(res.scanId);
      setSummary(null);
      setStage("");
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["copyright-scan", res.scanId] });
      toast.message("Scan queued — discovery will update here automatically.");
    },
    onError: async (e: Error) => {
      setStage("");
      toast.error(e.message);
      await qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      const rows = qc.getQueryData<Array<{ id: string; title: string; status: string }>>([
        "copyright-scans",
      ]);
      const failedMatch = rows?.find(
        (row) => row.title === scanMeta?.title && row.status === "failed",
      );
      if (failedMatch) {
        setSelectedScanId(failedMatch.id);
      } else {
        setScanMeta(null);
        setSummary(null);
      }
    },
  });

  const scanBusy =
    scan.isPending ||
    selectedScanStatus === "queued" ||
    selectedScanStatus === "running" ||
    selectedScanStatus === "pending";

  useEffect(() => {
    if (!selectedScanId) return;
    if (selectedScanStatus === "completed" || selectedScanStatus === "partial" || selectedScanStatus === "failed") {
      if (scan.isPending) scan.reset();
      setStage("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScanStatus, selectedScanId]);


  const review = useMutation({
    mutationFn: (v: { matchId: string; reviewStatus: "pending" | "evidence_ready" | "dismissed" }) => updFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copyright-scan", selectedScanId] }),
  });

  const detailAligned =
    !!selectedScanId &&
    !!detail.data?.scan?.id &&
    detail.data.scan.id === selectedScanId &&
    !detail.isLoading;
  const matches = scopedScanMatches(selectedScanId, detail.data, {
    isLoading: detail.isLoading,
  });
  const selectedScanTitle =
    detailAligned && detail.data?.scan?.title
      ? detail.data.scan.title
      : (scans.data ?? []).find((s) => s.id === selectedScanId)?.title ?? null;
  const showBanner =
    !scanBusy &&
    (selectedScanStatus === "completed" || selectedScanStatus === "partial") &&
    shouldShowAnalysisBanner({
      scanPending: false,
      selectedScanId,
      bannerTitle: scanMeta?.title,
      selectedScanTitle,
    });

  const activeScanStats = (
    detailAligned && detail.data?.scan?.stats
      ? detail.data.scan.stats
      : selectedScanRow?.stats ?? {}
  ) as Record<string, unknown>;

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
            Register your original poster, artwork, image or video, then run evidence-graded detection for unauthorized copies.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setRegisterOpen(true)}>
          <Copyright className="mr-2 h-4 w-4" />Register copyright work
        </Button>
      </section>

      {scanBusy && scanMeta && (
        <div className="animate-fade-in">
          <ScanProgress
            previews={previews}
            title={scanMeta.title}
            kind={scanMeta.kind}
            scanStatus={selectedScanStatus}
            scanId={selectedScanId}
            stats={activeScanStats}
          />
          {stage && (
            <p className="mt-2 text-center text-xs text-muted-foreground">{stage}</p>
          )}
        </div>
      )}

      {!scanBusy && selectedScanId && detailAligned && (
        <BrightDataProviderPanel
          stats={activeScanStats}
          scanStatus={selectedScanStatus}
          className="animate-fade-in"
        />
      )}

      {selectedScanStatus === "failed" && selectedScanId && detailAligned && (() => {
        const scanStats = (detail.data?.scan?.stats ?? {}) as Record<string, unknown>;
        const providerFailCats = providerFailureCategoryLines(scanStats);
        const providerSamples = Array.isArray(scanStats.provider_failure_samples)
          ? (scanStats.provider_failure_samples as Array<Record<string, unknown>>)
          : [];
        const failureSummary = summarizeProviderFailures(scanStats);
        const baseMessage =
          (detail.data?.scan?.error as string | null) ||
          (scanStats.failure_reason as string | undefined) ||
          "Discovery never completed. This is not a legitimate zero-result scan.";
        return (
          <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
            <h2 className="text-sm font-semibold text-destructive">Scan failed · {selectedScanTitle}</h2>
            <p className="mt-2 text-xs text-muted-foreground">{baseMessage}</p>
            {failureSummary && (
              <p className="mt-2 text-xs text-muted-foreground">
                Provider failures by category: {failureSummary}.
                {providerFailCats.some((r) => r.category === "authentication_failed") &&
                  " Check FIRECRAWL_API_KEY and LOVABLE_API_KEY (for lovc_ gateway keys)."}
                {providerFailCats.some((r) => r.category === "rate_limited") &&
                  " Discovery batches Firecrawl in groups of 3 with circuit breaker — retry the scan."}
                {Boolean(scanStats.firecrawl_operator_action) &&
                  ` ${String(scanStats.firecrawl_operator_action)}`}
              </p>
            )}
            {providerFailCats.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {PROVIDER_FAILURE_CATEGORIES.filter((c) =>
                  providerFailCats.some((r) => r.category === c),
                ).map((c) => {
                  const count = providerFailCats.find((r) => r.category === c)?.count ?? 0;
                  return (
                    <Badge key={c} variant="outline" className="text-[10px]">
                      {c}: {count}
                    </Badge>
                  );
                })}
              </div>
            )}
            {providerSamples.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {providerSamples.slice(0, 4).map((row, idx) => (
                  <li key={`${String(row.query)}-${idx}`} className="leading-relaxed">
                    • {String(row.category ?? "unknown")}: {String(row.detail ?? "n/a")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}

      {showBanner && summary && scanMeta && (
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
              <div key={s.label} className="rounded-lg border border-border/50 bg-background/30 p-3">
                <div className="text-lg font-semibold">{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
          {previews.length > 0 && (
            <div className="mt-3 flex gap-1.5">
              {previews.map((src) => (
                <img key={src} src={src} alt={`Reference frame for ${scanMeta.title}`}
                  className="h-12 w-16 rounded border border-border/50 object-cover" />
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
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">Eterna</span>
                </div>
                <h3 className="text-2xl font-semibold leading-tight tracking-tight">Register your copyright material</h3>
                <p className="text-xs text-muted-foreground">
                  Movie posters, artwork, trailers and full videos are supported as reference sources.
                </p>
              </div>
              <ol className="relative mt-6 space-y-2">
                {["Name the protected work", "Upload the original file", "Run evidence-graded detection"].map((s, i) => (
                  <li key={s} className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs backdrop-blur">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">{i + 1}</span>
                    <span className="min-w-0 truncate">{s}</span>
                  </li>
                ))}
              </ol>
            </aside>

            <div className="space-y-4 p-6">
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-lg">Upload Original Copyright Material</DialogTitle>
                <DialogDescription className="text-xs">
                  Upload the original poster, artwork, image, or video you want to protect. This file will be used as a reference sample to identify possible unauthorized copies and matches.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Protected work</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vasantham — Official Poster" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Investigate known URLs (optional)
                </label>
                <textarea
                  value={knownUrlsText}
                  onChange={(e) => setKnownUrlsText(e.target.value)}
                  placeholder={"https://example.com/movie/title-detail\nOne URL per line · max 10 · http/https only"}
                  rows={3}
                  className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <p className="text-[11px] text-muted-foreground">
                  Seeds exact-page investigation only. Domains are never auto-labelled illegal; each URL still needs title identity and distribution-access evidence.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Reference file</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button variant="outline" className="w-full justify-start" onClick={() => fileRef.current?.click()}>
                  {file
                    ? <>{file.type.startsWith("video/") ? <Film className="mr-2 h-4 w-4" /> : <ImageIcon className="mr-2 h-4 w-4" />}<span className="truncate">{file.name}</span></>
                    : <><Upload className="mr-2 h-4 w-4" />Upload Reference File</>}
                </Button>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">Poster • Artwork • Image • Video</p>
              </div>

              <p className="text-xs text-muted-foreground">
                You must upload the original copyrighted content as the reference source for detection. Videos are sampled into 4 keyframes in your browser before upload. Matches below 50% confidence, plus reviews, news and commentary, are discarded automatically.
              </p>
              {stage && <p className="text-xs text-muted-foreground">{stage}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setRegisterOpen(false)}>Cancel</Button>
                <Button onClick={() => scan.mutate()} disabled={scanBusy}>
                  {scanBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSearch className="mr-2 h-4 w-4" />}
                  Run detection
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>


      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">

        <aside className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scans</h2>
          {(scans.data ?? []).map((s) => {
            const st = (s.stats ?? {}) as Record<string, number>;
            return (
              <button
                key={s.id}
                onClick={() => selectScan(s.id)}
                className={`w-full rounded-lg border p-3 text-left text-sm transition ${
                  selectedScanId === s.id ? "border-primary/50 bg-primary/10" : "border-border/60 bg-card/50 hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{s.title}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{s.status}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.reference_kind} · {st.matches ?? 0} matches · {new Date(s.created_at).toLocaleDateString()}
                </div>
              </button>
            );
          })}
          {!scans.isLoading && !(scans.data ?? []).length && (
            <p className="text-xs text-muted-foreground">No detections yet.</p>
          )}
        </aside>

        <section className="space-y-3">
          {!selectedScanId && <p className="text-sm text-muted-foreground">Select a scan to review graded evidence.</p>}
          {selectedScanId && (
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
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading findings for the selected scan…
            </p>
          )}
          {selectedScanId && !detail.isLoading && detail.isError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              Could not load findings for this scan. {detail.error instanceof Error ? detail.error.message : "Please try again."}
            </p>
          )}
          {selectedScanId && !detail.isLoading && !detail.isError && !detailAligned && (
            <p className="text-sm text-muted-foreground">
              Waiting for selected-scan findings…
            </p>
          )}
          {detailAligned && !matches.length && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
              <p>
                No client-visible unauthorized-distribution findings for{" "}
                <span className="font-medium text-foreground">{selectedScanTitle ?? "this scan"}</span>.
                Pages need exact-title identity plus exact-page access evidence (player,
                download, file-host, torrent/magnet, or theatre-print). Cinema,
                trailers, reviews, cast, news, social and artwork-only matches stay rejected.
              </p>
              {(() => {
                const scanStats = (detail.data?.scan?.stats ?? {}) as Record<string, unknown>;
                const funnel =
                  Array.isArray(scanStats.rejection_funnel) && scanStats.rejection_funnel.length
                    ? (scanStats.rejection_funnel as string[])
                    : explainZeroMatchFunnel(scanStats);
                const d = diagnosticsFromStats(scanStats);
                const failByCat = (scanStats.crawl_failed_by_category ?? {}) as Record<string, number>;
                const knownFailures = Array.isArray(scanStats.known_url_failure_reasons)
                  ? (scanStats.known_url_failure_reasons as Array<Record<string, unknown>>)
                  : [];
                return (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        { label: "Known URLs submitted", value: Number(scanStats.known_urls_submitted ?? d.known_urls_submitted) },
                        { label: "Known URLs attempted", value: Number(scanStats.known_urls_attempted ?? d.known_urls_attempted) },
                        { label: "Known URLs retrieved", value: Number(scanStats.known_urls_retrieved ?? d.known_urls_retrieved) },
                        { label: "Known URLs rendered", value: Number(scanStats.known_urls_rendered ?? d.known_urls_rendered) },
                        { label: "Known URLs verified", value: Number(scanStats.known_urls_verified ?? d.known_urls_verified) },
                        {
                          label: "Known URLs rejected",
                          value:
                            Number(scanStats.known_urls_rejected ?? 0) +
                            Number(scanStats.known_urls_rejected_after_crawl ?? 0),
                        },
                        { label: "Provider candidates", value: Number(scanStats.provider_candidates ?? d.provider_results) },
                        { label: "Provider requests", value: Number(scanStats.provider_requests ?? d.queries_executed) },
                        { label: "Provider successes", value: Number(scanStats.provider_successes ?? 0) },
                        { label: "Provider failures", value: Number(scanStats.provider_failures ?? 0) },
                        { label: "Telegram candidates", value: Number(scanStats.telegram_candidates ?? 0) },
                        { label: "Crawl succeeded", value: Math.max(0, d.pages_crawled - d.pages_failed) },
                        { label: "Crawl failed", value: d.pages_failed },
                        { label: "Title rejected", value: d.title_identity_rejected },
                        { label: "Access evidence missing", value: d.access_evidence_rejected },
                        { label: "Official/catalog/promo", value: d.official_authorized_rejected + d.catalog_listing_rejected + d.youtube_promotional_rejected },
                        { label: "Client-visible findings", value: d.client_visible_findings },
                        { label: "Monitored sources created", value: Number(scanStats.registered_monitored_sources ?? d.registered_monitored_sources) },
                        { label: "Unique pages", value: d.unique_candidate_pages },
                        { label: "Detail follows", value: d.detail_pages_followed },
                        {
                          label: "Executor started",
                          value: scanStats.executor_started_at
                            ? String(scanStats.executor_started_at).slice(11, 19)
                            : "—",
                        },
                      ].map((row) => (
                        <div key={row.label} className="rounded-md border border-border/50 bg-background/40 px-3 py-2">
                          <div className="text-sm font-medium text-foreground">{row.value}</div>
                          <div className="text-[10px] uppercase tracking-wide">{row.label}</div>
                        </div>
                      ))}
                    </div>
                    {CRAWL_FAILURE_CATEGORIES.some((c) => (failByCat[c] ?? 0) > 0) && (
                      <div className="rounded-md border border-border/50 bg-background/30 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Crawl failed by category</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {CRAWL_FAILURE_CATEGORIES.filter((c) => (failByCat[c] ?? 0) > 0).map((c) => (
                            <Badge key={c} variant="outline" className="text-[10px]">
                              {c}: {failByCat[c]}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {providerFailureCategoryLines(scanStats).length > 0 && (
                      <div className="rounded-md border border-border/50 bg-background/30 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Provider failures by category</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {providerFailureCategoryLines(scanStats).map(({ category, count }) => (
                            <Badge key={category} variant="outline" className="text-[10px]">
                              {category}: {count}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {knownFailures.length > 0 && (
                      <div className="rounded-md border border-border/50 bg-background/30 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Known URL failure reasons</p>
                        <ul className="mt-2 space-y-1 text-xs">
                          {knownFailures.slice(0, 6).map((row, idx) => (
                            <li key={`${String(row.url)}-${idx}`} className="leading-relaxed">
                              • {String(row.url ?? "url")} — {String(row.category ?? "unknown")}: {String(row.reason ?? "n/a")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <ul className="space-y-1.5 text-xs">
                      {funnel.map((line) => (
                        <li key={line} className="leading-relaxed">• {line}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          )}


          {detailAligned && matches.map((m) => {
            const band = BAND[m.confidence_band] ?? BAND.review;
            const ev = (m.evidence ?? {}) as Record<string, unknown>;
            const contact = (m.contact ?? {}) as Record<string, string | null>;
            const dist = (ev.distribution ?? null) as null | {
              domain_risk?: string;
              content_type?: string;
              classification?: string;
              release_timing?: string;
              release_offset_days?: number | null;
              piracy_indicators?: Array<{ key: string; detail: string; strong?: boolean }>;
              distribution_links?: string[];
              quality_tags?: string[];
              identity_evidence?: string[];
              access_evidence?: string[];
              confidence_breakdown?: {
                identity?: number;
                access?: number;
                releaseWindow?: number;
                penalties?: number;
              };
              evidence_screenshot?: string | null;
              embed_sources?: string[];
            };
            const classification = dist?.classification ?? m.detection_type;
            const riskCls =
              dist?.domain_risk === "high" ? "border-destructive/50 text-destructive"
              : dist?.domain_risk === "medium" ? "border-amber-500/50 text-amber-500"
              : "text-muted-foreground";
            const host = typeof ev.host === "string" ? ev.host : null;
            const canonical = m.source_url;
            const breakdown = dist?.confidence_breakdown;

            return (
              <article key={m.id} className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
                <div className="flex gap-4">
                  {(dist?.evidence_screenshot || m.thumbnail_url) && (
                    <img
                      src={dist?.evidence_screenshot || m.thumbnail_url || ""}
                      alt={`Matched evidence frame from ${m.platform ?? "source"}`}
                      loading="lazy"
                      className="h-24 w-24 shrink-0 rounded-lg border border-border/60 object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={band.cls}>{m.confidence}% · {band.label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[classification] ?? classification}</Badge>
                      <Badge variant="outline" className="text-[10px]">{m.platform ?? "Unknown platform"}</Badge>
                      {host && <Badge variant="outline" className="text-[10px]">{host}</Badge>}
                      {dist && (
                        <>
                          <Badge variant="outline" className={`text-[10px] uppercase ${riskCls}`}>
                            {dist.domain_risk} risk
                          </Badge>
                          {dist.release_timing && dist.release_timing !== "unknown" && (
                            <Badge variant="outline" className="text-[10px]">
                              {dist.release_timing.replace(/_/g, " ")}
                              {typeof dist.release_offset_days === "number" ? ` · +${dist.release_offset_days}d` : ""}
                            </Badge>
                          )}
                        </>
                      )}
                      {m.review_status !== "pending" && (
                        <Badge variant="outline" className="text-[10px]">{m.review_status.replace("_", " ")}</Badge>
                      )}
                    </div>
                    <a href={canonical} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-sm text-primary hover:underline">
                      Open verified evidence page <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="truncate text-[11px] text-muted-foreground">{m.page_title || canonical}</p>
                    {m.reason && (
                      <p className="text-xs text-muted-foreground">
                        {m.reason} Evidence for rights-holder review — not a final legal determination.
                      </p>
                    )}
                    {(dist?.identity_evidence?.length || dist?.access_evidence?.length) ? (
                      <div className="space-y-1 text-[11px] text-muted-foreground">
                        {dist?.identity_evidence?.length ? (
                          <p><span className="font-medium">Title identity:</span> {dist.identity_evidence.join(", ")}</p>
                        ) : null}
                        {dist?.access_evidence?.length ? (
                          <p><span className="font-medium">Distribution access:</span> {dist.access_evidence.slice(0, 3).join(" ")}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {breakdown && (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium">Confidence:</span>{" "}
                        identity {breakdown.identity ?? 0} · access {breakdown.access ?? 0}
                        · release {breakdown.releaseWindow ?? 0}
                        {(breakdown.penalties ?? 0) > 0 ? ` · penalties -${breakdown.penalties}` : ""}
                      </p>
                    )}
                    {dist?.piracy_indicators?.length ? (
                      <ul className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2">
                        {dist.piracy_indicators.slice(0, 6).map((i) => (
                          <li key={i.key} className="flex gap-1.5 text-[11px] text-muted-foreground">
                            <span className={i.strong ? "text-destructive" : "text-primary"}>●</span>
                            <span><span className="font-medium">{i.key.replace(/_/g, " ")}:</span> {i.detail}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {dist?.distribution_links?.length ? (
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-medium">Player / download / file-host / torrent:</span>{" "}
                        {dist.distribution_links.slice(0, 3).map((link, idx) => (
                          <span key={link}>
                            {idx > 0 ? " · " : ""}
                            {link.startsWith("magnet:") ? (
                              <span className="break-all">{link.slice(0, 64)}…</span>
                            ) : /^https?:\/\//i.test(link) ? (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                                {link.slice(0, 80)}
                              </a>
                            ) : (
                              link.slice(0, 80)
                            )}
                          </span>
                        ))}
                      </p>
                    ) : null}

                    {Array.isArray(m.transformations) && m.transformations.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(m.transformations as string[]).map((t) => (
                          <span key={t} className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                        ))}
                      </div>
                    )}
                    {m.ocr_text && (
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        <span className="font-medium">OCR:</span> {m.ocr_text}
                      </p>
                    )}
                    {typeof ev.watermark === "string" && ev.watermark && (
                      <p className="text-[11px] text-muted-foreground"><span className="font-medium">Watermark:</span> {ev.watermark}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      {contact.abuseEmail && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{contact.abuseEmail}</span>}
                      {contact.reportUrl && (
                        <a href={contact.reportUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
                          <ShieldCheck className="h-3 w-3" />Abuse / DMCA page
                        </a>
                      )}
                      {contact.note && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{contact.note}</span>}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline"
                        onClick={() => review.mutate({ matchId: m.id, reviewStatus: "evidence_ready" })}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" />Mark evidence ready
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
          )}
        </section>

      </div>

      {/* Global monitor — clearly separate from selected-scan findings */}
      <DistributionMonitorPanel />

<InvestigationModal
  open={investigationOpen}
  onOpenChange={setInvestigationOpen}
  match={selectedMatch}
/>
    </div>
  );
}
