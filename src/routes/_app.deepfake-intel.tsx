import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runDeepfakeScan,
  continueDeepfakeScan,
  listDeepfakeScans,
  getDeepfakeScan,
  updateDeepfakeFinding,
  submitManualEvidenceUrls,
  listManualEvidenceLeads,
  overrideManualEvidenceSource,
  loadSarayuEvidence,
  retryManualEvidenceLead,
} from "@/lib/deepfake-intel.functions";
import { downloadSarayuSuppliedEvidenceReport } from "@/lib/deepfake/sarayu-supplied-report.functions";
import {
  createDeepfakeTargetProfile,
  listDeepfakeTargetProfiles,
  uploadDeepfakeReferenceFace,
  deleteDeepfakeReferenceFace,
} from "@/lib/deepfake/face-profile.functions";
import { getDeepfakeReportUrl, listDeepfakeReports, downloadDeepfakeReport } from "@/lib/deepfake/report.functions";
import { DeepfakeReportActionBar } from "@/components/deepfake/DeepfakeReportActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ScanFace, ShieldAlert, ExternalLink, Loader2, AlertTriangle,
  CheckCircle2, Filter, Radar, Upload, Trash2,
  UserRoundCheck, Copy, Camera, FileSearch, Download, FileDown,
} from "lucide-react";
import { useUserRoles } from "@/hooks/use-user-roles";
import {
  isScanStalled,
  isTerminalScanStatus,
  pickLiveScanId,
  scanPollInterval,
  scanProgressSignature,
  SCAN_STALL_WARNING_MS,
  filterScanHistory,
  shouldShowHistoryEmpty,
  shouldShowHistoryLoading,
  shouldShowResultsLoader,
} from "@/lib/deepfake/scan-ui-state";
import {
  decideResultsConsoleMount,
  emptyFindingsDetailLines,
  emptyFindingsStatusMessage,
  explainResultsConsoleMountDecision,
  extractClientVisibleFindings,
  shouldRenderLegacyFindingCards,
} from "@/lib/deepfake/results-console-mount";
import { InvestigationStatsPanel } from "@/components/deepfake/InvestigationStatsPanel";
import {
  resolveWorkerProgressUiState,
  workerProgressUiCopy,
} from "@/lib/deepfake/worker-progress-ui";
import { googleImagesBackgroundProgress } from "@/lib/deepfake/google-images-diagnostics";
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import {
  SarayuDemoScanSequence,
  useSarayuDemoSequence,
} from "@/components/deepfake/SarayuDemoScanSequence";
import { ThreatAlertBanner } from "@/components/deepfake/ThreatAlertBanner";
import { useReferenceFaceThumbnail } from "@/components/deepfake/useReferenceFaceThumbnail";
import { scanBelongsToSelectedProfile } from "@/lib/deepfake/identity-scan-viz";
import {
  buildThreatAlertSummary,
  isElevatedThreatTone,
  resolveThreatAlertAnnouncement,
  type ThreatAlertAnnouncementState,
} from "@/lib/deepfake/threat-alert";
import { ResultsIntelligenceConsole } from "@/components/deepfake/results/ResultsIntelligenceConsole";
import {
  isSarayuMohanIdentity,
  normalizeIdentityName,
  resolveActiveIdentityName,
} from "@/lib/deepfake/identity-state";
import { sarayuDemoSessionKey } from "@/lib/deepfake/sarayu-demo-animation";

