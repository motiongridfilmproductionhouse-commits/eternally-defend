import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedPutUrl, putObject, sha256Hex } from "@/lib/aws/s3.server";
import { hostOf, canonicalUrl, type DiscoveryCandidate } from "@/lib/copyright/url.server";
import { analyzeReference, firecrawlDiscover } from "@/lib/copyright/discover.server";
import {
  brightDataDiagnostic,
  type BrightDataDiscoveryResult,
} from "@/lib/copyright/brightdata-provider.server";
import { emptyProviderFailureCounts } from "@/lib/copyright/provider-failures";
import { bytesToDataUrl, copyrightImageTypes } from "@/lib/copyright/storage.server";
import { readStoredObject } from "@/lib/copyright/storage.server";

import { bandFor, gradeCandidate } from "@/lib/copyright/classify.server";
import { analyzeDistributionPage, releaseTimingFor } from "@/lib/copyright/distribution.server";
import {
  registerDistributionSource,
  runAutoMonitor,
  shouldRegisterMonitoredSource,
} from "@/lib/copyright/distribution-monitor.server";
import {
  isActionablePiracy,
  normalizeClassification,
} from "@/lib/copyright/taxonomy";
import { filterClientVisibleCopyrightMatches } from "@/lib/copyright/client-filter";
import { dedupeCopyrightMatchRows } from "@/lib/copyright/match-upsert";
import { detectPrimaryPurpose } from "@/lib/copyright/page-classify.server";
import { expandTitleVariants } from "@/lib/copyright/title-identity";
import { explainZeroMatchFunnel, summarizeProviderFailures } from "@/lib/copyright/scan-diagnostics";
import {
  acceptedKnownUrls,
  parseKnownUrlInputs,
  prioritizeKnownUrlLeads,
  validateKnownUrlSeeds,
} from "@/lib/copyright/known-urls.server";
import { isNeverMonitoredDomain } from "@/lib/copyright/official-platforms";
import {
  allocateCrawlSlots,
  isPastDeadline,
  KNOWN_URL_BUDGET_MS,
  PROVIDER_CRAWL_BUDGET_MS,
  splitKnownAndProviderLeads,
} from "@/lib/copyright/crawl-budget";
import {
  bumpCrawlFailure,
  emptyCrawlFailureCounts,
  type CrawlFailureCategory,
} from "@/lib/copyright/crawl-failure";
import {
  copyrightScanWorkerDispatchDiagnostic,
  isCopyrightScanWorkerSecretConfigured,
  resolveCopyrightScanWorkerUrl,
} from "@/lib/copyright/scan-worker-dispatch.server";
import {
  ScanActivityRecorder,
  flushScanActivity,
} from "@/lib/copyright/scan-activity";
import {
  decideCopyrightTerminalStatus,
  EXECUTOR_START_WATCHDOG_MS,
  isExecutorWatchdogExpired,
  markStage,
  watchdogFailureStats,
  type CopyrightTerminalStatus,
} from "@/lib/copyright/scan-lifecycle";
import type { ProviderFailureCategory } from "@/lib/copyright/provider-failures";

import {
  buildMovieFingerprint,
  matchCandidateAgainstFingerprint,
  blendConfidence,
  EMPTY_MATCH,
  type FingerprintMatch,
} from "@/lib/copyright/fingerprint.server";
import { fetchImageBytes } from "@/lib/aws/s3.server";
import { resolveAbuseContact } from "@/lib/copyright/contacts.server";
import type { Database } from "@/integrations/supabase/types";

type MatchInsert = Database["public"]["Tables"]["copyright_matches"]["Insert"];
type ContextSupabase = SupabaseClient<Database>;

const ACTIVE_COPYRIGHT_SCAN_STATUSES = ["queued", "running", "pending"] as const;
const TERMINAL_STATUS_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

/** Neutral legacy-provider placeholder. Copyright discovery is Firecrawl-only. */
function emptyBrightDataDiscovery(): BrightDataDiscoveryResult {
  return {
    provider: "brightdata",
    configured: false,
    hits: [],
    pageLeads: [],
    queriesGenerated: 0,
    requests: 0,
    successes: 0,
    failures: 0,
    candidates: 0,
    duplicatesDropped: 0,
    failuresByCategory: emptyProviderFailureCounts(),
    failureSamples: [],
    diagnostic: brightDataDiagnostic(),
  };
}

function mergeProviderFailureCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...emptyProviderFailureCounts(), ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = (out[key] ?? 0) + value;
  }
  return out;
}


