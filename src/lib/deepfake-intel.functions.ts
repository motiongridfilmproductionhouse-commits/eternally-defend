import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isBlockedHost } from "./deepfake/queries";
import type { Database } from "@/integrations/supabase/types";
import { filterDeepfakeCandidates } from "./deepfake/filter.server";
import {
  classifyPageEvidence,
  finalizeDeepfakeFinding,
  isClientVisibleClassification,
  shouldAnalyzeMedia,
  shouldPersistFinding,
  type FindingClassification,
} from "./deepfake/page-evidence.server";
import { isUrlVerified } from "./deepfake/url-verification.server";
import {
  filterClientDiscoveries,
  filterClientFindings,
} from "./deepfake/client-results.server";
import { generateDeepfakeQueries } from "./deepfake/query-generator.server";
import {
  buildExecutedQueryPlan,
  mergeDiscoveredCandidates,
} from "./deepfake/discovery-plan.server";
import {
  assertNotAborted,
  createScanRuntime,
  isAbortError,
  leaseExpiresAtIso,
  ScanDeadlineError,
} from "./deepfake/scan-runtime.server";
import {
  createDiscoveryFunnelMetrics,
  createScanRunToken,
  decideTerminalStatus,
  finalizeScanStatus,
  hasValidScanProgress,
  recoverExpiredScanLease,
  recoverExpiredScansForUser,
  touchScanProgress,
  type DiscoveryFunnelMetrics,
  type ScanOwnership,
  type TerminalScanStatus,
} from "./deepfake/scan-ownership.server";
import {
  findActiveScanForIdentity,
  isUniqueViolation,
} from "./deepfake/scan-concurrency.server";
import {
  findingPersistKey,
  upsertDiscoveriesBatch,
  upsertFindingsBatch,
} from "./deepfake/scan-persist.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

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
  classification_status?:
    | "completed"
    | "no_media"
    | "provider_error"
    | "failed";
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
};

type RiskCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
};

const EMPTY_VERIFICATION_METRICS: VerificationMetrics = {
  crawl_succeeded: 0,
  crawl_failed: 0,
  identity_rejected: 0,
  page_type_rejected: 0,
  url_rejected: 0,
};

const MEDIA_PROCESS_BATCH_SIZE = 12;

function alreadyRunningError(scanId: string): Error {
  return new Error(
    `A scan is already running for this identity (scan_id: ${scanId})`,
  );
}