export const Route = createFileRoute("/_app/deepfake-intel")({
  head: () => ({
    meta: [
      { title: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { name: "description", content: "Scan the public web for deepfakes, AI-generated intimate imagery, face swaps, and synthetic media targeting protected identities." },
      { property: "og:title", content: "Deepfake & Synthetic Media Intelligence — Eterna" },
      { property: "og:description", content: "Cautious, evidence-graded intelligence sweeps for deepfake and synthetic media abuse." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeepfakeIntelPage,
});

type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const RISK_STYLE: Record<RiskLevel, { badge: string; dot: string }> = {
  CRITICAL: { badge: "bg-red-600/15 text-red-500 border-red-600/40", dot: "bg-red-500" },
  HIGH:     { badge: "bg-orange-500/15 text-orange-400 border-orange-500/40", dot: "bg-orange-400" },
  MEDIUM:   { badge: "bg-amber-400/15 text-amber-400 border-amber-400/40", dot: "bg-amber-400" },
  LOW:      { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40", dot: "bg-emerald-400" },
};

const DIAGNOSTIC_KEYS = [
  "queries_generated",
  "queries_executed",
  "provider_candidates",
  "unique_candidates",
  "crawl_succeeded",
  "crawl_failed",
  "identity_rejected",
  "page_type_rejected",
  "url_rejected",
  "dns_resolution_failed",
  "private_address_rejected",
  "tls_connection_failed",
  "request_timeout",
  "redirect_rejected",
  "crawl_provider_failed",
  "network_failed",
  "unverified",
  "probable",
  "verified",
  "client_visible",
  "serpapi_requests",
  "serpapi_failures",
  "serpapi_candidates",
  "serpapi_unique_pages",
  "serpapi_face_rejected",
  "serpapi_verified",
  "serpapi_credits_used",
] as const;

const MANUAL_DIAGNOSTIC_KEYS = [
  "manual_urls_submitted",
  "google_viewer_urls_parsed",
  "selected_results_resolved",
  "source_pages_found",
  "pages_crawled",
  "images_extracted",
  "faces_compared",
  "identity_matches",
  "evidence_packages_ready",
  "failed_resolutions",
  "duplicate_leads",
] as const;

const MANUAL_STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  parsing: "Resolving Google result",
  source_resolved: "Source page found",
  crawl_pending: "Crawling source",
  crawled: "Source crawled",
  identity_check_pending: "Face comparison pending",
  review_required: "Requires review",
  evidence_ready: "Evidence ready",
  rejected: "Rejected",
  failed: "Failed",
};

const MANUAL_STATUS_STEPS = [
  ["submitted", "Submitted"],
  ["parsing", "Resolving Google result"],
  ["source_resolved", "Source page found"],
  ["crawl_pending", "Crawling source"],
  ["identity_check_pending", "Face comparison complete"],
  ["evidence_ready", "Evidence ready"],
  ["review_required", "Requires review"],
  ["failed", "Failed with reason"],
] as const;

function manualStatusRank(status?: string | null): number {
  const order = [
    "submitted",
    "parsing",
    "source_resolved",
    "crawl_pending",
    "crawled",
    "identity_check_pending",
    "review_required",
    "evidence_ready",
    "rejected",
    "failed",
  ];
  return Math.max(0, order.indexOf(status ?? ""));
}

function metricRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    }
  }

  return Object.keys(out).length ? out : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function metricLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function stageLabel(stage?: unknown): string | null {
  if (typeof stage !== "string") return null;
  const labels: Record<string, string> = {
    discovering: "Discovering",
    verifying: "Verifying",
    classifying: "Classifying",
    saving: "Saving",
    checkpoint: "Checkpoint saved",
    done: "Done",
  };
  return labels[stage] ?? null;
}

/** Never show raw undici "TypeError: fetch failed" in the Deepfake UI. */
function formatDeepfakeStartupError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unable to start investigation.";

  if (raw.includes("Unable to start investigation.")) {
    return raw;
  }

  const lower = raw.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("typeerror") ||
    lower.includes("networkerror") ||
    lower.includes("failed to fetch")
  ) {
    return [
      "Unable to start investigation.",
      "",
      "The Deepfake Intelligence worker could not be reached.",
      "",
      "Error:",
      "Worker endpoint unavailable.",
    ].join("\n");
  }

  return [
    "Unable to start investigation.",
    "",
    "The Deepfake Intelligence worker could not be reached.",
    "",
    "Error:",
    raw,
  ].join("\n");
}

function DeepfakeIntelPage() {
  const runFn = useServerFn(runDeepfakeScan);
  const continueFn = useServerFn(continueDeepfakeScan);
  const listFn = useServerFn(listDeepfakeScans);
  const getFn = useServerFn(getDeepfakeScan);
  const updFn = useServerFn(updateDeepfakeFinding);
  const submitManualFn = useServerFn(submitManualEvidenceUrls);
  const listManualFn = useServerFn(listManualEvidenceLeads);
  const overrideManualFn = useServerFn(overrideManualEvidenceSource);
  const loadSarayuFn = useServerFn(loadSarayuEvidence);
  const retryManualFn = useServerFn(retryManualEvidenceLead);
  const downloadSarayuReportFn = useServerFn(downloadSarayuSuppliedEvidenceReport);
  const createProfileFn = useServerFn(createDeepfakeTargetProfile);
  const listProfilesFn = useServerFn(listDeepfakeTargetProfiles);
  const uploadReferenceFn = useServerFn(uploadDeepfakeReferenceFace);
  const deleteReferenceFn = useServerFn(deleteDeepfakeReferenceFace);
  const reportFn = useServerFn(getDeepfakeReportUrl);
  const listReportsFn = useServerFn(listDeepfakeReports);
  const downloadReportFn = useServerFn(downloadDeepfakeReport);
  const qc = useQueryClient();
  const { isAdmin } = useUserRoles();

  const [reportHistoryOpen, setReportHistoryOpen] = useState(false);
  const [reportGenerateMode, setReportGenerateMode] = useState<
    "final" | "interim" | null
  >(null);
  const [downloadingHistoryId, setDownloadingHistoryId] = useState<string | null>(
    null,
  );
  const [startupDispatchError, setStartupDispatchError] = useState<string | null>(
    null,
  );
  const [lastGeneratedReport, setLastGeneratedReport] = useState<{
    historyId: string | null;
    url: string;
    fileName: string;
    scanId: string | null;
  } | null>(null);

  const openReportUrl = (url: string) => {
    // Async generation often loses the user-gesture context, so window.open
    // is blocked. Prefer a temporary anchor click, then fall back.
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    } catch {
      /* fall through */
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      toast.message("Report ready — allow pop-ups, or use Download PDF.");
    }
  };

  const reportErrorMessage = (error: unknown) => {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return "Unable to generate or download the deepfake report.";
  };

  const reportMutation = useMutation({
    mutationFn: (vars: {
      data: {
        scanId?: string;
        profileId?: string;
        force?: boolean;
        reportMode?: "final" | "interim";
      };
    }) => reportFn(vars),
    onMutate: (vars) => {
      setReportGenerateMode(vars.data.reportMode === "interim" ? "interim" : "final");
    },
    onSuccess: (res: {
      url: string;
      findings: number;
      reportMode?: "final" | "interim";
      historyId?: string | null;
      fileName?: string;
      scanId?: string;
    }) => {
      setLastGeneratedReport({
        historyId: res.historyId ?? null,
        url: res.url,
        fileName: res.fileName ?? "eterna-deepfake-report.pdf",
        scanId: res.scanId ?? selectedScanId,
      });
      openReportUrl(res.url);
      const label =
        res.reportMode === "interim" ? "Interim report" : "Deepfake threat report";
      toast.success(
        res.findings > 0
          ? `${label} ready (${res.findings} finding${res.findings === 1 ? "" : "s"}).`
          : `${label} ready (no client-visible findings).`,
      );
      void qc.invalidateQueries({ queryKey: ["deepfake-report-history"] });
      setReportHistoryOpen(true);
    },
    onError: (e: unknown) => toast.error(reportErrorMessage(e)),
    onSettled: () => setReportGenerateMode(null),
  });

  const downloadMutation = useMutation({
    mutationFn: (vars: { data: { historyId: string } }) =>
      downloadReportFn(vars),
    onMutate: (vars) => {
      setDownloadingHistoryId(vars.data.historyId);
    },
    onSuccess: (res: { url: string; fileName?: string }) => {
      setLastGeneratedReport((prev) =>
        prev
          ? { ...prev, url: res.url, fileName: res.fileName ?? prev.fileName }
          : {
              historyId: downloadingHistoryId,
              url: res.url,
              fileName: res.fileName ?? "eterna-deepfake-report.pdf",
              scanId: selectedScanId,
            },
      );
      openReportUrl(res.url);
      toast.success("Opening report PDF.");
    },
    onError: (e: unknown) => toast.error(reportErrorMessage(e)),
    onSettled: () => setDownloadingHistoryId(null),
  });

  const [targetName, setTargetName] = useState("");
  const [googleImagesUrl, setGoogleImagesUrl] = useState("");
  const [manualEvidenceUrls, setManualEvidenceUrls] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [handlesText, setHandlesText] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
  const [threatDomainFocus, setThreatDomainFocus] = useState<string | null>(
    null,
  );
  const [manualOverrideDrafts, setManualOverrideDrafts] = useState<
    Record<string, { source_page_url: string; direct_image_url: string; notes: string }>
  >({});
  const [stalled, setStalled] = useState(false);
  // Kept in a ref so the polling callbacks can react to an in-flight scan
  // request without re-creating the query options on every render.
  const runPendingRef = useRef(false);
  const progressRef = useRef<{ signature: string; at: number } | null>(null);
  const lastStartOptionsRef = useRef<{
    google_images_url?: string;
  }>({});



  const profiles = useQuery({
    queryKey: ["deepfake-target-profiles"],
    queryFn: () => listProfilesFn({}),
  });

  const selectedProfile = (profiles.data ?? []).find(
    (profile) => profile.id === selectedProfileId,
  );

  const enrolledFaces =
    selectedProfile?.deepfake_reference_faces ?? [];

  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    const file = referenceFiles[0];
    if (!file) {
      setLocalPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [referenceFiles]);

  const { thumbnailUrl } = useReferenceFaceThumbnail({
    faces: enrolledFaces as Array<{
      id: string;
      storage_path?: string | null;
      created_at?: string | null;
    }>,
    localPreviewUrl,
  });

  const scans = useQuery({
    queryKey: ["deepfake-scans"],
    queryFn: () => listFn({}),
    refetchInterval: (q) => {
      const data = q.state.data as Array<{ status: string }> | undefined;
      return scanPollInterval({
        status: data?.some((s) => s.status === "running") ? "running" : null,
        requestPending: runPendingRef.current,
      });
    },
  });

  const historyScans = filterScanHistory(scans.data ?? []);
  const selectedHistoryScan = historyScans.find(
    (historyScan) => historyScan.id === selectedScanId,
  ) ?? null;

  const selected = useQuery({
    queryKey: ["deepfake-scan", selectedScanId],
    queryFn: () => selectedScanId ? getFn({ data: { scan_id: selectedScanId } }) : null,
    enabled: !!selectedScanId,
    refetchInterval: (q) => {
      const d = q.state.data as {
        scan?: { status?: string; discovery_metrics?: Record<string, unknown> };
      } | null | undefined;
      const googleProgress = googleImagesBackgroundProgress(d?.scan?.discovery_metrics);
      return scanPollInterval({
        status: d?.scan?.status ?? null,
        requestPending: runPendingRef.current,
        googleImagesBackgroundRunning: googleProgress.running,
      });
    },
  });

  const manualLeads = useQuery({
    queryKey: [
      "deepfake-manual-leads",
      selectedScanId,
      selectedProfileId,
      targetName.trim(),
    ],
    queryFn: () =>
      listManualFn({
        data: {
          scan_id: selectedScanId ?? undefined,
          profile_id: selectedProfileId || undefined,
          target_name:
            !selectedScanId && !selectedProfileId && targetName.trim()
              ? targetName.trim()
              : undefined,
        },
      }),
    enabled: Boolean(selectedScanId || selectedProfileId || targetName.trim()),
    refetchInterval: (q) => {
      const data = q.state.data as
        | { leads?: Array<{ processing_status?: string }> }
        | undefined;
      const active = (data?.leads ?? []).some(
        (lead) =>
          !["review_required", "evidence_ready", "rejected", "failed"].includes(
            lead.processing_status ?? "",
          ),
      );
      return active ? 2000 : 8000;
    },
  });

  const normalizeTarget = (value: string) => value.trim().toLowerCase();

  const activeScanForIdentity = (scans.data ?? []).find((scan) => {
    if (scan.status !== "running") return false;
    if (normalizeTarget(scan.target_name) !== normalizeTarget(targetName)) {
      return false;
    }
    const scanProfileId = (scan as { profile_id?: string | null }).profile_id ?? null;
    const selected = selectedProfileId || null;
    return scanProfileId === selected;
  });

  const identityScanLocked = Boolean(activeScanForIdentity);

  const activeScanForSelectedScan = (selectedScan: {
    id: string;
    target_name: string;
    profile_id?: string | null;
  } | null) => {
    if (!selectedScan) return null;
    return (scans.data ?? []).find((scan) => {
      if (scan.status !== "running") return false;
      if (scan.id === selectedScan.id) return false;
      if (
        normalizeTarget(scan.target_name) !==
        normalizeTarget(selectedScan.target_name)
      ) {
        return false;
      }
      const scanProfileId =
        (scan as { profile_id?: string | null }).profile_id ?? null;
      const selectedProfile =
        (selectedScan as { profile_id?: string | null }).profile_id ?? null;
      return scanProfileId === selectedProfile;
    }) ?? null;
  };

  const run = useMutation({
    mutationFn: (input: {
      target_name: string;
      profile_id?: string;
      aliases: string[];
      handles: string[];
      google_images_url?: string;
    }) => runFn({ data: input }),
    onSuccess: (res) => {
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
      qc.invalidateQueries({ queryKey: ["deepfake-scan", res.scan_id] });

      if ((res as { already_running?: boolean }).already_running) {
        setStartupDispatchError(null);
        toast.message(
          "A scan is already running for this identity — showing live progress.",
        );
        return;
      }

      const dispatchError =
        typeof (res as { dispatch_error?: unknown }).dispatch_error === "string"
          ? (res as { dispatch_error: string }).dispatch_error
          : null;
      if (dispatchError) {
        setStartupDispatchError(dispatchError);
        toast.error(dispatchError, { duration: 12_000 });
        return;
      }

      setStartupDispatchError(null);
      toast.message(
        "Scan started — background worker dispatched. Live progress will update automatically.",
      );
    },
    onError: (e) => {
      const message = formatDeepfakeStartupError(e);
      setStartupDispatchError(message);
      toast.error(message, { duration: 12_000 });
    },
  });

  const submitManual = useMutation({
    mutationFn: (input: {
      target_name: string;
      urls_text: string;
      profile_id?: string;
      scan_id?: string;
    }) => submitManualFn({ data: input }),
    onSuccess: (res) => {
      setManualEvidenceUrls("");
      qc.invalidateQueries({ queryKey: ["deepfake-manual-leads"] });
      qc.invalidateQueries({ queryKey: ["deepfake-scan", selectedScanId] });
      toast.message(
        res.dispatched
          ? `Manual evidence queued — ${res.submitted} link${res.submitted === 1 ? "" : "s"} visible now.`
          : `Manual evidence saved — worker dispatch pending: ${res.dispatch_reason ?? "not configured"}`,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Manual evidence submission failed",
      ),
  });

  const overrideManual = useMutation({
    mutationFn: (input: {
      lead_id: string;
      source_page_url?: string;
      direct_image_url?: string;
      notes?: string;
    }) => overrideManualFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deepfake-manual-leads"] });
      toast.message("Manual source override saved");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Manual override failed",
      ),
  });

  const loadSarayu = useMutation({
    mutationFn: () => loadSarayuFn({}),
    onSuccess: (res) => {
      setSelectedProfileId(res.profile_id);
      setTargetName("Sarayu Mohan");
      qc.invalidateQueries({ queryKey: ["deepfake-target-profiles"] });
      qc.invalidateQueries({ queryKey: ["deepfake-manual-leads"] });
      toast.message(
        res.processing_pending
          ? `Sarayu Evidence loaded — ${res.inserted_count} inserted, ${res.existing_count} existing. Processing pending.`
          : `Sarayu Evidence loaded — ${res.inserted_count} inserted, ${res.existing_count} existing. Dispatch started.`,
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to load Sarayu evidence"),
  });

  const retryManual = useMutation({
    mutationFn: (lead_id: string) => retryManualFn({ data: { lead_id } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["deepfake-manual-leads"] });
      toast.message(res.dispatched ? "Evidence processing dispatched" : "Processing pending");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to retry evidence"),
  });

  const downloadSarayuReport = useMutation({
    mutationFn: () => downloadSarayuReportFn({}),
    onSuccess: (result) => {
      const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.message("Supplied Evidence Report downloaded");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to generate supplied evidence report"),
  });

  const continueScan = useMutation({
    mutationFn: (scan_id: string) => continueFn({ data: { scan_id } }),
    onSuccess: (res) => {
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
      qc.invalidateQueries({ queryKey: ["deepfake-scan", res.scan_id] });

      if ((res as { already_running?: boolean }).already_running) {
        setStartupDispatchError(null);
        toast.message(
          "A scan is already running for this identity — showing live progress.",
        );
        return;
      }

      const dispatchError =
        typeof (res as { dispatch_error?: unknown }).dispatch_error === "string"
          ? (res as { dispatch_error: string }).dispatch_error
          : null;
      if (dispatchError) {
        setStartupDispatchError(dispatchError);
        toast.error(dispatchError, { duration: 12_000 });
        return;
      }

      setStartupDispatchError(null);
      toast.message("Continuing from checkpoint — background worker dispatched.");
    },
    onError: (error) => {
      const message = formatDeepfakeStartupError(error);
      setStartupDispatchError(message);
      toast.error(message, { duration: 12_000 });
    },
  });

  const createProfile = useMutation({
    mutationFn: (target_name: string) =>
      createProfileFn({
        data: {
          target_name,
          authorization_status: "authorized",
        },
      }),
    onSuccess: (profile) => {
      setSelectedProfileId(profile.id);
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success("Protected identity profile created");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Profile creation failed",
      ),
  });

  const uploadReferences = useMutation({
    mutationFn: async (files: File[]) => {
      if (!selectedProfileId) {
        throw new Error("Select or create a target profile first.");
      }

      const uploaded = [];

      for (const file of files) {
        const image_base64 = await fileToDataUrl(file);

        uploaded.push(
          await uploadReferenceFn({
            data: {
              profile_id: selectedProfileId,
              filename: file.name,
              content_type: file.type as
                | "image/jpeg"
                | "image/png"
                | "image/webp",
              image_base64,
            },
          }),
        );
      }

      return uploaded;
    },
    onSuccess: (uploaded) => {
      setReferenceFiles([]);
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success(
        `${uploaded.length} reference photo${
          uploaded.length === 1 ? "" : "s"
        } enrolled`,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Reference photo upload failed",
      ),
  });

  const deleteReference = useMutation({
    mutationFn: (reference_face_id: string) =>
      deleteReferenceFn({
        data: {
          profile_id: selectedProfileId,
          reference_face_id,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["deepfake-target-profiles"],
      });
      toast.success("Reference photo removed");
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to remove reference photo",
      ),
  });

  const upd = useMutation({
    mutationFn: (v: { finding_id: string; review_status: "new" | "reviewed" | "dismissed" | "queued_takedown" }) =>
      updFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deepfake-scan", selectedScanId] });
    },
  });

  const selectedScanRow = selected.data?.scan ?? null;
  const selectedScanStatus = selectedScanRow?.status ?? null;
  const activeIdentityName = resolveActiveIdentityName({
    selectedProfileName: selectedProfile?.target_name,
    scan: selectedScanRow as { target_name?: string | null; identity_name?: string | null } | null,
    selectedScan: selectedHistoryScan,
    targetName,
  });
  const isSarayuMohan = isSarayuMohanIdentity(activeIdentityName);
  const sarayuDemoKey = sarayuDemoSessionKey(
    isSarayuMohan ? selectedScanId : null,
    isSarayuMohan ? selectedProfileId : null,
  );
  const sarayuDemo = useSarayuDemoSequence(
    sarayuDemoKey,
    isSarayuMohan && Boolean(sarayuDemoKey),
  );
  const showSarayuDemo = isSarayuMohan && sarayuDemo.active;
  const scanRequestPending =
    run.isPending || continueScan.isPending;
  const scanningUi =
    scanRequestPending ||
    selectedScanStatus === "running" ||
    Boolean(activeScanForIdentity);
  runPendingRef.current = scanRequestPending;

  /*
   * Select the freshly created scan row as soon as it shows up in history so
   * live progress renders while status is still "running".
   */
  useEffect(() => {
    if (!selectedScanRow?.target_name) return;
    setTargetName(selectedScanRow.target_name);
    const matchingProfile = (profiles.data ?? []).find(
      (profile) =>
        normalizeIdentityName(profile.target_name) ===
        normalizeIdentityName(selectedScanRow.target_name),
    );
    setSelectedProfileId(
      matchingProfile?.id ??
        ((selectedScanRow as { profile_id?: string | null }).profile_id ?? ""),
    );
  }, [profiles.data, selectedScanRow?.id, selectedScanRow?.target_name]);

  useEffect(() => {
    const candidateId = pickLiveScanId({
      scans: (scans.data ?? []) as Array<{ id: string; status: string; target_name: string }>,
      targetName,
      selectedScanId,
      requestPending: scanRequestPending,
    });
    if (candidateId) setSelectedScanId(candidateId);
  }, [scanRequestPending, selectedScanId, scans.data, targetName]);

  /*
   * Polling is the source of truth for "is this scan still running". Once the
   * row reaches a terminal status, drop mutation pending/loading state even if
   * the long-running execute request has not resolved yet.
   */
  useEffect(() => {
    if (!isTerminalScanStatus(selectedScanStatus)) return;
    if (run.isPending) run.reset();
    if (continueScan.isPending) continueScan.reset();
    if (continueScan.isPending) continueScan.reset();
    setStalled(false);
    qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScanStatus, selectedScanId]);

  // Polling health warning: no status/metrics/finding change for 15s.
  useEffect(() => {
    if (!selectedScanId || selectedScanStatus !== "running") {
      progressRef.current = null;
      setStalled(false);
      return;
    }
    const signature = scanProgressSignature({
      status: selectedScanStatus,
      metrics: selectedScanRow?.discovery_metrics,
      findingCount: selected.data?.findings?.length ?? 0,
      discoveryCount: selected.data?.discoveries?.length ?? 0,
    });
    const now = Date.now();
    if (progressRef.current?.signature !== signature) {
      progressRef.current = { signature, at: now };
      setStalled(false);
    }
    const lastChangeAt = progressRef.current.at;
    const timer = window.setTimeout(
      () =>
        setStalled(
          isScanStalled({ status: "running", lastChangeAt, now: Date.now() }),
        ),
      Math.max(SCAN_STALL_WARNING_MS - (now - lastChangeAt), 500),
    );
    return () => window.clearTimeout(timer);
  }, [
    selectedScanId,
    selectedScanStatus,
    selectedScanRow?.discovery_metrics,
    selected.data?.findings?.length,
    selected.data?.discoveries?.length,
    selected.dataUpdatedAt,
  ]);



  const onRun = () => {
    const name = targetName.trim();

    if (!name) {
      toast.error("Enter a target name");
      return;
    }

    if (activeScanForIdentity) {
      setSelectedScanId(activeScanForIdentity.id);
      toast.message(
        "A scan is already running for this identity — showing live progress.",
      );
      return;
    }

    const hasGoogleImagesLink = Boolean(googleImagesUrl.trim());
    const hasFaceProfile =
      Boolean(selectedProfileId) && enrolledFaces.length >= 3;

    if (!hasGoogleImagesLink && !hasFaceProfile) {
      toast.error(
        "Paste a Google Images link or select a profile with at least three reference photos",
      );
      return;
    }

    const aliases = aliasesText
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    const handles = handlesText
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    const google_images_url = googleImagesUrl.trim() || undefined;
    lastStartOptionsRef.current = { google_images_url };
    run.mutate({
      target_name: name,
      profile_id: selectedProfileId || undefined,
      aliases,
      handles,
      google_images_url,
    });
  };

  const onSubmitManualEvidence = () => {
    const name = targetName.trim() || selectedProfile?.target_name?.trim() || "";
    if (!name) {
      toast.error("Enter or select the protected identity first");
      return;
    }
    if (!manualEvidenceUrls.trim()) {
      toast.error("Paste at least one manual evidence URL");
      return;
    }
    submitManual.mutate({
      target_name: name,
      urls_text: manualEvidenceUrls,
      profile_id: selectedProfileId || undefined,
      scan_id: selectedScanId ?? undefined,
    });
  };

  const onCreateProfile = () => {
    const name = targetName.trim();

    if (!name) {
      toast.error("Enter the protected person's name first");
      return;
    }

    createProfile.mutate(name);
  };

  const onReferenceFilesSelected = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";

    const allowed = selected.filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type),
    );

    if (allowed.length !== selected.length) {
      toast.error("Only JPEG, PNG and WebP photos are supported");
    }

    const remainingSlots = Math.max(
      0,
      5 - enrolledFaces.length,
    );

    setReferenceFiles(allowed.slice(0, remainingSlots));
  };

  const scan = selected.data?.scan ?? null;
  // Normalize production snake_case getDeepfakeScan findings at the UI boundary.
  const findings = extractClientVisibleFindings(selected.data ?? null);
  // Threat alert always uses the complete client-visible findings array
  // (never console filters / pagination).
  const threatSummary = buildThreatAlertSummary(findings);

  const reportScope = {
    scanId: selectedScanId || undefined,
    // When a scan is selected, omit profileId so generation cannot fail on a
    // mismatched leftover profile selection in the left panel.
    profileId: selectedScanId
      ? undefined
      : selectedProfileId || undefined,
  };
  const canRequestReport = Boolean(reportScope.scanId || reportScope.profileId);

  const reportHistory = useQuery({
    queryKey: [
      "deepfake-report-history",
      selectedScanId ?? null,
      selectedProfileId || null,
    ],
    enabled: canRequestReport,
    queryFn: () =>
      listReportsFn({
        data: {
          scanId: selectedScanId || undefined,
          profileId: selectedProfileId || undefined,
        },
      }),
    retry: 1,
  });

  const runDeepfakeReport = (reportMode: "final" | "interim") => {
    if (!canRequestReport) {
      toast.error("Select a protected identity or scan first.");
      return;
    }
    if (reportMutation.isPending || downloadMutation.isPending) {
      toast.message("A report request is already in progress…");
      return;
    }
    reportMutation.mutate({
      data: {
        ...reportScope,
        reportMode,
        // Explicit Generate actions always rebuild from current persisted findings.
        force: true,
      },
    });
  };

  const downloadLatestReport = () => {
    if (lastGeneratedReport?.url) {
      openReportUrl(lastGeneratedReport.url);
      toast.success("Opening report PDF.");
      return;
    }
    const latest = reportHistory.data?.[0];
    if (latest?.id) {
      downloadMutation.mutate({ data: { historyId: latest.id } });
      return;
    }
    toast.error("Generate a report first.");
  };

  const canDownloadReport = Boolean(
    lastGeneratedReport?.url ||
      reportHistory.data?.some((row) => Boolean(row.storageKey)),
  );
  const threatAnnouncementRef = useRef<ThreatAlertAnnouncementState | null>(
    null,
  );
  const [threatBannerRole, setThreatBannerRole] = useState<"alert" | "status">(
    "status",
  );
  // useLayoutEffect so role="alert" is applied before paint on the live <2→2+ crossing.
  // Skip zero-total baselines while the newly selected scan is still loading so
  // history selection / reload of an already-saved multi-threat scan stays role="status".
  useEffect(() => {
    setThreatDomainFocus(null);
  }, [selectedScanId]);

  useEffect(() => {
    setLastGeneratedReport(null);
    setReportHistoryOpen(false);
  }, [selectedScanId]);

  useLayoutEffect(() => {
    if (!selectedScanId) {
      threatAnnouncementRef.current = null;
      setThreatBannerRole("status");
      return;
    }

    const loadedScanId = selected.data?.scan?.id ?? null;
    if (loadedScanId !== selectedScanId || selected.isLoading) {
      if (threatAnnouncementRef.current?.scanId !== selectedScanId) {
        // Mark the selection change without recording distinctTotal: 0.
        threatAnnouncementRef.current = {
          scanId: selectedScanId,
          distinctTotal: -1,
          tone: "cyan",
          hasAnnouncedAlert: false,
          hasAnnouncedMultiple: false,
        };
        setThreatBannerRole("status");
      }
      return;
    }

    const previous = threatAnnouncementRef.current;
    const effectivePrevious =
      !previous ||
      previous.scanId !== selectedScanId ||
      previous.distinctTotal < 0
        ? null
        : previous;

    const decision = resolveThreatAlertAnnouncement({
      scanId: selectedScanId,
      distinctTotal: threatSummary.total,
      tone: threatSummary.tone,
      previous: effectivePrevious,
    });
    threatAnnouncementRef.current = decision.next;
    setThreatBannerRole(decision.role);
  }, [
    selectedScanId,
    selected.data?.scan?.id,
    selected.isLoading,
    threatSummary.total,
    threatSummary.tone,
  ]);

  const scrollToThreatSection = (elementIds: string | string[]) => {
    if (typeof document === "undefined") return;
    const ids = Array.isArray(elementIds) ? elementIds : [elementIds];
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    for (const elementId of ids) {
      const node = document.getElementById(elementId);
      if (!node) continue;
      node.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      return;
    }
  };

  const discoveries = selected.data?.discoveries ?? [];
  const diagnostics = metricRecord(scan?.discovery_metrics);
  const manualLeadRows = manualLeads.data?.leads ?? [];
  const manualDiagnostics = metricRecord(manualLeads.data?.diagnostics);
  const showResultsLoader = shouldShowResultsLoader({
    isLoading: selected.isLoading,
    hasScan: Boolean(scan),
  });
  const consoleMount = decideResultsConsoleMount({
    selectedScanId,
    hasScanRow: Boolean(scan),
    visibleFindingCount: findings.length,
    showLoader: showResultsLoader,
  });
  const mountResultsConsole = consoleMount.mount;
  const renderLegacyFindingCards = shouldRenderLegacyFindingCards({
    consoleMounted: mountResultsConsole,
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!selectedScanId) return;
    // Temporary mount assertion — counts/status only, never raw provider rows.
    console.info(
      "[deepfake-intel]",
      explainResultsConsoleMountDecision({
        selectedScanId,
        hasScanRow: Boolean(scan),
        visibleFindingCount: findings.length,
        showLoader: showResultsLoader,
        scanStatus: scan?.status ?? null,
      }),
    );
  }, [
    selectedScanId,
    scan?.id,
    scan?.status,
    findings.length,
    showResultsLoader,
    consoleMount.reason,
  ]);
  const discoveryMetricObject = objectRecord(scan?.discovery_metrics);
  const checkpoint = objectRecord(scan?.scan_checkpoint);
  const rawStage =
    (typeof discoveryMetricObject?.stage === "string"
      ? discoveryMetricObject.stage
      : null) ??
    (typeof checkpoint?.stage === "string" ? checkpoint.stage : null);
  const liveStage = stageLabel(rawStage);
  const plannedQueries =
    (typeof checkpoint?.planned_query_count === "number"
      ? checkpoint.planned_query_count
      : undefined) ??
    (typeof checkpoint?.queries === "object" && Array.isArray(checkpoint.queries)
      ? checkpoint.queries.length
      : undefined) ??
    diagnostics?.queries_generated ??
    scan?.total_queries ??
    0;
  const executedQueries =
    diagnostics?.queries_executed ??
    (typeof checkpoint?.next_query_index === "number"
      ? checkpoint.next_query_index
      : 0);

  const selectedScanMatchesProfile = Boolean(
    scan &&
      scanBelongsToSelectedProfile({
        scanProfileId:
          (scan as { profile_id?: string | null }).profile_id ?? null,
        scanTargetName: scan.target_name,
        selectedProfileId,
        selectedProfileName: selectedProfile?.target_name || targetName,
      }),
  );

  // Prefer the selected scan when it belongs to this profile so threat colour
  // and PARTIAL/PAUSED lifecycle stay aligned with the results panel below.
  const vizSourceScan = selectedScanMatchesProfile
    ? scan
    : activeScanForIdentity &&
        (!selectedScanId || activeScanForIdentity.id === selectedScanId)
      ? activeScanForIdentity
      : null;
  const vizSourceMetrics = metricRecord(vizSourceScan?.discovery_metrics);
  const vizSourceMetricObject = objectRecord(vizSourceScan?.discovery_metrics);
  const vizSourceCheckpoint = objectRecord(vizSourceScan?.scan_checkpoint);
  const vizStage =
    (typeof vizSourceMetricObject?.stage === "string"
      ? vizSourceMetricObject.stage
      : null) ??
    (typeof vizSourceCheckpoint?.stage === "string"
      ? vizSourceCheckpoint.stage
      : null);
  // Lifecycle status from the viz source; threat tone is independent and always
  // derived from the selected scan's complete findings array.
  const vizScanStatus = vizSourceScan?.status ?? scan?.status ?? null;
  const vizExecutedQueries =
    vizSourceMetrics?.queries_executed ??
    (typeof vizSourceCheckpoint?.next_query_index === "number"
      ? vizSourceCheckpoint.next_query_index
      : null) ??
    executedQueries;
  const vizPlannedQueries =
    (typeof vizSourceCheckpoint?.planned_query_count === "number"
      ? vizSourceCheckpoint.planned_query_count
      : null) ??
    (Array.isArray(vizSourceCheckpoint?.queries)
      ? vizSourceCheckpoint.queries.length
      : null) ??
    vizSourceMetrics?.queries_generated ??
    vizSourceScan?.total_queries ??
    plannedQueries;
  const vizPagesVerified =
    vizSourceMetrics?.crawl_succeeded ?? diagnostics?.crawl_succeeded ?? null;
  const vizThreatsSaved =
    threatSummary.total > 0
      ? threatSummary.total
      : vizSourceMetrics?.client_visible ??
        vizSourceScan?.total_results ??
        scan?.total_results ??
        null;
  const vizErrorMessage =
    vizSourceScan?.error_message ?? scan?.error_message ?? null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">SYNTHETIC MEDIA INTEL</div>
          <h1 className="text-2xl font-display font-semibold flex items-center gap-2">
            <ScanFace className="size-5 text-primary" />
            Deepfake &amp; Synthetic Media Intelligence
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl mt-1">
            Sweeps the public web for deepfake claims, AI-generated intimate imagery, face swaps,
            fake leaks, and non-consensual synthetic media targeting protected identities. Results
            are triaged with a cautious classifier and never asserted as fact.
          </p>
        </div>
        {(selectedProfileId || selectedScanId) && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => {
              if (selectedScanId) {
                scrollToThreatSection([
                  "deepfake-report-action-bar",
                  "deepfake-results-panel",
                ]);
                setReportHistoryOpen(true);
                return;
              }
              runDeepfakeReport("final");
            }}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Generate Deepfake Report
          </Button>
        )}
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Left: control panel */}
        <div className="space-y-4">
          <div className="card-surface p-4 space-y-3">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">NEW SCAN</div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Target name</label>
              <Input
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="Full name, brand, or protected identity"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Google Images search link
                <span className="ml-1 font-normal text-muted-foreground">
                  Optional
                </span>
              </label>

              <Input
                type="url"
                value={googleImagesUrl}
                onChange={(e) => setGoogleImagesUrl(e.target.value)}
                placeholder="Paste Google Images search URL"
              />

              <p className="text-[10px] text-muted-foreground">
                Open Google Images, search the protected identity, then paste
                the search-page URL here.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Manual Evidence URLs
                <span className="ml-1 font-normal text-muted-foreground">
                  Google Images, source pages, or direct images
                </span>
              </label>
              <Textarea
                value={manualEvidenceUrls}
                onChange={(e) => setManualEvidenceUrls(e.target.value)}
                placeholder="Paste one or more URLs. Google Images #sv variants are kept as separate leads."
                rows={4}
              />
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={submitManual.isPending || !manualEvidenceUrls.trim()}
                onClick={onSubmitManualEvidence}
              >
                {submitManual.isPending ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Saving leads…
                  </>
                ) : (
                  "Process supplied links now"
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Leads are persisted immediately and processed separately from
                the 56-query sweep.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <UserRoundCheck className="size-4 text-primary" />
                <div>
                  <div className="text-xs font-semibold">
                    Protected identity verification
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Face matching removes results showing a different person.
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Identity profile
                </label>

                <select
                  value={selectedProfileId}
                  onChange={(event) => {
                    const profileId = event.target.value;
                    setSelectedProfileId(profileId);
                    setReferenceFiles([]);

                    const profile = (profiles.data ?? []).find(
                      (item) => item.id === profileId,
                    );

                    if (profile?.target_name) {
                      setTargetName(profile.target_name);
                    }
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Select protected identity</option>
                  {(profiles.data ?? []).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.target_name} · {
                        profile.deepfake_reference_faces?.length ?? 0
                      }/5 photos
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={
                    createProfile.isPending ||
                    !targetName.trim()
                  }
                  onClick={onCreateProfile}
                >
                  {createProfile.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Creating profile…
                    </>
                  ) : (
                    <>
                      <UserRoundCheck className="size-4 mr-2" />
                      Create Profile for This Target
                    </>
                  )}
                </Button>
              </div>

              {selectedProfileId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium">
                      Reference photos
                    </label>
                    <Badge
                      variant={
                        enrolledFaces.length >= 3
                          ? "default"
                          : "secondary"
                      }
                    >
                      {enrolledFaces.length}/5 enrolled
                    </Badge>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Upload 3–5 clear photos of the same person. Use front,
                    left-angle and right-angle photographs. Avoid group photos,
                    sunglasses and heavily edited images.
                  </p>

                  {enrolledFaces.length > 0 && (
                    <div className="space-y-1.5">
                      {enrolledFaces.map(
                        (
                          face: {
                            id: string;
                            face_confidence?: number | null;
                          },
                          index: number,
                        ) => (
                          <div
                            key={face.id}
                            className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              <span className="text-xs">
                                Reference photo {index + 1}
                              </span>
                              {typeof face.face_confidence === "number" && (
                                <span className="text-[10px] text-muted-foreground">
                                  {face.face_confidence.toFixed(1)}% quality
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              aria-label="Delete reference photo"
                              disabled={deleteReference.isPending}
                              onClick={() =>
                                deleteReference.mutate(face.id)
                              }
                              className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {enrolledFaces.length < 5 && (
                    <>
                      <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-3 text-xs text-primary hover:bg-primary/10">
                        <Upload className="size-4 mr-2" />
                        Choose reference photos
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={onReferenceFilesSelected}
                        />
                      </label>

                      {referenceFiles.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] text-muted-foreground">
                            {referenceFiles.length} photo{
                              referenceFiles.length === 1 ? "" : "s"
                            } selected
                          </div>

                          <Button
                            type="button"
                            className="w-full"
                            disabled={uploadReferences.isPending}
                            onClick={() =>
                              uploadReferences.mutate(referenceFiles)
                            }
                          >
                            {uploadReferences.isPending ? (
                              <>
                                <Loader2 className="size-4 mr-2 animate-spin" />
                                Enrolling faces…
                              </>
                            ) : (
                              <>
                                <Upload className="size-4 mr-2" />
                                Upload and Enrol Faces
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}

                  {enrolledFaces.length >= 3 && (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-500">
                      <CheckCircle2 className="size-4 shrink-0" />
                      Face-verified scanning is ready.
                    </div>
                  )}

                  {isAdmin && normalizeTarget(selectedProfile?.target_name ?? "") === "sarayumohan" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={loadSarayu.isPending}
                      onClick={() => loadSarayu.mutate()}
                    >
                      {loadSarayu.isPending ? (
                        <><Loader2 className="size-4 mr-2 animate-spin" /> Loading Sarayu Evidence…</>
                      ) : (
                        <><FileSearch className="size-4 mr-2" /> Load Sarayu Evidence</>
                      )}
                    </Button>
                  )}

                  <div className="space-y-1.5 pt-1 border-t border-border/60">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={reportMutation.isPending}
                      onClick={() => {
                        if (selectedScanId) {
                          scrollToThreatSection([
                            "deepfake-report-action-bar",
                            "deepfake-results-panel",
                          ]);
                          setReportHistoryOpen(true);
                          return;
                        }
                        runDeepfakeReport("final");
                      }}
                    >
                      {reportMutation.isPending ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          Preparing report…
                        </>
                      ) : (
                        <>
                          <FileDown className="size-4 mr-2" />
                          Generate Deepfake Report
                        </>
                      )}
                    </Button>
                    <p className="text-[10px] text-muted-foreground">
                      Opens the report action bar above verified findings when a
                      scan is selected. Builds from existing scan evidence only.
                    </p>
                  </div>
                </div>
              )}

              {isSarayuMohan && (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">Supplied Evidence Report — 6 Links</Badge>
                    <span className="text-[10px] text-muted-foreground">Pending Verification</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={downloadSarayuReport.isPending}
                    onClick={() => downloadSarayuReport.mutate()}
                  >
                    {downloadSarayuReport.isPending ? (
                      <><Loader2 className="size-4 mr-2 animate-spin" /> Generating report…</>
                    ) : (
                      <><Download className="size-4 mr-2" /> Download Supplied Evidence Report</>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Aliases / nicknames / prior names</label>
              <Textarea
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder="One per line or comma-separated"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Social handles / usernames</label>
              <Textarea
                value={handlesText}
                onChange={(e) => setHandlesText(e.target.value)}
                placeholder="@handle, username, etc."
                rows={3}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={onRun}
              disabled={
                scanningUi ||
                (
                  !googleImagesUrl.trim() &&
                  (
                    !selectedProfileId ||
                    enrolledFaces.length < 3
                  )
                )
              }
            >
              {scanningUi ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {identityScanLocked && !scanRequestPending
                    ? "Scan already running for this identity…"
                    : "Scanning…"}
                </>
              ) : (
                <>
                  <Radar className="size-4 mr-2" />
                  {googleImagesUrl.trim() &&
                  (!selectedProfileId || enrolledFaces.length < 3)
                    ? "Run Discovery Sweep"
                    : "Run Face-Verified Sweep"}
                </>
              )}
            </Button>
            {(startupDispatchError ||
              run.error ||
              continueScan.error) && (
              <div
                className="rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-[11px] text-red-600 whitespace-pre-wrap"
                data-testid="deepfake-startup-error"
              >
                <div>
                  {startupDispatchError ||
                    formatDeepfakeStartupError(
                      run.error || continueScan.error,
                    )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => onRun()}
                  >
                    Retry
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const el = document.querySelector(
                        '[data-testid="deepfake-investigation-stats"]',
                      );
                      el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    View diagnostics
                  </Button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {identityScanLocked
                ? "Another active scan for this identity is in progress. Results stay visible as they are saved."
                : "Searches public web pages for exact-identity synthetic, face-swap, and explicit-media threats."}
            </p>
          </div>

          <div className="card-surface p-4">
            <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground mb-2">SCAN HISTORY</div>
            {shouldShowHistoryLoading({
              isLoading: scans.isLoading,
              isFetching: scans.isFetching,
              hasData: scans.data !== undefined,
            }) ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
            ) : scans.isError ? (
              <div className="text-xs text-red-500 py-4 text-center">
                {scans.error instanceof Error
                  ? scans.error.message
                  : "Unable to load scan history"}
              </div>
            ) : shouldShowHistoryEmpty({
                isLoading: scans.isLoading,
                isFetching: scans.isFetching,
                isError: scans.isError,
                count: historyScans.length,
              }) ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No scans yet.</div>
            ) : (
              <ul className="space-y-1.5 max-h-[420px] overflow-auto">
                {historyScans.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => {
                        setSelectedScanId(s.id);
                        setTargetName(s.target_name);
                        const scanProfileId =
                          (s as { profile_id?: string | null }).profile_id ?? null;
                        const matchingProfile = (profiles.data ?? []).find(
                          (profile) =>
                            profile.id === scanProfileId ||
                            normalizeIdentityName(profile.target_name) ===
                              normalizeIdentityName(s.target_name),
                        );
                        setSelectedProfileId(matchingProfile?.id ?? scanProfileId ?? "");
                      }}
                      className={`w-full text-left rounded-lg border p-2.5 transition ${
                        selectedScanId === s.id
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/60 hover:bg-secondary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium truncate">{s.target_name}</div>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-1 flex-wrap">
                        <RiskChip level="CRITICAL" count={s.critical_count} />
                        <RiskChip level="HIGH" count={s.high_count} />
                        <RiskChip level="MEDIUM" count={s.medium_count} />
                        <RiskChip level="LOW" count={s.low_count} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(s.created_at).toLocaleString()}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: identity visualization + findings */}
        <div className="space-y-4">
          {showSarayuDemo ? (
            <SarayuDemoScanSequence
              sequence={sarayuDemo}
              thumbnailUrl={thumbnailUrl}
              enrolledCount={enrolledFaces.length}
              scanId={selectedScanId}
            />
          ) : selectedProfileId ? (
            <IdentityScanVisualization
              artistName={
                selectedProfile?.target_name ||
                targetName ||
                "Protected identity"
              }
              enrolledCount={enrolledFaces.length}
              thumbnailUrl={thumbnailUrl}
              scanStatus={vizScanStatus}
              stage={vizStage}
              executedQueries={vizExecutedQueries}
              plannedQueries={vizPlannedQueries}
              pagesVerified={vizPagesVerified}
              threatsSaved={vizThreatsSaved}
              errorMessage={vizErrorMessage}
              threatSummary={threatSummary}
              threatFindings={findings}
              scanId={selectedScanId}
              threatFindingsReady={Boolean(
                selectedScanId &&
                  selected.data?.scan?.id === selectedScanId &&
                  !selected.isLoading,
              )}
              onSelectThreatDomain={(domain) => {
                setRiskFilter("ALL");
                setThreatDomainFocus(domain);
                scrollToThreatSection([
                  "top-verified-domains",
                  "intelligence-tables",
                  "results-intelligence-console",
                ]);
              }}
            />
          ) : null}

          {!showSarayuDemo && isSarayuMohan && sarayuDemo.complete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={sarayuDemo.replay}
              data-testid="sarayu-demo-replay"
            >
              Replay scan animation
            </Button>
          )}

          {!showSarayuDemo && selectedScanId && isElevatedThreatTone(threatSummary.tone) ? (
            <ThreatAlertBanner
              summary={threatSummary}
              ariaRole={threatBannerRole}
              scanStatus={scan?.status ?? null}
              onReviewThreats={() =>
                scrollToThreatSection([
                  "finding-cards-heading",
                  "results-intelligence-console",
                  "verified-threat-overview-heading",
                  "deepfake-results-panel",
                ])
              }
              onViewAffectedDomains={() =>
                scrollToThreatSection([
                  "top-verified-domains",
                  "intelligence-tables",
                  "results-intelligence-console",
                  "deepfake-results-panel",
                ])
              }
              onContinueScan={
                scan?.status === "partial"
                  ? () => continueScan.mutate(scan.id)
                  : undefined
              }
              continuePending={continueScan.isPending}
              continueDisabled={Boolean(
                activeScanForSelectedScan(scan) ||
                  (scan &&
                    activeScanForIdentity &&
                    activeScanForIdentity.id !== scan.id),
              )}
            />
          ) : null}

          {!showSarayuDemo && (!scan && !selectedProfileId ? (
            <>
              <ManualEvidenceLeadsSection
                leads={manualLeadRows}
                diagnostics={manualDiagnostics}
                automatedFindingsCount={findings.length}
                loading={manualLeads.isLoading}
                error={manualLeads.error}
                overrideDrafts={manualOverrideDrafts}
                setOverrideDrafts={setManualOverrideDrafts}
                onOverride={(leadId, draft) =>
                  overrideManual.mutate({
                    lead_id: leadId,
                    source_page_url: draft.source_page_url || undefined,
                    direct_image_url: draft.direct_image_url || undefined,
                    notes: draft.notes || undefined,
                  })
                }
                overridePending={overrideManual.isPending}
                onRetry={(leadId) => retryManual.mutate(leadId)}
                retryPending={retryManual.isPending}
              />
              <div className="card-surface p-10 text-center text-sm text-muted-foreground">
                <ShieldAlert className="size-8 mx-auto mb-2 text-muted-foreground/60" strokeWidth={1.2} />
                Run a sweep or select a scan from history to view findings.
              </div>
            </>
          ) : !scan && selectedProfileId ? (
            <>
              <ManualEvidenceLeadsSection
                leads={manualLeadRows}
                diagnostics={manualDiagnostics}
                automatedFindingsCount={findings.length}
                loading={manualLeads.isLoading}
                error={manualLeads.error}
                overrideDrafts={manualOverrideDrafts}
                setOverrideDrafts={setManualOverrideDrafts}
                onOverride={(leadId, draft) =>
                  overrideManual.mutate({
                    lead_id: leadId,
                    source_page_url: draft.source_page_url || undefined,
                    direct_image_url: draft.direct_image_url || undefined,
                    notes: draft.notes || undefined,
                  })
                }
                overridePending={overrideManual.isPending}
                onRetry={(leadId) => retryManual.mutate(leadId)}
                retryPending={retryManual.isPending}
              />
              <div className="card-surface p-4 text-center text-sm text-muted-foreground">
                Identity profile ready. Run a Face-Verified Sweep or select a scan
                from history — results stay visible here as they are saved.
              </div>
            </>
          ) : scan ? (
            <>
              <ManualEvidenceLeadsSection
                leads={manualLeadRows}
                diagnostics={manualDiagnostics}
                automatedFindingsCount={findings.length}
                loading={manualLeads.isLoading}
                error={manualLeads.error}
                overrideDrafts={manualOverrideDrafts}
                setOverrideDrafts={setManualOverrideDrafts}
                onOverride={(leadId, draft) =>
                  overrideManual.mutate({
                    lead_id: leadId,
                    source_page_url: draft.source_page_url || undefined,
                    direct_image_url: draft.direct_image_url || undefined,
                    notes: draft.notes || undefined,
                  })
                }
                overridePending={overrideManual.isPending}
                onRetry={(leadId) => retryManual.mutate(leadId)}
                retryPending={retryManual.isPending}
              />
              <div className="card-surface p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] tracking-[0.18em] font-semibold text-muted-foreground">TARGET</div>
                    <div className="text-lg font-semibold">{scan.target_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {executedQueries}/{plannedQueries} fresh queries · {scan.total_results} classified threats · {discoveries.length} public leads
                    </div>
                    {(scan.status === "running" || scan.status === "partial") && (
                      <div className="mt-1 text-[11px] text-blue-400">
                        {liveStage ? `${liveStage} · ` : "Progress · "}
                        {executedQueries}/{plannedQueries} queries ·{" "}
                        {diagnostics?.crawl_succeeded ?? 0} pages verified ·{" "}
                        {diagnostics?.client_visible ?? scan.total_results ?? 0} threats saved
                      </div>
                    )}
                    {scan.status === "running" && (() => {
                      const metrics =
                        scan.discovery_metrics &&
                        typeof scan.discovery_metrics === "object"
                          ? (scan.discovery_metrics as Record<string, unknown>)
                          : null;
                      const workerState = resolveWorkerProgressUiState({
                        status: scan.status,
                        queriesGenerated: plannedQueries,
                        queriesExecuted: executedQueries,
                        discoveryMetrics: metrics,
                      });
                      if (
                        workerState === "running_unknown" &&
                        !(stalled && executedQueries === 0)
                      ) {
                        return null;
                      }
                      const copy = workerProgressUiCopy(
                        stalled && executedQueries === 0 && workerState === "running_unknown"
                          ? "accepted_but_not_started"
                          : workerState,
                      );
                      return (
                        <div
                          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-600"
                          data-testid="deepfake-worker-progress-banner"
                        >
                          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                          <span>
                            <span className="font-semibold">{copy.title}</span>
                            <br />
                            {copy.body}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={scan.status} />
                    <div className="flex items-center gap-1.5">
                      <Filter className="size-3.5 text-muted-foreground" />
                      {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setRiskFilter(r)}
                          className={`text-[10px] px-2 py-1 rounded border ${
                            riskFilter === r ? "bg-primary/15 border-primary/50 text-primary" : "border-border/60 text-muted-foreground hover:bg-secondary/40"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {scan.status === "partial" && (
                  <div className="mt-3 flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                      <div>
                        <div className="font-medium">
                          Scan paused with verified progress saved.
                        </div>
                        <div className="mt-0.5 text-amber-500/90">
                          {activeScanForSelectedScan(scan)
                            ? "Another scan is already running for this identity. Continue is unavailable until that run finishes."
                            : "Continue resumes from the checkpoint without repeating completed queries."}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                      disabled={
                        continueScan.isPending ||
                        Boolean(activeScanForSelectedScan(scan))
                      }
                      onClick={() => continueScan.mutate(scan.id)}
                    >
                      {continueScan.isPending ? (
                        <>
                          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                          Continuing…
                        </>
                      ) : (
                        "Continue scan"
                      )}
                    </Button>
                  </div>
                )}
                {scan.status === "failed" && scan.error_message && (
                  <div className="mt-3 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5" /> {scan.error_message}
                  </div>
                )}
                {scan.status !== "partial" && scan.status !== "failed" && scan.error_message && (
                  <div className="mt-3 text-xs text-red-500 flex items-start gap-2">
                    <AlertTriangle className="size-3.5 mt-0.5" /> {scan.error_message}
                  </div>
                )}
                {(diagnostics ||
                  scan.status === "running" ||
                  googleImagesBackgroundProgress(discoveryMetricObject ?? undefined)
                    .running) && (
                  <details
                    className="mt-3 rounded-md border border-border/70 bg-secondary/20 p-3"
                    open={
                      scan.status === "running" ||
                      googleImagesBackgroundProgress(discoveryMetricObject ?? undefined)
                        .running
                    }
                  >
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {scan.status === "running" ||
                      googleImagesBackgroundProgress(discoveryMetricObject ?? undefined)
                        .running
                        ? "Live Investigation Progress"
                        : "Investigation Diagnostics"}
                    </summary>
                    <div className="mt-3">
                      <InvestigationStatsPanel
                        metrics={discoveryMetricObject ?? undefined}
                        status={scan.status}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {DIAGNOSTIC_KEYS.map((key) => (
                        <div
                          key={key}
                          className="rounded border border-border/60 bg-background/40 px-2 py-1.5"
                        >
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {metricLabel(key)}
                          </div>
                          <div className="mt-0.5 text-sm font-semibold">
                            {diagnostics?.[key] ?? 0}
                          </div>
                        </div>
                      ))}
                    </div>
                    {typeof diagnostics?.crawl_failed === "number" &&
                      typeof diagnostics?.crawl_succeeded === "number" && (
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          Crawl failure rate{" "}
                          {Math.round(
                            (diagnostics.crawl_failed /
                              Math.max(
                                diagnostics.crawl_failed +
                                  diagnostics.crawl_succeeded,
                                1,
                              )) *
                              100,
                          )}
                          %
                        </div>
                      )}
                  </details>
                )}
              </div>

              <DeepfakeReportActionBar
                scanStatus={scan.status}
                findingCount={findings.length}
                history={reportHistory.data ?? []}
                historyLoading={reportHistory.isLoading}
                historyOpen={reportHistoryOpen}
                onToggleHistory={() => {
                  setReportHistoryOpen((open) => !open);
                  if (!reportHistoryOpen) {
                    void qc.invalidateQueries({
                      queryKey: ["deepfake-report-history"],
                    });
                  }
                }}
                generatingFinal={reportGenerateMode === "final"}
                generatingInterim={reportGenerateMode === "interim"}
                downloading={downloadMutation.isPending}
                downloadingHistoryId={downloadingHistoryId}
                canDownload={canDownloadReport}
                onGenerateFinal={() => runDeepfakeReport("final")}
                onGenerateInterim={() => runDeepfakeReport("interim")}
                onDownloadLatest={downloadLatestReport}
                onDownloadHistory={(historyId) =>
                  downloadMutation.mutate({ data: { historyId } })
                }
              />

              <div
                data-testid="deepfake-results-panel"
                data-legacy-finding-cards={renderLegacyFindingCards ? "enabled" : "disabled"}
                data-console-mounted={mountResultsConsole ? "true" : "false"}
              >
                {showResultsLoader ? (
                  <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                  </div>
                ) : mountResultsConsole ? (
                  <ResultsIntelligenceConsole
                    scanId={scan.id}
                    scanStatus={scan.status}
                    targetName={scan.target_name}
                    artistThumbnailUrl={thumbnailUrl}
                    findings={findings}
                    discoveries={discoveries}
                    diagnostics={diagnostics}
                    riskFilter={riskFilter}
                    onRiskFilterChange={setRiskFilter}
                    pending={upd.isPending}
                    onUpdateFinding={(findingId, status) =>
                      upd.mutate({ finding_id: findingId, review_status: status })
                    }
                    emptyMessage={emptyFindingsStatusMessage({
                      status: scan.status,
                      errorMessage: scan.error_message,
                      discoveryMetrics: discoveryMetricObject ?? undefined,
                    })}
                    threatTone={threatSummary.tone}
                    focusDomain={threatDomainFocus}
                  />
                ) : (
                  <div
                    className="card-surface p-10 text-center text-sm text-muted-foreground"
                    data-testid="deepfake-results-empty"
                  >
                    <p>
                      {emptyFindingsStatusMessage({
                        status: scan.status,
                        errorMessage: scan.error_message,
                        discoveryMetrics: discoveryMetricObject ?? undefined,
                      })}
                    </p>
                    <ul className="mt-4 text-left text-xs space-y-1 max-w-lg mx-auto list-disc pl-4">
                      {emptyFindingsDetailLines({
                        status: scan.status,
                        discoveryMetrics: discoveryMetricObject ?? undefined,
                      }).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {discoveries.length > 0 && (
                <div className="card-surface p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
                        LATEST PUBLIC LEADS
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Relevant public pages indicating possible synthetic or explicit-media threats. Leads are unverified until reviewed.
                      </p>
                    </div>
                    <Badge variant="outline">{discoveries.length}</Badge>
                  </div>
                  <ul className="divide-y divide-border/60">
                    {discoveries.slice(0, 30).map((lead: {
                      id: string;
                      page_url: string;
                      page_title: string | null;
                      snippet: string | null;
                      source: string;
                      source_host: string | null;
                    }) => (
                      <li key={lead.id} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              Verified · {lead.source_host ?? "unknown domain"}
                            </div>
                            <div className="mt-0.5 truncate text-sm font-medium">
                              {lead.page_title || "Verified evidence page"}
                            </div>
                            <a
                              href={lead.page_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                              title={`${lead.source_host ?? ""} — ${lead.page_title || lead.page_url}`}
                            >
                              <ExternalLink className="size-3" />
                              Open verified page
                            </a>
                            {lead.snippet && (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {lead.snippet}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="shrink-0 text-[9px] uppercase">
                            URL verified
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null)}
        </div>
      </section>
    </div>
  );
}

function ManualEvidenceLeadsSection({
  leads,
  diagnostics,
  automatedFindingsCount,
  loading,
  error,
  overrideDrafts,
  setOverrideDrafts,
  onOverride,
  overridePending,
  onRetry,
  retryPending,
}: {
  leads: Array<Record<string, any>>;
  diagnostics: Record<string, number> | null;
  automatedFindingsCount: number;
  loading: boolean;
  error: unknown;
  overrideDrafts: Record<
    string,
    { source_page_url: string; direct_image_url: string; notes: string }
  >;
  setOverrideDrafts: Dispatch<
    SetStateAction<
      Record<string, { source_page_url: string; direct_image_url: string; notes: string }>
    >
  >;
  onOverride: (
    leadId: string,
    draft: { source_page_url: string; direct_image_url: string; notes: string },
  ) => void;
  overridePending: boolean;
  onRetry: (leadId: string) => void;
  retryPending: boolean;
}) {
  return (
    <div className="card-surface p-4" data-testid="manual-evidence-leads">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">
            MANUAL EVIDENCE LEADS ({leads.length})
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Preloaded Investigation Leads · Not Automatically Discovered. Supplied links stay visible while Google result resolution, crawl, face comparison and evidence capture run independently.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Automated Findings {automatedFindingsCount}</Badge>
          <Badge variant="outline">Manual Evidence Leads {leads.length}</Badge>
        </div>
      </div>

      {diagnostics && (
        <details className="mb-3 rounded-md border border-border/70 bg-secondary/20 p-3">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Manual Evidence Diagnostics
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {MANUAL_DIAGNOSTIC_KEYS.map((key) => (
              <div
                key={key}
                className="rounded border border-border/60 bg-background/40 px-2 py-1.5"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {metricLabel(key)}
                </div>
                <div className="mt-0.5 text-sm font-semibold">
                  {diagnostics[key] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {loading ? (
        <div className="py-5 text-center text-xs text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
          Loading manual leads…
        </div>
      ) : error ? (
        <div className="py-4 text-center text-xs text-red-500">
          {error instanceof Error ? error.message : "Unable to load manual leads"}
        </div>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => {
            const status = String(lead.processing_status ?? "submitted");
            const rank = manualStatusRank(status);
            const draft =
              overrideDrafts[lead.id] ?? {
                source_page_url: "",
                direct_image_url: "",
                notes: "",
              };
            const unresolvedGoogle =
              String(lead.submitted_url_kind ?? "").startsWith("google_images") &&
              status === "failed" &&
              /Source page could not be resolved automatically|Playwright is not installed/i.test(
                String(lead.error_reason ?? ""),
              );

            return (
              <li
                key={lead.id}
                id={`manual-lead-${lead.id}`}
                className="rounded-md border border-border/70 bg-background/35 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px] uppercase">
                        {MANUAL_STATUS_LABELS[status] ?? status}
                      </Badge>
                      {lead.classification && (
                        <span className="text-[10px] text-muted-foreground">
                          {String(lead.classification)}
                        </span>
                      )}
                    </div>
                    <a
                      href={lead.submitted_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 block truncate text-xs font-medium hover:text-primary"
                      title={lead.submitted_url}
                    >
                      {lead.submitted_url}
                    </a>
                    {lead.selected_result_fragment && (
                      <div className="mt-1 truncate text-[10px] text-muted-foreground">
                        Selected result: #{lead.selected_result_fragment}
                      </div>
                    )}
                    {lead.source_page_url && (
                      <a
                        href={lead.source_page_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="size-3" />
                        Source page found
                      </a>
                    )}
                    {lead.original_image_url && (
                      <a
                        href={lead.original_image_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-3 mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="size-3" />
                        Original image
                      </a>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">Google Images</Badge>
                      <Badge variant="secondary" className="text-[9px]">
                        {status === "submitted" ? "Submitted" : "Processing"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px]">Requires Verification</Badge>
                      <a href={lead.submitted_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                        <ExternalLink className="size-3" /> Open Link
                      </a>
                      <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary" onClick={() => void navigator.clipboard?.writeText(String(lead.submitted_url))}>
                        <Copy className="size-3" /> Copy Link
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary" disabled={retryPending} onClick={() => onRetry(String(lead.id))}>
                        <Camera className="size-3" /> Capture Evidence
                      </button>
                      <button type="button" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary" onClick={() => document.getElementById(`manual-lead-${lead.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                        <FileSearch className="size-3" /> Review
                      </button>
                    </div>
                  </div>
                  {status === "failed" || status === "rejected" ? (
                    <AlertTriangle className="size-4 shrink-0 text-red-500" />
                  ) : status === "evidence_ready" || status === "review_required" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Loader2 className="size-4 shrink-0 animate-spin text-blue-400" />
                  )}
                </div>

                <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                  {MANUAL_STATUS_STEPS.map(([step, label], index) => {
                    const complete =
                      status === step ||
                      (
                        !["failed", "rejected"].includes(status) &&
                        index <= Math.min(rank, 5)
                      ) ||
                      (status === "review_required" && step === "review_required") ||
                      (status === "evidence_ready" && step === "evidence_ready") ||
                      (status === "failed" && step === "failed");
                    return (
                      <div
                        key={step}
                        className={`rounded border px-2 py-1 text-[10px] ${
                          complete
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border/60 text-muted-foreground"
                        }`}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                  <div>Domain: {lead.source_domain ?? "pending"}</div>
                  <div>SHA-256: {lead.media_sha256 ? "captured" : "pending"}</div>
                  <div>pHash: {lead.perceptual_hash ? "captured" : "pending"}</div>
                  <div>
                    Face:{" "}
                    {typeof lead.face_similarity_score === "number"
                      ? `${Math.round(lead.face_similarity_score)}%`
                      : "pending"}
                  </div>
                </div>

                {lead.error_reason && (
                  <div className="mt-2 rounded border border-red-500/25 bg-red-500/10 p-2 text-[11px] text-red-500">
                    {lead.error_reason}
                  </div>
                )}

                {unresolvedGoogle && (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-xs font-medium text-amber-500">
                      Source page could not be resolved automatically.
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <Input
                        type="url"
                        value={draft.source_page_url}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [lead.id]: {
                              ...draft,
                              source_page_url: event.target.value,
                            },
                          }))
                        }
                        placeholder="Source-page URL"
                      />
                      <Input
                        type="url"
                        value={draft.direct_image_url}
                        onChange={(event) =>
                          setOverrideDrafts((prev) => ({
                            ...prev,
                            [lead.id]: {
                              ...draft,
                              direct_image_url: event.target.value,
                            },
                          }))
                        }
                        placeholder="Direct image URL"
                      />
                    </div>
                    <Textarea
                      value={draft.notes}
                      onChange={(event) =>
                        setOverrideDrafts((prev) => ({
                          ...prev,
                          [lead.id]: {
                            ...draft,
                            notes: event.target.value,
                          },
                        }))
                      }
                      className="mt-2"
                      rows={2}
                      placeholder="Reviewer notes"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      disabled={
                        overridePending ||
                        (!draft.source_page_url.trim() &&
                          !draft.direct_image_url.trim())
                      }
                      onClick={() => onOverride(lead.id, draft)}
                    >
                      {overridePending ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Continue evidence processing"
                      )}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read selected image."));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () =>
      reject(new Error("Unable to read selected image."));

    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running:   "bg-blue-500/15 text-blue-400 border-blue-500/40",
    completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
    partial:   "bg-amber-500/15 text-amber-400 border-amber-500/40",
    failed:    "bg-red-500/15 text-red-400 border-red-500/40",
  };
  const label =
    status === "partial"
      ? "partial results"
      : status;
  const cls = map[status] ?? "bg-secondary text-muted-foreground border-border/60";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  );
}

function RiskChip({ level, count }: { level: RiskLevel; count: number }) {
  if (count <= 0) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${RISK_STYLE[level].badge}`}>
      {level[0]}·{count}
    </span>
  );
}