function plainStats(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function recordCopyrightScanDiagnostic(
  supabase: ContextSupabase,
  scanId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("copyright_scans")
      .select("id,status,stats")
      .eq("id", scanId)
      .maybeSingle();
    if (error || !data) {
      console.error("copyright_scan_diagnostic_read_failed", {
        scan_id: scanId,
        error: error?.message ?? "scan_not_found",
      });
      return false;
    }
    if (!ACTIVE_COPYRIGHT_SCAN_STATUSES.includes(data.status as typeof ACTIVE_COPYRIGHT_SCAN_STATUSES[number])) {
      return false;
    }
    const nextStats = {
      ...plainStats(data.stats),
      ...patch,
      last_progress_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await supabase
      .from("copyright_scans")
      .update({ stats: nextStats as never })
      .eq("id", scanId)
      .in("status", [...ACTIVE_COPYRIGHT_SCAN_STATUSES])
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      console.error("copyright_scan_diagnostic_write_failed", {
        scan_id: scanId,
        error: updateError?.message ?? "scan_not_active",
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("copyright_scan_diagnostic_write_exception", {
      scan_id: scanId,
      error: errorMessage(error),
    });
    return false;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectCopyrightScanTerminalState(
  supabase: ContextSupabase,
  scanId: string,
  intendedStatus: CopyrightTerminalStatus,
): Promise<void> {
  const { data, error } = await supabase
    .from("copyright_scans")
    .select("id,status")
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(`terminal_state_conflict: copyright scan ${scanId} is missing.`);
  }
  if (data.status === intendedStatus) return;
  throw new Error(
    `terminal_state_conflict: copyright scan ${scanId} is ${data.status}, not ${intendedStatus}.`,
  );
}

async function updateTerminalScanRow(
  supabase: ContextSupabase,
  scanId: string,
  update: {
    status: CopyrightTerminalStatus;
    sha256?: string | null;
    error?: string | null;
    stats?: unknown;
  },
): Promise<void> {
  const { data, error } = await supabase
    .from("copyright_scans")
    .update({
      status: update.status,
      sha256: update.sha256 ?? null,
      error: update.error ?? null,
      stats: update.stats as never,
    })
    .eq("id", scanId)
    .in("status", [...ACTIVE_COPYRIGHT_SCAN_STATUSES])
    .select("id,status")
    .maybeSingle();
  if (error) throw error;
  if (data?.id === scanId) return;
  await inspectCopyrightScanTerminalState(supabase, scanId, update.status);
}

export async function writeCopyrightTerminalStatus(
  supabase: ContextSupabase,
  scanId: string,
  update: {
    status: CopyrightTerminalStatus;
    sha256?: string | null;
    error?: string | null;
    stats?: unknown;
  },
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= TERMINAL_STATUS_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await updateTerminalScanRow(supabase, scanId, update);
      return;
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      console.error("copyright_scan_terminal_update_failed", {
        scan_id: scanId,
        intended_status: update.status,
        attempt: attempt + 1,
        error: message,
      });
      if (message.startsWith("terminal_state_conflict:")) throw error;
      const delay = TERMINAL_STATUS_RETRY_DELAYS_MS[attempt];
      if (delay == null) break;
      await sleep(delay);
    }
  }

  if (update.status !== "failed") {
    try {
      await updateTerminalScanRow(supabase, scanId, {
        status: "failed",
        error: `Terminal update failed while writing ${update.status}: ${errorMessage(lastError)}`.slice(0, 500),
        stats: update.stats,
      });
      return;
    } catch (fallbackError) {
      console.error("copyright_scan_terminal_fallback_failed", {
        scan_id: scanId,
        intended_status: update.status,
        error: errorMessage(fallbackError),
      });
      throw fallbackError;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

async function dispatchCopyrightScanExecutionInline(
  scanId: string,
  requestSupabase?: ContextSupabase,
): Promise<void> {
  const executorSupabase = requestSupabase ?? (
    await import("@/integrations/supabase/client.server")
  ).supabaseAdmin;

  // A detached promise is cancelled when a serverless request finishes. Await
  // the fallback so the executor actually claims the queued scan before this
  // request can be torn down. Prefer the authenticated request client so this
  // recovery path does not depend on an admin runtime credential.
  const result = await executeCopyrightScanById({
    supabase: executorSupabase,
    scanId,
    source: "worker",
  });
  if (result.status === "failed") {
    console.error("copyright_scan_inline_executor_failed", {
      scan_id: scanId,
      error: result.stats.failure_reason ?? "Inline executor failed",
    });
  }
}

async function dispatchCopyrightScanExecution(
  scanId: string,
  supabase?: ContextSupabase,
): Promise<void> {
  const diagnostic = copyrightScanWorkerDispatchDiagnostic();
  const workerUrl = resolveCopyrightScanWorkerUrl();
  const dispatchStartedAt = new Date().toISOString();
  const baseDiagnosticStats = {
    worker_dispatch_started_at: dispatchStartedAt,
    worker_dispatch_url_configured: diagnostic.worker_url_configured,
    worker_dispatch_url_source: diagnostic.worker_url_source,
    worker_dispatch_url_origin: diagnostic.worker_url_origin,
    worker_dispatch_url_path: diagnostic.worker_url_path,
    worker_dispatch_secret_present: diagnostic.worker_secret_present,
    worker_dispatch_secret_length: diagnostic.worker_secret_length,
    worker_dispatch_watchdog_ms: EXECUTOR_START_WATCHDOG_MS,
  };
  console.info("copyright_scan_worker_dispatch_request", {
    scan_id: scanId,
    ...baseDiagnosticStats,
  });
  if (supabase) {
    await recordCopyrightScanDiagnostic(supabase, scanId, baseDiagnosticStats);
  }

  if (!workerUrl) {
    console.error("copyright_scan_worker_dispatch_missing_url", {
      scan_id: scanId,
      worker_dispatch_url_source: diagnostic.worker_url_source,
    });
    if (supabase) {
      await recordCopyrightScanDiagnostic(supabase, scanId, {
        ...baseDiagnosticStats,
        worker_dispatch_last_error: "worker_url_missing",
        worker_dispatch_fallback: "inline",
      });
    }
    await dispatchCopyrightScanExecutionInline(scanId, supabase);
    return;
  }

  if (!isCopyrightScanWorkerSecretConfigured()) {
    // Development / single-node fallback when the signed hook secret is not set.
    console.error("copyright_scan_worker_dispatch_missing_secret", {
      scan_id: scanId,
      worker_dispatch_url_origin: diagnostic.worker_url_origin,
      worker_dispatch_url_path: diagnostic.worker_url_path,
    });
    if (supabase) {
      await recordCopyrightScanDiagnostic(supabase, scanId, {
        ...baseDiagnosticStats,
        worker_dispatch_last_error: "worker_secret_missing",
        worker_dispatch_fallback: "inline",
      });
    }
    await dispatchCopyrightScanExecutionInline(scanId, supabase);
    return;
  }

  const body = JSON.stringify({ scan_id: scanId });
  const { signCopyrightScanWorkerRequest } = await import("@/lib/copyright/worker-auth.server");
  const { signature, timestamp } = signCopyrightScanWorkerRequest(body);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const attemptNumber = attempt + 1;
    console.info("copyright_scan_worker_dispatch_attempt", {
      scan_id: scanId,
      attempt: attemptNumber,
      worker_dispatch_url_origin: diagnostic.worker_url_origin,
      worker_dispatch_url_path: diagnostic.worker_url_path,
    });
    if (supabase) {
      await recordCopyrightScanDiagnostic(supabase, scanId, {
        ...baseDiagnosticStats,
        worker_dispatch_attempts: attemptNumber,
        worker_dispatch_last_attempt_at: new Date().toISOString(),
      });
    }
    try {
      const response = await fetchWithTimeout(
        workerUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-eterna-timestamp": timestamp,
            "x-eterna-signature": signature,
          },
          body,
        },
        10_000,
      );
      console.info("copyright_scan_worker_dispatch_response", {
        scan_id: scanId,
        attempt: attemptNumber,
        status: response.status,
      });
      if (response.ok) return;
      const text = await response.text().catch(() => "");
      lastError = new Error(`Worker dispatch failed (${response.status}): ${text.slice(0, 200)}`);
      if (supabase) {
        await recordCopyrightScanDiagnostic(supabase, scanId, {
          ...baseDiagnosticStats,
          worker_dispatch_attempts: attemptNumber,
          worker_dispatch_last_status: response.status,
          worker_dispatch_last_error: `http_${response.status}`,
        });
      }
    } catch (error) {
      lastError = error;
      console.error("copyright_scan_worker_dispatch_attempt_failed", {
        scan_id: scanId,
        attempt: attemptNumber,
        error: errorMessage(error),
      });
      if (supabase) {
        await recordCopyrightScanDiagnostic(supabase, scanId, {
          ...baseDiagnosticStats,
          worker_dispatch_attempts: attemptNumber,
          worker_dispatch_last_error: errorMessage(error).slice(0, 500),
        });
      }
    }
    await sleep(300 * (attempt + 1));
  }

  // Remote hook unreachable (misconfigured URL, env gap, cold start). Run the
  // executor in-process so the scan still completes instead of failing hard.
  console.error("copyright_scan_worker_dispatch_fallback_inline", {
    scan_id: scanId,
    error: errorMessage(lastError),
  });
  if (supabase) {
    await recordCopyrightScanDiagnostic(supabase, scanId, {
      ...baseDiagnosticStats,
      worker_dispatch_last_error: errorMessage(lastError).slice(0, 500),
      worker_dispatch_fallback: "inline",
      worker_dispatch_fallback_at: new Date().toISOString(),
    });
  }
  await dispatchCopyrightScanExecutionInline(scanId, supabase);
}


/** Presigned upload slot for a reference image or an extracted video frame. */
export const prepareCopyrightUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(copyrightImageTypes),
    size: z.number().int().positive().max(12 * 1024 * 1024),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

/** Same-origin fallback upload used by the Copyright scanner to avoid fragile browser-to-S3 PUT failures. */
export const uploadCopyrightReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(copyrightImageTypes),
    base64: z.string().min(1).max(20 * 1024 * 1024),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const bytes = Buffer.from(data.base64, "base64");
    if (!bytes.length) throw new Error("Reference file is empty.");
    if (bytes.length > 12 * 1024 * 1024) throw new Error("Reference file exceeds the 12 MB limit.");
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    await putObject({
      key,
      body: bytes,
      contentType: data.contentType,
      metadata: {
        user_id: context.userId,
        source: "copyright_intel",
      },
    });
    return { key };
  });

const copyrightScanInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  referenceKind: z.enum(["image", "video"]),
  contentType: z.enum(copyrightImageTypes),
  /** Frame keys: one for a still, several sampled frames for a video. */
  keys: z.array(z.string().min(10).max(500)).min(1).max(6),
  /** Optional known public URLs to investigate first (max 10). Never auto-guilty. */
  knownUrls: z.array(z.string().trim().min(8).max(2000)).max(10).optional(),
});

/**
 * Start a copyright scan: create the row and return the scan ID immediately.
 * Does NOT run discovery inline. The backend dispatches the worker after the
 * queued scan row is created, so the browser is only responsible for polling.
 */
export const runCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => copyrightScanInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `clients/${userId}/copyright/`;
    if (data.keys.some((k) => !k.startsWith(prefix))) throw new Error("Invalid reference storage path.");

    const nowIso = new Date().toISOString();
    const { data: scan, error: sErr } = await supabase.from("copyright_scans").insert({
      user_id: userId,
      title: data.title,
      reference_kind: data.referenceKind,
      storage_path: data.keys[0],
      frame_paths: data.keys,
      status: "queued",
      stats: {
        scan_created: nowIso,
        scan_created_at: nowIso,
        last_progress_at: nowIso,
        executor_started_at: null,
        discovery_never_started: true,
        pending_input: {
          contentType: data.contentType,
          knownUrls: data.knownUrls ?? [],
          keys: data.keys,
        },
      },
    }).select("id").single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Could not start scan.");

    try {
      await dispatchCopyrightScanExecution(scan.id as string, supabase);
    } catch (error) {
      const message = `Copyright scan worker dispatch failed: ${errorMessage(error)}`;
      const failedStats = {
        scan_created: nowIso,
        scan_created_at: nowIso,
        last_progress_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        discovery_never_started: true,
        failure_reason: message.slice(0, 500),
        pending_input: {
          contentType: data.contentType,
          knownUrls: data.knownUrls ?? [],
          keys: data.keys,
        },
      };
      await writeCopyrightTerminalStatus(supabase, scan.id as string, {
        status: "failed",
        error: message.slice(0, 500),
        stats: failedStats,
      });
      throw new Error(message);
    }

    // Immediate start — must not imply completion or zero-result success.
    return {
      scanId: scan.id as string,
      started: true as const,
      status: "queued" as const,
    };
  });

/**
 * Long-running copyright discovery + exact-page evidence pipeline.
 * Must be invoked separately after runCopyrightScan returns a scanId.
 */
export const executeCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    return executeCopyrightScanById({
      supabase: context.supabase,
      scanId: data.scanId,
      userId: context.userId,
      source: "user",
    });
  });

