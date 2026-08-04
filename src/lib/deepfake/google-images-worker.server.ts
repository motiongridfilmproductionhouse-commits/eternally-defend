/**
 * Background worker for Google Images investigation jobs.
 * Processes 3–5 queries per execution within a 30–40 second budget.
 */

import { randomUUID } from "node:crypto";
import {
  claimGoogleImagesJobs,
  completeGoogleImagesJob,
  countGoogleImagesJobs,
  hasPendingGoogleImagesJobs,
  releaseGoogleImagesJobLease,
  syncGoogleImagesScanMetrics,
  GOOGLE_IMAGES_MAX_JOB_ATTEMPTS,
} from "./google-images-jobs.server";
import { dispatchGoogleImagesWorker } from "./google-images-worker-dispatch.server";
import { processGoogleImagesQuery, findingRowFromGoogleImagesCandidate } from "./google-images-investigation.server";
import { parseReferenceImagesFromMetrics } from "./reference-images";
import { parseGoogleImagesEvidencePackages } from "./google-images-evidence.server";
import { upsertDiscoveriesBatch, upsertFindingsBatch } from "./scan-persist.server";

export const GOOGLE_IMAGES_WORKER_BUDGET_MS = 35_000;
export const GOOGLE_IMAGES_WORKER_BATCH_SIZE = 4;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export type GoogleImagesWorkerResult = {
  processed: number;
  remaining: number;
  dispatched_next: boolean;
  background_status: "running" | "completed" | "failed";
};

