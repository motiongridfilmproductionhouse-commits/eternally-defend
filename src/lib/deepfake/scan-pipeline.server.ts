import { isFirecrawlConfigured } from "../firecrawl-client.server";
import { filterDeepfakeCandidates } from "./filter.server";
import { generateDeepfakeQueries } from "./query-generator.server";
import { isBlockedHost } from "./queries";
import {
  isCandidateDisabledForFeature,
  isProviderDisabledForFeature,
} from "../policy/source-policy";

import {
  buildExecutedQueryPlan,
  discoveredCandidateKey,
  mergeDiscoveredCandidates,
} from "./discovery-plan.server";
import {
  adaptivePerQueryLimit,
  canStartProviderCall,
  canStartVerification,
  createScanBudget,
  discoveryBudgetRemaining,
  INITIAL_PRIORITY_QUERY_COUNT,
  MIN_PROVIDER_TIME_MS,
  QUERY_BATCH_SIZE,
  recordSpend,
  verificationBudgetRemaining,
  VERIFY_CANDIDATE_BATCH_SIZE,
} from "./scan-budget.server";
import { buildAdaptiveQuerySchedule, nextQueryBatch } from "./query-priority.server";
import {
  checkpointHasPendingWork,
  createEmptyCheckpoint,
  enforceCheckpointBounds,
  markQueryCompleted,
  parseScanCheckpoint,
  recordProviderLatency,
  type ScanCheckpoint,
} from "./scan-checkpoint.server";
import {
  assertNotAborted,
  isAbortError,
  isDeadlineOrTimeoutError,
  ScanCheckpointPauseError,
  type ScanRuntime,
} from "./scan-runtime.server";
import {
  createDiscoveryFunnelMetrics,
  touchScanProgress,
  type DiscoveryFunnelMetrics,
  type ScanOwnership,
} from "./scan-ownership.server";
import {
  findingPersistKey,
  upsertDiscoveriesBatch,
  upsertFindingsBatch,
} from "./scan-persist.server";
import { createImportedImageQueries, parseGoogleImagesUrl } from "./google-images-import.server";
import {
  classifyPageEvidence,
  finalizeDeepfakeFinding,
  isClientVisibleClassification,
  shouldAnalyzeMedia,
  shouldPersistFinding,
  type FindingClassification,
} from "./page-evidence.server";
import { collectReferenceImages } from "./reference-collection.server";
import { expandIdentityVariants } from "./identity-variants.server";
import { isUrlVerified } from "./url-verification.server";
import { parseReferenceImagesFromMetrics, type CollectedReferenceImage } from "./reference-images";
import {
  queueGoogleImagesInvestigation,
  syncGoogleImagesScanMetrics,
} from "./google-images-jobs.server";
import { dispatchGoogleImagesWorker } from "./google-images-worker-dispatch.server";
import { hydrateHighRiskRegistryFromDatabase } from "./high-risk-registry.server";

type ProviderHit = {
  url: string;
  title?: string;
  description?: string;
  query: string;
  source?: string;
  thumbnail_url?: string;
  image_url?: string;
  media_url?: string;
  is_sensitive?: boolean;
  content_match_score?: number;
  threat_signals?: string[];
};

type VerifiedCandidate = ProviderHit & {
  discovered_url: string;
  final_url: string;
  canonical_url: string;
  http_status: number | null;
  redirect_chain: string[];
  crawled_at: string;
  page_title: string | null;
  page_description: string | null;
  page_text: string;
  page_inspected: boolean;
  verified_domain: string | null;
  url_verification_status: string;
  rejection_reason: string | null;
  evidence_page_url: string;
  related_links?: string[];
};

type FinalizedFinding = ProviderHit & {
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  content_category: string | null;
  confidence: number;
  is_synthetic: boolean;
  face_referenced: boolean;
  takedown_recommended: boolean;
  ai_reasoning: string | null;
  classification_status?: "completed" | "no_media" | "provider_error" | "failed";
  finding_classification?: string | null;
  page_type?: string | null;
  identity_confidence?: number | null;
  synthetic_media_confidence?: number | null;
  matched_evidence?: string[];
  classification_explanation?: string | null;
  target_face_match?: boolean | null;
  face_similarity?: number | null;
  matched_face_id?: string | null;
  hive_deepfake_score?: number | null;
  hive_ai_generated_score?: number | null;
  page_text?: string;
  discovered_url?: string;
  final_url?: string;
  canonical_url?: string;
  http_status?: number | null;
  redirect_chain?: string[];
  crawled_at?: string | null;
  verified_domain?: string | null;
  url_verification_status?: string | null;
  url_rejection_reason?: string | null;
  evidence_page_url?: string;
};

type VerificationMetrics = {
  crawl_succeeded: number;
  crawl_failed: number;
  identity_rejected: number;
  page_type_rejected: number;
  url_rejected: number;
  dns_resolution_failed?: number;
  private_address_rejected?: number;
  tls_connection_failed?: number;
  request_timeout?: number;
  redirect_rejected?: number;
  crawl_provider_failed?: number;
  network_failed?: number;
};

type RiskCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export type PipelineWorkerLimits = {
  maxQueryBatches: number;
  onBatchProcessed?: (info: { batchNumber: number; queryIds: string[] }) => void;
};

export type PipelineResult = {
  completed: boolean;
  checkpointPaused: boolean;
  discoveryCount: number;
  findingCount: number;
  clientVisibleCount: number;
  riskCounts: RiskCounts;
  metrics: DiscoveryFunnelMetrics;
  checkpoint: ScanCheckpoint;
  planQueryCount: number;
  queryBatchesProcessed: number;
};

const THREAT_TRIAGE_SIGNALS = new Set([
  "nude",
  "pornographic",
  "sexual-content",
  "leaked-intimate-media",
  "undressing",
  "deepfake",
  "ai-nude",
  "morphed-media",
  "synthetic-media",
]);

const MEDIA_PROCESS_BATCH_SIZE = 12;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function stageMetrics(
  metrics: DiscoveryFunnelMetrics,
  checkpoint: ScanCheckpoint,
): DiscoveryFunnelMetrics & { stage: string; planned_queries: number } {
  return {
    ...metrics,
    stage: checkpoint.stage,
    planned_queries: checkpoint.queries.length,
  };
}

function addVerificationMetrics(metrics: DiscoveryFunnelMetrics, next: VerificationMetrics): void {
  metrics.crawl_succeeded += next.crawl_succeeded;
  metrics.crawl_failed += next.crawl_failed;
  metrics.identity_rejected += next.identity_rejected;
  metrics.page_type_rejected += next.page_type_rejected;
  metrics.url_rejected += next.url_rejected;
  metrics.dns_resolution_failed += next.dns_resolution_failed ?? 0;
  metrics.private_address_rejected += next.private_address_rejected ?? 0;
  metrics.tls_connection_failed += next.tls_connection_failed ?? 0;
  metrics.request_timeout += next.request_timeout ?? 0;
  metrics.redirect_rejected += next.redirect_rejected ?? 0;
  metrics.crawl_provider_failed += next.crawl_provider_failed ?? 0;
  metrics.network_failed += next.network_failed ?? 0;
}

function hasThreatSignal(hit: { threat_signals?: string[] }): boolean {
  return (hit.threat_signals ?? []).some((signal) => THREAT_TRIAGE_SIGNALS.has(signal));
}