export async function executeCopyrightScanById(opts: {
  supabase: ContextSupabase;
  scanId: string;
  userId?: string;
  source?: "worker" | "user";
}): Promise<{
  scanId: string;
  status: string;
  stats: ReturnType<typeof serializeCopyrightStats>;
}> {
    const { supabase } = opts;

    console.info("copyright_scan_executor_start", {
      scan_id: opts.scanId,
      source: opts.source ?? "user",
      user_scoped: Boolean(opts.userId),
    });

    let claim = supabase
      .from("copyright_scans")
      .update({ status: "running" })
      .eq("id", opts.scanId)
      .eq("status", "queued")
      .select("*");
    if (opts.userId) claim = claim.eq("user_id", opts.userId);

    const { data: claimedScan, error: claimErr } = await claim.maybeSingle();
    if (claimErr) {
      console.error("copyright_scan_executor_claim_failed", {
        scan_id: opts.scanId,
        source: opts.source ?? "user",
        error: claimErr.message,
      });
      throw new Error(claimErr.message);
    }

    if (!claimedScan) {
      let existingQuery = supabase
        .from("copyright_scans")
        .select("*")
        .eq("id", opts.scanId);
      if (opts.userId) existingQuery = existingQuery.eq("user_id", opts.userId);
      const { data: existing, error: existingErr } = await existingQuery.maybeSingle();
      if (existingErr) throw new Error(existingErr.message);
      if (!existing) throw new Error("Scan not found.");
      console.info("copyright_scan_executor_claim_not_queued", {
        scan_id: opts.scanId,
        source: opts.source ?? "user",
        current_status: existing.status,
      });
      return {
        scanId: existing.id as string,
        status: existing.status,
        stats: serializeCopyrightStats(existing.stats),
      };
    }

    const scan = claimedScan;
    console.info("copyright_scan_executor_claimed", {
      scan_id: scan.id,
      source: opts.source ?? "user",
    });
    const userId = scan.user_id as string;

    const priorStats = (scan.stats ?? {}) as Record<string, unknown>;
    const pending = (priorStats.pending_input ?? {}) as {
      contentType?: string;
      knownUrls?: string[];
      keys?: string[];
    };
    const keys = (
      Array.isArray(pending.keys) && pending.keys.length
        ? pending.keys
        : (scan.frame_paths as string[] | null) ?? []
    ).filter((k): k is string => typeof k === "string");
    const contentType = (
      pending.contentType && copyrightImageTypes.includes(pending.contentType as typeof copyrightImageTypes[number])
        ? pending.contentType
        : "image/jpeg"
    ) as typeof copyrightImageTypes[number];
    const knownUrls = Array.isArray(pending.knownUrls) ? pending.knownUrls : [];
    const workTitle = scan.title;

    if (!keys.length) {
      const failedStats = {
        ...priorStats,
        ...watchdogFailureStats(priorStats),
        finished_at: new Date().toISOString(),
        failure_reason: "Scan has no reference storage keys — executor cannot run discovery.",
      };
      await writeCopyrightTerminalStatus(supabase, scan.id, {
        status: "failed",
        error: "Scan has no reference storage keys.",
        stats: failedStats,
      });
      return {
        scanId: scan.id as string,
        status: "failed" as const,
        stats: serializeCopyrightStats(failedStats),
      };
    }

    let stages: Record<string, string> = markStage(
      {
        scan_created:
          typeof priorStats.scan_created === "string"
            ? priorStats.scan_created
            : typeof priorStats.scan_created_at === "string"
              ? priorStats.scan_created_at
              : scan.created_at,
      },
      "executor_started",
    );

    const activity = new ScanActivityRecorder();
    activity.restoreFromStats(priorStats);
    activity.setWorkflowStage("preparing_reference");
    let abortedByDeadline = false;
    let liveStats: Record<string, unknown> = {
      ...priorStats,
      ...stages,
      executor_started_at: stages.executor_started,
      discovery_never_started: false,
    };

    let lastActivityFlush = 0;
    let activityFlushInFlight = false;

    const pushActivity = (extra?: Record<string, unknown>, force = false) => {
      if (abortedByDeadline) return Promise.resolve();
      liveStats = activity.mergeToStats({ ...liveStats, ...stages, ...(extra ?? {}) });
      const now = Date.now();
      if (!force && (activityFlushInFlight || now - lastActivityFlush < 900)) {
        return Promise.resolve();
      }
      lastActivityFlush = now;
      activityFlushInFlight = true;
      return flushScanActivity(
        async (stats) => {
          await supabase
            .from("copyright_scans")
            .update({ stats: stats as never })
            .eq("id", scan.id)
            .eq("status", "running");
        },
        liveStats,
        activity,
        extra,
      ).finally(() => {
        activityFlushInFlight = false;
      });
    };

    await supabase
      .from("copyright_scans")
      .update({ stats: activity.mergeToStats(liveStats) as never })
      .eq("id", scan.id)
      .eq("status", "running");

    try {
      const firstBytes = await readStoredObject(keys[0]!);
      if (!firstBytes.length) throw new Error("Reference file is empty.");
      const sha256 = await sha256Hex(firstBytes);
      const referenceDataUrl = bytesToDataUrl(firstBytes, contentType);

      activity.setWorkflowStage("analyzing_visual");
      await pushActivity();

      // 1. AI-vision analysis + AWS Rekognition fingerprint of the reference material.
      const allFrames = await Promise.all(
        keys.slice(0, 4).map(async (k, i) => (i === 0 ? firstBytes : await readStoredObject(k).catch(() => new Uint8Array()))),
      );
      const [analysis, fingerprint] = await Promise.all([
        analyzeReference(referenceDataUrl, workTitle),
        buildMovieFingerprint(allFrames.filter((b) => b.length > 0), workTitle),
      ]);

      activity.setWorkflowStage("extracting_identifiers");
      await pushActivity();

      // 2a. Optional known-URL seeds (high priority) — validated before provider search.
      const knownInputs = parseKnownUrlInputs(knownUrls);
      const knownSeeds = await validateKnownUrlSeeds(knownInputs);
      const knownAccepted = acceptedKnownUrls(knownSeeds);

      // 2b. Firecrawl reverse discovery, seeded by that analysis.
      stages = markStage(stages, "queries_generated");
      stages = markStage(stages, "discovery_started");
      activity.setWorkflowStage("discovering_candidates");
      await pushActivity({ queries_generated: 0 });

      // Known URLs are investigated before any provider search.
      const titleSeedsEarly = [workTitle, analysis.title ?? "", ...analysis.altTitles].filter(Boolean);
      const titlesEarly = [
        ...new Set([
          ...titleSeedsEarly,
          ...titleSeedsEarly.flatMap((t) => expandTitleVariants(t).filter((v) => /[\s-]/.test(v))),
        ]),
      ].slice(0, 12);
      const earlyKnownInspected = new Set<string>();
      const earlyKnownInvestigations: Array<{
        url: string;
        retrieved: boolean;
        rendered: boolean;
        reason?: string | null;
      }> = [];
      let earlyKnownUrlsAttempted = 0;
      const knownPreDeadlineAt = Date.now() + KNOWN_URL_BUDGET_MS;
      for (const url of knownAccepted) {
        if (isPastDeadline(knownPreDeadlineAt)) {
          abortedByDeadline = true;
          break;
        }
        earlyKnownUrlsAttempted += 1;
        activity.recordChecking({
          url,
          pageTitle: workTitle,
          leadQuery: "known_url_seed",
        });
        const dist = await analyzeDistributionPage({
          url,
          title: workTitle,
          titles: titlesEarly,
          releaseDate: analysis.releaseDate,
          preferRender: true,
          signal: AbortSignal.timeout(Math.max(1_000, knownPreDeadlineAt - Date.now())),
        });
        activity.recordDistributionOutcome({
          url: dist.url,
          pageTitle: dist.pageTitle ?? workTitle,
          leadQuery: "known_url_seed",
          crawlFailed: dist.crawlFailed,
          classification: dist.classification,
          clientVisible: dist.clientVisible,
          strongEvidence: dist.strongEvidence,
          identityEvidence: dist.identityEvidence,
          rendered: dist.rendered,
        });
        earlyKnownInspected.add(canonicalUrl(dist.url));
        earlyKnownInvestigations.push({
          url: dist.url,
          retrieved: !dist.crawlFailed,
          rendered: dist.rendered,
          reason: dist.crawlFailureReason ?? dist.reason ?? null,
        });
        await pushActivity({
          known_urls_attempted: earlyKnownUrlsAttempted,
          pages_crawled: earlyKnownUrlsAttempted,
        });
      }

      const discoveryDeadlineAt = Date.now() + PROVIDER_CRAWL_BUDGET_MS;
      const discoverySignal = AbortSignal.timeout(
        Math.max(5_000, discoveryDeadlineAt - Date.now()),
      );

      const byUrl = new Map<string, DiscoveryCandidate>();

      // Firecrawl v2 is the sole copyright discovery and rendered-page provider.
      // Keeping neutral legacy telemetry preserves older report compatibility.
      await pushActivity({
        brightdata_configured: false,
        brightdata_diagnostic: brightDataDiagnostic(),
        brightdata_running: false,
        brightdata_last_status: "disabled",
      });

      let discovery = await firecrawlDiscover(referenceDataUrl, workTitle, 0, analysis, {
        signal: discoverySignal,
        deadlineAt: discoveryDeadlineAt,
        analysis,
      });
      const brightDataDiscovery = emptyBrightDataDiscovery();

      await pushActivity({
        brightdata_running: false,
        brightdata_configured: brightDataDiscovery.configured,
        brightdata_diagnostic: brightDataDiscovery.diagnostic,
        brightdata_duration_ms: 0,

        brightdata_queries_generated: brightDataDiscovery.queriesGenerated,
        brightdata_requests: brightDataDiscovery.requests,
        brightdata_successes: brightDataDiscovery.successes,
        brightdata_failures: brightDataDiscovery.failures,
        brightdata_candidates: brightDataDiscovery.candidates,
        brightdata_duplicates_dropped: brightDataDiscovery.duplicatesDropped,
        brightdata_failures_by_category: brightDataDiscovery.failuresByCategory,
        brightdata_failure_samples: brightDataDiscovery.failureSamples.slice(0, 6),

        brightdata_last_status: "disabled",
      });

      const serpapiDiscovery = {
        pageLeads: [],
        requests: 0,
        successes: 0,
        failures: 0,
        candidates: 0,
        failureMessages: [],
        configured: false,
      };

      // Normalize + dedupe candidate URLs across providers.
      const extraLeads = [...brightDataDiscovery.pageLeads, ...serpapiDiscovery.pageLeads];
      if (extraLeads.length) {
        const mergedLeads = [...discovery.pageLeads];
        const seenLeadUrls = new Set(mergedLeads.map((l) => canonicalUrl(l.url)));
        for (const lead of extraLeads) {
          const key = canonicalUrl(lead.url);
          if (seenLeadUrls.has(key)) continue;
          seenLeadUrls.add(key);
          mergedLeads.push({ ...lead, url: key });
        }
        discovery = {
          ...discovery,
          pageLeads: mergedLeads,
          providerFailuresByCategory: mergeProviderFailureCounts(
            discovery.providerFailuresByCategory,
            brightDataDiscovery.failuresByCategory,
          ),
          providerFailureSamples: [
            ...discovery.providerFailureSamples,
            ...brightDataDiscovery.failureSamples,
          ].slice(0, 12),
          candidates_by_provider: {
            ...discovery.candidates_by_provider,
            brightdata: brightDataDiscovery.candidates,
            serpapi: serpapiDiscovery.candidates,
          },
        };
      }

      stages = markStage(stages, "first_provider_response");

      for (const c of discovery.candidates) {
        if (!byUrl.has(c.url)) byUrl.set(c.url, c);
      }

      for (const lead of discovery.pageLeads.slice(0, 20)) {
        activity.recordDiscovered({
          url: lead.url,
          pageTitle: lead.title,
          leadQuery: lead.query,
        });
      }
      for (const lead of brightDataDiscovery.pageLeads.slice(0, 20)) {
        activity.recordDiscovered({
          url: lead.url,
          pageTitle: lead.title,
          leadQuery: `brightdata:${lead.query ?? "discovery"}`,
        });
      }
      for (const lead of serpapiDiscovery.pageLeads.slice(0, 20)) {
        activity.recordDiscovered({
          url: lead.url,
          pageTitle: lead.title,
          leadQuery: lead.query ?? "serpapi:fallback",
        });
      }
      activity.setWorkflowStage("retrieving_pages");
      await pushActivity({
        queries_executed: discovery.queriesExecuted,
        provider_results: byUrl.size + discovery.pageLeads.length,
        unique_candidate_pages: new Set([
          ...byUrl.keys(),
          ...discovery.pageLeads.map((l) => canonicalUrl(l.url)),
        ]).size,
        provider_failures: discovery.providerFailures,
        firecrawl_circuit_opened: discovery.firecrawl_circuit_opened,
        provider_failures_by_category: discovery.providerFailuresByCategory,
      });

      // Prioritise high-signal piracy leads, keep the grading budget bounded.
      const ordered = [...byUrl.values()]
        .filter((c) => c.thumbnail || c.imageUrl)
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, 40);

      // 3. Evidence grading with a multimodal comparison.
      // Image/OCR path produces identity-only internal leads — never actionable piracy.
      const fallbackRows: MatchInsert[] = [];
      let ignored = 0;

      const buildRow = (
        candidate: DiscoveryCandidate,
        confidence: number,
        detectionType: string,
        transformations: string[],
        ocrText: string | null,
        watermark: string | null,
        reason: string,
        rek: FingerprintMatch = EMPTY_MATCH,
      ): MatchInsert => {
        const contact = resolveAbuseContact(candidate.url);
        return {
          scan_id: scan.id,
          user_id: userId,
          source_url: canonicalUrl(candidate.url),
          platform: contact.platform,
          page_title: candidate.title,
          thumbnail_url: candidate.thumbnail ?? candidate.imageUrl,
          confidence,
          confidence_band: bandFor(confidence),
          detection_type: detectionType,
          transformations,
          evidence: {
            reference_frame_index: candidate.frameIndex,
            reference_frame_path: keys[candidate.frameIndex] ?? keys[0],
            candidate_image_url: candidate.imageUrl ?? candidate.thumbnail,
            discovery: candidate.exact ? "piracy_lead" : "visual_match",
            discovery_query: candidate.query ?? null,
            keyword_match: candidate.keywordMatch ?? candidate.query ?? null,
            piracy_category: candidate.category ?? null,
            website_type: candidate.websiteType ?? null,
            detected_language: candidate.language ?? analysis.language ?? null,
            reference_ocr_text: analysis.ocrText,
            reference_watermark: analysis.watermark,
            reference_media_type: analysis.mediaType,
            reference_language: analysis.language,
            reference_alt_titles: analysis.altTitles,
            reference_release_date: analysis.releaseDate,
            reference_actors: analysis.actors,
            reference_region: analysis.region,
            watermark,
            host: hostOf(candidate.url),
            // AWS Rekognition recognition details
            recognition: {
              provider: fingerprint.available ? "aws_rekognition" : "unavailable",
              face_similarity: rek.faceSimilarity,
              actor_matches: rek.celebrityMatches,
              scene_similarity: rek.sceneOverlap,
              matched_scene_labels: rek.matchedLabels,
              ocr_title_match: rek.ocrTitleMatch,
              matched_ocr_text: rek.matchedOcrText,
              watermark_match: rek.watermarkMatch,
              signals: rek.signals,
              signal_count: rek.signals.length,
              corroboration_score: rek.score,
            },
            reference_fingerprint: {
              scene_labels: fingerprint.labels,
              scene_categories: fingerprint.sceneCategories,
              recognized_actors: fingerprint.celebrities,
              face_count: fingerprint.faceCount,
              ocr_lines: fingerprint.ocrLines.slice(0, 20),
              watermark_hints: fingerprint.watermarkHints,
            },
          },
          ocr_text: ocrText,
          reason,
          contact: contact as unknown as MatchInsert["contact"],
        };
      };

      for (let offset = 0; offset < ordered.length; offset += 4) {
        const batch = ordered.slice(offset, offset + 4);
        const graded = await Promise.all(batch.map(async (candidate) => {
          const img = candidate.imageUrl ?? candidate.thumbnail!;

          // AWS Rekognition corroboration on the candidate image (best effort).
          let rek: FingerprintMatch = EMPTY_MATCH;
          if (fingerprint.available) {
            const fetched = await fetchImageBytes(img).catch(() => null);
            if (fetched?.bytes?.length) {
              rek = await matchCandidateAgainstFingerprint(fingerprint, fetched.bytes, workTitle);
            }
          }

          const result = await gradeCandidate({
            referenceDataUrl,
            candidateImageUrl: img,
            candidatePageUrl: candidate.url,
            candidateTitle: candidate.title,
            platform: candidate.source,
            workTitle: workTitle,
            highSignal: candidate.exact || rek.signals.length >= 2,
            referenceOcrText: analysis.ocrText,
            referenceWatermark: analysis.watermark,
          });
          return { candidate, result, rek };
        }));


        for (const { candidate, result, rek } of graded) {
          const blended = blendConfidence(result ? result.confidence : null, rek);
          const rekStrong = rek.signals.length >= 2;
          // Identity match only — poster/OCR/actors never prove illegal distribution.
          const identityMatch = result
            ? (!result.falsePositive || rek.signals.length >= 3) &&
              (result.detectionType !== "unrelated" && result.detectionType !== "UNRELATED") &&
              blended >= 50
            : rekStrong && blended >= 50;

          const rekReason = rek.signals.length
            ? ` AWS recognition: ${rek.signals.join("; ")}.`
            : "";

          const purpose = detectPrimaryPurpose({
            url: candidate.url,
            pageTitle: candidate.title,
            text: `${candidate.title ?? ""} ${candidate.category ?? ""} ${candidate.query ?? ""}`,
            host: hostOf(candidate.url),
          });

          // Image/OCR path can only produce non-actionable identity leads.
          // Actionable piracy requires exact-page distribution evidence (below).
          let identityType = "DUPLICATE_ARTWORK_ONLY";
          if (purpose === "cinema_or_showtime" || candidate.category === "cinema_or_showtime") {
            identityType = "CINEMA_OR_SHOWTIME";
          } else if (purpose === "trailer_or_promo" || result?.detectionType === "trailer_copy") {
            identityType = "TRAILER_OR_PROMO";
          } else if (purpose === "review_or_news") {
            identityType = "REVIEW_OR_NEWS";
          } else if (purpose === "cast_or_information") {
            identityType = "CAST_OR_INFORMATION";
          } else if (purpose === "social_discussion" || candidate.category === "forum_post") {
            identityType = "SOCIAL_DISCUSSION";
          } else if (purpose === "official_or_authorized") {
            identityType = "OFFICIAL_OR_AUTHORIZED";
          } else if (
            result?.detectionType &&
            !isActionablePiracy(result.detectionType) &&
            result.detectionType !== "unrelated" &&
            result.detectionType !== "ripped_copy" &&
            result.detectionType !== "video_clip" &&
            result.detectionType !== "cam_recording"
          ) {
            identityType = normalizeClassification(result.detectionType);
          }

          if (identityMatch) {
            const row = buildRow(
              candidate,
              Math.min(blended, 49),
              identityType,
              [...(result?.transformations ?? []), ...(rek.watermarkMatch ? ["watermark_match"] : [])],
              result?.ocrText ?? (rek.matchedOcrText.join(" | ") || null),
              result?.watermark ?? rek.watermarkMatch,
              `${result?.reason ?? "Identity/artwork match."}${rekReason} Artwork, OCR, or actor similarity proves relevance only — not unauthorized distribution.`,
              rek,
            );
            row.evidence = {
              ...(row.evidence as Record<string, unknown>),
              client_visible: false,
              identity_only: true,
              classification: identityType,
            };
            // Persist non-actionable identity leads internally; never as piracy.
            fallbackRows.push(row);
            continue;
          }

          ignored++;
          if ((candidate.exact || rek.signals.length >= 1) && !(result?.falsePositive && blended < 20)) {
            const leadRow = buildRow(
              candidate,
              Math.max(20, Math.min(40, blended || 25)),
              "UNVERIFIED_LEAD",
              result?.transformations ?? [],
              result?.ocrText ?? null,
              result?.watermark ?? rek.watermarkMatch,
              (result?.reason ||
                `Unverified discovery lead (${candidate.category ?? "web_lead"}) from "${candidate.keywordMatch ?? candidate.query ?? workTitle}" — requires exact-page distribution evidence.`) + rekReason,
              rek,
            );
            leadRow.evidence = {
              ...(leadRow.evidence as Record<string, unknown>),
              client_visible: false,
              classification: "UNVERIFIED_LEAD",
            };
            fallbackRows.push(leadRow);
          }
        }
      }

      // 4. Unauthorized-distribution site inspection. Exact-page crawl required.
      //    Identity (title/poster/OCR) alone never qualifies. Fail closed on crawl failure.
      const titleSeeds = [workTitle, analysis.title ?? "", ...analysis.altTitles].filter(Boolean);
      const titles = [...new Set([
        ...titleSeeds,
        ...titleSeeds.flatMap((t) => expandTitleVariants(t).filter((v) => /[\s-]/.test(v))),
      ])].slice(0, 12);
      const releaseDate = analysis.releaseDate;
      // Known URLs first so they receive crawl budget before provider candidates.
      const knownLeadUrls = knownAccepted.map((url) => ({
        url,
        title: workTitle,
        query: "known_url_seed",
        text: workTitle,
        strong: true as const,
      }));
      const providerLeads = discovery.pageLeads
        .sort((a2, b2) => Number(b2.strong) - Number(a2.strong));
      const leadUrls = prioritizeKnownUrlLeads(knownLeadUrls, providerLeads, 32);
      const slotAllocation = allocateCrawlSlots(
        knownLeadUrls.length,
        providerLeads.length,
        32,
      );
      const { known: knownPhaseLeads, provider: providerPhaseLeads } =
        splitKnownAndProviderLeads(leadUrls);

      const distributionRows: MatchInsert[] = [];
      const internalRows: MatchInsert[] = [];
      const inspectedDomains = new Set<string>();
      const inspectedUrls = new Set<string>(earlyKnownInspected);
      const detailFollowQueue: string[] = [];
      type KnownUrlInvestigation = {
        url: string;
        host?: string | null;
        accepted?: boolean;
        reject_reason?: string | null;
        reject_detail?: string | null;
        classification: string;
        client_visible: boolean;
        strong_evidence?: boolean;
        crawl_failed?: boolean;
        crawl_failure_category?: CrawlFailureCategory | null;
        crawl_failure_reason?: string | null;
        retrieval_method?: string | null;
        rendered?: boolean;
        page_title?: string | null;
        identity_evidence?: string[];
        access_evidence?: string[];
        indicator_keys?: string[];
        embed_sources?: string[];
        distribution_links?: string[];
        reason?: string | null;
        registered?: boolean;
        visibility_decision?: string;
        attempted?: boolean;
        verified?: boolean;
      };
      const knownUrlInvestigations: KnownUrlInvestigation[] = [];
      const crawlFailedByCategory = emptyCrawlFailureCounts();
      let knownUrlsAttempted = 0;
      let knownUrlsRetrieved = 0;
      let knownUrlsRendered = 0;
      let knownUrlsVerified = 0;
      let knownUrlsRejectedAfterCrawl = 0;

      // Persist unsafe/rejected known URLs as internal investigation leads (fail closed).
      for (const seed of knownSeeds.filter((s) => !s.accepted)) {
        const contact = resolveAbuseContact(seed.url);
        internalRows.push({
          scan_id: scan.id,
          user_id: userId,
          source_url: canonicalUrl(seed.url),
          platform: contact.platform,
          page_title: `Known URL rejected: ${seed.rejectReason ?? "unsafe"}`,
          thumbnail_url: null,
          confidence: 0,
          confidence_band: "review",
          detection_type: "INVESTIGATION_LEAD",
          transformations: [],
          evidence: {
            discovery: "known_url_seed",
            client_visible: false,
            classification: "INVESTIGATION_LEAD",
            known_url: {
              input: seed.input,
              accepted: false,
              reject_reason: seed.rejectReason,
              reject_detail: seed.rejectDetail,
            },
          },
          ocr_text: null,
          reason:
            seed.rejectDetail ||
            `Known URL failed safety validation (${seed.rejectReason ?? "rejected"}) — fail closed, not classified as infringement.`,
          contact: contact as unknown as MatchInsert["contact"],
        });
        knownUrlInvestigations.push({
          url: seed.url,
          accepted: false,
          reject_reason: seed.rejectReason,
          reject_detail: seed.rejectDetail,
          classification: "INVESTIGATION_LEAD",
          client_visible: false,
        });
        activity.recordBlocked({
          url: seed.url,
          pageTitle: seed.rejectDetail,
          reason: seed.rejectReason,
        });
      }

      let pagesCrawled = 0;
      let pagesFailed = 0;
      let cinemaRejected = 0;
      let trailerRejected = 0;
      let reviewRejected = 0;
      let socialRejected = 0;
      let artworkRejected = 0;
      let officialRejected = 0;
      let youtubePromoRejected = 0;
      let catalogListingRejected = 0;
      let titleIdentityRejected = 0;
      let accessEvidenceRejected = 0;
      let hardNegativeRejected = 0;
      let listingPagesFound = 0;
      let accessEvidencePages = 0;
      let embeddedPlayers = 0;
      let downloadPages = 0;
      let fileHostDestinations = 0;
      let torrentsMagnets = 0;
      let theatrePrintFindings = 0;
      let detailPagesFollowed = 0;
      let registeredMonitoredSources = 0;

      const distributionSummary: Array<{
        url: string;
        domain_risk: string;
        content_type: string;
        classification: string;
        release_timing: string;
        confidence: number;
        strong_evidence: boolean;
        client_visible: boolean;
        indicators: string[];
      }> = [];

      const ingestDistribution = async (
        dist: Awaited<ReturnType<typeof analyzeDistributionPage>>,
        leadQuery: string | null,
        leadTitle: string | null,
      ) => {
        const key = canonicalUrl(dist.url);
        if (inspectedUrls.has(key)) return;
        inspectedUrls.add(key);
        inspectedDomains.add((dist.domain ?? "").toLowerCase());
        pagesCrawled += 1;

        if (dist.crawlFailed) {
          pagesFailed += 1;
          bumpCrawlFailure(crawlFailedByCategory, dist.crawlFailureCategory);
          // Network/render failures are never counted as content rejection below.
        } else {
          switch (dist.classification) {
            case "CINEMA_OR_SHOWTIME":
              cinemaRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "TRAILER_OR_PROMO":
              trailerRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "REVIEW_OR_NEWS":
            case "CAST_OR_INFORMATION":
              reviewRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "SOCIAL_DISCUSSION":
              socialRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "OFFICIAL_OR_AUTHORIZED":
            case "OFFICIAL_OR_AUTHORIZED_PAGE":
              officialRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "CATALOG_OR_LISTING":
              catalogListingRejected += 1;
              hardNegativeRejected += 1;
              break;
            case "DUPLICATE_ARTWORK_ONLY":
              artworkRejected += 1;
              break;
            default:
              break;
          }
          if (
            dist.classification === "TRAILER_OR_PROMO" &&
            isNeverMonitoredDomain(dist.url)
          ) {
            youtubePromoRejected += 1;
          }
        }

        if (dist.detailFollowUrls.length) listingPagesFound += 1;

        // Content-rejection counters only apply to successfully retrieved pages.
        if (!dist.crawlFailed && !dist.identityEvidence.length && !dist.clientVisible) {
          titleIdentityRejected += 1;
        }
        if (
          !dist.crawlFailed &&
          dist.identityEvidence.length &&
          !dist.strongEvidence &&
          !dist.clientVisible &&
          dist.classification !== "CINEMA_OR_SHOWTIME" &&
          dist.classification !== "TRAILER_OR_PROMO" &&
          dist.classification !== "REVIEW_OR_NEWS" &&
          dist.classification !== "CAST_OR_INFORMATION" &&
          dist.classification !== "SOCIAL_DISCUSSION" &&
          dist.classification !== "OFFICIAL_OR_AUTHORIZED" &&
          dist.classification !== "DUPLICATE_ARTWORK_ONLY"
        ) {
          accessEvidenceRejected += 1;
        }

        if (dist.indicatorKeys.includes("embedded_player")) embeddedPlayers += 1;
        if (dist.classification === "DOWNLOAD_PAGE") downloadPages += 1;
        if (dist.classification === "FILE_HOST_DISTRIBUTION") fileHostDestinations += 1;
        if (dist.classification === "TORRENT_OR_MAGNET") torrentsMagnets += 1;
        if (dist.classification === "THEATRE_PRINT_DISTRIBUTION") theatrePrintFindings += 1;
        if (dist.strongEvidence) accessEvidencePages += 1;

        for (const detail of dist.detailFollowUrls) {
          if (!inspectedUrls.has(canonicalUrl(detail))) detailFollowQueue.push(detail);
        }

        distributionSummary.push({
          url: dist.url,
          domain_risk: dist.domainRisk,
          content_type: dist.contentType,
          classification: dist.classification,
          release_timing: dist.releaseTiming,
          confidence: dist.confidence,
          strong_evidence: dist.strongEvidence,
          client_visible: dist.clientVisible,
          indicators: dist.indicatorKeys,
        });

        const contact = resolveAbuseContact(dist.url);
        const matchRow: MatchInsert = {
          scan_id: scan.id,
          user_id: userId,
          source_url: key,
          platform: contact.platform,
          page_title: dist.pageTitle ?? leadTitle,
          thumbnail_url: dist.screenshot,
          confidence: dist.confidence,
          confidence_band: bandFor(dist.confidence),
          detection_type: dist.classification,
          transformations: dist.qualityTags.slice(0, 8),
          evidence: {
            discovery: "distribution_site",
            discovery_query: leadQuery,
            keyword_match: leadQuery,
            host: hostOf(dist.url),
            website_type: dist.contentType,
            detected_language: analysis.language,
            reference_release_date: releaseDate,
            client_visible: dist.clientVisible,
            classification: dist.classification,
            identity_evidence: dist.identityEvidence,
            access_evidence: dist.accessEvidence,
            confidence_breakdown: dist.confidenceBreakdown,
            embed_sources: dist.embedSources,
            distribution: {
              domain: dist.domain,
              domain_risk: dist.domainRisk,
              content_type: dist.contentType,
              classification: dist.classification,
              release_timing: dist.releaseTiming,
              release_offset_days: dist.releaseOffsetDays,
              piracy_indicators: dist.indicators.map((i) => ({
                key: i.key, detail: i.detail, weight: i.weight, strong: i.strong,
              })),
              indicator_keys: dist.indicatorKeys,
              distribution_links: dist.distributionLinks,
              quality_tags: dist.qualityTags,
              strong_evidence: dist.strongEvidence,
              client_visible: dist.clientVisible,
              identity_evidence: dist.identityEvidence,
              access_evidence: dist.accessEvidence,
              confidence_breakdown: dist.confidenceBreakdown,
              evidence_screenshot: dist.screenshot,
              embed_sources: dist.embedSources,
            },
          },
          ocr_text: null,
          reason: dist.reason,
          contact: contact as unknown as MatchInsert["contact"],
        };

        if (leadQuery === "known_url_seed") {
          knownUrlsAttempted += 1;
          if (!dist.crawlFailed) knownUrlsRetrieved += 1;
          if (dist.rendered) knownUrlsRendered += 1;
          if (dist.clientVisible && dist.strongEvidence) knownUrlsVerified += 1;
          else if (!dist.crawlFailed) knownUrlsRejectedAfterCrawl += 1;
          knownUrlInvestigations.push({
            url: dist.url,
            host: dist.domain,
            accepted: true,
            attempted: true,
            classification: dist.classification,
            client_visible: dist.clientVisible,
            strong_evidence: dist.strongEvidence,
            crawl_failed: dist.crawlFailed,
            crawl_failure_category: dist.crawlFailureCategory,
            crawl_failure_reason: dist.crawlFailureReason,
            retrieval_method: dist.retrievalMethod,
            rendered: dist.rendered,
            verified: Boolean(dist.clientVisible && dist.strongEvidence),
            page_title: dist.pageTitle,
            identity_evidence: dist.identityEvidence,
            access_evidence: dist.accessEvidence,
            indicator_keys: dist.indicatorKeys,
            embed_sources: dist.embedSources,
            distribution_links: dist.distributionLinks,
            reason: dist.reason,
            registered: false,
            visibility_decision: dist.clientVisible
              ? "client_visible_actionable"
              : dist.crawlFailed
                ? `fail_closed_crawl:${dist.crawlFailureCategory ?? "unknown"}`
                : "internal_or_non_actionable",
          });
        }

        if (
          dist.clientVisible &&
          dist.strongEvidence &&
          isActionablePiracy(dist.classification) &&
          shouldRegisterMonitoredSource(dist)
        ) {
          const registered = await registerDistributionSource(supabase, {
            userId,
            scanId: scan.id,
            workTitle: workTitle,
            platform: contact.platform,
            analysis: dist,
          }).catch(() => null);
          if (registered) {
            registeredMonitoredSources += 1;
            if (leadQuery === "known_url_seed") {
              const last = knownUrlInvestigations[knownUrlInvestigations.length - 1];
              if (last) last.registered = true;
            }
          }
          distributionRows.push(matchRow);
        } else if (
          dist.clientVisible &&
          dist.strongEvidence &&
          isActionablePiracy(dist.classification)
        ) {
          // Actionable finding for UI but not eligible for domain monitoring
          // (e.g. never-monitor hosts) — still show as client-visible match.
          distributionRows.push(matchRow);
        } else {
          // Retain every inspected source as an internal diagnostics lead so the
          // operator-facing "all sources" list is complete (including UNRELATED).
          matchRow.evidence = {
            ...(matchRow.evidence as Record<string, unknown>),
            client_visible: false,
          };
          internalRows.push(matchRow);
        }

        activity.recordDistributionOutcome({
          url: dist.url,
          pageTitle: dist.pageTitle ?? leadTitle,
          leadQuery,
          crawlFailed: dist.crawlFailed,
          classification: dist.classification,
          clientVisible: dist.clientVisible,
          strongEvidence: dist.strongEvidence,
          identityEvidence: dist.identityEvidence,
          rendered: dist.rendered,
        });
      };

      // Phase A — known URLs first with reserved time budget (never starved by providers).
      activity.setWorkflowStage("checking_access");
      const knownDeadlineAt = Date.now() + KNOWN_URL_BUDGET_MS;
      for (let offset = 0; offset < knownPhaseLeads.length; offset += 2) {
        if (isPastDeadline(knownDeadlineAt)) {
          abortedByDeadline = true;
          for (const lead of knownPhaseLeads.slice(offset)) {
            const key = canonicalUrl(lead.url);
            if (inspectedUrls.has(key)) continue;
            inspectedUrls.add(key);
            knownUrlsAttempted += 1;
            bumpCrawlFailure(crawlFailedByCategory, "aborted_by_deadline");
            pagesCrawled += 1;
            pagesFailed += 1;
            knownUrlInvestigations.push({
              url: lead.url,
              host: hostOf(lead.url),
              accepted: true,
              attempted: true,
              classification: "UNVERIFIED_LEAD",
              client_visible: false,
              crawl_failed: true,
              crawl_failure_category: "aborted_by_deadline",
              crawl_failure_reason: "Known-URL reserved budget exhausted before attempt completed",
              visibility_decision: "fail_closed_crawl:aborted_by_deadline",
            });
          }
          break;
        }
        const batch = knownPhaseLeads.slice(offset, offset + 2);
        const signal = AbortSignal.timeout(
          Math.max(1_000, knownDeadlineAt - Date.now()),
        );
        const analyses = await Promise.all(
          batch.map(async (lead) => {
            const key = canonicalUrl(lead.url);
            if (!inspectedUrls.has(key)) {
              activity.recordChecking({
                url: lead.url,
                pageTitle: lead.title,
                leadQuery: lead.query,
              });
            }
            return {
              lead,
              analysis: await analyzeDistributionPage({
                url: lead.url,
                title: lead.title,
                titles,
                releaseDate,
                signal,
                preferRender: true,
              }),
            };
          }),
        );
        for (const { lead, analysis: dist } of analyses) {
          await ingestDistribution(dist, lead.query, lead.title);
        }
        await pushActivity({ pages_crawled: pagesCrawled, pages_failed: pagesFailed });
      }

      // Phase B — provider candidates with remaining budget / reserved leftover slots.
      const providerDeadlineAt = Date.now() + PROVIDER_CRAWL_BUDGET_MS;
      for (let offset = 0; offset < providerPhaseLeads.length; offset += 4) {
        if (isPastDeadline(providerDeadlineAt)) {
          abortedByDeadline = true;
          for (const lead of providerPhaseLeads.slice(offset)) {
            const key = canonicalUrl(lead.url);
            if (inspectedUrls.has(key)) continue;
            inspectedUrls.add(key);
            bumpCrawlFailure(crawlFailedByCategory, "aborted_by_deadline");
            pagesCrawled += 1;
            pagesFailed += 1;
          }
          break;
        }
        const batch = providerPhaseLeads.slice(offset, offset + 4);
        const signal = AbortSignal.timeout(
          Math.max(1_000, providerDeadlineAt - Date.now()),
        );
        const analyses = await Promise.all(
          batch.map(async (lead) => {
            const key = canonicalUrl(lead.url);
            if (!inspectedUrls.has(key)) {
              activity.recordChecking({
                url: lead.url,
                pageTitle: lead.title,
                leadQuery: lead.query,
              });
            }
            return {
              lead,
              analysis: await analyzeDistributionPage({
                url: lead.url,
                title: lead.title,
                titles,
                releaseDate,
                signal,
              }),
            };
          }),
        );
        for (const { lead, analysis: dist } of analyses) {
          await ingestDistribution(dist, lead.query, lead.title);
        }
        await pushActivity({ pages_crawled: pagesCrawled, pages_failed: pagesFailed });
      }

      if (pagesCrawled > 0) stages = markStage(stages, "first_page_crawled");
      stages = markStage(stages, "classification_started");
      activity.setWorkflowStage("classifying_evidence");
      await pushActivity({}, true);

      // Bounded same-domain detail follow from listing pages.
      const details = detailFollowQueue.slice(0, 12);
      for (let offset = 0; offset < details.length; offset += 4) {
        if (isPastDeadline(providerDeadlineAt)) {
          abortedByDeadline = true;
          break;
        }
        const batch = details.slice(offset, offset + 4);
        const signal = AbortSignal.timeout(
          Math.max(1_000, providerDeadlineAt - Date.now()),
        );
        const analyses = await Promise.all(
          batch.map(async (url) => {
            activity.recordChecking({
              url,
              leadQuery: "detail_follow",
              stage: "detail_follow",
            });
            return analyzeDistributionPage({
              url,
              titles,
              releaseDate,
              skipDetailFollow: true,
              signal,
            });
          }),
        );
        for (const dist of analyses) {
          detailPagesFollowed += 1;
          await ingestDistribution(dist, "detail_follow", dist.pageTitle);
        }
        await pushActivity({
          detail_pages_followed: detailPagesFollowed,
          pages_crawled: pagesCrawled,
        });
      }

      activity.setWorkflowStage("saving_report");

      // 5. Auto Monitor pass: re-check already-known distribution sources that
      //    were not crawled by this scan, so every movie scan covers the full
      //    registered source list without duplicating crawls.
      const monitorPass = await runAutoMonitor(supabase, {
        userId,
        limit: 8,
        force: true,
        runType: "scan",
        excludeDomains: [...inspectedDomains].filter(Boolean),
      }).catch(() => ({ checked: 0, incidents: 0 }));

      // Persist actionable findings + a bounded set of internal non-piracy leads.
      // Internal leads never use ripped_copy and are marked client_visible: false.
      // Keep client_visible:false rows even when taxonomy is "actionable" (e.g.
      // YouTube VIDEO_HOST_REUPLOAD internal investigation leads).
      const seenUrls = new Set(distributionRows.map((r) => r.source_url));
      const isInternalLeadRow = (r: MatchInsert) => {
        const ev = (r.evidence ?? {}) as Record<string, unknown>;
        if (ev.client_visible === false) return true;
        return !isActionablePiracy(r.detection_type);
      };
      const internalPersist = dedupeCopyrightMatchRows(
        [...internalRows, ...fallbackRows].filter(
          (r) => !seenUrls.has(r.source_url) && isInternalLeadRow(r),
        ),
      ).slice(0, 80) as MatchInsert[];
      const allRows = dedupeCopyrightMatchRows([
        ...distributionRows,
        ...internalPersist,
      ]) as MatchInsert[];

      if (allRows.length) {
        const { error: mErr } = await supabase.from("copyright_matches").upsert(allRows, { onConflict: "scan_id,source_url" });
        if (mErr) throw new Error(mErr.message);
      }

      const clientVisibleFindings = filterClientVisibleCopyrightMatches(distributionRows);
      const verifiedFindingsByProvider = {
        firecrawl: 0,
        serpapi: 0,
        known_url: 0,
        telegram: 0,
      };
      for (const row of clientVisibleFindings) {
        const q = String((row.evidence as Record<string, unknown> | undefined)?.discovery_query ?? "");
        if (q === "known_url_seed") verifiedFindingsByProvider.known_url += 1;
        else if (q.startsWith("serpapi:")) verifiedFindingsByProvider.serpapi += 1;
        else if (/\btelegram\b/i.test(q)) verifiedFindingsByProvider.telegram += 1;
        else verifiedFindingsByProvider.firecrawl += 1;
      }

      const uniqueCandidatePages = new Set([
        ...byUrl.keys(),
        ...discovery.pageLeads.map((l) => canonicalUrl(l.url)),
      ]).size;
      const artworkOnlyRejected =
        artworkRejected +
        fallbackRows.filter((r) => r.detection_type === "DUPLICATE_ARTWORK_ONLY").length;

      const stats = {
        candidates: byUrl.size,
        graded: ordered.length,
        rekognition: fingerprint.available,
        recognized_actors: fingerprint.celebrities,
        scene_labels: fingerprint.labels.slice(0, 12),
        reference_faces: fingerprint.faceCount,
        matches: clientVisibleFindings.length,
        leads: internalPersist.length,
        queries_generated: discovery.queriesGenerated,
        queries_executed: discovery.queriesExecuted,
        provider_requests: discovery.providerRequests,
        provider_successes: discovery.providerSuccesses,
        provider_failures: discovery.providerFailures,
        provider_failures_by_category: discovery.providerFailuresByCategory,
        provider_failure_samples: discovery.providerFailureSamples,
        firecrawl_env_diagnostic: discovery.firecrawl_env_diagnostic,
        firecrawl_requests: discovery.firecrawl_requests,
        firecrawl_successes: discovery.firecrawl_successes,
        firecrawl_failures: discovery.firecrawl_failures,
        firecrawl_circuit_opened: discovery.firecrawl_circuit_opened,
        firecrawl_circuit_reason: discovery.firecrawl_circuit_reason,
        firecrawl_operator_action: discovery.firecrawl_operator_action,
        firecrawl_stopped_early: discovery.firecrawl_stopped_early,
        firecrawl_stopped_early_reason: discovery.firecrawl_stopped_early_reason,
        serpapi_requests: serpapiDiscovery.requests,
        serpapi_successes: serpapiDiscovery.successes,
        serpapi_failures: serpapiDiscovery.failures,
        serpapi_candidates: serpapiDiscovery.candidates,
        serpapi_failure_messages: serpapiDiscovery.failureMessages.slice(0, 6),
        brightdata_configured: brightDataDiscovery.configured,
        brightdata_queries_generated: brightDataDiscovery.queriesGenerated,
        brightdata_requests: brightDataDiscovery.requests,
        brightdata_successes: brightDataDiscovery.successes,
        brightdata_failures: brightDataDiscovery.failures,
        brightdata_candidates: brightDataDiscovery.candidates,
        brightdata_duplicates_dropped: brightDataDiscovery.duplicatesDropped,
        brightdata_failures_by_category: brightDataDiscovery.failuresByCategory,
        brightdata_failure_samples: brightDataDiscovery.failureSamples.slice(0, 6),
        brightdata_diagnostic: brightDataDiscovery.diagnostic,
        candidates_by_provider: {
          ...discovery.candidates_by_provider,
          brightdata: brightDataDiscovery.candidates,
          known_url: knownAccepted.length,
        },
        verified_findings_by_provider: verifiedFindingsByProvider,
        provider_candidates: byUrl.size,
        provider_results: byUrl.size + discovery.pageLeads.length,
        telegram_queries: discovery.telegram_queries,
        telegram_requests: discovery.telegram_requests,
        telegram_posts: discovery.telegram_posts,
        telegram_candidates: discovery.telegram_candidates,
        telegram_failures: discovery.telegram_failures,
        unique_candidate_pages: uniqueCandidatePages,
        unique_pages: uniqueCandidatePages,
        known_urls_submitted: knownInputs.length,
        known_urls_accepted: knownAccepted.length,
        known_urls_rejected: knownSeeds.filter((s) => !s.accepted).length,
        known_urls_attempted: Math.max(knownUrlsAttempted, earlyKnownUrlsAttempted),
        known_urls_retrieved:
          knownUrlsRetrieved +
          earlyKnownInvestigations.filter((k) => k.retrieved).length,
        known_urls_rendered:
          knownUrlsRendered +
          earlyKnownInvestigations.filter((k) => k.rendered).length,
        known_urls_verified: knownUrlsVerified,
        known_urls_rejected_after_crawl: knownUrlsRejectedAfterCrawl,
        known_url_failure_reasons: knownUrlInvestigations
          .filter((k) => k.crawl_failed || k.reject_reason)
          .map((k) => ({
            url: k.url,
            reason: k.crawl_failure_reason || k.reject_detail || k.reason || null,
            category: k.crawl_failure_category || k.reject_reason || null,
          }))
          .slice(0, 12),
        known_url_investigations: [
          ...earlyKnownInvestigations.map((k) => ({
            url: k.url,
            accepted: true,
            attempted: true,
            retrieved: k.retrieved,
            rendered: k.rendered,
            reason: k.reason,
            phase: "preflight_before_search",
          })),
          ...knownUrlInvestigations.slice(0, 12),
        ],
        crawl_slots_reserved_known: slotAllocation.knownSlots,
        crawl_slots_provider: slotAllocation.providerSlots,
        listing_pages_found: listingPagesFound,
        detail_pages_followed: detailPagesFollowed,
        pages_crawled: pagesCrawled,
        pages_failed: pagesFailed,
        crawl_failed_by_category: crawlFailedByCategory,
        title_identity_rejected: titleIdentityRejected,
        hard_negative_rejected: hardNegativeRejected,
        access_evidence_rejected: accessEvidenceRejected,
        official_authorized_rejected: officialRejected,
        youtube_promotional_rejected: youtubePromoRejected,
        catalog_listing_rejected: catalogListingRejected,
        cinema_showtime_rejected: cinemaRejected,
        trailer_promo_rejected: trailerRejected,
        review_news_rejected: reviewRejected,
        social_discussion_rejected: socialRejected,
        artwork_only_rejected: artworkOnlyRejected,
        registered_monitored_sources: registeredMonitoredSources,
        access_evidence_pages: accessEvidencePages,
        embedded_players: embeddedPlayers,
        download_pages: downloadPages,
        file_host_destinations: fileHostDestinations,
        torrents_magnets: torrentsMagnets,
        theatre_print_findings: theatrePrintFindings,
        internal_leads_persisted: internalPersist.length,
        client_visible_findings: clientVisibleFindings.length,
        verified_client_visible_findings: clientVisibleFindings.length,
        distribution_pages_inspected: leadUrls.length + detailPagesFollowed,
        distribution_sites: distributionRows.length,
        distribution_high_risk: distributionSummary.filter((d) => d.domain_risk === "high").length,
        distribution_summary: distributionSummary.slice(0, 25),
        rejection_funnel: explainZeroMatchFunnel({
          queries_generated: discovery.queriesGenerated,
          queries_executed: discovery.queriesExecuted,
          provider_results: byUrl.size + discovery.pageLeads.length,
          unique_candidate_pages: uniqueCandidatePages,
          listing_pages_found: listingPagesFound,
          detail_pages_followed: detailPagesFollowed,
          pages_crawled: pagesCrawled,
          pages_failed: pagesFailed,
          title_identity_rejected: titleIdentityRejected,
          hard_negative_rejected: hardNegativeRejected,
          access_evidence_rejected: accessEvidenceRejected,
          artwork_only_rejected: artworkOnlyRejected,
          access_evidence_pages: accessEvidencePages,
          embedded_players: embeddedPlayers,
          download_pages: downloadPages,
          file_host_destinations: fileHostDestinations,
          torrents_magnets: torrentsMagnets,
          theatre_print_findings: theatrePrintFindings,
          internal_leads_persisted: internalPersist.length,
          client_visible_findings: clientVisibleFindings.length,
          known_urls_submitted: knownInputs.length,
          known_urls_accepted: knownAccepted.length,
          known_urls_attempted: knownUrlsAttempted,
          known_urls_retrieved: knownUrlsRetrieved,
          known_urls_rendered: knownUrlsRendered,
          known_urls_verified: knownUrlsVerified,
          known_urls_rejected: knownSeeds.filter((s) => !s.accepted).length,
          known_urls_rejected_after_crawl: knownUrlsRejectedAfterCrawl,
          known_url_failure_reasons: knownUrlInvestigations
            .filter((k) => k.crawl_failed || k.reject_reason)
            .map((k) => ({
              url: k.url,
              reason: k.crawl_failure_reason || k.reject_detail || k.reason || null,
              category: k.crawl_failure_category || k.reject_reason || null,
            }))
            .slice(0, 12),
          crawl_failed_by_category: crawlFailedByCategory,
          official_authorized_rejected: officialRejected,
          catalog_listing_rejected: catalogListingRejected,
          youtube_promotional_rejected: youtubePromoRejected,
          registered_monitored_sources: registeredMonitoredSources,
        }),
        title_variants_used: titles.slice(0, 8),
        monitored_sources_checked: monitorPass.checked,
        monitor_incidents: monitorPass.incidents,

        release_timing: releaseTimingFor(releaseDate).timing,
        queries_language: analysis.language,
        release_date: analysis.releaseDate,

        ignored,
        frames: keys.length,
        sha256,
        confirmed: clientVisibleFindings.filter((r) => r.confidence_band === "confirmed").length,
        probable: clientVisibleFindings.filter((r) => r.confidence_band === "probable").length,
        review: clientVisibleFindings.filter((r) => r.confidence_band === "review").length,
        ...markStage(stages, "finished_at"),
        executor_started_at: stages.executor_started,
        scan_created_at: stages.scan_created,
        last_progress_at: new Date().toISOString(),
        discovery_never_started: false,
      };

      const terminal = decideCopyrightTerminalStatus({
        executorStarted: true,
        queriesGenerated: discovery.queriesGenerated,
        queriesExecuted: discovery.queriesExecuted,
        providerSuccesses: discovery.providerSuccesses + serpapiDiscovery.successes,
        providerFailures: discovery.providerFailures,
        providerCandidates: byUrl.size + discovery.pageLeads.length,
        knownUrlsAttempted: Math.max(knownUrlsAttempted, earlyKnownUrlsAttempted),
        knownUrlsAccepted: knownAccepted.length,
        pagesCrawled,
        clientVisibleFindings: clientVisibleFindings.length,
        abortedByDeadline,
        firecrawlCircuitOpened: discovery.firecrawl_circuit_opened,
        serpapiSuccesses: serpapiDiscovery.successes,
        serpapiCandidates: serpapiDiscovery.candidates,
        brightDataQueriesGenerated: brightDataDiscovery.queriesGenerated,
        brightDataRequests: brightDataDiscovery.requests,
        brightDataSuccesses: brightDataDiscovery.successes,
        brightDataCandidates: brightDataDiscovery.candidates,
      });

      const providerFailureHint = summarizeProviderFailures({
        provider_failures_by_category: discovery.providerFailuresByCategory,
      });
      const operatorHint = discovery.firecrawl_operator_action
        ? ` ${discovery.firecrawl_operator_action}`
        : "";
      const failureReason =
        terminal.reason && terminal.status === "failed"
          ? `${terminal.reason}${providerFailureHint ? ` (${providerFailureHint})` : ""}${operatorHint}`
          : terminal.reason ?? discovery.firecrawl_circuit_reason;

      const finalStats = activity.mergeToStats({
        ...stats,
        failure_reason: failureReason,
        terminal_status: terminal.status,
        pages_crawled: Math.max(
          pagesCrawled,
          typeof liveStats.pages_crawled === "number" ? liveStats.pages_crawled : 0,
          earlyKnownUrlsAttempted,
        ),
      });

      await pushActivity({}, true);

      await writeCopyrightTerminalStatus(supabase, scan.id, {
        status: terminal.status,
        sha256,
        error: terminal.status === "failed" ? (failureReason ?? "Scan failed").slice(0, 500) : null,
        stats: finalStats,
      });

      return {
        scanId: scan.id as string,
        status: terminal.status,
        stats: serializeCopyrightStats(finalStats),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failedStats = activity.mergeToStats({
        ...priorStats,
        ...stages,
        ...markStage(stages, "finished_at"),
        executor_started_at: stages.executor_started ?? null,
        discovery_never_started: !stages.discovery_started,
        failure_reason: message.slice(0, 500),
        candidates: 0,
        matches: 0,
        graded: 0,
      });
      await writeCopyrightTerminalStatus(supabase, scan.id, {
        status: "failed",
        error: message.slice(0, 500),
        stats: failedStats,
      });
      // Persist real failure — never convert to completed.
      return {
        scanId: scan.id as string,
        status: "failed" as const,
        stats: serializeCopyrightStats(failedStats),
      };
    }
}

