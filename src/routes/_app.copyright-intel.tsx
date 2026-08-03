import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  uploadCopyrightReference, runCopyrightScan, listCopyrightScans,
  getCopyrightScan, updateCopyrightMatch,
} from "@/lib/copyright.functions";
import {
  bootstrapStatsFromState,
  createScanBootstrap,
  isActiveScanStatus,
  mergeActiveScanStats,
  rememberNonEmptyScanTelemetry,
  type ScanBootstrapState,
} from "@/lib/copyright/scan-bootstrap";
import { parseSourceActivity } from "@/lib/copyright/source-activity";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ScanProgress } from "@/components/copyright/ScanProgress";
import { AllSourcesPanel } from "@/components/copyright/AllSourcesPanel";
import { SuspiciousSourcesPanel } from "@/components/copyright/SuspiciousSourcesPanel";
import type { PublicSuspiciousSource } from "@/lib/copyright/suspicious-sources";
import { YoutubeMonitorPanel } from "@/components/copyright/YoutubeMonitorPanel";
import { DistributionMonitorPanel } from "@/components/copyright/DistributionMonitorPanel";
import { ProtectedWorkRegistrationModal } from "@/components/copyright/ProtectedWorkRegistrationModal";
import {
  defaultReleaseProtectionForm,
  formToReleaseProtectionSettings,
  type ReleaseProtectionFormState,
} from "@/components/copyright/ReleaseProtectionRegistration";
import {
  meetsAutomaticMonitoringReferenceMinimum,
  validateReleaseProtectionSettings,
} from "@/lib/copyright/release-protection";
import { ReleaseProtectionPanel } from "@/components/copyright/ReleaseProtectionPanel";

import InvestigationModal from "@/components/investigation/InvestigationModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  crawlMetricsFromStats,
  diagnosticsFromStats,
  explainZeroMatchFunnel,
  providerFailureCategoryLines,
  providerMetricsFromStats,
  summarizeProviderFailures,
} from "@/lib/copyright/scan-diagnostics";
import { PROVIDER_FAILURE_CATEGORIES } from "@/lib/copyright/provider-failures";
import {
  shouldShowAnalysisBanner,
} from "@/lib/copyright/scan-scope";
import { CRAWL_FAILURE_CATEGORIES } from "@/lib/copyright/crawl-failure";