function findingRowFromClassification(input: {
  scanId: string;
  userId: string;
  finding: FinalizedFinding;
}): Record<string, unknown> {
  const { finding, scanId, userId } = input;
  const pageUrl = finding.final_url ?? finding.evidence_page_url ?? finding.url;

  return {
    scan_id: scanId,
    user_id: userId,
    url: pageUrl,
    source_host: finding.verified_domain ?? hostOf(pageUrl),
    page_title: finding.title ?? null,
    snippet: finding.description ?? null,
    query: finding.query,
    risk_level: finding.risk_level,
    content_category: finding.content_category,
    confidence: finding.confidence,
    is_synthetic: finding.is_synthetic,
    face_referenced: finding.face_referenced,
    takedown_recommended: finding.takedown_recommended,
    target_face_match: finding.target_face_match ?? false,
    face_similarity: finding.face_similarity ?? null,
    matched_face_id: finding.matched_face_id ?? null,
    ai_reasoning: finding.classification_explanation
      ? `${finding.classification_explanation}${
          finding.ai_reasoning ? ` ${finding.ai_reasoning}` : ""
        }`
      : finding.ai_reasoning,
    finding_classification: finding.finding_classification ?? null,
    page_type: finding.page_type ?? null,
    identity_confidence: finding.identity_confidence ?? null,
    synthetic_media_confidence: finding.synthetic_media_confidence ?? null,
    matched_evidence: finding.matched_evidence ?? [],
    classification_explanation: finding.classification_explanation ?? null,
    discovered_url: finding.discovered_url ?? pageUrl,
    final_url: finding.final_url ?? pageUrl,
    canonical_url: finding.canonical_url ?? pageUrl,
    http_status: finding.http_status ?? null,
    redirect_chain: finding.redirect_chain ?? [],
    crawled_at: finding.crawled_at ?? null,
    url_verification_status: finding.url_verification_status ?? null,
    url_rejection_reason: finding.url_rejection_reason ?? null,
  };
}

/** Build the initial query schedule persisted at scan startup and reused by workers. */
export function buildScheduledQueries(input: {
  target: { name: string; aliases: string[]; handles: string[] };
  googleImagesUrl?: string;
  maxQueries: number;
}): string[] {
  const generatedQueries = generateDeepfakeQueries(input.target).slice(
    0,
    Math.max(1, input.maxQueries),
  );

  let importedQueries: string[] = [];
  if (input.googleImagesUrl) {
    const imported = parseGoogleImagesUrl(input.googleImagesUrl);
    importedQueries = createImportedImageQueries(imported.query);
  }

  const merged = buildExecutedQueryPlan({
    importedQueries,
    generatedQueries,
    maxQueries: input.maxQueries,
  });
  const importedKeys = new Set(importedQueries.map((query) => query.toLowerCase()));
  const importedHead = merged.filter((query) => importedKeys.has(query.toLowerCase()));
  const remainder = merged.filter((query) => !importedKeys.has(query.toLowerCase()));
  const scheduledRemainder = buildAdaptiveQuerySchedule({
    queries: remainder,
    initialCount: INITIAL_PRIORITY_QUERY_COUNT,
  });

  return uniqueStrings([...importedHead, ...scheduledRemainder]).slice(0, input.maxQueries);
}

