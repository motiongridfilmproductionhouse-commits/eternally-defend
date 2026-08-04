import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  filterClientDiscoveries,
  filterClientFindings,
} from "./deepfake/client-results.server";
import {
  assertNotAborted,
  createScanRuntime,
  isAbortError,
  isDeadlineOrTimeoutError,
  leaseExpiresAtIso,
  ScanCheckpointPauseError,
  ScanDeadlineError,
} from "./deepfake/scan-runtime.server";
import {
  checkpointHasPendingWork,
  parseScanCheckpoint,
  type ScanCheckpoint,
} from "./deepfake/scan-checkpoint.server";
import {
  createDiscoveryFunnelMetrics,
  createScanRunToken,
  decideTerminalStatus,
  finalizeScanStatus,
  hasValidScanProgress,
  recoverExpiredScanLease,
  recoverExpiredScansForUser,
  type DiscoveryFunnelMetrics,
  type ScanOwnership,
  type TerminalScanStatus,
} from "./deepfake/scan-ownership.server";
import {
  findActiveScanForIdentity,
  isUniqueViolation,
} from "./deepfake/scan-concurrency.server";
import {
  executeInterleavedDeepfakePipeline,
  type PipelineResult,
} from "./deepfake/scan-pipeline.server";
import {
  classifyManualEvidenceUrl,
  createEmptyManualEvidenceDiagnostics,
  dispatchManualEvidenceWorker,
  processManualEvidenceLeadsById,
  splitManualEvidenceUrls,
} from "./deepfake/manual-evidence.server";
import {
  removeSarayuMohanPreloadedEvidence,
  seedSarayuMohanManualEvidence,
} from "./deepfake/sarayu-evidence-seed.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

async function requireDeepfakeAdmin(context: any) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Forbidden");
}

function alreadyRunningResult(scanId: string) {
  return {
    scan_id: scanId,
    total_results: 0,
    discovered_results: 0,
    status: "running" as const,
    already_running: true as const,
  };
}

function isDeadlineAbort(error: unknown, signal: AbortSignal): boolean {
  if (isDeadlineOrTimeoutError(error)) return true;
  if (error instanceof ScanDeadlineError) return true;
  if (signal.reason instanceof ScanDeadlineError) return true;
  return (
    isAbortError(error) &&
    signal.aborted &&
    (signal.reason instanceof ScanDeadlineError ||
      isDeadlineOrTimeoutError(signal.reason))
  );
}

function checkpointFromError(error: unknown): ScanCheckpoint | null {
  const value = (error as { checkpoint?: unknown } | null)?.checkpoint;
  return parseScanCheckpoint(value);
}