function syncVerificationMetrics(
  metrics: DiscoveryFunnelMetrics,
  primary: VerificationMetrics,
  related: VerificationMetrics,
) {
  metrics.crawl_succeeded =
    primary.crawl_succeeded + related.crawl_succeeded;
  metrics.crawl_failed = primary.crawl_failed + related.crawl_failed;
  metrics.identity_rejected =
    primary.identity_rejected + related.identity_rejected;
  metrics.page_type_rejected =
    primary.page_type_rejected + related.page_type_rejected;
  metrics.url_rejected = primary.url_rejected + related.url_rejected;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function findingRowFromClassification(input: {
  scanId: string;
  userId: string;
  finding: FinalizedFinding;
  hostOf: (url: string) => string | null;
}): Record<string, unknown> {
  const { finding, hostOf, scanId, userId } = input;
  const pageUrl =
    finding.final_url ?? finding.evidence_page_url ?? finding.url;

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

function isDeadlineAbort(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof ScanDeadlineError) return true;
  if (signal.reason instanceof ScanDeadlineError) return true;
  return (
    isAbortError(error) &&
    signal.aborted &&
    signal.reason instanceof ScanDeadlineError
  );
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
    const hostOf = (url: string): string | null => {
      try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return null;
      }
    };
    const canonicalUrl = (url: string): string => {
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
    };

    const runtime = createScanRuntime();
    const scanRunToken = createScanRunToken();
    const metrics = createDiscoveryFunnelMetrics();
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
      throw alreadyRunningError(activeScan.id);
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
          throw alreadyRunningError(concurrent.id);
        }
      }
      throw new Error(sErr?.message ?? "failed to create scan");
    }

    const ownership: ScanOwnership = {
      scanId: scan.id,
      scanRunToken,
      runtime,
    };

    let planQueryCount = 0;
    let discoveredResults = 0;
    let discoveryCount = 0;
    let clientVisibleCount = 0;
    let pipelineError: unknown = null;
    let pipelineCompleted = false;
    let terminalStatus: TerminalScanStatus = "failed";
    let terminalReason: string | null = null;
    const riskCounts: RiskCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    const persistedDiscoveryKeys = new Set<string>();
    const persistedFindingKeys = new Set<string>();
    const countedFindingKeys = new Set<string>();

    const heartbeat = async (patch?: Record<string, unknown>) => {
      assertNotAborted(runtime.signal);
      await touchScanProgress({
        supabase,
        ownership,
        patch: {
          discovery_metrics: metrics,
          ...patch,
        },
      });
      assertNotAborted(runtime.signal);
    };

    const updateFindingMetrics = (items: FinalizedFinding[]) => {
      for (const item of items) {
        const key = findingPersistKey(item as any);
        if (!key || countedFindingKeys.has(key)) continue;
        countedFindingKeys.add(key);

        discoveredResults++;

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

    try {
      assertNotAborted(runtime.signal);

      const generatedQueries = generateDeepfakeQueries(
        {
          name: data.target_name,
          aliases,
          handles,
        },
        {
          maxQueries: data.max_queries ?? 56,
        },
      );
      metrics.queries_generated = generatedQueries.length;

      let importedQueries: string[] = [];

      if (data.google_images_url) {
        const { parseGoogleImagesUrl, createImportedImageQueries } =
          await import("./deepfake/google-images-import.server");

        const imported = parseGoogleImagesUrl(data.google_images_url);

        importedQueries = createImportedImageQueries(imported.query);
      }

      /*
       * Imported Google search terms are placed first.
       * Google itself is not scraped. Existing Firecrawl search
       * discovers the public source pages for these terms.
       */
      const plan = {
        queries: buildExecutedQueryPlan({
          importedQueries,
          generatedQueries,
          maxQueries: data.max_queries ?? 56,
        }),
      };
      metrics.queries_generated = plan.queries.length;
      planQueryCount = plan.queries.length;

      await heartbeat({
        total_queries: planQueryCount,
      });

      const { firecrawlSearch, searchQueriesWithBoundedConcurrency } =
        await import("./deepfake/firecrawl.server");
      const { isFirecrawlConfigured } = await import(
        "./firecrawl-client.server"
      );
      const perQuery = data.per_query_limit ?? 20;
      const CONCURRENCY = 3;
      const allHits: ProviderHit[] = [];
      const providerHits: ProviderHit[] = [];

      if (isFirecrawlConfigured()) {
        const firecrawlResults = await searchQueriesWithBoundedConcurrency(
          plan.queries,
          {
            concurrency: CONCURRENCY,
            provider: "firecrawl",
            search: (query) =>
              firecrawlSearch(query, perQuery, {
                signal: runtime.signal,
                softDeadlineMs: runtime.softDeadlineMs,
              }),
            signal: runtime.signal,
            onBatchComplete: async (info) => {
              metrics.queries_executed = info.queriesExecuted;
              metrics.provider_candidates =
                providerHits.length + info.hitsSoFar;
              await heartbeat({
                total_queries: planQueryCount,
              });
            },
          },
        );

        metrics.queries_executed = firecrawlResults.queriesExecuted;
        metrics.query_failures += firecrawlResults.failures.length;
        metrics.provider_failures += firecrawlResults.failures.length;

        for (const failure of firecrawlResults.failures.slice(0, 10)) {
          console.warn("[DEEPFAKE] Search query failed:", failure);
        }

        providerHits.push(...firecrawlResults.hits);
      } else {
        console.warn(
          "[DEEPFAKE] Firecrawl is not configured; skipping Firecrawl search provider.",
        );
      }

      await heartbeat();

      try {
        assertNotAborted(runtime.signal);
        const { searchRecentYouTubeMentions } = await import(
          "./deepfake/youtube-discovery.server"
        );
        providerHits.push(
          ...(await searchRecentYouTubeMentions({
            name: data.target_name,
            aliases,
            handles,
            maxResults: 40,
            pages: 2,
            signal: runtime.signal,
            softDeadlineMs: runtime.softDeadlineMs,
          })),
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        metrics.provider_failures++;
        console.warn("[DEEPFAKE] YouTube discovery failed:", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await heartbeat();

      try {
        assertNotAborted(runtime.signal);
        const { searchRecentRedditMentions } = await import(
          "./deepfake/reddit-discovery.server"
        );
        providerHits.push(
          ...(await searchRecentRedditMentions({
            name: data.target_name,
            aliases,
            handles,
            maxResults: 60,
            pages: 2,
            signal: runtime.signal,
            softDeadlineMs: runtime.softDeadlineMs,
          })),
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        metrics.provider_failures++;
        console.warn("[DEEPFAKE] Reddit discovery failed:", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      metrics.provider_candidates = providerHits.length;

      const crawlEligibleHits: ProviderHit[] = [];
      for (const h of providerHits) {
        const host = h.url ? hostOf(h.url) : null;
        const imageHost =
          typeof h.image_url === "string" ? hostOf(h.image_url) : null;
        const thumbnailHost =
          typeof h.thumbnail_url === "string" ? hostOf(h.thumbnail_url) : null;
        const explicitProviderResult =
          h.source === "youtube_api" || h.source === "reddit_api";
        const hasAnyUsableUrl =
          host !== null || imageHost !== null || thumbnailHost !== null;
        if (
          !hasAnyUsableUrl ||
          (!explicitProviderResult &&
            ((host !== null && isBlockedHost(host)) ||
              (imageHost !== null && isBlockedHost(imageHost)) ||
              (thumbnailHost !== null && isBlockedHost(thumbnailHost))))
        ) {
          continue;
        }

        crawlEligibleHits.push(h);
      }

      allHits.push(
        ...mergeDiscoveredCandidates(crawlEligibleHits, {
          defaultQuery: data.target_name,
        }),
      );

      metrics.unique_candidates = allHits.length;
      await heartbeat();

      if (allHits.length) {
        const candidateFilter = filterDeepfakeCandidates(allHits, target);

        console.log("[DEEPFAKE] Candidate filter:", {
          accepted: candidateFilter.accepted.length,
          triage: candidateFilter.triage.length,
          rejected: candidateFilter.rejected.length,
        });

        console.log(
          "[DEEPFAKE] Rejected candidate sample:",
          candidateFilter.rejected.slice(0, 5).map((item) => ({
            url: item.url,
            score: item.content_match_score,
            reason: item.rejection_reason,
          })),
        );

        /*
         * Candidates awaiting URL verification. Discoveries are written only
         * after URL_VERIFIED so clients never see search/homepage/broken links.
         */
        const pagesToInspect = [
          ...candidateFilter.accepted,
          ...candidateFilter.triage.filter((item) =>
            (item.threat_signals ?? []).some((signal) =>
              [
                "nude",
                "pornographic",
                "sexual-content",
                "leaked-intimate-media",
                "undressing",
                "deepfake",
                "ai-nude",
                "morphed-media",
                "synthetic-media",
              ].includes(signal),
            ),
          ),
        ];

        const { verifyCandidateUrls } = await import(
          "./deepfake/url-verification.server"
        );
        let primaryVerificationMetrics = { ...EMPTY_VERIFICATION_METRICS };
        let relatedVerificationMetrics = { ...EMPTY_VERIFICATION_METRICS };

        /*
         * Follow redirects, crawl the final canonical URL, and keep only
         * URL_VERIFIED exact content pages that match the selected identity.
         * Search titles/snippets are never used as page evidence.
         */
        const urlVerification = await verifyCandidateUrls(
          pagesToInspect.map((hit) => ({
            url: hit.url,
            title: hit.title,
            description: hit.description,
            query: hit.query,
            source: (hit as { source?: string }).source,
            image_url: (hit as { image_url?: string }).image_url,
            thumbnail_url: (hit as { thumbnail_url?: string }).thumbnail_url,
            media_url: (hit as { media_url?: string }).media_url,
            content_match_score: hit.content_match_score,
            threat_signals: hit.threat_signals,
          })),
          target,
          {
            maxPages: 160,
            signal: runtime.signal,
            softDeadlineMs: runtime.softDeadlineMs,
            onBatchComplete: async (info) => {
              primaryVerificationMetrics = info.metrics;
              syncVerificationMetrics(
                metrics,
                primaryVerificationMetrics,
                relatedVerificationMetrics,
              );
              discoveryCount += await upsertDiscoveriesBatch({
                supabase,
                userId,
                scanId: scan.id,
                targetName: data.target_name,
                hostOf,
                rows: info.verifiedBatch,
                alreadyPersisted: persistedDiscoveryKeys,
              });
              await heartbeat({
                total_results: clientVisibleCount,
              });
            },
          },
        );

        primaryVerificationMetrics = urlVerification.metrics;
        syncVerificationMetrics(
          metrics,
          primaryVerificationMetrics,
          relatedVerificationMetrics,
        );

        const verifiedCanonical = new Set(
          urlVerification.verified.map((hit) => hit.canonical_url),
        );
        const relatedLinks = new Map<
          string,
          {
            url: string;
            title?: string;
            description?: string;
            query: string;
            source?: string;
          }
        >();

        for (const hit of urlVerification.verified as VerifiedCandidate[]) {
          const sourceHost = hostOf(hit.final_url);
          for (const link of hit.related_links ?? []) {
            const linkHost = hostOf(link);
            if (!sourceHost || linkHost !== sourceHost) continue;
            if (verifiedCanonical.has(canonicalUrl(link))) continue;

            relatedLinks.set(link, {
              url: link,
              title: hit.page_title ?? hit.title,
              description: hit.page_description ?? hit.description,
              query: hit.query,
              source: "validated_domain_link",
            });
          }
        }

        let relatedVerification:
          | Awaited<ReturnType<typeof verifyCandidateUrls>>
          | null = null;

        if (relatedLinks.size) {
          assertNotAborted(runtime.signal);
          relatedVerification = await verifyCandidateUrls(
            Array.from(relatedLinks.values()),
            target,
            {
              maxPages: 60,
              signal: runtime.signal,
              softDeadlineMs: runtime.softDeadlineMs,
              onBatchComplete: async (info) => {
                relatedVerificationMetrics = info.metrics;
                syncVerificationMetrics(
                  metrics,
                  primaryVerificationMetrics,
                  relatedVerificationMetrics,
                );
                discoveryCount += await upsertDiscoveriesBatch({
                  supabase,
                  userId,
                  scanId: scan.id,
                  targetName: data.target_name,
                  hostOf,
                  rows: info.verifiedBatch,
                  alreadyPersisted: persistedDiscoveryKeys,
                });
                await heartbeat({
                  total_results: clientVisibleCount,
                });
              },
            },
          );

          relatedVerificationMetrics = relatedVerification.metrics;
          syncVerificationMetrics(
            metrics,
            primaryVerificationMetrics,
            relatedVerificationMetrics,
          );
        }

        const mediaCandidates = [
          ...(urlVerification.verified as VerifiedCandidate[]),
          ...((relatedVerification?.verified ?? []) as VerifiedCandidate[]),
        ];

        if (mediaCandidates.length) {
          discoveryCount += await upsertDiscoveriesBatch({
            supabase,
            userId,
            scanId: scan.id,
            targetName: data.target_name,
            hostOf,
            rows: mediaCandidates,
            alreadyPersisted: persistedDiscoveryKeys,
          });
          await heartbeat({
            total_results: clientVisibleCount,
          });
        }

        /*
         * Inspect each URL-verified crawled page before media classification.
         * Use crawled title/description/content only — never search snippets.
         */
        const inspectedCandidates = mediaCandidates.map((hit) => {
          const pageUrl = hit.final_url ?? hit.evidence_page_url ?? hit.url;
          const preEvidence = classifyPageEvidence({
            url: pageUrl,
            title: hit.page_title ?? hit.title,
            description: hit.page_description ?? hit.description,
            page_text: hit.page_text,
            page_inspected: hit.page_inspected,
            query: hit.query,
            target,
            target_face_match: (hit as any).target_face_match,
            face_similarity: (hit as any).face_similarity,
          });

          return {
            ...hit,
            page_inspected: hit.page_inspected ?? false,
            page_type: preEvidence.page_type,
            identity_confidence: preEvidence.identity_confidence,
            synthetic_media_confidence:
              preEvidence.synthetic_media_confidence,
            matched_evidence: preEvidence.matched_evidence,
            finding_classification: preEvidence.finding_classification,
            classification_explanation: preEvidence.classification_explanation,
            url_verification_status: hit.url_verification_status,
            discovered_url: hit.discovered_url,
            final_url: hit.final_url,
            canonical_url: hit.canonical_url,
            http_status: hit.http_status,
            redirect_chain: hit.redirect_chain,
            crawled_at: hit.crawled_at,
            verified_domain: hit.verified_domain,
            _pre_evidence: preEvidence,
          };
        });

        for (const inspectedBatch of chunkArray(
          inspectedCandidates,
          MEDIA_PROCESS_BATCH_SIZE,
        )) {
          assertNotAborted(runtime.signal);
          await heartbeat({
            total_results: clientVisibleCount,
          });

          const analyzableCandidates = inspectedBatch.filter((hit) =>
            shouldAnalyzeMedia(hit._pre_evidence, {
              page_inspected: hit.page_inspected,
              page_text: hit.page_text,
            }),
          );

          let hiveCandidates: Array<(typeof analyzableCandidates)[number]> =
            analyzableCandidates;

          /*
           * When a face profile is selected, only media containing the
           * enrolled target identity may continue to Hive.
           */
          if (data.profile_id && analyzableCandidates.length) {
            const { filterCandidatesByTargetFace } = await import(
              "./deepfake/face-filter.server"
            );

            const faceResults = await filterCandidatesByTargetFace({
              supabase,
              userId,
              profileId: data.profile_id,
              candidates: analyzableCandidates,
              similarityThreshold: 88,
              signal: runtime.signal,
              softDeadlineMs: runtime.softDeadlineMs,
            });

            /*
             * Keep verified face matches. Preserve synthetic-signal pages
             * when face verification cannot run due to missing media, so
             * page-evidence can still classify them as probable/unverified.
             */
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
          }

          console.log("[DEEPFAKE] Hive input:", {
            acceptedPages: candidateFilter.accepted.length,
            inspectedPages: inspectedBatch.length,
            analyzablePages: analyzableCandidates.length,
            mediaCandidates: mediaCandidates.length,
            faceProfileEnabled: Boolean(data.profile_id),
            hiveCandidates: hiveCandidates.length,
            directMedia: hiveCandidates.filter((item) =>
              Boolean(item.media_url || item.image_url),
            ).length,
          });

          const { classifyHitsWithHive } = await import(
            "./deepfake/hive.server"
          );

          const hiveResults = hiveCandidates.length
            ? await classifyHitsWithHive(hiveCandidates, {
                signal: runtime.signal,
                softDeadlineMs: runtime.softDeadlineMs,
              })
            : [];

          const hiveUsable = hiveResults.some(
            (item) => item.classification_status === "completed",
          );

          let mediaClassified: Array<
            Awaited<ReturnType<typeof classifyHitsWithHive>>[number]
          > = hiveResults;

          /*
           * When the media classifier is unavailable, use cautious text
           * triage only for pages that already passed page-evidence gates.
           * Results still go through finalizeDeepfakeFinding before save.
           */
          if (!hiveUsable && hiveCandidates.length) {
            const { classifyHits } = await import(
              "./deepfake/classify.server"
            );

            const textPool = hiveCandidates.slice(0, 40);

            try {
              const textResults = await classifyHits(
                textPool.map((item) => ({
                  url: item.evidence_page_url ?? item.url,
                  title: item.title,
                  description: item.description,
                  query: item.query,
                })),
                target,
                { signal: runtime.signal },
              );

              mediaClassified = textResults.map((item, index) => ({
                ...textPool[index],
                ...item,
                content_match_score:
                  (textPool[index] as any)?.content_match_score ?? 0,
                classification_status: "completed" as const,
                visibility: "triage" as const,
                ai_reasoning:
                  `${item.ai_reasoning} (Text-only triage: media analysis unavailable.)`.trim(),
              }));

              console.log("[DEEPFAKE] Text-classifier fallback:", {
                classified: mediaClassified.length,
              });
            } catch (fallbackError) {
              if (isAbortError(fallbackError)) throw fallbackError;
              console.warn(
                "[DEEPFAKE] Text-classifier fallback failed:",
                fallbackError instanceof Error
                  ? fallbackError.message
                  : String(fallbackError),
              );
            }
          }

          const mediaByPage = new Map<
            string,
            (typeof mediaClassified)[number]
          >();
          for (const item of mediaClassified) {
            const pageUrl = (item as any).evidence_page_url ?? item.url;
            const existing = mediaByPage.get(pageUrl);
            if (
              !existing ||
              (item.confidence ?? 0) > (existing.confidence ?? 0)
            ) {
              mediaByPage.set(pageUrl, item);
            }
          }

          /*
           * Finalize every URL-verified crawled page with identity + synthetic
           * evidence. Search snippets are never used. Only URL_VERIFIED +
           * VERIFIED/PROBABLE deepfakes are client-visible.
           */
          const finalized = inspectedBatch.map((hit) => {
            const pageUrl = hit.final_url ?? hit.evidence_page_url ?? hit.url;
            const media =
              mediaByPage.get(pageUrl) ??
              mediaByPage.get(hit.evidence_page_url ?? "") ??
              mediaByPage.get(hit.url);

            const crawledTitle = hit.page_title ?? media?.title ?? null;
            const crawledDescription =
              hit.page_description ?? media?.description ?? null;

            const finalizedFields = finalizeDeepfakeFinding({
              url: pageUrl,
              title: crawledTitle,
              description: crawledDescription,
              page_text: hit.page_text,
              page_inspected: hit.page_inspected,
              query: hit.query,
              target,
              hive_deepfake_score:
                (media as any)?.hive_deepfake_score ?? null,
              hive_ai_generated_score:
                (media as any)?.hive_ai_generated_score ?? null,
              target_face_match:
                (media as any)?.target_face_match ??
                (hit as any).target_face_match ??
                null,
              face_similarity:
                (media as any)?.face_similarity ??
                (hit as any).face_similarity ??
                null,
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
              classification_status:
                media?.classification_status ?? "no_media",
              target_face_match:
                (media as any)?.target_face_match ??
                (hit as any).target_face_match ??
                false,
              face_similarity:
                (media as any)?.face_similarity ??
                (hit as any).face_similarity ??
                null,
              matched_face_id:
                (media as any)?.matched_face_id ??
                (hit as any).matched_face_id ??
                null,
              hive_deepfake_score: (media as any)?.hive_deepfake_score,
              hive_ai_generated_score:
                (media as any)?.hive_ai_generated_score,
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
            const key =
              item.canonical_url ?? item.evidence_page_url ?? item.url;
            const existing = dedupedFinalized.get(key);
            if (
              !existing ||
              (item.confidence ?? 0) > (existing.confidence ?? 0)
            ) {
              dedupedFinalized.set(key, item);
            }
          }

          const classified = Array.from(dedupedFinalized.values()).filter(
            (item) =>
              isUrlVerified(item.url_verification_status) &&
              shouldPersistFinding(
                item.finding_classification as FindingClassification,
              ),
          );

          if (classified.length) {
            console.log(
              "[FINAL CLASSIFIED RESULTS]",
              classified.map((c) => ({
                title: c.title,
                risk: c.risk_level,
                category: c.content_category,
                confidence: c.confidence,
                status: c.classification_status,
                reasoning: c.ai_reasoning,
              })),
            );
          }

          updateFindingMetrics(classified);

          const rows = classified.map((finding) =>
            findingRowFromClassification({
              scanId: scan.id,
              userId,
              finding,
              hostOf,
            }),
          );

          await upsertFindingsBatch({
            supabase,
            rows,
            alreadyPersisted: persistedFindingKeys,
          });

          console.log("[DEEPFAKE] Result routing:", {
            metrics,
            urlVerified: urlVerification.verified.length,
            urlRejected:
              urlVerification.rejected.length +
              (relatedVerification?.rejected.length ?? 0),
            inspected: inspectedBatch.length,
            persisted: discoveredResults,
            clientVisible: clientVisibleCount,
            unverifiedLeads: metrics.unverified,
            rejected: candidateFilter.rejected.length,
            classifications: classified.map((item) => ({
              url: item.url,
              final_url: item.final_url,
              classification: item.finding_classification,
              page_type: item.page_type,
              identity: item.identity_confidence,
              synthetic: item.synthetic_media_confidence,
            })),
          });

          await heartbeat({
            total_results: clientVisibleCount,
            critical_count: riskCounts.critical,
            high_count: riskCounts.high,
            medium_count: riskCounts.medium,
            low_count: riskCounts.low,
          });

          /*
           * Preserve exact page/media URLs, metadata and SHA-256 hashes
           * for review and takedown preparation.
           * Only client-visible deepfake findings are sealed as evidence.
           */
          const evidenceCandidates = classified.filter(
            (item) =>
              isClientVisibleClassification(item.finding_classification) &&
              isUrlVerified(item.url_verification_status),
          );

          if (evidenceCandidates.length) {
            try {
              const { captureAndStoreEvidence } = await import(
                "./deepfake/evidence-capture.server"
              );

              const evidenceResult = await captureAndStoreEvidence({
                supabase,
                userId,
                scanId: scan.id,
                candidates: evidenceCandidates as any[],
                signal: runtime.signal,
                softDeadlineMs: runtime.softDeadlineMs,
              });

              console.log(
                "[DEEPFAKE:EVIDENCE] Capture summary:",
                evidenceResult,
              );
            } catch (evidenceError) {
              if (isAbortError(evidenceError)) throw evidenceError;
              /*
               * Evidence failure must not destroy the scan or findings.
               */
              console.warn(
                "[DEEPFAKE:EVIDENCE] Capture failed:",
                evidenceError instanceof Error
                  ? evidenceError.message
                  : String(evidenceError),
              );
            }

            await heartbeat({
              total_results: clientVisibleCount,
            });
          }
        }
      }

      pipelineCompleted = true;
      terminalStatus = "completed";
    } catch (error) {
      pipelineError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[DEEPFAKE] Scan stopped before full completion:", {
        scan_id: scan.id,
        error: message,
      });
    } finally {
      const errorMessage =
        pipelineError instanceof Error
          ? pipelineError.message
          : pipelineError
            ? String(pipelineError)
            : null;
      const deadlineAbort = isDeadlineAbort(pipelineError, runtime.signal);
      const validProgress = hasValidScanProgress({
        metrics,
        discoveryCount,
        findingCount: discoveredResults,
        clientVisibleCount,
      });
      const decision = pipelineCompleted
        ? { status: "completed" as TerminalScanStatus, reason: null }
        : decideTerminalStatus({
            abortedByDeadline: deadlineAbort,
            hasValidProgress: validProgress,
            errorMessage:
              errorMessage ??
              (runtime.signal.aborted
                ? "Scan was aborted before completion."
                : null),
          });

      terminalStatus = decision.status;
      terminalReason = decision.reason;

      const finalPatch = {
        total_queries: planQueryCount,
        total_results: clientVisibleCount,
        critical_count: riskCounts.critical,
        high_count: riskCounts.high,
        medium_count: riskCounts.medium,
        low_count: riskCounts.low,
        discovery_metrics: metrics,
      };

      await finalizeScanStatus({
        supabase,
        ownership,
        status: terminalStatus,
        patch: finalPatch,
        errorMessage: terminalReason,
      });
    }

    return {
      scan_id: scan.id,
      total_results: clientVisibleCount,
      discovered_results: discoveredResults,
      status: terminalStatus,
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

    if (scanRes.error) {
      throw new Error(scanRes.error.message);
    }

    if (findingsRes.error) {
      throw new Error(findingsRes.error.message);
    }

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

    /*
     * Server-side client filter scoped to this scan_id + selected target:
     * URL_VERIFIED + VERIFIED/PROBABLE only. UNVERIFIED_LEAD / URL_REJECTED
     * / off-target identities never appear in history or polling responses.
     */
    const findings = filterClientFindings(
      allFindings,
      target,
      data.scan_id,
    ).sort(
      (a, b) =>
        (riskRank[b.risk_level] ?? 0) - (riskRank[a.risk_level] ?? 0) ||
        b.confidence - a.confidence,
    );

    /*
     * Latest Public Leads: URL-verified + selected-target only.
     * Raw Firecrawl rows (analysis_status=discovered) cannot reach the UI.
     */
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