export async function executeGoogleImagesWorkerBatch(input: {
  supabase: any;
  scanId: string;
  userId?: string;
  budgetMs?: number;
  batchSize?: number;
}): Promise<GoogleImagesWorkerResult> {
  const budgetMs = input.budgetMs ?? GOOGLE_IMAGES_WORKER_BUDGET_MS;
  const batchSize = input.batchSize ?? GOOGLE_IMAGES_WORKER_BATCH_SIZE;
  const startedAt = Date.now();
  const leaseOwner = randomUUID();

  const { data: scan, error: scanError } = await input.supabase
    .from("deepfake_scans")
    .select("id, user_id, target_name, discovery_metrics")
    .eq("id", input.scanId)
    .maybeSingle();

  if (scanError || !scan) {
    throw new Error(scanError?.message ?? "Scan not found for Google Images worker");
  }

  const userId = input.userId ?? scan.user_id;
  const referenceImages = parseReferenceImagesFromMetrics(
    scan.discovery_metrics as Record<string, unknown>,
  );

  await syncGoogleImagesScanMetrics({
    supabase: input.supabase,
    scanId: input.scanId,
    userId,
    backgroundStatus: "running",
  });

  const jobs = await claimGoogleImagesJobs({
    supabase: input.supabase,
    scanId: input.scanId,
    limit: batchSize,
    leaseOwner,
  });

  if (!jobs.length) {
    const counts = await countGoogleImagesJobs({
      supabase: input.supabase,
      scanId: input.scanId,
    });
    const backgroundStatus =
      counts.queued > 0 || counts.running > 0 ? "running" : "completed";
    await syncGoogleImagesScanMetrics({
      supabase: input.supabase,
      scanId: input.scanId,
      userId,
      backgroundStatus,
      extraMetrics: {
        google_images_investigation_complete:
          backgroundStatus === "completed" ? 1 : 0,
      },
    });
    return {
      processed: 0,
      remaining: counts.queued + counts.running,
      dispatched_next: false,
      background_status: backgroundStatus,
    };
  }

  const seenImageUrls = new Set<string>();
  const seenSha = new Set<string>();
  const seenPhash = new Set<string>();
  const persistedDiscoveryKeys = new Set<string>();
  let processed = 0;

  const existingMetrics =
    scan.discovery_metrics && typeof scan.discovery_metrics === "object"
      ? (scan.discovery_metrics as Record<string, unknown>)
      : {};
  const existingEvidence = parseGoogleImagesEvidencePackages(existingMetrics);
  const mergedEvidence = [...existingEvidence];

  for (const job of jobs) {
    if (Date.now() - startedAt > budgetMs - 5_000) {
      await releaseGoogleImagesJobLease({
        supabase: input.supabase,
        jobId: job.id,
        retryable: true,
      });
      continue;
    }

    try {
      const result = await processGoogleImagesQuery({
        query: job.query,
        referenceImages,
        seenImageUrls,
        seenSha,
        seenPhash,
        softDeadlineMs: startedAt + budgetMs,
      });

      const jobStatus =
        result.failure && (job.attempts ?? 0) >= GOOGLE_IMAGES_MAX_JOB_ATTEMPTS
          ? "failed"
          : result.failure
            ? "retryable"
            : "completed";

      await completeGoogleImagesJob({
        supabase: input.supabase,
        jobId: job.id,
        status: jobStatus,
        metrics: result.metrics,
        diagnostics: {
          failure: result.failure,
          query: job.query,
          used_browser: result.used_browser,
          browser_available: result.browser_available,
        },
      });

      if (result.candidates.length) {
        await upsertDiscoveriesBatch({
          supabase: input.supabase,
          userId,
          scanId: input.scanId,
          targetName: scan.target_name,
          hostOf,
          rows: result.candidates.map((hit) => ({
            source: hit.source,
            query: hit.query,
            page_url: hit.url,
            canonical_url: hit.url,
            final_url: hit.url,
            image_url: hit.image_url,
            thumbnail_url: hit.thumbnail_url,
            verified_domain: hostOf(hit.url),
            target_face_match: hit.target_face_match,
            face_similarity: hit.face_similarity,
          })),
          alreadyPersisted: persistedDiscoveryKeys,
        });

        const findingRows = result.candidates
          .map((candidate) =>
            findingRowFromGoogleImagesCandidate({
              scanId: input.scanId,
              userId,
              candidate,
            }),
          )
          .filter((row): row is Record<string, unknown> => Boolean(row));

        if (findingRows.length) {
          await upsertFindingsBatch({
            supabase: input.supabase,
            rows: findingRows,
            alreadyPersisted: new Set<string>(),
          });
        }
      }

      mergedEvidence.push(...result.evidence_packages);
      processed += 1;

      await syncGoogleImagesScanMetrics({
        supabase: input.supabase,
        scanId: input.scanId,
        userId,
        backgroundStatus: "running",
        extraMetrics: {
          google_images_evidence_packages: mergedEvidence.slice(0, 80),
          face_comparisons:
            (Number(existingMetrics.face_comparisons) || 0) +
            result.metrics.face_comparisons,
          images_compared:
            (Number(existingMetrics.images_compared) || 0) +
            result.metrics.face_comparisons,
          reference_google_images_found:
            (Number(existingMetrics.reference_google_images_found) || 0) +
            result.metrics.images_discovered,
        },
      });
    } catch (error) {
      const retryable = (job.attempts ?? 0) < GOOGLE_IMAGES_MAX_JOB_ATTEMPTS;
      if (retryable) {
        await releaseGoogleImagesJobLease({
          supabase: input.supabase,
          jobId: job.id,
          retryable: true,
        });
      } else {
        await completeGoogleImagesJob({
          supabase: input.supabase,
          jobId: job.id,
          status: "failed",
          diagnostics: {
            failure: error instanceof Error ? error.message : String(error),
            query: job.query,
          },
        });
      }
    }
  }

  const pending = await hasPendingGoogleImagesJobs({
    supabase: input.supabase,
    scanId: input.scanId,
  });
  const counts = await countGoogleImagesJobs({
    supabase: input.supabase,
    scanId: input.scanId,
  });

  const backgroundStatus = pending ? "running" : "completed";
  await syncGoogleImagesScanMetrics({
    supabase: input.supabase,
    scanId: input.scanId,
    userId,
    backgroundStatus,
    extraMetrics: {
      google_images_investigation_complete: pending ? 0 : 1,
      google_images_evidence_packages: mergedEvidence.slice(0, 80),
    },
  });

  let dispatchedNext = false;
  if (pending) {
    const dispatch = await dispatchGoogleImagesWorker({ scanId: input.scanId });
    dispatchedNext = dispatch.dispatched;
  }

  return {
    processed,
    remaining: counts.queued + counts.running,
    dispatched_next: dispatchedNext,
    background_status: backgroundStatus,
  };
}
