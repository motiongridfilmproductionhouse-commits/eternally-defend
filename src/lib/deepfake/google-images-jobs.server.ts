/**
 * Google Images investigation job queue — insert, claim, persist, aggregate.
 */

import { randomUUID } from "node:crypto";
import { buildGoogleImagesInvestigationQueries } from "./google-images-queries.server";
import {
  emptyGoogleImagesDiagnostics,
  type GoogleImagesInvestigationDiagnostics,
} from "./google-images-diagnostics";
import { dispatchGoogleImagesWorker } from "./google-images-worker-dispatch.server";

export type GoogleImagesJobStatus =
  | "queued"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "retryable";

export type GoogleImagesJobRow = {
  id: string;
  scan_id: string;
  user_id: string;
  identity_id: string | null;
  query: string;
  priority: number;
  status: GoogleImagesJobStatus;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  lease_owner: string | null;
  lease_expiry: string | null;
  metrics: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

export const GOOGLE_IMAGES_JOB_LEASE_MS = 90_000;
export const GOOGLE_IMAGES_MAX_JOB_ATTEMPTS = 4;

function priorityForQuery(query: string, index: number): number {
  const lower = query.toLowerCase();
  if (!lower.includes("deepfake") && !lower.includes("ai") && !lower.includes("fake")) {
    return 10 + index;
  }
  if (lower.includes("deepfake") || lower.includes("face swap")) {
    return 20 + index;
  }
  return 50 + index;
}

export async function queueGoogleImagesInvestigation(input: {
  supabase: any;
  scanId: string;
  userId: string;
  identityId?: string | null;
  name: string;
  aliases?: string[];
  handles?: string[];
}): Promise<{ queued: number; queries: string[] }> {
  const queries = buildGoogleImagesInvestigationQueries({
    name: input.name,
    aliases: input.aliases,
    handles: input.handles,
  });

  if (!queries.length) {
    return { queued: 0, queries: [] };
  }

  const rows = queries.map((query, index) => ({
    scan_id: input.scanId,
    user_id: input.userId,
    identity_id: input.identityId ?? null,
    query,
    priority: priorityForQuery(query, index),
    status: "queued" as const,
  }));

  const { error } = await input.supabase
    .from("deepfake_google_images_jobs")
    .upsert(rows, { onConflict: "scan_id,query", ignoreDuplicates: true });

  if (error) {
    throw new Error(`Failed to queue Google Images jobs: ${error.message}`);
  }

  return { queued: queries.length, queries };
}

export async function claimGoogleImagesJobs(input: {
  supabase: any;
  scanId: string;
  limit?: number;
  leaseOwner?: string;
}): Promise<GoogleImagesJobRow[]> {
  const limit = Math.min(5, Math.max(1, input.limit ?? 4));
  const leaseOwner = input.leaseOwner ?? randomUUID();
  const leaseExpiry = new Date(Date.now() + GOOGLE_IMAGES_JOB_LEASE_MS).toISOString();
  const nowIso = new Date().toISOString();

  const { data: candidates, error: selectError } = await input.supabase
    .from("deepfake_google_images_jobs")
    .select("*")
    .eq("scan_id", input.scanId)
    .in("status", ["queued", "retryable"])
    .or(`lease_expiry.is.null,lease_expiry.lt.${nowIso}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (selectError) {
    throw new Error(`Failed to list Google Images jobs: ${selectError.message}`);
  }

  const claimed: GoogleImagesJobRow[] = [];
  for (const row of candidates ?? []) {
    const { data, error } = await input.supabase
      .from("deepfake_google_images_jobs")
      .update({
        status: "running",
        lease_owner: leaseOwner,
        lease_expiry: leaseExpiry,
        started_at: row.started_at ?? nowIso,
        attempts: (row.attempts ?? 0) + 1,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .in("status", ["queued", "retryable"])
      .select("*")
      .maybeSingle();

    if (!error && data) {
      claimed.push(data as GoogleImagesJobRow);
    }
  }

  return claimed;
}

export async function completeGoogleImagesJob(input: {
  supabase: any;
  jobId: string;
  status: GoogleImagesJobStatus;
  metrics?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await input.supabase
    .from("deepfake_google_images_jobs")
    .update({
      status: input.status,
      completed_at: ["completed", "failed"].includes(input.status) ? nowIso : null,
      lease_owner: null,
      lease_expiry: null,
      metrics: input.metrics ?? {},
      diagnostics: input.diagnostics ?? {},
      updated_at: nowIso,
    })
    .eq("id", input.jobId);

  if (error) {
    throw new Error(`Failed to update Google Images job: ${error.message}`);
  }
}

export async function releaseGoogleImagesJobLease(input: {
  supabase: any;
  jobId: string;
  retryable?: boolean;
}): Promise<void> {
  const status: GoogleImagesJobStatus = input.retryable ? "retryable" : "queued";
  const { error } = await input.supabase
    .from("deepfake_google_images_jobs")
    .update({
      status,
      lease_owner: null,
      lease_expiry: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.jobId);

  if (error) {
    throw new Error(`Failed to release Google Images job lease: ${error.message}`);
  }
}

export async function countGoogleImagesJobs(input: {
  supabase: any;
  scanId: string;
}): Promise<{
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}> {
  const { data, error } = await input.supabase
    .from("deepfake_google_images_jobs")
    .select("status")
    .eq("scan_id", input.scanId);

  if (error) {
    return { total: 0, queued: 0, running: 0, completed: 0, failed: 0 };
  }

  const counts = { total: 0, queued: 0, running: 0, completed: 0, failed: 0 };
  for (const row of data ?? []) {
    counts.total += 1;
    const status = String((row as { status?: string }).status ?? "");
    if (status === "queued" || status === "retryable") counts.queued += 1;
    else if (status === "running" || status === "partial") counts.running += 1;
    else if (status === "completed") counts.completed += 1;
    else if (status === "failed") counts.failed += 1;
  }
  return counts;
}

export function aggregateGoogleImagesDiagnostics(
  jobs: Array<{ metrics?: Record<string, unknown>; diagnostics?: Record<string, unknown>; status?: string }>,
  queriesPlanned: number,
): GoogleImagesInvestigationDiagnostics {
  const base = emptyGoogleImagesDiagnostics();
  base.queries_planned = queriesPlanned;

  for (const job of jobs) {
    const m = job.metrics ?? {};
    const n = (key: string) => {
      const v = m[key];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    if (job.status === "completed" || job.status === "partial" || job.status === "failed") {
      base.queries_executed += 1;
    }
    base.pages_loaded += n("pages_loaded");
    base.images_discovered += n("images_discovered");
    base.images_downloaded += n("images_downloaded");
    base.duplicate_images += n("duplicate_images");
    base.valid_faces += n("valid_faces");
    base.high_confidence_matches += n("high_confidence_matches");
    base.candidate_pages_crawled += n("candidate_pages_crawled");
    base.evidence_packages_created += n("evidence_packages_created");
    base.failed_downloads += n("failed_downloads");
    base.face_comparisons += n("face_comparisons");
    base.rejected_identities += n("rejected_identities");
  }

  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const pending = jobs.filter((j) =>
    ["queued", "running", "retryable", "partial"].includes(String(j.status)),
  ).length;

  if (pending > 0 && completed > 0) {
    base.provider_status = "degraded";
  } else if (pending > 0) {
    base.provider_status = completed > 0 || failed > 0 ? "degraded" : "not_started";
  } else if (completed === jobs.length && jobs.length > 0) {
    base.provider_status = "success";
  } else if (failed > 0 && completed === 0) {
    base.provider_status = "unavailable";
  } else if (failed > 0) {
    base.provider_status = "degraded";
  }

  return base;
}

export async function syncGoogleImagesScanMetrics(input: {
  supabase: any;
  scanId: string;
  userId: string;
  backgroundStatus: "queued" | "running" | "completed" | "failed";
  extraMetrics?: Record<string, unknown>;
}): Promise<GoogleImagesInvestigationDiagnostics> {
  const { data: jobs } = await input.supabase
    .from("deepfake_google_images_jobs")
    .select("status, metrics, diagnostics")
    .eq("scan_id", input.scanId);

  const jobRows = (jobs ?? []) as Array<{
    status?: string;
    metrics?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
  }>;

  const counts = await countGoogleImagesJobs({ supabase: input.supabase, scanId: input.scanId });
  const diagnostics = aggregateGoogleImagesDiagnostics(jobRows, counts.total);
  const progressPercent =
    counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  const { data: scan } = await input.supabase
    .from("deepfake_scans")
    .select("discovery_metrics")
    .eq("id", input.scanId)
    .eq("user_id", input.userId)
    .maybeSingle();

  const existing =
    scan?.discovery_metrics && typeof scan.discovery_metrics === "object"
      ? (scan.discovery_metrics as Record<string, unknown>)
      : {};

  const patch = {
    ...existing,
    google_images_diagnostic: diagnostics,
    google_images_background_status: input.backgroundStatus,
    google_images_jobs_total: counts.total,
    google_images_jobs_completed: counts.completed,
    google_images_jobs_running: counts.running,
    google_images_jobs_queued: counts.queued,
    google_images_progress_percent: progressPercent,
    investigation_stage:
      input.backgroundStatus === "running"
        ? "searching_google"
        : existing.investigation_stage,
    ...(input.extraMetrics ?? {}),
  };

  await input.supabase
    .from("deepfake_scans")
    .update({
      discovery_metrics: patch,
      heartbeat_at: new Date().toISOString(),
    })
    .eq("id", input.scanId)
    .eq("user_id", input.userId);

  return diagnostics;
}

export async function queueAndDispatchGoogleImagesInvestigation(input: {
  supabase: any;
  scanId: string;
  userId: string;
  identityId?: string | null;
  name: string;
  aliases?: string[];
  handles?: string[];
}): Promise<{ queued: number }> {
  const result = await queueGoogleImagesInvestigation(input);

  await syncGoogleImagesScanMetrics({
    supabase: input.supabase,
    scanId: input.scanId,
    userId: input.userId,
    backgroundStatus: result.queued > 0 ? "queued" : "completed",
    extraMetrics: {
      google_images_jobs_queued: result.queued > 0 ? 1 : 0,
      google_images_investigation_complete: 0,
    },
  });

  if (result.queued > 0) {
    const dispatch = await dispatchGoogleImagesWorker({ scanId: input.scanId });
    if (!dispatch.dispatched) {
      const { executeGoogleImagesWorkerBatch } = await import(
        "./google-images-worker.server"
      );
      void executeGoogleImagesWorkerBatch({
        supabase: input.supabase,
        scanId: input.scanId,
        userId: input.userId,
      }).catch((error) => {
        console.warn("[DEEPFAKE] Inline Google Images worker fallback failed:", {
          scanId: input.scanId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  return { queued: result.queued };
}

export async function hasPendingGoogleImagesJobs(input: {
  supabase: any;
  scanId: string;
}): Promise<boolean> {
  const counts = await countGoogleImagesJobs(input);
  return counts.queued > 0 || counts.running > 0;
}