export async function executeInterleavedDeepfakePipeline(input: {
  supabase: any;
  userId: string;
  ownership: ScanOwnership;
  scanId: string;
  target: { name: string; aliases: string[]; handles: string[] };
  profileId?: string | null;
  googleImagesUrl?: string;
  maxQueries?: number;
  perQueryLimit?: number;
  runtime: ScanRuntime;
  resumeCheckpoint?: ScanCheckpoint | null;
  workerLimits?: PipelineWorkerLimits;
}): Promise<PipelineResult> {
  // Hydrate the high-risk domain registry from prior scans (any target) before
  // building this scan's query plan, so Tier 1 site: queries are not
  // permanently limited to the 3-domain seed list. Idempotent and
  // non-throwing — a hydration failure just means this run uses whatever the
  // in-process registry already has (seed domains at minimum).
  await hydrateHighRiskRegistryFromDatabase(input.supabase);

  const autoAliases = expandIdentityVariants({
    name: input.target.name,
    aliases: input.target.aliases,
    handles: input.target.handles,
  });
  const mergedAliases = [...new Set([...input.target.aliases, ...autoAliases])].slice(0, 48);
  const mergedTarget = { ...input.target, aliases: mergedAliases };

  const maxQueries = input.resumeCheckpoint?.max_queries ?? input.maxQueries ?? 72;
  const perQueryLimit = input.resumeCheckpoint?.per_query_limit ?? input.perQueryLimit ?? 20;
  const scheduledQueries = buildScheduledQueries({
    target: mergedTarget,
    googleImagesUrl: input.googleImagesUrl,
    maxQueries,
  });

  const resumeCheckpoint = input.resumeCheckpoint
    ? parseScanCheckpoint(input.resumeCheckpoint)
    : null;

  const metrics = {
    ...createDiscoveryFunnelMetrics(),
    ...(resumeCheckpoint?.metrics ?? {}),
  };
  metrics.queries_generated = resumeCheckpoint?.queries.length ?? scheduledQueries.length;

  let checkpoint =
    resumeCheckpoint ??
    createEmptyCheckpoint({
      queries: scheduledQueries,
      targetName: mergedTarget.name,
      profileId: input.profileId ?? null,
      aliases: mergedTarget.aliases,
      handles: mergedTarget.handles,
      perQueryLimit,
      maxQueries,
      initialWaveCount: INITIAL_PRIORITY_QUERY_COUNT,
      metrics,
    });

  metrics.aliases_generated = autoAliases.length;

  let collectedReferenceImages: CollectedReferenceImage[] = resumeCheckpoint
    ? parseReferenceImagesFromMetrics(resumeCheckpoint.metrics as Record<string, unknown>)
    : [];

  // Google Images is a first-class early discovery source: queue investigation
  // queries before reference harvest so diagnostics/UI show it first. Dispatch
  // workers after references are available for reliable face comparison.
  // Failures never abort the scan (Bing/Brave/Yandex continue independently).
  if (!metrics.google_images_jobs_queued) {
    await touchScanProgress({
      supabase: input.supabase,
      ownership: input.ownership,
      patch: {
        discovery_metrics: {
          ...stageMetrics(metrics, checkpoint),
          investigation_stage: "searching_google",
          google_images_background_status: "queued",
        },
      },
    });

    try {
      const queued = await queueGoogleImagesInvestigation({
        supabase: input.supabase,
        scanId: input.scanId,
        userId: input.userId,
        identityId: input.profileId ?? null,
        name: mergedTarget.name,
        aliases: mergedTarget.aliases,
        handles: mergedTarget.handles,
      });
      metrics.google_images_jobs_queued = queued.queued > 0 ? 1 : 0;
      metrics.google_images_jobs_total = queued.queued;
      await syncGoogleImagesScanMetrics({
        supabase: input.supabase,
        scanId: input.scanId,
        userId: input.userId,
        backgroundStatus: queued.queued > 0 ? "queued" : "completed",
        extraMetrics: {
          google_images_jobs_queued: queued.queued > 0 ? 1 : 0,
          google_images_investigation_complete: 0,
        },
      });
    } catch (error) {
      console.warn("[DEEPFAKE] Google Images queue isolated failure:", {
        error: error instanceof Error ? error.message : String(error),
      });
      metrics.google_images_jobs_queued = 1;
      await touchScanProgress({
        supabase: input.supabase,
        ownership: input.ownership,
        patch: {
          discovery_metrics: {
            ...stageMetrics(metrics, checkpoint),
            google_images_diagnostic: {
              provider_status: "unavailable",
              failure_reason: error instanceof Error ? error.message : String(error),
            },
            google_images_background_status: "failed",
          },
        },
      });
    }
  }

  if (!resumeCheckpoint) {
    await touchScanProgress({
      supabase: input.supabase,
      ownership: input.ownership,
      patch: {
        discovery_metrics: {
          ...metrics,
          investigation_stage: "collecting_reference_images",
          aliases_generated: metrics.aliases_generated,
        },
      },
    });

    const refResult = await collectReferenceImages({
      name: mergedTarget.name,
      aliases: mergedTarget.aliases,
      handles: mergedTarget.handles,
      signal: input.runtime.signal,
      softDeadlineMs: input.runtime.softDeadlineMs,
      onProgress: async (stage) => {
        await touchScanProgress({
          supabase: input.supabase,
          ownership: input.ownership,
          patch: {
            discovery_metrics: {
              ...metrics,
              investigation_stage: stage,
            },
          },
        });
      },
    });

    collectedReferenceImages = refResult.images;

    metrics.reference_images_count = refResult.final_reference_count;
    metrics.final_reference_images = refResult.final_reference_count;
    metrics.embeddings_indexed = refResult.images.filter((i) => i.embedding_indexed).length;
    metrics.images_downloaded = refResult.provider_stats.reduce(
      (sum, s) => sum + s.images_downloaded,
      0,
    );
    for (const stat of refResult.provider_stats) {
      if (stat.provider === "google_images") {
        metrics.reference_google_images_found = stat.images_found;
      } else if (stat.provider === "bing_images") {
        metrics.reference_bing_images_found = stat.images_found;
      } else if (stat.provider === "yandex_images") {
        metrics.reference_yandex_images_found = stat.images_found;
      }
    }
    await touchScanProgress({
      supabase: input.supabase,
      ownership: input.ownership,
      patch: {
        discovery_metrics: {
          ...metrics,
          reference_image_provider_stats: refResult.provider_stats,
          reference_images: refResult.images.slice(0, 120),
        },
      },
    });
  }

  // Start Google Images workers once reference faces are available (or after
  // a best-effort harvest). Isolation: dispatch failures never abort the scan.
  // Only kick workers when queued/not finished — avoid re-dispatch every wave.
  const metricsRecord = metrics as Record<string, unknown>;
  const googleImagesBg =
    typeof metricsRecord.google_images_background_status === "string"
      ? metricsRecord.google_images_background_status
      : null;
  if (
    metrics.google_images_jobs_queued &&
    googleImagesBg !== "completed" &&
    googleImagesBg !== "failed"
  ) {
    try {
      console.info("deepfake_startup_stage", {
        stage: "google_images_queue",
        scan_id: input.scanId,
        background_status: googleImagesBg,
      });
      const dispatch = await dispatchGoogleImagesWorker({
        scanId: input.scanId,
        timeoutMs: 8_000,
      });
      if (!dispatch.dispatched) {
        console.warn("[DEEPFAKE] Google Images worker dispatch failed:", {
          scanId: input.scanId,
          reason: dispatch.reason,
          category: dispatch.category,
          worker_url: dispatch.worker_url,
        });
        const { isProductionDeepfakeRuntime, keepBackgroundWorkAlive } =
          await import("./startup-network.server");
        // Production: leave GI jobs queued/retryable — never inline sync/async fallback.
        if (!isProductionDeepfakeRuntime()) {
          const { executeGoogleImagesWorkerBatch } = await import("./google-images-worker.server");
          keepBackgroundWorkAlive(
            executeGoogleImagesWorkerBatch({
              supabase: input.supabase,
              scanId: input.scanId,
              userId: input.userId,
            }).catch((error) => {
              console.warn("[DEEPFAKE] Inline Google Images worker fallback failed:", {
                scanId: input.scanId,
                error: error instanceof Error ? error.message : String(error),
              });
            }),
          );
        }
      }
      await touchScanProgress({
        supabase: input.supabase,
        ownership: input.ownership,
        patch: {
          discovery_metrics: {
            ...stageMetrics(metrics, checkpoint),
            google_images_background_status: "running",
            investigation_stage: "searching_google",
          },
        },
      });
    } catch (error) {
      console.warn("[DEEPFAKE] Google Images dispatch isolated failure:", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!resumeCheckpoint) {
    checkpoint.queries = scheduledQueries;
  }
  checkpoint.planned_query_count = checkpoint.queries.length;
  checkpoint.initial_wave_count = checkpoint.initial_wave_count || INITIAL_PRIORITY_QUERY_COUNT;
  checkpoint.per_query_limit = perQueryLimit;
  checkpoint.max_queries = maxQueries;
  if (!checkpoint.serpapi_queries?.length) {
    const { buildSerpApiExactIdentityQueries } = await import("./serpapi-images.server");
    checkpoint.serpapi_queries = buildSerpApiExactIdentityQueries({
      name: mergedTarget.name,
      aliases: mergedTarget.aliases,
    });
    checkpoint.serpapi_next_query_index = 0;
    checkpoint.serpapi_completed_query_ids = checkpoint.serpapi_completed_query_ids ?? [];
    checkpoint.serpapi_seen_page_urls = checkpoint.serpapi_seen_page_urls ?? [];
  }
  checkpoint = enforceCheckpointBounds(checkpoint);

  const budget = createScanBudget(input.runtime);
  const riskCounts: RiskCounts = { ...checkpoint.risk_counts };
  let discoveryCount = checkpoint.discovery_count;
  let findingCount = checkpoint.finding_count;
  let clientVisibleCount = checkpoint.client_visible_count;

  /*
   * Rehydrate durable dedupe keys from the database — never trust checkpoint
   * verified_canonical_urls as proof that URL_VERIFIED / identity gates passed.
   * Pending URLs are only candidate seeds and must be re-verified.
   */
  const persistedDiscoveryKeys = new Set<string>();
  const persistedFindingKeys = new Set<string>();
  try {
    const { data: existingDiscoveries } = await input.supabase
      .from("deepfake_discoveries")
      .select("page_url, canonical_url, analysis_status")
      .eq("scan_id", input.scanId)
      .eq("user_id", input.userId)
      .limit(500);
    for (const row of existingDiscoveries ?? []) {
      const status = String((row as any).analysis_status ?? "");
      if (status && status !== "url_verified") continue;
      const key = canonicalUrl(String((row as any).canonical_url || (row as any).page_url || ""));
      if (key) persistedDiscoveryKeys.add(key);
    }

    const { data: existingFindings } = await input.supabase
      .from("deepfake_findings")
      .select("canonical_url, evidence_page_url, url, url_verification_status")
      .eq("scan_id", input.scanId)
      .eq("user_id", input.userId)
      .limit(500);
    for (const row of existingFindings ?? []) {
      if (!isUrlVerified((row as any).url_verification_status)) continue;
      const key = findingPersistKey(row as any);
      if (key) persistedFindingKeys.add(key);
    }
  } catch (rehydrateError) {
    console.warn(
      "[DEEPFAKE] Failed to rehydrate persisted keys; using empty dedupe sets:",
      rehydrateError instanceof Error ? rehydrateError.message : String(rehydrateError),
    );
  }

  discoveryCount = Math.max(discoveryCount, persistedDiscoveryKeys.size);
  findingCount = Math.max(findingCount, persistedFindingKeys.size);

  const countedFindingKeys = new Set<string>(persistedFindingKeys);
  const seenCandidateKeys = new Set<string>();
  for (const url of persistedDiscoveryKeys) {
    seenCandidateKeys.add(`page:${canonicalUrl(url)}`);
  }
  for (const url of persistedFindingKeys) {
    seenCandidateKeys.add(`page:${canonicalUrl(url)}`);
  }

  const pendingCandidates = new Map<string, ProviderHit>();
  for (const url of checkpoint.pending_candidate_urls) {
    const key = canonicalUrl(url);
    if (!key || persistedDiscoveryKeys.has(key) || persistedFindingKeys.has(key)) {
      continue;
    }
    pendingCandidates.set(key, {
      url,
      query: input.target.name,
      source: "checkpoint_resume",
    });
  }

  const relatedLinks = new Map<string, ProviderHit>();

  const syncCheckpoint = () => {
    checkpoint.metrics = { ...metrics };
    checkpoint.risk_counts = { ...riskCounts };
    checkpoint.discovery_count = discoveryCount;
    checkpoint.finding_count = findingCount;
    checkpoint.client_visible_count = clientVisibleCount;
    checkpoint.pending_candidate_urls = Array.from(pendingCandidates.values())
      .map((item) => item.url)
      .filter((url) => /^https?:\/\//i.test(url));
    checkpoint.verified_canonical_urls = Array.from(
      new Set([
        ...persistedDiscoveryKeys,
        ...persistedFindingKeys,
        ...checkpoint.verified_canonical_urls.map(canonicalUrl),
      ]),
    ).filter(Boolean);
    checkpoint.pending_work = checkpointHasPendingWork(checkpoint);
    checkpoint.last_checkpoint_at = new Date().toISOString();
    checkpoint = enforceCheckpointBounds(checkpoint);
  };

  const heartbeat = async (stage: ScanCheckpoint["stage"], patch?: Record<string, unknown>) => {
    assertNotAborted(input.runtime.signal);
    checkpoint.stage = stage;
    syncCheckpoint();
    await touchScanProgress({
      supabase: input.supabase,
      ownership: input.ownership,
      patch: {
        scan_checkpoint: checkpoint,
        discovery_metrics: stageMetrics(metrics, checkpoint),
        total_queries: checkpoint.queries.length,
        total_results: clientVisibleCount,
        critical_count: riskCounts.critical,
        high_count: riskCounts.high,
        medium_count: riskCounts.medium,
        low_count: riskCounts.low,
        ...(patch ?? {}),
      },
    });
    assertNotAborted(input.runtime.signal);
  };

  const updateFindingMetrics = (items: FinalizedFinding[]) => {
    for (const item of items) {
      const key = findingPersistKey(item as any);
      if (!key || countedFindingKeys.has(key)) continue;
      countedFindingKeys.add(key);

      if (item.finding_classification === "UNVERIFIED_LEAD") {
        metrics.unverified++;
      } else if (item.finding_classification === "PROBABLE_DEEPFAKE") {
        metrics.probable++;
      } else if (item.finding_classification === "VERIFIED_DEEPFAKE") {
        metrics.verified++;
      }

      const clientVisible =
        isClientVisibleClassification(item.finding_classification) &&
        isUrlVerified(item.url_verification_status);
      if (!clientVisible) continue;

      clientVisibleCount++;
      metrics.client_visible = clientVisibleCount;

      if (item.risk_level === "CRITICAL") riskCounts.critical++;
      else if (item.risk_level === "HIGH") riskCounts.high++;
      else if (item.risk_level === "MEDIUM") riskCounts.medium++;
      else riskCounts.low++;
    }
  };

  const collectRelatedLinks = (verified: VerifiedCandidate[]) => {
    const verifiedCanonical = new Set(checkpoint.verified_canonical_urls.map(canonicalUrl));
    for (const hit of verified) {
      const sourceHost = hostOf(hit.final_url);
      for (const link of hit.related_links ?? []) {
        const linkHost = hostOf(link);
        if (!sourceHost || linkHost !== sourceHost) continue;
        const canonical = canonicalUrl(link);
        if (verifiedCanonical.has(canonical)) continue;
        if (pendingCandidates.has(canonical)) continue;
        relatedLinks.set(canonical, {
          url: link,
          title: hit.page_title ?? hit.title,
          description: hit.page_description ?? hit.description,
          query: hit.query,
          source: "validated_domain_link",
        });
      }
    }
  };

  const classifyAndPersist = async (mediaCandidates: VerifiedCandidate[]) => {
    if (!mediaCandidates.length) return;
    if (!canStartVerification(budget)) return;

    const classifyStartedAt = Date.now();
    await heartbeat("classifying");

    const inspectedCandidates = mediaCandidates.map((hit) => {
      const pageUrl = hit.final_url ?? hit.evidence_page_url ?? hit.url;
      const preEvidence = classifyPageEvidence({
        url: pageUrl,
        title: hit.page_title ?? hit.title,
        description: hit.page_description ?? hit.description,
        page_text: hit.page_text,
        page_inspected: hit.page_inspected,
        query: hit.query,
        target: input.target,
        target_face_match: (hit as any).target_face_match,
        face_similarity: (hit as any).face_similarity,
      });

      return {
        ...hit,
        page_inspected: hit.page_inspected ?? false,
        page_type: preEvidence.page_type,
        identity_confidence: preEvidence.identity_confidence,
        synthetic_media_confidence: preEvidence.synthetic_media_confidence,
        matched_evidence: preEvidence.matched_evidence,
        finding_classification: preEvidence.finding_classification,
        classification_explanation: preEvidence.classification_explanation,
        _pre_evidence: preEvidence,
      };
    });

    for (const inspectedBatch of chunkArray(inspectedCandidates, MEDIA_PROCESS_BATCH_SIZE)) {
      assertNotAborted(input.runtime.signal);
      await heartbeat("classifying");

      const analyzableCandidates = inspectedBatch.filter((hit) =>
        shouldAnalyzeMedia(hit._pre_evidence, {
          page_inspected: hit.page_inspected,
          page_text: hit.page_text,
        }),
      );

      let hiveCandidates: Array<(typeof analyzableCandidates)[number]> = analyzableCandidates;

      if (input.profileId && analyzableCandidates.length) {
        const { filterCandidatesByTargetFace } = await import("./face-filter.server");
        const faceResults = await filterCandidatesByTargetFace({
          supabase: input.supabase,
          userId: input.userId,
          profileId: input.profileId,
          candidates: analyzableCandidates,
          similarityThreshold: 88,
          signal: input.runtime.signal,
          softDeadlineMs: input.runtime.softDeadlineMs,
        });

        metrics.face_comparisons += analyzableCandidates.length;
        metrics.images_compared += analyzableCandidates.length;
        metrics.video_keyframe_comparisons += [
          ...faceResults.matched,
          ...faceResults.rejected,
          ...faceResults.errors,
        ].reduce((sum, item) => sum + ((item as any).video_frames_compared ?? 0), 0);

        metrics.serpapi_face_rejected += faceResults.rejected.filter(
          (item) => item.source === "serpapi_google_images",
        ).length;

        const syntheticUnavailable = faceResults.errors.filter((item) => {
          const text = [
            item.title ?? "",
            item.description ?? "",
            item.page_text ?? "",
            item.url ?? "",
          ].join(" ");
          return /\b(?:deepfake|face\s*swap|ai\s*nude|fake\s*nude|morphed|synthetic\s*media)\b/i.test(
            text,
          );
        });

        hiveCandidates = [
          ...(faceResults.matched as any[]),
          ...syntheticUnavailable.map((item) => ({
            ...item,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
          })),
        ];
      } else if (collectedReferenceImages.length > 0 && analyzableCandidates.length) {
        await touchScanProgress({
          supabase: input.supabase,
          ownership: input.ownership,
          patch: {
            discovery_metrics: {
              ...stageMetrics(metrics, checkpoint),
              investigation_stage: "comparing_faces",
            },
          },
        });
        const { filterCandidatesByAutoReferences } =
          await import("./auto-reference-face-filter.server");
        const faceResults = await filterCandidatesByAutoReferences({
          referenceImages: collectedReferenceImages,
          candidates: analyzableCandidates,
          similarityThreshold: 88,
          signal: input.runtime.signal,
          softDeadlineMs: input.runtime.softDeadlineMs,
        });

        metrics.face_comparisons += faceResults.comparisons;
        metrics.images_compared += faceResults.comparisons;
        metrics.video_keyframe_comparisons += [
          ...faceResults.matched,
          ...faceResults.rejected,
          ...faceResults.errors,
        ].reduce((sum, item) => sum + ((item as any).video_frames_compared ?? 0), 0);

        const syntheticUnavailable = faceResults.errors.filter((item) => {
          const text = [
            item.title ?? "",
            item.description ?? "",
            item.page_text ?? "",
            item.url ?? "",
          ].join(" ");
          return /\b(?:deepfake|face\s*swap|ai\s*nude|fake\s*nude|morphed|synthetic\s*media)\b/i.test(
            text,
          );
        });

        hiveCandidates = [
          ...(faceResults.matched as any[]),
          ...analyzableCandidates
            .filter(
              (c) =>
                !faceResults.matched.some((m) => m.url === c.url) &&
                !faceResults.rejected.some((r) => r.url === c.url) &&
                !faceResults.errors.some((e) => e.url === c.url),
            )
            .map((item) => ({
              ...item,
              target_face_match: false,
              face_similarity: 0,
              matched_face_id: null,
            })),
          ...syntheticUnavailable.map((item) => ({
            ...item,
            target_face_match: false,
            face_similarity: 0,
            matched_face_id: null,
          })),
        ];
      }

      const { classifyHitsWithHive } = await import("./hive.server");
      const hiveResults = hiveCandidates.length
        ? await classifyHitsWithHive(hiveCandidates, {
            signal: input.runtime.signal,
            softDeadlineMs: input.runtime.softDeadlineMs,
          })
        : [];

      const hiveUsable = hiveResults.some((item) => item.classification_status === "completed");

      let mediaClassified: Array<Awaited<ReturnType<typeof classifyHitsWithHive>>[number]> =
        hiveResults;

      if (!hiveUsable && hiveCandidates.length) {
        const { classifyHits } = await import("./classify.server");
        const textPool = hiveCandidates.slice(0, 40);

        try {
          const textResults = await classifyHits(
            textPool.map((item) => ({
              url: item.evidence_page_url ?? item.url,
              title: item.title,
              description: item.description,
              query: item.query,
            })),
            input.target,
            { signal: input.runtime.signal },
          );

          mediaClassified = textResults.map((item, index) => ({
            ...textPool[index],
            ...item,
            content_match_score: (textPool[index] as any)?.content_match_score ?? 0,
            classification_status: "completed" as const,
            visibility: "triage" as const,
            ai_reasoning:
              `${item.ai_reasoning} (Text-only triage: media analysis unavailable.)`.trim(),
          }));
        } catch (fallbackError) {
          if (isAbortError(fallbackError)) throw fallbackError;
          console.warn(
            "[DEEPFAKE] Text-classifier fallback failed:",
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          );
        }
      }

      const mediaByPage = new Map<string, (typeof mediaClassified)[number]>();
      for (const item of mediaClassified) {
        const pageUrl = (item as any).evidence_page_url ?? item.url;
        const existing = mediaByPage.get(pageUrl);
        if (!existing || (item.confidence ?? 0) > (existing.confidence ?? 0)) {
          mediaByPage.set(pageUrl, item);
        }
      }

      const finalized = inspectedBatch.map((hit) => {
        const pageUrl = hit.final_url ?? hit.evidence_page_url ?? hit.url;
        const media =
          mediaByPage.get(pageUrl) ??
          mediaByPage.get(hit.evidence_page_url ?? "") ??
          mediaByPage.get(hit.url);

        const crawledTitle = hit.page_title ?? media?.title ?? null;
        const crawledDescription = hit.page_description ?? media?.description ?? null;
        const finalizedFields = finalizeDeepfakeFinding({
          url: pageUrl,
          title: crawledTitle,
          description: crawledDescription,
          page_text: hit.page_text,
          page_inspected: hit.page_inspected,
          query: hit.query,
          target: input.target,
          hive_deepfake_score: (media as any)?.hive_deepfake_score ?? null,
          hive_ai_generated_score: (media as any)?.hive_ai_generated_score ?? null,
          target_face_match:
            (media as any)?.target_face_match ?? (hit as any).target_face_match ?? null,
          face_similarity: (media as any)?.face_similarity ?? (hit as any).face_similarity ?? null,
          is_synthetic: media?.is_synthetic ?? null,
          content_category: media?.content_category ?? null,
          existing_reasoning: media?.ai_reasoning ?? null,
          existing_category: media?.content_category ?? null,
          existing_confidence: media?.confidence ?? null,
        });

        return {
          url: pageUrl,
          title: crawledTitle ?? undefined,
          description: crawledDescription ?? undefined,
          query: hit.query,
          evidence_page_url: pageUrl,
          media_url: (media as any)?.media_url ?? hit.media_url,
          content_match_score: (hit as any).content_match_score ?? 0,
          threat_signals: (hit as any).threat_signals,
          classification_status: media?.classification_status ?? "no_media",
          target_face_match:
            (media as any)?.target_face_match ?? (hit as any).target_face_match ?? false,
          face_similarity: (media as any)?.face_similarity ?? (hit as any).face_similarity ?? null,
          matched_face_id: (media as any)?.matched_face_id ?? (hit as any).matched_face_id ?? null,
          hive_deepfake_score: (media as any)?.hive_deepfake_score,
          hive_ai_generated_score: (media as any)?.hive_ai_generated_score,
          page_text: hit.page_text,
          discovered_url: hit.discovered_url,
          final_url: hit.final_url,
          canonical_url: hit.canonical_url,
          http_status: hit.http_status,
          redirect_chain: hit.redirect_chain,
          crawled_at: hit.crawled_at,
          verified_domain: hit.verified_domain,
          url_verification_status: hit.url_verification_status,
          url_rejection_reason: hit.rejection_reason ?? null,
          ...finalizedFields,
        } as FinalizedFinding;
      });

      const dedupedFinalized = new Map<string, FinalizedFinding>();
      for (const item of finalized) {
        const key = item.canonical_url ?? item.evidence_page_url ?? item.url;
        const existing = dedupedFinalized.get(key);
        if (!existing || (item.confidence ?? 0) > (existing.confidence ?? 0)) {
          dedupedFinalized.set(key, item);
        }
      }

      const classified = Array.from(dedupedFinalized.values()).filter(
        (item) =>
          isUrlVerified(item.url_verification_status) &&
          shouldPersistFinding(item.finding_classification as FindingClassification),
      );

      await heartbeat("saving");
      const rows = classified.map((finding) =>
        findingRowFromClassification({
          scanId: input.scanId,
          userId: input.userId,
          finding,
        }),
      );
      const keysBefore = new Set(persistedFindingKeys);
      const persistedCount = await upsertFindingsBatch({
        supabase: input.supabase,
        rows,
        alreadyPersisted: persistedFindingKeys,
      });

      if (persistedCount > 0) {
        findingCount += persistedCount;
        const persistedFindings = classified.filter((item) => {
          const key = findingPersistKey(item as any);
          return Boolean(key && !keysBefore.has(key) && persistedFindingKeys.has(key));
        });
        updateFindingMetrics(persistedFindings);

        // Grow the high-risk domain registry from real qualified findings so
        // future queries for THIS and other targets prioritise domains that
        // have actually produced verified/probable deepfake findings, rather
        // than the fixed 3-domain seed list. Best-effort only: a registry
        // failure never blocks or fails the scan.
        try {
          const { recordQualifiedDomainFinding, persistQualifiedDomainFinding } =
            await import("./high-risk-registry.server");
          for (const item of persistedFindings) {
            if (!isClientVisibleClassification(item.finding_classification)) continue;
            const pageUrl = item.canonical_url ?? item.final_url ?? item.url;
            if (!pageUrl) continue;
            const entry = recordQualifiedDomainFinding({
              hostname: pageUrl,
              provider: item.source ?? undefined,
              query: item.query,
            });
            await persistQualifiedDomainFinding(input.supabase, entry);
          }
        } catch (registryError) {
          console.warn("[DEEPFAKE] High-risk domain registry update failed:", {
            error: registryError instanceof Error ? registryError.message : String(registryError),
          });
        }
      }

      await heartbeat("saving");

      const evidenceCandidates = classified.filter(
        (item) =>
          isClientVisibleClassification(item.finding_classification) &&
          isUrlVerified(item.url_verification_status),
      );

      if (evidenceCandidates.length) {
        try {
          const { captureAndStoreEvidence } = await import("./evidence-capture.server");
          await captureAndStoreEvidence({
            supabase: input.supabase,
            userId: input.userId,
            scanId: input.scanId,
            candidates: evidenceCandidates as any[],
            signal: input.runtime.signal,
            softDeadlineMs: input.runtime.softDeadlineMs,
          });
        } catch (evidenceError) {
          if (isAbortError(evidenceError)) throw evidenceError;
          console.warn(
            "[DEEPFAKE:EVIDENCE] Capture failed:",
            evidenceError instanceof Error ? evidenceError.message : String(evidenceError),
          );
        }
        await heartbeat("saving");
      }
    }

    recordSpend(budget, "verification", Date.now() - classifyStartedAt);
  };

  const verifyAndClassify = async (
    candidates: ProviderHit[],
    maxPages = VERIFY_CANDIDATE_BATCH_SIZE,
  ) => {
    if (!candidates.length) return;
    if (!canStartVerification(budget)) return;
    const startedAt = Date.now();
    await heartbeat("verifying");

    const { verifyCandidateUrls } = await import("./url-verification.server");
    const verification = await verifyCandidateUrls(
      candidates.map((hit) => ({
        url: hit.url,
        title: hit.title,
        description: hit.description,
        query: hit.query,
        source: hit.source,
        image_url: hit.image_url,
        thumbnail_url: hit.thumbnail_url,
        media_url: hit.media_url,
        content_match_score: hit.content_match_score,
        threat_signals: hit.threat_signals,
      })),
      input.target,
      {
        maxPages,
        signal: input.runtime.signal,
        softDeadlineMs: input.runtime.softDeadlineMs,
        onBatchComplete: async (info) => {
          discoveryCount += await upsertDiscoveriesBatch({
            supabase: input.supabase,
            userId: input.userId,
            scanId: input.scanId,
            targetName: input.target.name,
            hostOf,
            rows: info.verifiedBatch,
            alreadyPersisted: persistedDiscoveryKeys,
          });
          await heartbeat("verifying");
        },
      },
    );

    recordSpend(budget, "verification", Date.now() - startedAt);
    addVerificationMetrics(metrics, verification.metrics);

    const verified = verification.verified as VerifiedCandidate[];
    const serpapiInBatch = candidates.filter((hit) => hit.source === "serpapi_google_images");
    if (serpapiInBatch.length) {
      const { isSerpApiFaceIdentityRejectionReason } = await import("./serpapi-images.server");
      const serpapiVerified = verified.filter((hit) => hit.source === "serpapi_google_images");
      metrics.serpapi_verified += serpapiVerified.length;

      // Only explicit face/identity rejection outcomes — URL/crawl/page-evidence
      // rejects are already tracked via addVerificationMetrics.
      const serpapiUrls = new Set(serpapiInBatch.map((hit) => hit.url).filter(Boolean));
      for (const rejected of verification.rejected) {
        const discovered = rejected.discovered_url;
        if (!discovered || !serpapiUrls.has(discovered)) continue;
        if (isSerpApiFaceIdentityRejectionReason(rejected.rejection_reason)) {
          metrics.serpapi_face_rejected += 1;
        }
      }
    }
    for (const hit of verified) {
      checkpoint.verified_canonical_urls.push(canonicalUrl(hit.canonical_url));
    }
    collectRelatedLinks(verified);

    if (verified.length) {
      discoveryCount += await upsertDiscoveriesBatch({
        supabase: input.supabase,
        userId: input.userId,
        scanId: input.scanId,
        targetName: input.target.name,
        hostOf,
        rows: verified,
        alreadyPersisted: persistedDiscoveryKeys,
      });
      await classifyAndPersist(verified);
    }
  };

  const processPendingCandidates = async (maxPages = VERIFY_CANDIDATE_BATCH_SIZE) => {
    if (!pendingCandidates.size) return;
    if (!canStartVerification(budget)) return;
    const batch = Array.from(pendingCandidates.values()).slice(0, maxPages);
    await verifyAndClassify(batch, maxPages);
    for (const item of batch) {
      pendingCandidates.delete(canonicalUrl(item.url));
    }
  };

  const enqueueProviderHits = async (hits: ProviderHit[]) => {
    metrics.provider_candidates += hits.length;

    const eligibleHits: ProviderHit[] = [];
    for (const hit of hits) {
      // Feature-scoped source policy (e.g. Reddit is disabled for the deepfake
      // agent). Checked before the "explicit provider" bypass below, otherwise
      // provider-tagged hits skip host filtering entirely.
      if (isCandidateDisabledForFeature("deepfake_intel", hit)) continue;

      const host = hit.url ? hostOf(hit.url) : null;
      const imageHost = typeof hit.image_url === "string" ? hostOf(hit.image_url) : null;
      const thumbnailHost =
        typeof hit.thumbnail_url === "string" ? hostOf(hit.thumbnail_url) : null;
      const explicitProviderResult = hit.source === "youtube_api";
      const hasAnyUsableUrl = host !== null || imageHost !== null || thumbnailHost !== null;
      if (
        !hasAnyUsableUrl ||
        (!explicitProviderResult &&
          ((host !== null && isBlockedHost(host)) ||
            (imageHost !== null && isBlockedHost(imageHost)) ||
            (thumbnailHost !== null && isBlockedHost(thumbnailHost))))
      ) {
        continue;
      }

      const key = discoveredCandidateKey(hit);
      if (key && seenCandidateKeys.has(key)) continue;
      if (key) seenCandidateKeys.add(key);
      eligibleHits.push(hit);
    }

    const merged = mergeDiscoveredCandidates(eligibleHits, {
      defaultQuery: input.target.name,
    }) as ProviderHit[];
    metrics.unique_candidates += merged.length;

    if (!merged.length) {
      await heartbeat("discovering");
      return;
    }

    const candidateFilter = filterDeepfakeCandidates(merged, input.target);
    const pagesToInspect = [
      ...candidateFilter.accepted,
      ...candidateFilter.triage.filter(hasThreatSignal),
    ] as ProviderHit[];

    for (const hit of pagesToInspect) {
      pendingCandidates.set(canonicalUrl(hit.url), hit);
    }

    await heartbeat("verifying");
    await processPendingCandidates();
  };

  const pauseIfPending = async () => {
    syncCheckpoint();
    if (!checkpointHasPendingWork(checkpoint)) return;
    checkpoint.stage = "checkpoint";
    syncCheckpoint();
    await heartbeat("checkpoint");
    const pause = new ScanCheckpointPauseError();
    (pause as ScanCheckpointPauseError & { checkpoint?: ScanCheckpoint }).checkpoint = checkpoint;
    throw pause;
  };

  await heartbeat("discovering");

  /**
   * Optional SerpApi Google Images wave. Isolated: failures never abort the
   * scan. Runs inside the same discovery budget and verifies immediately.
   */
  const runSerpApiDiscoveryWave = async (maxRequests = 2) => {
    if ((checkpoint.serpapi_next_query_index ?? 0) >= (checkpoint.serpapi_queries?.length ?? 0)) {
      return;
    }

    const { isSerpApiConfigured, searchSerpApiQueriesBounded, SERPAPI_MAX_REQUESTS_PER_SCAN } =
      await import("./serpapi-images.server");

    if (!isSerpApiConfigured()) {
      checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      await heartbeat("discovering");
      return;
    }

    if (metrics.serpapi_requests >= SERPAPI_MAX_REQUESTS_PER_SCAN) {
      checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      await heartbeat("discovering");
      return;
    }

    if (!canStartProviderCall(budget, MIN_PROVIDER_TIME_MS)) {
      return;
    }

    const remainingRequests = Math.max(0, SERPAPI_MAX_REQUESTS_PER_SCAN - metrics.serpapi_requests);
    const requestBudget = Math.min(maxRequests, remainingRequests);
    if (requestBudget <= 0) {
      checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      await heartbeat("discovering");
      return;
    }

    const startedAt = Date.now();
    try {
      assertNotAborted(input.runtime.signal);
      const remainingQueries = checkpoint.serpapi_queries.slice(
        checkpoint.serpapi_next_query_index,
      );
      const result = await searchSerpApiQueriesBounded({
        queries: remainingQueries,
        maxRequests: requestBudget,
        alreadyCompletedIds: checkpoint.serpapi_completed_query_ids,
        alreadySeenPages: checkpoint.serpapi_seen_page_urls,
        signal: input.runtime.signal,
        softDeadlineMs: input.runtime.softDeadlineMs,
        // Meter every settled query before any awaitable verify work so a
        // mid-batch abort cannot drop already-consumed HTTP attempts.
        onQueryMetered: ({ query, hits, creditsUsed, httpAttempts }) => {
          const queryId = query.trim().toLowerCase();
          if (!checkpoint.serpapi_completed_query_ids.includes(queryId)) {
            checkpoint.serpapi_completed_query_ids.push(queryId);
          }
          checkpoint.serpapi_next_query_index = Math.min(
            checkpoint.serpapi_queries.length,
            Math.max(
              checkpoint.serpapi_next_query_index,
              checkpoint.serpapi_completed_query_ids.length,
            ),
          );
          metrics.serpapi_credits_used += creditsUsed;
          metrics.serpapi_requests += Math.max(0, httpAttempts);
          if (hits.length) {
            metrics.serpapi_candidates += hits.length;
            for (const hit of hits) {
              if (!checkpoint.serpapi_seen_page_urls.includes(hit.url)) {
                checkpoint.serpapi_seen_page_urls.push(hit.url);
              }
            }
            metrics.serpapi_unique_pages = Math.max(
              metrics.serpapi_unique_pages,
              checkpoint.serpapi_seen_page_urls.length,
            );
          }
          checkpoint.metrics = { ...metrics };
        },
        onQueryComplete: async ({ hits }) => {
          if (hits.length) {
            await enqueueProviderHits(hits as ProviderHit[]);
            await processPendingCandidates();
          }
          await heartbeat("discovering");
        },
      });

      recordSpend(budget, "discovery", Date.now() - startedAt);
      recordProviderLatency(
        checkpoint,
        `serpapi:${checkpoint.serpapi_next_query_index}`,
        Date.now() - startedAt,
      );

      metrics.serpapi_failures += result.failures;
      metrics.serpapi_unique_pages = Math.max(metrics.serpapi_unique_pages, result.uniquePages);
      if (result.failures > 0) {
        metrics.provider_failures += result.failures;
      }

      for (const id of result.completedQueryIds) {
        if (!checkpoint.serpapi_completed_query_ids.includes(id)) {
          checkpoint.serpapi_completed_query_ids.push(id);
        }
      }
      checkpoint.serpapi_seen_page_urls = Array.from(
        new Set([...checkpoint.serpapi_seen_page_urls, ...result.seenPageUrls]),
      );
      checkpoint.serpapi_next_query_index = Math.min(
        checkpoint.serpapi_queries.length,
        Math.max(
          checkpoint.serpapi_next_query_index,
          checkpoint.serpapi_completed_query_ids.length,
        ),
      );
      // Only advance to end when SerpApi is truly done (unique-page cap or all
      // queries completed). Partial wave budgets must leave remaining queries.
      if (result.drained) {
        checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      } else if (metrics.serpapi_requests >= SERPAPI_MAX_REQUESTS_PER_SCAN) {
        checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      }

      for (const message of result.failureMessages.slice(0, 5)) {
        console.warn("[DEEPFAKE] SerpApi discovery soft-failure:", message);
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      metrics.serpapi_failures++;
      metrics.provider_failures++;
      console.warn("[DEEPFAKE] SerpApi discovery isolated failure:", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Keep remaining SerpApi queries/budget for later waves or Continue.
      // Only retire the plan when the HTTP attempt cap is already exhausted.
      if (metrics.serpapi_requests >= SERPAPI_MAX_REQUESTS_PER_SCAN) {
        checkpoint.serpapi_next_query_index = checkpoint.serpapi_queries.length;
      } else {
        checkpoint.serpapi_next_query_index = Math.min(
          checkpoint.serpapi_queries.length,
          Math.max(
            checkpoint.serpapi_next_query_index,
            checkpoint.serpapi_completed_query_ids.length,
          ),
        );
      }
    } finally {
      await heartbeat("discovering");
    }
  };

  let queryBatchesProcessed = 0;
  const workerMaxQueryBatches = input.workerLimits?.maxQueryBatches ?? Number.POSITIVE_INFINITY;

  const shouldPauseForWorkerContinuation = () =>
    Number.isFinite(workerMaxQueryBatches) &&
    queryBatchesProcessed >= workerMaxQueryBatches &&
    checkpointHasPendingWork(checkpoint);

  try {
    // First SerpApi wave (≤2 requests) so verification can begin early.
    await runSerpApiDiscoveryWave(2);
    await processPendingCandidates();

    if (shouldPauseForWorkerContinuation()) {
      await pauseIfPending();
    }

    if (!isFirecrawlConfigured()) {
      console.warn("[DEEPFAKE] Firecrawl is not configured; skipping Firecrawl search provider.");
      checkpoint.next_query_index = checkpoint.queries.length;
      await heartbeat("discovering");
    }

    while (isFirecrawlConfigured() && checkpoint.next_query_index < checkpoint.queries.length) {
      assertNotAborted(input.runtime.signal);
      await processPendingCandidates();

      if (shouldPauseForWorkerContinuation()) {
        await pauseIfPending();
      }

      // Interleave remaining SerpApi requests inside Firecrawl waves.
      await runSerpApiDiscoveryWave(2);
      await processPendingCandidates();

      if (shouldPauseForWorkerContinuation()) {
        await pauseIfPending();
      }

      if (
        checkpoint.next_query_index >= checkpoint.initial_wave_count &&
        discoveryBudgetRemaining(budget) < MIN_PROVIDER_TIME_MS
      ) {
        if (checkpointHasPendingWork(checkpoint)) {
          await pauseIfPending();
        }
        break;
      }

      const estimatedProviderMs = Math.max(
        checkpoint.average_provider_latency_ms,
        MIN_PROVIDER_TIME_MS,
      );
      if (!canStartProviderCall(budget, estimatedProviderMs)) {
        if (checkpointHasPendingWork(checkpoint)) {
          await pauseIfPending();
        }
        break;
      }

      const { batch, nextIndex } = nextQueryBatch(
        checkpoint.queries,
        checkpoint.next_query_index,
        QUERY_BATCH_SIZE,
      );
      if (!batch.length) break;

      const batchQueryIds = batch.map((query) => query.trim().toLowerCase());
      input.workerLimits?.onBatchProcessed?.({
        batchNumber: queryBatchesProcessed + 1,
        queryIds: batchQueryIds,
      });

      const providerStartedAt = Date.now();
      const perQuery = adaptivePerQueryLimit({
        baseLimit: perQueryLimit,
        averageProviderLatencyMs: checkpoint.average_provider_latency_ms,
        discoveryRemainingMs: discoveryBudgetRemaining(budget),
      });

      await heartbeat("discovering");
      const { firecrawlSearch, searchQueriesWithBoundedConcurrency } =
        await import("./firecrawl.server");
      const results = await searchQueriesWithBoundedConcurrency(batch, {
        concurrency: 3,
        provider: "firecrawl",
        search: (query) =>
          firecrawlSearch(query, perQuery, {
            signal: input.runtime.signal,
            softDeadlineMs: input.runtime.softDeadlineMs,
          }),
        signal: input.runtime.signal,
      });

      const providerElapsed = Date.now() - providerStartedAt;
      recordSpend(budget, "discovery", providerElapsed);
      recordProviderLatency(
        checkpoint,
        `firecrawl:${checkpoint.next_query_index}`,
        providerElapsed,
      );

      for (const query of batch) {
        markQueryCompleted(checkpoint, query);
      }
      checkpoint.next_query_index = nextIndex;
      metrics.queries_executed += results.queriesExecuted;
      metrics.query_failures += results.failures.length;
      metrics.provider_failures += results.failures.length;
      for (const failure of results.failures.slice(0, 10)) {
        console.warn("[DEEPFAKE] Search query failed:", failure);
      }

      await heartbeat("discovering");
      await enqueueProviderHits(results.hits as ProviderHit[]);
      await heartbeat("discovering");

      queryBatchesProcessed += 1;
      if (shouldPauseForWorkerContinuation()) {
        await pauseIfPending();
      }
    }

    if (shouldPauseForWorkerContinuation()) {
      await pauseIfPending();
    }

    // Drain any remaining SerpApi budget after Firecrawl waves.
    await runSerpApiDiscoveryWave(5);
    await processPendingCandidates();

    if (shouldPauseForWorkerContinuation()) {
      await pauseIfPending();
    }

    if (input.workerLimits && checkpoint.next_query_index < checkpoint.queries.length) {
      await pauseIfPending();
    }

    if (
      !checkpoint.youtube_done &&
      canStartProviderCall(
        budget,
        Math.max(checkpoint.average_provider_latency_ms, MIN_PROVIDER_TIME_MS),
      )
    ) {
      const startedAt = Date.now();
      try {
        assertNotAborted(input.runtime.signal);
        const { searchRecentYouTubeMentions } = await import("./youtube-discovery.server");
        const hits = await searchRecentYouTubeMentions({
          name: input.target.name,
          aliases: input.target.aliases,
          handles: input.target.handles,
          maxResults: 40,
          pages: 2,
          signal: input.runtime.signal,
          softDeadlineMs: input.runtime.softDeadlineMs,
        });
        recordSpend(budget, "discovery", Date.now() - startedAt);
        await enqueueProviderHits(hits as ProviderHit[]);
      } catch (error) {
        if (isAbortError(error)) throw error;
        metrics.provider_failures++;
        console.warn("[DEEPFAKE] YouTube discovery failed:", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        checkpoint.youtube_done = true;
        await heartbeat("discovering");
      }
    }

    await processPendingCandidates();

    /*
     * Reddit discovery is disabled for the deepfake agent by product rule
     * (see src/lib/policy/source-policy.ts). The provider call is skipped
     * entirely rather than filtered downstream, so no Reddit request is made.
     */
    if (!checkpoint.reddit_done && isProviderDisabledForFeature("deepfake_intel", "reddit_api")) {
      checkpoint.reddit_done = true;
    }

    /*
     * Reverse-image discovery wave. Text queries can only find pages that
     * *mention* the target by name/alias/handle — an anonymously posted
     * face-swap or leak never surfaces that way. This pushes the target's
     * own enrolled reference face through the reverse-image providers
     * (already wired for the copyright/asset-protection pipeline) and feeds
     * any returned pages through the exact same enqueue → filter → face
     * verification path as every other provider. It only ever widens
     * discovery; a reverse-image hit still has to pass identity and
     * manipulation verification before it can become a finding, and a
     * missing/unconfigured provider degrades to zero leads rather than
     * failing the scan.
     */
    if (
      !checkpoint.reverse_image_done &&
      canStartProviderCall(
        budget,
        Math.max(checkpoint.average_provider_latency_ms, MIN_PROVIDER_TIME_MS),
      )
    ) {
      const startedAt = Date.now();
      try {
        assertNotAborted(input.runtime.signal);
        const { seedDeepfakeLeadsFromReferenceFaces } = await import("./reverse-image-seed.server");
        const seedResult = await seedDeepfakeLeadsFromReferenceFaces({
          supabase: input.supabase,
          userId: input.userId,
          subject: input.target.name,
          maxFaces: 2,
        });
        recordSpend(budget, "discovery", Date.now() - startedAt);
        metrics.reverse_image_reference_faces_used += seedResult.diagnostics.reference_faces_used;
        metrics.reverse_image_raw_candidates += seedResult.diagnostics.raw_candidates;
        metrics.reverse_image_leads += seedResult.diagnostics.seeded_leads;
        metrics.reverse_image_provider_failures += seedResult.diagnostics.providers_failed.length;
        if (seedResult.leads.length) {
          await enqueueProviderHits(seedResult.leads.map((lead) => ({ ...lead })) as ProviderHit[]);
        }
      } catch (error) {
        if (isAbortError(error)) throw error;
        metrics.provider_failures++;
        metrics.reverse_image_provider_failures += 1;
        console.warn("[DEEPFAKE] Reverse-image discovery failed:", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        checkpoint.reverse_image_done = true;
        await heartbeat("discovering");
      }
    }

    await processPendingCandidates();

    if (!checkpoint.related_done) {
      if (relatedLinks.size && verificationBudgetRemaining(budget) >= MIN_PROVIDER_TIME_MS) {
        await verifyAndClassify(Array.from(relatedLinks.values()), 24);
      }
      checkpoint.related_done = true;
      await heartbeat("discovering");
    }

    await processPendingCandidates();

    if (checkpointHasPendingWork(checkpoint)) {
      await pauseIfPending();
    }

    checkpoint.stage = "done";
    checkpoint.pending_work = false;
    syncCheckpoint();
    await heartbeat("done");

    return {
      completed: true,
      checkpointPaused: false,
      discoveryCount,
      findingCount,
      clientVisibleCount,
      riskCounts,
      metrics,
      checkpoint,
      planQueryCount: checkpoint.queries.length,
      queryBatchesProcessed,
    };
  } catch (error) {
    if (error instanceof ScanCheckpointPauseError) {
      throw error;
    }

    if (isDeadlineOrTimeoutError(error) || isAbortError(error)) {
      await pauseIfPending();
    }

    if (error instanceof Error) {
      (error as Error & { checkpoint?: ScanCheckpoint }).checkpoint = checkpoint;
    }
    throw error;
  }
}