function finalCounts(input: {
  pipelineResult: PipelineResult | null;
  checkpoint: ScanCheckpoint | null;
}) {
  const { pipelineResult, checkpoint } = input;
  return {
    planQueryCount:
      pipelineResult?.planQueryCount ?? checkpoint?.queries.length ?? 0,
    discoveryCount:
      pipelineResult?.discoveryCount ?? checkpoint?.discovery_count ?? 0,
    findingCount:
      pipelineResult?.findingCount ?? checkpoint?.finding_count ?? 0,
    clientVisibleCount:
      pipelineResult?.clientVisibleCount ??
      checkpoint?.client_visible_count ??
      0,
    riskCounts: pipelineResult?.riskCounts ??
      checkpoint?.risk_counts ?? {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
    metrics: {
      ...createDiscoveryFunnelMetrics(),
      ...(pipelineResult?.metrics ?? checkpoint?.metrics ?? {}),
    },
  };
}

async function finalizePipelineRun(input: {
  supabase: any;
  ownership: ScanOwnership;
  runtime: ReturnType<typeof createScanRuntime>;
  pipelineResult: PipelineResult | null;
  pipelineError: unknown;
  fallbackCheckpoint?: ScanCheckpoint | null;
}): Promise<{
  terminalStatus: TerminalScanStatus;
  terminalReason: string | null;
  counts: ReturnType<typeof finalCounts>;
  checkpoint: ScanCheckpoint | null;
}> {
  const checkpoint =
    input.pipelineResult?.checkpoint ??
    checkpointFromError(input.pipelineError) ??
    input.fallbackCheckpoint ??
    null;
  const counts = finalCounts({
    pipelineResult: input.pipelineResult,
    checkpoint,
  });
  const errorMessage =
    input.pipelineError instanceof Error
      ? input.pipelineError.message
      : input.pipelineError
        ? String(input.pipelineError)
        : null;
  const checkpointPause = input.pipelineError instanceof ScanCheckpointPauseError;
  const deadlineAbort =
    isDeadlineAbort(input.pipelineError, input.runtime.signal) ||
    isDeadlineOrTimeoutError(input.pipelineError) ||
    checkpointPause;
  const validProgress = hasValidScanProgress({
    metrics: counts.metrics,
    discoveryCount: counts.discoveryCount,
    findingCount: counts.findingCount,
    clientVisibleCount: counts.clientVisibleCount,
  });
  const pendingWork = checkpoint ? checkpointHasPendingWork(checkpoint) : false;
  const decision =
    input.pipelineResult?.completed && !input.pipelineError
      ? { status: "completed" as TerminalScanStatus, reason: null }
      : decideTerminalStatus({
          abortedByDeadline: deadlineAbort,
          hasValidProgress: validProgress,
          pendingWork,
          checkpointPause,
          errorMessage: checkpointPause
            ? null
            : (errorMessage ??
              (input.runtime.signal.aborted
                ? "Scan was aborted before completion."
                : null)),
        });

  await finalizeScanStatus({
    supabase: input.supabase,
    ownership: input.ownership,
    status: decision.status,
    patch: {
      total_queries: counts.planQueryCount,
      total_results: counts.clientVisibleCount,
      critical_count: counts.riskCounts.critical,
      high_count: counts.riskCounts.high,
      medium_count: counts.riskCounts.medium,
      low_count: counts.riskCounts.low,
      discovery_metrics: counts.metrics,
      scan_checkpoint: checkpoint,
    },
    errorMessage: decision.reason,
  });

  return {
    terminalStatus: decision.status,
    terminalReason: decision.reason,
    counts,
    checkpoint,
  };
}

/**
 * Create/acquire a RUNNING scan row and return immediately.
 * Never waits for the discovery/verification pipeline — the client must call
 * executeDeepfakeScanPipeline with the returned scan_id.
 */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target_name: z.string().trim().min(1).max(200),
        profile_id: z.string().uuid().optional(),
        aliases: z
          .array(z.string().trim().min(1).max(200))
          .max(20)
          .optional()
          .default([]),
        handles: z
          .array(z.string().trim().min(1).max(200))
          .max(20)
          .optional()
          .default([]),
        google_images_url: z.string().trim().max(5000).optional(),
        max_queries: z.number().int().min(40).max(60).optional(),
        per_query_limit: z.number().int().min(10).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const runtime = createScanRuntime();
    const scanRunToken = createScanRunToken();
    const aliases = data.aliases ?? [];
    const handles = data.handles ?? [];

    try {
      await recoverExpiredScansForUser({ supabase, userId });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during scan start:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const activeScan = await findActiveScanForIdentity({
      supabase,
      userId,
      profileId: data.profile_id ?? null,
      targetName: data.target_name,
    });

    if (activeScan) {
      return alreadyRunningResult(activeScan.id);
    }

    const nowMs = Date.now();
    const scanInsert: Record<string, unknown> = {
      user_id: userId,
      target_name: data.target_name,
      aliases,
      handles,
      status: "running",
      scan_run_token: scanRunToken,
      heartbeat_at: new Date(nowMs).toISOString(),
      lease_expires_at: leaseExpiresAtIso(runtime.leaseTtlMs, nowMs),
      error_message: null,
      // Persist start options so execute can resume without trusting the client
      // for identity fields (google URL / limits only).
      discovery_metrics: {
        stage: "discovering",
        start_options: {
          google_images_url: data.google_images_url ?? null,
          max_queries: data.max_queries ?? 56,
          per_query_limit: data.per_query_limit ?? 20,
        },
      },
    };

    if (data.profile_id) {
      scanInsert.profile_id = data.profile_id;
    }

    const { data: scan, error: sErr } = await supabase
      .from("deepfake_scans")
      .insert(scanInsert as any)
      .select("id, status")
      .single();

    if (sErr || !scan) {
      if (sErr && isUniqueViolation(sErr)) {
        const concurrent = await findActiveScanForIdentity({
          supabase,
          userId,
          profileId: data.profile_id ?? null,
          targetName: data.target_name,
        });
        if (concurrent) {
          return alreadyRunningResult(concurrent.id);
        }
      }
      throw new Error(sErr?.message ?? "failed to create scan");
    }

    return {
      scan_id: scan.id,
      total_results: 0,
      discovered_results: 0,
      status: "running" as const,
      started: true as const,
    };
  });

