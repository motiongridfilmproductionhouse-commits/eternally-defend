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
  listAllCopyrightMatches,
  archivePreviousCopyrightResults,
  archiveScanCopyrightResults,
  retryCopyrightScan,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  ChevronDown,
  ChevronUp,
  Trash2,
  Archive,
  RefreshCw,
  Info,
  Bug,
} from "lucide-react";

type MatchRow = {
  id: string;
  scan_id?: string;
  user_id?: string;
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

const TYPE_LABEL: Record<string, string> = {
  exact_image: "exact copy",
  exact_video: "exact video match",
  reupload: "re-upload",
  video_clip: "video clip / trailer",
  cropped: "cropped / framed",
  resized: "resized copy",
  watermarked: "watermark removed/added",
  poster_derivative: "poster derivative",
  fan_art: "fan art / derivative",
  meme: "meme / parody",
  derivative: "derivative work",
  ripped_copy: "ripped copy / distribution lead",
};

const BAND: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "High Confidence Match (≥90%)", cls: "border-primary/50 text-primary" },
  probable: { label: "Probable Match (70-89%)", cls: "border-emerald-500/50 text-emerald-400" },
  review: { label: "Review Required (50-69%)", cls: "border-amber-500/50 text-amber-400" },
  dismissed: { label: "Dismissed (<50% or benign)", cls: "border-muted text-muted-foreground" },
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
  const listAllFn = useServerFn(listAllCopyrightMatches);
  const archivePreviousFn = useServerFn(archivePreviousCopyrightResults);
  const archiveScanFn = useServerFn(archiveScanCopyrightResults);

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

  const [showPreviousResults, setShowPreviousResults] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("copyright_show_previous_results") === "true";
    }
    return false;
  });

  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [archivingScanId, setArchivingScanId] = useState<string | null>(null);

  const retryFn = useServerFn(retryCopyrightScan);
  const [showAdminDiagnostics, setShowAdminDiagnostics] = useState(false);
  const [showProviderFailures, setShowProviderFailures] = useState(false);

  const retryScanMutation = useMutation({
    mutationFn: async (scanId: string) => {
      console.log("[CopyrightIntelUI] Retrying scan", { scanId });
      return await retryFn({ data: { scanId } });
    },
    onSuccess: (_, scanId) => {
      toast.success("Scan retry initiated. Updating progress...");
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["copyright-scan", scanId] });
      qc.invalidateQueries({ queryKey: ["all-copyright-matches"] });
    },
    onError: (err: Error) => {
      toast.error(`Retry failed: ${err.message}`);
    },
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("copyright_show_previous_results", String(showPreviousResults));
    }
  }, [showPreviousResults]);

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

  const allMatchesQuery = useQuery({
    queryKey: ["all-copyright-matches"],
    queryFn: () => listAllFn({}),
  });

  const allMatches = useMemo(
    () => (allMatchesQuery.data ?? []) as MatchRow[],
    [allMatchesQuery.data],
  );

  const currentMatches = useMemo(() => (detail.data?.matches ?? []) as MatchRow[], [detail.data]);

  const previousMatches = useMemo(
    () => allMatches.filter((m) => m.scan_id !== selectedScanId),
    [allMatches, selectedScanId],
  );

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

  const filteredCurrentMatches = useMemo(() => {
    if (statusFilter === "pending")
      return currentMatches.filter((m) => m.review_status === "pending");
    if (statusFilter === "verified")
      return currentMatches.filter((m) => m.confidence >= 90 || m.confidence_band === "confirmed");
    if (statusFilter === "review_required")
      return currentMatches.filter(
        (m) => m.confidence_band === "probable" || m.review_status === "evidence_ready",
      );
    if (statusFilter === "rejected")
      return currentMatches.filter((m) => m.review_status === "dismissed");
    return currentMatches;
  }, [currentMatches, statusFilter]);

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
        candidates: res.summary.candidates,
        matches: res.summary.matches,
        graded: res.summary.graded,
      });
      setSelectedScanId(res.scanId);
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["all-copyright-matches"] });
      toast.success(
        `${res.summary.matches} evidence-backed match(es) from ${res.summary.candidates} candidates`,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["copyright-scan", selectedScanId] });
      qc.invalidateQueries({ queryKey: ["all-copyright-matches"] });
    },
  });

  const clearPreviousMutation = useMutation({
    mutationFn: async () => {
      if (!selectedScanId) throw new Error("No active scan selected.");
      console.log("[CopyrightIntelUI] Sending archivePreviousCopyrightResults request", {
        keepScanId: selectedScanId,
      });
      const res = await archivePreviousFn({ data: { keepScanId: selectedScanId } });
      console.log("[CopyrightIntelUI] Received archivePreviousCopyrightResults response:", res);
      return res;
    },
    onSuccess: (res) => {
      console.log(
        "[CopyrightIntelUI] Clear previous succeeded. Closing dialog and invalidating queries.",
      );
      setClearDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["copyright-scan"] });
      qc.invalidateQueries({ queryKey: ["all-copyright-matches"] });
      toast.success(`Archived ${res.archivedCount} previous scan finding(s)`);
    },
    onError: (err: Error) => {
      console.error("[CopyrightIntelUI] Clear previous error:", err);
      toast.error(err.message || "Failed to archive previous scan results.");
    },
  });

  const archiveScanMutation = useMutation({
    mutationFn: async (scanId: string) => {
      console.log("[CopyrightIntelUI] Sending archiveScanCopyrightResults request", { scanId });
      const res = await archiveScanFn({ data: { scanId } });
      console.log("[CopyrightIntelUI] Received archiveScanCopyrightResults response:", res);
      return { res, scanId };
    },
    onSuccess: ({ res, scanId }) => {
      console.log(
        "[CopyrightIntelUI] Archive scan succeeded. Closing dialog and invalidating queries.",
      );
      if (selectedScanId === scanId) {
        setSelectedScanId(null);
      }
      setArchivingScanId(null);
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["copyright-scan"] });
      qc.invalidateQueries({ queryKey: ["all-copyright-matches"] });
      toast.success(`Archived ${res.archivedCount} finding(s) for scan`);
    },
    onError: (err: Error) => {
      console.error("[CopyrightIntelUI] Archive scan error:", err);
      toast.error(err.message || "Failed to archive scan results.");
    },
  });

  const renderMatchArticle = (m: MatchRow) => {
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
        className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur transition hover:border-primary/30"
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
                  <Badge variant="outline" className={`text-[10px] uppercase ${riskCls}`}>
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
              {m.page_title || m.source_url} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            {m.reason && <p className="text-xs text-muted-foreground">{m.reason}</p>}
            {dist?.piracy_indicators?.length ? (
              <ul className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2">
                {dist.piracy_indicators.slice(0, 6).map((i) => (
                  <li key={i.key} className="flex gap-1.5 text-[11px] text-muted-foreground">
                    <span className={i.strong ? "text-destructive" : "text-primary"}>●</span>
                    <span>
                      <span className="font-medium">{i.key.replace(/_/g, " ")}:</span> {i.detail}
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
                onClick={() => review.mutate({ matchId: m.id, reviewStatus: "evidence_ready" })}
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
  };

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
            scanStatus="running"
<<<<<<< HEAD
            scanId={selectedScanId}
=======
>>>>>>> 89d191a (fix copyright scan stalls and failure state handling)
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
            const isSelected = selectedScanId === s.id;
            return (
              <div
                key={s.id}
                className={`group relative rounded-lg border p-3 text-left text-sm transition ${
                  isSelected
                    ? "border-primary/50 bg-primary/10"
                    : "border-border/60 bg-card/50 hover:border-primary/30"
                }`}
              >
                <button
                  onClick={() => setSelectedScanId(s.id)}
                  className="w-full text-left focus:outline-none"
                >
                  <div className="flex items-center justify-between gap-2 pr-6">
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

                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    setArchivingScanId(s.id);
                  }}
                  title="Archive Results for this Scan"
                  className="absolute right-2 top-2 h-6 w-6 opacity-60 hover:opacity-100 group-hover:opacity-100"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            );
          })}
          {!scans.isLoading && !(scans.data ?? []).length && (
            <p className="text-xs text-muted-foreground">No detections yet.</p>
          )}
        </aside>

        <section className="space-y-6">
          {!selectedScanId && (
            <p className="text-sm text-muted-foreground">
              Select a scan to review graded evidence.
            </p>
          )}

          {selectedScanId && (
            <div className="space-y-6">
              {(() => {
                const selectedScan = scans.data?.find((s) => s.id === selectedScanId);
                const sDetail = detail.data?.scan ?? selectedScan;
                const sStats = (sDetail?.stats ?? {}) as Record<string, unknown>;
                const scanStatus = String(sDetail?.status ?? selectedScan?.status ?? "completed");

                return (
                  <div className="space-y-4">
                    {/* Failure Banner */}
                    {scanStatus === "failed" && (
                      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-5 text-destructive backdrop-blur space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-base font-semibold">
                              <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                              <span>Scan incomplete — results unavailable</span>
                            </div>
                            <p className="text-xs text-foreground/90">
                              This scan could not complete successfully, so Eterna cannot determine whether unauthorized copies exist yet.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={retryScanMutation.isPending}
                            onClick={() => {
                              if (selectedScanId) retryScanMutation.mutate(selectedScanId);
                            }}
                            className="shrink-0 font-medium"
                          >
                            {retryScanMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            {retryScanMutation.isPending ? "Retrying…" : "Retry Scan"}
                          </Button>
                        </div>
                        {Boolean(sDetail?.error || sStats.failure_reason) && (
                          <div className="rounded bg-background/50 p-2 text-xs font-mono text-muted-foreground truncate border border-border/40">
                            Reason: {String(sDetail?.error || sStats.failure_reason || "")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Partial Warning Banner */}
                    {scanStatus === "partial" && (
                      <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-amber-400 backdrop-blur space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                              <span>Scan completed with limited coverage</span>
                            </div>
                            <p className="text-xs text-foreground/90">
                              Some discovery routes failed and findings may be incomplete. Existing findings remain visible.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={retryScanMutation.isPending}
                            onClick={() => {
                              if (selectedScanId) retryScanMutation.mutate(selectedScanId);
                            }}
                            className="shrink-0 border-amber-500/50 text-amber-400 hover:bg-amber-500/20"
                          >
                            {retryScanMutation.isPending ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            {retryScanMutation.isPending ? "Retrying…" : "Re-run Scan"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Admin Diagnostics Panel */}
                    <div className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Bug className="h-4 w-4 text-primary" />
                          <span>Admin Scan Diagnostics</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setShowAdminDiagnostics(!showAdminDiagnostics)}
                        >
                          {showAdminDiagnostics ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                          {showAdminDiagnostics ? "Hide Diagnostics" : "Show Diagnostics"}
                        </Button>
                      </div>

                      {showAdminDiagnostics && (
                        <div className="space-y-3 pt-2 text-xs border-t border-border/40">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Current Stage</span>
                              <span className="font-semibold">{String(sStats.current_stage || sStats.stage || scanStatus)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Failed Stage</span>
                              <span className="font-semibold text-destructive">{String(sStats.failed_stage || sStats.error_stage || (scanStatus === "failed" ? "discovery" : "None"))}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Failure Code</span>
                              <span className="font-mono font-semibold text-destructive">{String(sStats.failure_code || sStats.error_code || (scanStatus === "failed" ? "EXECUTION_ERROR" : "N/A"))}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Failure Message</span>
                              <span className="truncate font-semibold text-destructive">{String(sStats.failure_reason || sStats.error || sDetail?.error || "None")}</span>
                            </div>

                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Queries Generated</span>
                              <span className="font-semibold">{String(sStats.queries_generated ?? 0)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Providers Attempted</span>
                              <span className="font-semibold">{String(sStats.provider_requests_started ?? sStats.providers_attempted ?? 0)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Successful Provider Requests</span>
                              <span className="font-semibold text-emerald-400">{String(sStats.provider_requests_succeeded ?? sStats.provider_successes ?? 0)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Candidate Pages Discovered</span>
                              <span className="font-semibold">{String(sStats.unique_candidate_urls ?? sStats.candidate_pages ?? 0)}</span>
                            </div>

                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Pages Crawled</span>
                              <span className="font-semibold">{String(sStats.pages_crawled ?? sStats.crawled_pages ?? 0)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Findings Persisted</span>
                              <span className="font-semibold">{String(sStats.findings_verified ?? sStats.total_matches ?? currentMatches.length)}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Worker Started At</span>
                              <span className="font-semibold truncate">{String(sStats.executor_started_at || sStats.started_at || sDetail?.created_at || "N/A")}</span>
                            </div>
                            <div className="rounded bg-background/50 p-2 border border-border/40">
                              <span className="text-[10px] text-muted-foreground uppercase block font-medium">Last Heartbeat</span>
                              <span className="font-semibold truncate">{String(sStats.last_heartbeat || sStats.updated_at || "N/A")}</span>
                            </div>
                          </div>

                          {Number(sStats.provider_requests_failed ?? sStats.provider_failures ?? 0) > 0 && (
                            <div className="pt-2 border-t border-border/40">
                              <button
                                onClick={() => setShowProviderFailures(!showProviderFailures)}
                                className="flex items-center justify-between w-full text-xs font-semibold text-destructive hover:underline py-1"
                              >
                                <span>Provider Failures ({String(sStats.provider_requests_failed ?? sStats.provider_failures ?? 0)})</span>
                                <span>{showProviderFailures ? "▲ Hide" : "▼ Show"}</span>
                              </button>
                              {showProviderFailures && (
                                <div className="mt-2 space-y-1 bg-background/40 p-2.5 rounded border border-border/40 font-mono text-[11px]">
                                  <div className="text-muted-foreground">Sanitized Provider Failure Categories:</div>
                                  <div className="text-destructive flex items-center gap-2">
                                    <span>• Provider Rate Limit / Quota Exceeded (Sanitized status 429)</span>
                                  </div>
                                  <div className="text-amber-400 flex items-center gap-2">
                                    <span>• Provider Request Timeout (Sanitized status 408)</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Current Scan Results Section */}
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">Current Scan Results</h2>
                      <span className="text-xs text-muted-foreground">
                        Showing {currentMatches.length} finding(s) for current active scan
                      </span>
                    </div>

                    {(() => {
                      const verifiedCnt = currentMatches.filter(
                        (m) => m.confidence >= 90 || m.confidence_band === "confirmed",
                      ).length;
                      const pendingCnt = currentMatches.filter(
                        (m) => m.review_status === "pending",
                      ).length;
                      const reviewReqCnt = currentMatches.filter(
                        (m) => m.confidence_band === "probable" || m.review_status === "evidence_ready",
                      ).length;
                      const rejectedCnt = currentMatches.filter(
                        (m) => m.review_status === "dismissed",
                      ).length;
                      const candPages =
                        sStats.candidate_pages ?? sStats.candidates ?? currentMatches.length;
                      const crwPages = sStats.crawled_pages ?? sStats.graded ?? currentMatches.length;

                      const piracyStreamingCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        const wType = String(ev.website_type ?? "");
                        return wType === "unauthorized_streaming" || wType === "mirror_or_redirect";
                      }).length;

                      const downloadFileHostsCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        const wType = String(ev.website_type ?? "");
                        return (
                          wType === "download_page" ||
                          wType === "file_host" ||
                          wType === "torrent_index"
                        );
                      }).length;

                      const videoReuploadsCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        return String(ev.website_type ?? "") === "video_host_reupload";
                      }).length;

                      const socialDistCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        return String(ev.website_type ?? "") === "social_distribution_lead";
                      }).length;

                      const reviewNewsCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        return String(ev.website_type ?? "") === "review_or_news";
                      }).length;

                      const officialExcludedCnt = currentMatches.filter((m) => {
                        const ev = (m.evidence ?? {}) as Record<string, unknown>;
                        const wType = String(ev.website_type ?? "");
                        return wType === "official_or_authorized" || wType === "unrelated";
                      }).length;

                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5 backdrop-blur">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-lg font-semibold">{currentMatches.length}</span>
                                {scanStatus === "failed" && (
                                  <Badge variant="destructive" className="text-[9px] uppercase px-1.5 py-0">
                                    SCAN INCOMPLETE
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Detected Threats {scanStatus === "failed" ? "(Unreliable)" : ""}
                              </div>
                            </div>
                            <div>
                              <div className="text-lg font-semibold text-emerald-400">
                                {verifiedCnt}
                              </div>
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

                          {/* Source-Category Counters */}
                          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 rounded-lg border border-border/40 bg-muted/30 p-2 text-xs">
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-destructive">
                                {piracyStreamingCnt}
                              </span>
                              <div className="text-[9px] text-muted-foreground">Piracy / Streaming</div>
                            </div>
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-amber-500">
                                {downloadFileHostsCnt}
                              </span>
                              <div className="text-[9px] text-muted-foreground">Download / Lockers</div>
                            </div>
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-purple-400">{videoReuploadsCnt}</span>
                              <div className="text-[9px] text-muted-foreground">Video Reuploads</div>
                            </div>
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-sky-400">{socialDistCnt}</span>
                              <div className="text-[9px] text-muted-foreground">Social Leads</div>
                            </div>
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-muted-foreground">
                                {reviewNewsCnt}
                              </span>
                              <div className="text-[9px] text-muted-foreground">Review / News</div>
                            </div>
                            <div className="text-center p-1 rounded bg-card/40">
                              <span className="font-semibold text-muted-foreground">
                                {officialExcludedCnt}
                              </span>
                              <div className="text-[9px] text-muted-foreground">
                                Official / Excluded
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            {[
                              { id: "all", label: "All Findings", count: currentMatches.length },
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
                        {selectedScanId && !detail.isLoading && !filteredCurrentMatches.length && (
                          <div>
                            {scanStatus === "failed" ? (
                              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive font-medium flex items-center gap-2">
                                <XCircle className="h-5 w-5 shrink-0" />
                                <span>Scan incomplete — results unavailable due to scan failure. Click "Retry Scan" above to run this scan again.</span>
                              </div>
                            ) : scanStatus === "queued" || scanStatus === "running" ? (
                              <div className="rounded-lg border border-primary/40 bg-primary/5 p-6 text-sm text-primary flex items-center gap-3">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <span>Scan in progress... Searching piracy indices and analyzing reference material.</span>
                              </div>
                            ) : scanStatus === "partial" ? (
                              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 text-sm text-amber-400 flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 shrink-0" />
                                <span>Scan completed with limited coverage. No qualifying matches found in completed discovery routes.</span>
                              </div>
                            ) : (
                              <div className="rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground flex items-center gap-2">
                                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                                <span>No qualifying matches found in this scan.</span>
                              </div>
                            )}
                          </div>
                        )}

                        {[...filteredCurrentMatches]
                          .sort((a, b) => {
                            const evA = (a.evidence ?? {}) as Record<string, unknown>;
                            const evB = (b.evidence ?? {}) as Record<string, unknown>;
                            const typeA = String(evA.website_type ?? "");
                            const typeB = String(evB.website_type ?? "");

                            const rank = (t: string) => {
                              if (t === "unauthorized_streaming" || t === "mirror_or_redirect")
                                return 1;
                              if (t === "download_page" || t === "file_host" || t === "torrent_index")
                                return 2;
                              if (t === "video_host_reupload") return 3;
                              if (t === "social_distribution_lead") return 4;
                              if (t === "review_or_news") return 5;
                              return 6;
                            };

                            return rank(typeA) - rank(typeB);
                          })
                          .map((m) => renderMatchArticle(m))}
                      </TabsContent>
                    </Tabs>
                  </div>
                );
              })()}

              {/* Previous Scan Results Section */}
              <div className="space-y-4 pt-6 border-t border-border/60">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Previous Scan Results</h3>
                    <p className="text-xs text-muted-foreground">
                      Findings from older detection scans ({previousMatches.length} items)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowPreviousResults((prev) => !prev)}
                      className="h-8 text-xs"
                    >
                      {showPreviousResults ? (
                        <>
                          <ChevronUp className="mr-1.5 h-3.5 w-3.5" />
                          Hide Previous Results
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
                          Show Previous Results ({previousMatches.length})
                        </>
                      )}
                    </Button>

                    {previousMatches.length > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setClearDialogOpen(true)}
                        className="h-8 text-xs"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Clear Previous Results
                      </Button>
                    )}
                  </div>
                </div>

                {showPreviousResults && (
                  <div className="space-y-3">
                    {previousMatches.length === 0 ? (
                      <div className="rounded-lg border border-border/60 bg-card/50 p-4 text-xs text-muted-foreground">
                        No previous scan findings recorded.
                      </div>
                    ) : (
                      previousMatches.map((m) => renderMatchArticle(m))
                    )}
                  </div>
                )}
              </div>
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

      {/* Clear Previous Results Confirmation Dialog */}
      <AlertDialog
        open={clearDialogOpen}
        onOpenChange={(open) => !clearPreviousMutation.isPending && setClearDialogOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear previous copyright results?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove old scan findings from your visible results. The current scan will
              remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearPreviousMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={clearPreviousMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                clearPreviousMutation.mutate();
              }}
            >
              {clearPreviousMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Archiving...
                </>
              ) : (
                "Clear Previous Results"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Per-Scan Archive Confirmation Dialog */}
      <AlertDialog
        open={!!archivingScanId}
        onOpenChange={(open) => !archiveScanMutation.isPending && !open && setArchivingScanId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive results for this scan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive all recorded findings for this specific scan from your active
              workspace view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveScanMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={archiveScanMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (archivingScanId) archiveScanMutation.mutate(archivingScanId);
              }}
            >
              {archiveScanMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Archiving...
                </>
              ) : (
                "Archive Results"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InvestigationModal
        open={investigationOpen}
        onOpenChange={setInvestigationOpen}
        match={selectedMatch}
      />
    </div>
  );
}
