import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  runDeepfakeScan,
  executeDeepfakeScanPipeline,
  continueDeepfakeScan,
  listDeepfakeScans,
  getDeepfakeScan,
  updateDeepfakeFinding,
} from "@/lib/deepfake-intel.functions";
import {
  createDeepfakeTargetProfile,
  listDeepfakeTargetProfiles,
  uploadDeepfakeReferenceFace,
  deleteDeepfakeReferenceFace,
} from "@/lib/deepfake/face-profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ScanFace, ShieldAlert, ExternalLink, Loader2, AlertTriangle,
  CheckCircle2, Filter, Radar, Upload, Trash2,
  UserRoundCheck,
} from "lucide-react";
import {
  isScanStalled,
  isTerminalScanStatus,
  pickLiveScanId,
  scanPollInterval,
  scanProgressSignature,
  SCAN_STALL_WARNING_MS,
  shouldShowHistoryEmpty,
  shouldShowHistoryLoading,
  shouldShowResultsLoader,
} from "@/lib/deepfake/scan-ui-state";
import { IdentityScanVisualization } from "@/components/deepfake/IdentityScanVisualization";
import { useReferenceFaceThumbnail } from "@/components/deepfake/useReferenceFaceThumbnail";
import { scanBelongsToSelectedProfile } from "@/lib/deepfake/identity-scan-viz";
import { ResultsIntelligenceConsole } from "@/components/deepfake/results/ResultsIntelligenceConsole";

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

