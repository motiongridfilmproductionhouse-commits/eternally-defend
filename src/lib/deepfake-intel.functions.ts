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

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

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
    metrics:
      pipelineResult?.metrics ??
      checkpoint?.metrics ?? {
        queries_generated: 0,
        queries_executed: 0,
        provider_candidates: 0,
        unique_candidates: 0,
        crawl_succeeded: 0,
        crawl_failed: 0,
        identity_rejected: 0,
        page_type_rejected: 0,
        url_rejected: 0,
        unverified: 0,
        probable: 0,
        verified: 0,
        client_visible: 0,
        provider_failures: 0,
        query_failures: 0,
      } satisfies DiscoveryFunnelMetrics,
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

/** Kick off a deepfake intelligence scan. Runs synchronously but saves progress incrementally. */
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
    const target = {
      name: data.target_name,
      aliases,
      handles,
    };

    await recoverExpiredScansForUser({ supabase, userId });

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
    };

    if (data.profile_id) {
      scanInsert.profile_id = data.profile_id;
    }

    const { data: scan, error: sErr } = await supabase
      .from("deepfake_scans")
      .insert(scanInsert as any)
      .select("*")
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

    const ownership: ScanOwnership = {
      scanId: scan.id,
      scanRunToken,
      runtime,
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
        profileId: data.profile_id ?? null,
        googleImagesUrl: data.google_images_url,
        maxQueries: data.max_queries ?? 56,
        perQueryLimit: data.per_query_limit ?? 20,
        runtime,
      });
    } catch (error) {
      pipelineError = error;
      console.warn("[DEEPFAKE] Scan stopped before full completion:", {
        scan_id: scan.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const finalized = await finalizePipelineRun({
      supabase,
      ownership,
      runtime,
      pipelineResult,
      pipelineError,
    });

    return {
      scan_id: scan.id,
      total_results: finalized.counts.clientVisibleCount,
      discovered_results: finalized.counts.findingCount,
      status: finalized.terminalStatus,
    };
  });

export const continueDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await recoverExpiredScanLease({ supabase, scanId: data.scan_id });

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

    const runtime = createScanRuntime();
    const scanRunToken = createScanRunToken();
    const nowMs = Date.now();
    const update = await supabase
      .from("deepfake_scans")
      .update({
        status: "running",
        scan_run_token: scanRunToken,
        heartbeat_at: new Date(nowMs).toISOString(),
        lease_expires_at: leaseExpiresAtIso(runtime.leaseTtlMs, nowMs),
        finished_at: null,
        error_message: null,
      } as any)
      .eq("id", scan.id)
      .eq("user_id", userId)
      .eq("status", "partial")
      .select("id");

    if (update.error) throw new Error(update.error.message);
    if (!Array.isArray(update.data) || update.data.length !== 1) {
      throw new Error("Unable to acquire the scan continuation lease.");
    }

    const ownership: ScanOwnership = {
      scanId: scan.id,
      scanRunToken,
      runtime,
    };
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
        maxQueries: resumeCheckpoint.max_queries,
        perQueryLimit: resumeCheckpoint.per_query_limit,
        runtime,
        resumeCheckpoint,
      });
    } catch (error) {
      pipelineError = error;
      console.warn("[DEEPFAKE] Scan continuation stopped:", {
        scan_id: scan.id,
        error: error instanceof Error ? error.message : String(error),
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

export const listDeepfakeScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await recoverExpiredScansForUser({ supabase, userId });

    const { data, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as ScanRow[];
  });

export const getDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scan_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await recoverExpiredScanLease({
      supabase: context.supabase,
      scanId: data.scan_id,
    });

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