/**
 * Run the interleaved pipeline for an already-created RUNNING scan.
 * Called separately so scan-start can return the scan_id immediately.
 */
export const executeDeepfakeScanPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid(),
        google_images_url: z.string().trim().max(5000).optional(),
        max_queries: z.number().int().min(40).max(60).optional(),
        per_query_limit: z.number().int().min(10).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: scan, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("id", data.scan_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!scan) throw new Error("Scan not found.");
    if (scan.status !== "running") {
      return {
        scan_id: scan.id,
        total_results: scan.total_results ?? 0,
        discovered_results: scan.total_results ?? 0,
        status: scan.status,
      };
    }

    const scanRunToken = (scan as { scan_run_token?: string | null }).scan_run_token;
    if (!scanRunToken) {
      throw new Error(
        "Scan ownership token is missing — restart the scan to acquire a new lease.",
      );
    }

    const metrics = objectish(scan.discovery_metrics);
    const startOptions = objectish(metrics?.start_options);
    const googleImagesUrl =
      data.google_images_url ??
      (typeof startOptions?.google_images_url === "string"
        ? startOptions.google_images_url
        : undefined);
    const maxQueries =
      data.max_queries ??
      (typeof startOptions?.max_queries === "number"
        ? startOptions.max_queries
        : 56);
    const perQueryLimit =
      data.per_query_limit ??
      (typeof startOptions?.per_query_limit === "number"
        ? startOptions.per_query_limit
        : 20);

    const runtime = createScanRuntime();
    const ownership: ScanOwnership = {
      scanId: scan.id,
      scanRunToken,
      runtime,
    };
    const resumeCheckpoint = parseScanCheckpoint(scan.scan_checkpoint);
    const target = {
      name: scan.target_name,
      aliases: scan.aliases ?? [],
      handles: scan.handles ?? [],
    };

    let pipelineResult: PipelineResult | null = null;
    let pipelineError: unknown = null;

    try {
      assertNotAborted(runtime.signal);
      pipelineResult = await executeInterleavedDeepfakePipeline({
        supabase,
        userId,
        ownership,
        scanId: scan.id,
        target,
        profileId: scan.profile_id ?? null,
        googleImagesUrl,
        maxQueries,
        perQueryLimit,
        runtime,
        resumeCheckpoint: resumeCheckpoint ?? undefined,
      });
    } catch (err) {
      pipelineError = err;
      console.warn("[DEEPFAKE] Scan pipeline stopped:", {
        scan_id: scan.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const finalized = await finalizePipelineRun({
      supabase,
      ownership,
      runtime,
      pipelineResult,
      pipelineError,
      fallbackCheckpoint: resumeCheckpoint,
    });

    return {
      scan_id: scan.id,
      total_results: finalized.counts.clientVisibleCount,
      discovered_results: finalized.counts.findingCount,
      status: finalized.terminalStatus,
    };
  });

/**
 * Acquire PARTIAL → RUNNING and return immediately. Pipeline execution is a
 * separate executeDeepfakeScanPipeline call from the client.
 */
export const continueDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      await recoverExpiredScanLease({ supabase, scanId: data.scan_id });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during continue:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const { data: scan, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("id", data.scan_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!scan) throw new Error("Scan not found.");
    if (scan.status !== "partial") {
      throw new Error("Only partial scans can be continued.");
    }

    const resumeCheckpoint = parseScanCheckpoint(scan.scan_checkpoint);
    if (!resumeCheckpoint) {
      throw new Error("This partial scan does not have a resumable checkpoint.");
    }

    const activeScan = await findActiveScanForIdentity({
      supabase,
      userId,
      profileId: scan.profile_id ?? null,
      targetName: scan.target_name,
    });

    if (activeScan && activeScan.id !== scan.id) {
      return alreadyRunningResult(activeScan.id);
    }

    /*
     * Atomic PARTIAL → RUNNING via SECURITY DEFINER RPC. The DB trigger only
     * allows this transition when the continue GUC is set inside the RPC, so
     * unrestricted client UPDATEs cannot revive partial scans.
     */
    const { data: acquiredRows, error: acquireError } = await supabase.rpc(
      "acquire_deepfake_scan_continuation" as any,
      { p_scan_id: scan.id },
    );

    if (acquireError) {
      throw new Error(
        acquireError.message || "Unable to acquire the scan continuation lease.",
      );
    }

    const acquired = Array.isArray(acquiredRows) ? acquiredRows[0] : acquiredRows;
    const scanRunToken =
      acquired && typeof acquired === "object"
        ? String((acquired as { scan_run_token?: string }).scan_run_token ?? "")
        : "";

    if (!scanRunToken) {
      throw new Error("Unable to acquire the scan continuation lease.");
    }

    return {
      scan_id: scan.id,
      total_results: scan.total_results ?? 0,
      discovered_results: scan.total_results ?? 0,
      status: "running" as const,
      started: true as const,
      continued: true as const,
    };
  });