function DeepfakeIntelPage() {
  const runFn = useServerFn(runDeepfakeScan);
  const executeFn = useServerFn(executeDeepfakeScanPipeline);
  const continueFn = useServerFn(continueDeepfakeScan);
  const listFn = useServerFn(listDeepfakeScans);
  const getFn = useServerFn(getDeepfakeScan);
  const updFn = useServerFn(updateDeepfakeFinding);
  const createProfileFn = useServerFn(createDeepfakeTargetProfile);
  const listProfilesFn = useServerFn(listDeepfakeTargetProfiles);
  const uploadReferenceFn = useServerFn(uploadDeepfakeReferenceFace);
  const deleteReferenceFn = useServerFn(deleteDeepfakeReferenceFace);
  const qc = useQueryClient();

  const [targetName, setTargetName] = useState("");
  const [googleImagesUrl, setGoogleImagesUrl] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [handlesText, setHandlesText] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<"ALL" | RiskLevel>("ALL");
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

  const selected = useQuery({
    queryKey: ["deepfake-scan", selectedScanId],
    queryFn: () => selectedScanId ? getFn({ data: { scan_id: selectedScanId } }) : null,
    enabled: !!selectedScanId,
    refetchInterval: (q) => {
      const d = q.state.data as { scan?: { status?: string } } | null | undefined;
      return scanPollInterval({
        status: d?.scan?.status ?? null,
        requestPending: runPendingRef.current,
      });
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

  const executePipeline = useMutation({
    mutationFn: (input: {
      scan_id: string;
      google_images_url?: string;
    }) => executeFn({ data: input }),
    onSuccess: (res) => {
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
      qc.invalidateQueries({ queryKey: ["deepfake-scan", res.scan_id] });

      if (res.status === "partial") {
        toast.message(
          `Partial results — ${res.total_results} threats saved before the scan deadline.`,
        );
        return;
      }

      if (res.status === "failed") {
        toast.error(
          "Scan failed before verified progress was saved. Check the scan error details.",
        );
        return;
      }

      if (res.status === "completed") {
        toast.success(
          `Scan complete — ${res.total_results} threats classified from ${res.discovered_results} latest public leads`,
        );
      }
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Scan pipeline failed to start",
      ),
  });

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
        toast.message(
          "A scan is already running for this identity — showing live progress.",
        );
        return;
      }

      toast.message("Scan started — verifying public leads…");
      executePipeline.mutate({
        scan_id: res.scan_id,
        google_images_url: lastStartOptionsRef.current.google_images_url,
      });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "Unable to start scan",
      ),
  });

  const continueScan = useMutation({
    mutationFn: (scan_id: string) => continueFn({ data: { scan_id } }),
    onSuccess: (res) => {
      setSelectedScanId(res.scan_id);
      qc.invalidateQueries({ queryKey: ["deepfake-scans"] });
      qc.invalidateQueries({ queryKey: ["deepfake-scan", res.scan_id] });

      if ((res as { already_running?: boolean }).already_running) {
        toast.message(
          "A scan is already running for this identity — showing live progress.",
        );
        return;
      }

      toast.message("Continuing from checkpoint…");
      executePipeline.mutate({ scan_id: res.scan_id });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Unable to continue scan",
      ),
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
  const scanRequestPending =
    run.isPending || continueScan.isPending || executePipeline.isPending;
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
    if (executePipeline.isPending) executePipeline.reset();
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
  const findings = selected.data?.findings ?? [];
  const discoveries = selected.data?.discoveries ?? [];
  const diagnostics = metricRecord(scan?.discovery_metrics);
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

  // Prefer the live in-progress scan for this identity over a stale history
  // selection (e.g. an older completed row still highlighted).
  const vizSourceScan = activeScanForIdentity
    ? activeScanForIdentity
    : selectedScanMatchesProfile
      ? scan
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
  const vizScanStatus = vizSourceScan?.status ?? null;
  const vizExecutedQueries =
    vizSourceMetrics?.queries_executed ??
    (typeof vizSourceCheckpoint?.next_query_index === "number"
      ? vizSourceCheckpoint.next_query_index
      : null);
  const vizPlannedQueries =
    (typeof vizSourceCheckpoint?.planned_query_count === "number"
      ? vizSourceCheckpoint.planned_query_count
      : null) ??
    (Array.isArray(vizSourceCheckpoint?.queries)
      ? vizSourceCheckpoint.queries.length
      : null) ??
    vizSourceMetrics?.queries_generated ??
    vizSourceScan?.total_queries ??
    null;
  const vizPagesVerified = vizSourceMetrics?.crawl_succeeded ?? null;
  const vizThreatsSaved =
    vizSourceMetrics?.client_visible ?? vizSourceScan?.total_results ?? null;
  const vizErrorMessage = vizSourceScan?.error_message ?? null;

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
            {(run.error || executePipeline.error || continueScan.error) && (
              <p className="text-[11px] text-red-500">
                {(run.error || executePipeline.error || continueScan.error) instanceof Error
                  ? (run.error || executePipeline.error || continueScan.error)!.message
                  : "Scan request failed"}
              </p>
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
                count: (scans.data ?? []).length,
              }) ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No scans yet.</div>
            ) : (
              <ul className="space-y-1.5 max-h-[420px] overflow-auto">
                {(scans.data ?? []).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedScanId(s.id)}
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
          {selectedProfileId ? (
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
            />
          ) : null}

          {!scan && !selectedProfileId ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              <ShieldAlert className="size-8 mx-auto mb-2 text-muted-foreground/60" strokeWidth={1.2} />
              Run a sweep or select a scan from history to view findings.
            </div>
          ) : !scan && selectedProfileId ? (
            <div className="card-surface p-4 text-center text-sm text-muted-foreground">
              Identity profile ready. Run a Face-Verified Sweep or select a scan
              from history — results stay visible here as they are saved.
            </div>
          ) : scan ? (
            <>
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
                    {scan.status === "running" && stalled && (
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-500">
                        <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          No new progress for 15s — the sweep may have stalled on
                          the server. Saved results below stay visible; the status
                          updates automatically once the run recovers or times out.
                        </span>
                      </div>
                    )}
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
                        executePipeline.isPending ||
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
                {(diagnostics || scan.status === "running") && (
                  <details className="mt-3 rounded-md border border-border/70 bg-secondary/20 p-3" open={scan.status === "running"}>
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {scan.status === "running" ? "Live Discovery Progress" : "Discovery Diagnostics"}
                    </summary>
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

              {shouldShowResultsLoader({ isLoading: selected.isLoading, hasScan: Boolean(scan) }) ? (
                <div className="card-surface p-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-5 mx-auto animate-spin mb-2" /> Loading findings…
                </div>
              ) : (
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
                  emptyMessage={
                    scan.status === "running"
                      ? "Sweep in progress — verified results appear as batches are saved."
                      : scan.status === "partial"
                        ? "Partial scan finished with no client-visible threats at this risk level. Check public leads below."
                        : scan.status === "failed"
                          ? (scan.error_message || "Scan failed before verified progress was saved.")
                          : "No findings at this risk level."
                  }
                />
              )}

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
          ) : null}
        </div>
      </section>
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