import {
  Copyright, Loader2, ShieldCheck, FileSearch,
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
  const [releaseProtectionForm, setReleaseProtectionForm] = useState<ReleaseProtectionFormState>(
    defaultReleaseProtectionForm,
  );
  const [additionalVisualFiles, setAdditionalVisualFiles] = useState<File[]>([]);
  const [trailerFile, setTrailerFile] = useState<File | null>(null);

  const [investigationOpen, setInvestigationOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [bootstrapByScanId, setBootstrapByScanId] = useState<Record<string, ScanBootstrapState>>({});
  const lastKnownStatsRef = useRef<Record<string, Record<string, unknown>>>({});
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
      candidates:
        st.pages_crawled ?? st.unique_candidate_pages ?? st.candidates ?? st.provider_candidates ?? 0,
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

      const additionalVisualKeys: string[] = [];
      for (let i = 0; i < additionalVisualFiles.length; i++) {
        const visual = additionalVisualFiles[i]!;
        setStage(`Uploading additional visual ${i + 1}/${additionalVisualFiles.length}…`);
        const visualType = visual.type as "image/jpeg" | "image/png" | "image/webp";
        const base64 = await blobToBase64(visual);
        const { key } = await uploadFn({
          data: {
            fileName: visual.name,
            contentType: visualType,
            base64,
          },
        });
        additionalVisualKeys.push(key);
      }

      const videoReferenceKeys: string[] = [];
      if (trailerFile) {
        setStage("Uploading trailer / video reference…");
        const trailerBlobs = trailerFile.type.startsWith("video/")
          ? await extractFrames(trailerFile, 2)
          : [trailerFile];
        for (let i = 0; i < trailerBlobs.length; i++) {
          const contentType = trailerFile.type.startsWith("video/")
            ? "image/jpeg"
            : (trailerFile.type as "image/jpeg" | "image/png" | "image/webp");
          const base64 = await blobToBase64(trailerBlobs[i]);
          const { key } = await uploadFn({
            data: {
              fileName: trailerFile.type.startsWith("video/") ? `trailer-frame-${i}.jpg` : trailerFile.name,
              contentType,
              base64,
            },
          });
          videoReferenceKeys.push(key);
        }
      }

      const releaseSettings = formToReleaseProtectionSettings(releaseProtectionForm);
      if (releaseSettings.enabled) {
        const validationErrors = validateReleaseProtectionSettings(releaseSettings);
        if (validationErrors.length) throw new Error(validationErrors.join(" "));
        const referencePackage = {
          primary_poster_key: keys[0],
          additional_visual_keys: additionalVisualKeys,
          video_reference_keys: videoReferenceKeys,
        };
        if (!meetsAutomaticMonitoringReferenceMinimum(referencePackage)) {
          throw new Error(
            "Automatic monitoring requires 1 primary poster, 2 additional visual references, and 1 trailer or approved video reference.",
          );
        }
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
          ...(releaseSettings.enabled
            ? {
                releaseProtection: {
                  settings: releaseSettings,
                  referencePackage: {
                    primary_poster_key: keys[0],
                    additional_visual_keys: additionalVisualKeys,
                    video_reference_keys: videoReferenceKeys,
                  },
                },
              }
            : {}),
        },
      });
    },
    onSuccess: (res: {
      scanId: string;
      started?: boolean;
      status?: string;
      configuredProviders?: string[];
    }) => {
      const bootstrap = createScanBootstrap({
        scanId: res.scanId,
        configuredProviderIds:
          res.configuredProviders?.length
            ? res.configuredProviders
            : ["firecrawl", "youtube", "bright_data"],
      });
      setBootstrapByScanId((prev) => ({ ...prev, [res.scanId]: bootstrap }));
      setSelectedScanId(res.scanId);
      setSummary(null);
      setStage("");
      qc.setQueryData(
        ["copyright-scans"],
        (old: Array<Record<string, unknown>> | undefined) => {
          const optimistic = {
            id: res.scanId,
            title: scanMeta?.title ?? "",
            status: "queued",
            reference_kind: scanMeta?.kind === "video" ? "video" : "image",
            created_at: new Date().toISOString(),
            stats: bootstrapStatsFromState(bootstrap),
          };
          return [optimistic, ...(old ?? []).filter((row) => row.id !== res.scanId)];
        },
      );
      qc.invalidateQueries({ queryKey: ["copyright-scans"] });
      qc.invalidateQueries({ queryKey: ["copyright-scan", res.scanId] });
      toast.message("Scan queued — discovery will update here automatically.");
    },
    onError: async (e: Error) => {
      setStage("");
      setBootstrapByScanId({});
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

  const selectedScanRow = (scans.data ?? []).find((s) => s.id === selectedScanId) ?? null;
  const bootstrapForSelected = selectedScanId ? bootstrapByScanId[selectedScanId] ?? null : null;
  const selectedScanStatus =
    selectedScanRow?.status ??
    detail.data?.scan?.status ??
    (bootstrapForSelected ? "queued" : null) ??
    (scan.isPending ? "queued" : null);

  const scanBusy =
    scan.isPending ||
    isActiveScanStatus(selectedScanStatus) ||
    !!bootstrapForSelected;

  useEffect(() => {
    if (!selectedScanId) return;
    if (
      selectedScanStatus === "completed" ||
      selectedScanStatus === "partial" ||
      selectedScanStatus === "failed"
    ) {
      if (scan.isPending) scan.reset();
      setStage("");
      setBootstrapByScanId((prev) => {
        if (!prev[selectedScanId]) return prev;
        const next = { ...prev };
        delete next[selectedScanId];
        return next;
      });
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
  const suspiciousSources: PublicSuspiciousSource[] =
    detailAligned && Array.isArray(detail.data?.suspiciousSources)
      ? (detail.data.suspiciousSources as PublicSuspiciousSource[])
      : [];
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

  const polledStats = mergeActiveScanStats({
    listStats:
      selectedScanId && selectedScanRow?.id === selectedScanId
        ? (selectedScanRow.stats as Record<string, unknown> | null | undefined)
        : null,
    detailStats:
      detail.data?.scan?.id === selectedScanId
        ? (detail.data.scan.stats as Record<string, unknown> | null | undefined)
        : null,
    bootstrap: bootstrapForSelected,
    lastKnown: selectedScanId ? lastKnownStatsRef.current[selectedScanId] ?? null : null,
  });

  useEffect(() => {
    if (!selectedScanId) return;
    const listStats =
      selectedScanId && selectedScanRow?.id === selectedScanId
        ? (selectedScanRow.stats as Record<string, unknown> | null | undefined)
        : null;
    const detailStats =
      detail.data?.scan?.id === selectedScanId
        ? (detail.data.scan.stats as Record<string, unknown> | null | undefined)
        : null;
    const polled = mergeActiveScanStats({
      listStats,
      detailStats,
      bootstrap: null,
      lastKnown: null,
    });
    const remembered = rememberNonEmptyScanTelemetry(
      lastKnownStatsRef.current[selectedScanId] ?? null,
      polled,
    );
    if (remembered) {
      lastKnownStatsRef.current[selectedScanId] = remembered;
    }
  }, [selectedScanId, selectedScanRow, detail.data]);

  const activeScanStats =
    scan.isPending && scanMeta && !selectedScanId
      ? bootstrapStatsFromState(
          createScanBootstrap({
            scanId: "pending",
            configuredProviderIds: ["firecrawl", "youtube", "bright_data"],
          }),
        )
      : polledStats;

  useEffect(() => {
    if (!import.meta.env.DEV || !scanBusy || !selectedScanId) return;
    const polledScanId =
      detail.data?.scan?.id === selectedScanId ? detail.data.scan.id : null;
    console.debug("copyright_scan_poll_diagnostics", {
      active_scan_id: selectedScanId,
      selected_scan_id: selectedScanId,
      polled_scan_id: polledScanId,
      source_activity_count: parseSourceActivity(activeScanStats).length,
      scan_status: selectedScanStatus,
    });
  }, [scanBusy, selectedScanId, selectedScanStatus, detail.data, activeScanStats]);

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
            scanStatus={selectedScanStatus ?? "queued"}
            scanId={selectedScanId}
            stats={activeScanStats}
          />
          {stage && (
            <p className="mt-2 text-center text-xs text-muted-foreground">{stage}</p>
          )}
        </div>
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
                  " Public discovery is temporarily rate-limited — retry the scan."}
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



      <ProtectedWorkRegistrationModal
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        title={title}
        onTitleChange={setTitle}
        knownUrlsText={knownUrlsText}
        onKnownUrlsTextChange={setKnownUrlsText}
        file={file}
        onFileChange={setFile}
        additionalVisualFiles={additionalVisualFiles}
        onAdditionalVisualFilesChange={setAdditionalVisualFiles}
        trailerFile={trailerFile}
        onTrailerFileChange={setTrailerFile}
        releaseProtectionForm={releaseProtectionForm}
        onReleaseProtectionFormChange={setReleaseProtectionForm}
        onSubmit={() => scan.mutate()}
        isSubmitting={scanBusy}
      />

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
            <Tabs defaultValue="center">
              <TabsList>
                <TabsTrigger value="center">Investigation center</TabsTrigger>
                <TabsTrigger value="sources">Suspicious sources</TabsTrigger>
                <TabsTrigger value="all">All sources</TabsTrigger>
                <TabsTrigger value="youtube">Video monitoring</TabsTrigger>
              </TabsList>
              <TabsContent value="center" className="mt-3">
                <InvestigationCenter
                  scanId={selectedScanId}
                  scanStatus={selectedScanStatus}
                  scanStartedAt={detail.data?.scan?.created_at ?? null}
                  workTitle={selectedScanTitle ?? scanMeta?.title ?? ""}
                  stats={activeScanStats}
                  sources={suspiciousSources}
                  onReview={(matchId) =>
                    review.mutate({ matchId, reviewStatus: "evidence_ready" })
                  }
                  onDismiss={(matchId) => review.mutate({ matchId, reviewStatus: "dismissed" })}
                />
              </TabsContent>
              <TabsContent value="all" className="mt-3">
                <AllSourcesPanel sources={(detail.data?.allSources ?? []) as never} />
              </TabsContent>
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
          {detailAligned && !suspiciousSources.length && (
            <div className="space-y-3 rounded-lg border border-border/60 bg-card/50 p-6 text-sm text-muted-foreground">
              <p>
                No suspicious sources to display for{" "}
                <span className="font-medium text-foreground">{selectedScanTitle ?? "this scan"}</span>.
                New findings need exact-title identity plus distribution-access evidence. Preserved
                historical suspicious sources appear here even when the current crawl could not
                reconfirm them.
              </p>
              {(() => {
                const scanStats = (detail.data?.scan?.stats ?? {}) as Record<string, unknown>;
                const funnel =
                  Array.isArray(scanStats.rejection_funnel) && scanStats.rejection_funnel.length
                    ? (scanStats.rejection_funnel as string[])
                    : explainZeroMatchFunnel(scanStats);
                const d = diagnosticsFromStats(scanStats);
                const crawl = crawlMetricsFromStats(scanStats);
                const provider = providerMetricsFromStats(scanStats);
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
                        { label: "Discovery candidates", value: provider.result_count },
                        { label: "Discovery requests", value: provider.requested },
                        { label: "Discovery successes", value: provider.succeeded },
                        { label: "Discovery errors", value: provider.failed },
                        { label: "Static pages fetched", value: crawl.static_fetch_succeeded },
                        { label: "Empty static HTML", value: crawl.static_fetch_empty },
                        { label: "Browser fallbacks tried", value: crawl.browser_fallback_attempted },
                        { label: "Browser fallbacks recovered", value: crawl.browser_fallback_succeeded || Number(scanStats.dynamic_render_recovered ?? 0) },
                        { label: "Rendered pages inspected", value: crawl.pages_rendered },
                        { label: "Detail pages followed", value: crawl.detail_pages_followed || d.detail_pages_followed },
                        { label: "Detail links discovered", value: Number(scanStats.detail_links_discovered ?? d.detail_links_discovered ?? 0) },
                        { label: "Detail pages queued", value: Number(scanStats.detail_pages_queued ?? d.detail_pages_queued ?? 0) },
                        { label: "Fresh discovery candidates", value: Number(scanStats.fresh_discovery_candidates ?? d.fresh_discovery_candidates ?? 0) },
                        { label: "Historical candidates restored", value: Number(scanStats.historical_candidates_restored ?? d.historical_candidates_restored ?? 0) },
                        { label: "Known-risk domains searched", value: Number(scanStats.known_risk_domains_searched ?? d.known_risk_domains_searched ?? 0) },
                        { label: "Monitored sources rechecked", value: Number(scanStats.monitored_sources_rechecked ?? d.monitored_sources_rechecked ?? 0) },
                        { label: "Mirror/redirect candidates", value: Number(scanStats.mirror_redirect_candidates ?? d.mirror_redirect_candidates ?? 0) },
                        { label: "Candidates before dedup", value: Number(scanStats.candidates_before_dedup ?? d.candidates_before_dedup ?? 0) },
                        { label: "Candidates after dedup", value: Number(scanStats.candidates_after_dedup ?? d.candidates_after_dedup ?? 0) },
                        { label: "Exact-title pages", value: crawl.exact_title_pages_found },
                        { label: "Pages with access evidence", value: crawl.pages_with_access_evidence },
                        { label: "Suspected (requires review)", value: Number(scanStats.suspected_review_pages ?? d.suspected_review_pages ?? 0) },
                        { label: "Historical reconfirmed", value: Number(scanStats.historical_findings_reconfirmed ?? d.historical_findings_reconfirmed ?? 0) },
                        { label: "Historical unreachable", value: Number(scanStats.historical_sources_temporarily_unreachable ?? d.historical_sources_temporarily_unreachable ?? 0) },
                        { label: "Historical requires review", value: Number(scanStats.historical_requires_review ?? d.historical_requires_review ?? 0) },
                        { label: "Suspicious sources shown", value: Number(scanStats.suspicious_sources_displayed ?? d.suspicious_sources_displayed ?? suspiciousSources.length) },
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
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Discovery errors by category</p>
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
                      {typeof scanStats.suspicious_sources_summary === "string" &&
                        scanStats.suspicious_sources_summary && (
                          <li className="leading-relaxed font-medium text-foreground">
                            • {scanStats.suspicious_sources_summary}
                          </li>
                        )}
                      {funnel.map((line) => (
                        <li key={line} className="leading-relaxed">• {line}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          )}


          {detailAligned && suspiciousSources.length > 0 && (
            <SuspiciousSourcesPanel
              sources={suspiciousSources}
              summaryLine={
                typeof detail.data?.scan?.stats === "object" &&
                detail.data?.scan?.stats &&
                typeof (detail.data.scan.stats as Record<string, unknown>).suspicious_sources_summary ===
                  "string"
                  ? ((detail.data.scan.stats as Record<string, unknown>)
                      .suspicious_sources_summary as string)
                  : null
              }
              onReview={(matchId) =>
                review.mutate({ matchId, reviewStatus: "evidence_ready" })
              }
              onInvestigate={(source) => {
                setSelectedMatch({
                  id: source.id,
                  source_url: source.url,
                  page_title: source.title,
                  confidence: source.confidence,
                  confidence_band: source.confidence_band,
                  detection_type: source.detection_type ?? source.classification,
                  reason: source.reason,
                  evidence: source.evidence,
                  contact: source.contact,
                  review_status: source.review_status,
                });
                setInvestigationOpen(true);
              }}
              onDismiss={(matchId) =>
                review.mutate({ matchId, reviewStatus: "dismissed" })
              }
            />
          )}
              </TabsContent>
            </Tabs>
          )}
        </section>

      </div>

      {/* Global monitor — clearly separate from selected-scan findings */}
      <ReleaseProtectionPanel />
      <DistributionMonitorPanel />

<InvestigationModal
  open={investigationOpen}
  onOpenChange={setInvestigationOpen}
  match={selectedMatch}
/>
    </div>
  );
}