export const listDeepfakeScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    try {
      await recoverExpiredScansForUser({ supabase, userId });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during history load:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const { data, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as ScanRow[];
  });

function objectish(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const getDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await recoverExpiredScanLease({
        supabase: context.supabase,
        scanId: data.scan_id,
      });
    } catch (recoverError) {
      console.warn(
        "[DEEPFAKE] Lease recovery skipped during scan load:",
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }

    const [scanRes, findingsRes, discoveriesRes] = await Promise.all([
      context.supabase
        .from("deepfake_scans")
        .select("*")
        .eq("id", data.scan_id)
        .maybeSingle(),

      context.supabase
        .from("deepfake_findings")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("risk_level", { ascending: true })
        .order("confidence", { ascending: false }),

      (context.supabase as any)
        .from("deepfake_discoveries")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("discovered_at", {
          ascending: false,
        })
        .limit(500),
    ]);

    if (scanRes.error) throw new Error(scanRes.error.message);
    if (findingsRes.error) throw new Error(findingsRes.error.message);
    if (discoveriesRes.error) {
      console.warn(
        "[DEEPFAKE] Unable to load discoveries:",
        discoveriesRes.error.message,
      );
    }

    const scan = scanRes.data as
      | (ScanRow & { profile_id?: string | null })
      | null;

    if (!scan) {
      return {
        scan: null,
        findings: [],
        discoveries: [],
      };
    }

    const target = {
      name: scan.target_name,
      aliases: scan.aliases ?? [],
      handles: scan.handles ?? [],
    };

    const riskRank: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    const allFindings = (findingsRes.data ?? []) as Array<
      FindingRow & {
        finding_classification?: string | null;
        url_verification_status?: string | null;
        final_url?: string | null;
        canonical_url?: string | null;
        discovered_url?: string | null;
        verified_domain?: string | null;
      }
    >;

    const findings = filterClientFindings(
      allFindings,
      target,
      data.scan_id,
    ).sort(
      (a, b) =>
        (riskRank[b.risk_level] ?? 0) - (riskRank[a.risk_level] ?? 0) ||
        b.confidence - a.confidence,
    );

    const discoveries = filterClientDiscoveries(
      (discoveriesRes.data ?? []) as Array<{
        id: string;
        scan_id?: string;
        page_url: string;
        page_title: string | null;
        snippet: string | null;
        source: string;
        source_host: string | null;
        analysis_status?: string | null;
        canonical_url?: string | null;
        image_url?: string | null;
        thumbnail_url?: string | null;
      }>,
      target,
      data.scan_id,
    );

    return {
      scan,
      findings,
      discoveries,
    };
  });