/** Ensure server-fn return stats are JSON-serializable for TanStack Start. */
function serializeCopyrightStats(stats: unknown): {
  candidates?: number;
  matches?: number;
  graded?: number;
  failure_reason?: string | null;
  queries_generated?: number;
  queries_executed?: number;
  provider_successes?: number;
  provider_failures?: number;
  executor_started_at?: string | null;
  last_progress_at?: string | null;
} {
  try {
    return JSON.parse(JSON.stringify(stats ?? {})) as {
      candidates?: number;
      matches?: number;
      graded?: number;
      failure_reason?: string | null;
      queries_generated?: number;
      queries_executed?: number;
      provider_successes?: number;
      provider_failures?: number;
      executor_started_at?: string | null;
      last_progress_at?: string | null;
    };
  } catch {
    return { failure_reason: "Unable to serialize scan stats" };
  }
}

async function applyExecutorWatchdog(
  supabase: ContextSupabase,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const out = [];
  for (const row of rows) {
    const stats = (row.stats ?? {}) as Record<string, unknown>;
    const expired = isExecutorWatchdogExpired({
      status: String(row.status ?? ""),
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
      executorStartedAt:
        typeof stats.executor_started_at === "string"
          ? stats.executor_started_at
          : typeof stats.executor_started === "string"
            ? stats.executor_started
            : null,
    });
    if (!expired) {
      out.push(row);
      continue;
    }
    const failedStats = {
      ...stats,
      ...watchdogFailureStats(stats),
      failure_reason:
        "Copyright scan executor never started within the watchdog window (executor_not_started).",
    };
    await writeCopyrightTerminalStatus(supabase, row.id as string, {
      status: "failed",
      error:
        "Copyright scan executor never started within the watchdog window (executor_not_started).",
      stats: failedStats,
    });
    out.push({ ...row, status: "failed", error: failedStats.failure_reason, stats: failedStats });
  }
  return out;
}

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans").select("*")
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const rows = await applyExecutorWatchdog(
      context.supabase,
      (data ?? []) as Array<Record<string, unknown>>,
    );
    return rows as typeof data;
  });