export const updateDeepfakeFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        finding_id: z.string().uuid(),
        review_status: z.enum([
          "new",
          "reviewed",
          "dismissed",
          "queued_takedown",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("deepfake_findings")
      .update({ review_status: data.review_status })
      .eq("id", data.finding_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const submitManualEvidenceUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid().optional(),
        profile_id: z.string().uuid().optional(),
        target_name: z.string().trim().min(1).max(200),
        urls_text: z.string().trim().min(1).max(30_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const urls = splitManualEvidenceUrls(data.urls_text).slice(0, 50);
    if (!urls.length) {
      throw new Error("Paste at least one http(s) evidence URL.");
    }

    const rows = urls.map((submittedUrl) => {
      const classified = classifyManualEvidenceUrl(submittedUrl);
      return {
        user_id: userId,
        scan_id: data.scan_id ?? null,
        profile_id: data.profile_id ?? null,
        target_name: data.target_name,
        submitted_url: classified.exactSubmittedUrl,
        submitted_url_kind: classified.kind,
        selected_result_fragment: classified.selectedResultFragment,
        processing_status: "submitted",
        classification: "manual lead",
        discovery_path: ["manual_submission"],
        error_reason: null,
        updated_at: new Date().toISOString(),
      };
    });

    const { data: inserted, error } = await (supabase as any)
      .from("deepfake_manual_leads")
      .upsert(rows, {
        onConflict: "user_id,target_name,submitted_url",
        ignoreDuplicates: false,
      })
      .select("*");
    if (error) throw new Error(error.message);

    const leadIds = ((inserted ?? []) as Array<{ id: string }>).map((row) => row.id);
    const dispatch = leadIds.length
      ? await dispatchManualEvidenceWorker(leadIds)
      : { dispatched: false, reason: "No lead rows were created." };

    if (!dispatch.dispatched && leadIds.length) {
      await (supabase as any)
        .from("deepfake_manual_leads")
        .update({
          error_reason: dispatch.reason,
          updated_at: new Date().toISOString(),
        })
        .in("id", leadIds);
    }

    return {
      lead_ids: leadIds,
      submitted: urls.length,
      dispatched: dispatch.dispatched,
      dispatch_reason: dispatch.reason,
    };
  });

export const processManualEvidenceUrlsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        lead_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("user_id", context.userId)
      .in("id", data.lead_ids);
    if (error) throw new Error(error.message);
    const leadIds = (rows ?? []).map((row: { id: string }) => row.id);
    return processManualEvidenceLeadsById({
      supabase: context.supabase,
      leadIds,
    });
  });

export const listManualEvidenceLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        scan_id: z.string().uuid().optional(),
        profile_id: z.string().uuid().optional(),
        target_name: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (data.scan_id) {
      query = query.eq("scan_id", data.scan_id);
    } else if (data.profile_id) {
      query = query.eq("profile_id", data.profile_id);
    } else if (data.target_name?.trim()) {
      query = query.eq("target_name", data.target_name.trim());
    }

    const { data: leads, error } = await query;
    if (error) throw new Error(error.message);

    const diagnostics = createEmptyManualEvidenceDiagnostics();
    for (const lead of leads ?? []) {
      diagnostics.manual_urls_submitted++;
      if (String(lead.submitted_url_kind ?? "").startsWith("google_images")) {
        diagnostics.google_viewer_urls_parsed++;
      }
      if (lead.source_page_url || lead.original_image_url) {
        diagnostics.selected_results_resolved++;
      }
      if (lead.source_page_url) diagnostics.source_pages_found++;
      if (lead.processing_status === "crawled" || lead.page_title) {
        diagnostics.pages_crawled++;
      }
      if (Array.isArray(lead.extracted_images)) {
        diagnostics.images_extracted += lead.extracted_images.length;
      }
      if (lead.face_similarity_score !== null && lead.face_similarity_score !== undefined) {
        diagnostics.faces_compared++;
      }
      if ((lead.face_similarity_score ?? 0) >= 88) {
        diagnostics.identity_matches++;
      }
      if (lead.processing_status === "evidence_ready" || lead.media_sha256) {
        diagnostics.evidence_packages_ready++;
      }
      if (lead.processing_status === "failed") diagnostics.failed_resolutions++;
      if (lead.duplicate_of_lead_id) diagnostics.duplicate_leads++;
    }

    return {
      leads: leads ?? [],
      diagnostics,
    };
  });

export const overrideManualEvidenceSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        lead_id: z.string().uuid(),
        source_page_url: z.string().trim().url().optional(),
        direct_image_url: z.string().trim().url().optional(),
        notes: z.string().trim().max(2000).optional(),
      })
      .refine((value) => value.source_page_url || value.direct_image_url, {
        message: "Enter a source-page URL or direct image URL.",
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: lead, error: loadError } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("id", data.lead_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!lead) throw new Error("Manual lead not found.");

    const { error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .update({
        reviewer_source_page_url: data.source_page_url ?? null,
        reviewer_image_url: data.direct_image_url ?? null,
        reviewer_notes: data.notes ?? null,
        source_page_url: data.source_page_url ?? null,
        original_image_url: data.direct_image_url ?? null,
        processing_status: "source_resolved",
        error_reason: null,
        classification: "manual lead",
        discovery_path: ["manual_submission", "admin_override"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.lead_id);
    if (error) throw new Error(error.message);

    const dispatch = await dispatchManualEvidenceWorker([data.lead_id]);
    return {
      ok: true,
      dispatched: dispatch.dispatched,
      dispatch_reason: dispatch.reason,
    };
  });

export const loadSarayuEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireDeepfakeAdmin(context);
    return seedSarayuMohanManualEvidence(context.supabase);
  });

export const removeSarayuMohanEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireDeepfakeAdmin(context);
    return removeSarayuMohanPreloadedEvidence(context.supabase);
  });

export const retryManualEvidenceLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ lead_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: lead, error } = await (context.supabase as any)
      .from("deepfake_manual_leads")
      .select("id")
      .eq("id", data.lead_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) throw new Error("Manual lead not found.");
    const dispatch = await dispatchManualEvidenceWorker([data.lead_id]);
    if (!dispatch.dispatched) {
      await (context.supabase as any)
        .from("deepfake_manual_leads")
        .update({ state: "submitted", processing_status: "submitted", error_reason: "Processing pending" })
        .eq("id", data.lead_id);
    }
    return dispatch;
  });

/** Prefills target from client_profiles for the signed-in user. */
export const getDeepfakeTargetSuggestion = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("client_profiles")
      .select("full_name, display_name, company_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      target_name: (data?.full_name ??
        data?.display_name ??
        data?.company_name ??
        "") as string,
      aliases: [] as string[],
      handles: [] as string[],
    };
  });