export const getCopyrightScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: scan, error } = await context.supabase
      .from("copyright_scans").select("*").eq("id", data.scanId).single();
    if (error) throw new Error(error.message);
    const [watched] = await applyExecutorWatchdog(context.supabase, [
      scan as unknown as Record<string, unknown>,
    ]);
    const watchedScan = (watched ?? scan) as typeof scan;
    const { data: matches, error: mErr } = await context.supabase
      .from("copyright_matches").select("*").eq("scan_id", data.scanId)
      .order("confidence", { ascending: false });
    if (mErr) throw new Error(mErr.message);
    // Raw / non-actionable / identity-only rows stay internal — never as piracy UI.
    // `allSources` is the full inspected-source list (evidence status included)
    // so operators can see every site that was discovered and checked.
    const allSources = (matches ?? []).map((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      const dist = (ev.distribution ?? {}) as Record<string, unknown>;
      const identity = Array.isArray(dist.identity_evidence)
        ? (dist.identity_evidence as string[])
        : Array.isArray(ev.identity_evidence)
          ? (ev.identity_evidence as string[])
          : [];
      const access = Array.isArray(dist.access_evidence)
        ? (dist.access_evidence as string[])
        : Array.isArray(ev.access_evidence)
          ? (ev.access_evidence as string[])
          : [];
      const crawlFailed = ev.crawl_failed === true || dist.crawl_failed === true;
      const clientVisible = ev.client_visible !== false && dist.client_visible !== false;
      const strong = dist.strong_evidence === true;
      return {
        id: m.id,
        url: m.source_url,
        host: typeof ev.host === "string" ? ev.host : null,
        page_title: m.page_title,
        classification: (dist.classification as string) ?? m.detection_type,
        content_type: (dist.content_type as string) ?? (ev.website_type as string) ?? null,
        domain_risk: (dist.domain_risk as string) ?? null,
        confidence: m.confidence,
        checked: !crawlFailed,
        crawl_failure_reason:
          (ev.crawl_failure_reason as string) ?? (dist.crawl_failure_reason as string) ?? null,
        identity_evidence: identity.slice(0, 4),
        access_evidence: access.slice(0, 4),
        quality_tags: Array.isArray(dist.quality_tags) ? (dist.quality_tags as string[]).slice(0, 6) : [],
        status: crawlFailed
          ? ("unreachable" as const)
          : clientVisible && strong
            ? ("verified_piracy" as const)
            : identity.length || access.length
              ? ("insufficient_evidence" as const)
              : ("no_match" as const),
        reason: m.reason,
        discovery_query: (ev.discovery_query as string) ?? null,
      };
    });
    return {
      scan: watchedScan,
      matches: filterClientVisibleCopyrightMatches(matches ?? []),
      allSources,
    };
  });

export const updateCopyrightMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    matchId: z.string().uuid(),
    reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_matches").update({ review_status: data.reviewStatus }).eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
