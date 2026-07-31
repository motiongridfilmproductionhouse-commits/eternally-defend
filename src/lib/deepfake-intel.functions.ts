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
import {
  isUrlVerified,
} from "./deepfake/url-verification.server";
import {
  filterClientDiscoveries,
  filterClientFindings,
} from "./deepfake/client-results.server";
import {
  generateDeepfakeQueries,
} from "./deepfake/query-generator.server";
import {
  buildExecutedQueryPlan,
  discoveredCandidateKey,
} from "./deepfake/discovery-plan.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

type DiscoveryFunnelMetrics = {
  queries_generated: number;
  queries_executed: number;
  provider_candidates: number;
  unique_candidates: number;
  crawl_succeeded: number;
  crawl_failed: number;
  identity_rejected: number;
  page_type_rejected: number;
  url_rejected: number;
  unverified: number;
  probable: number;
  verified: number;
  client_visible: number;
  provider_failures: number;
  query_failures: number;
};

function createDiscoveryFunnelMetrics(): DiscoveryFunnelMetrics {
  return {
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
  };
}

/** Kick off a deepfake intelligence scan. Runs synchronously and returns the scan id. */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    target_name: z.string().trim().min(1).max(200),
    profile_id: z.string().uuid().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    handles: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    google_images_url: z.string().trim().max(5000).optional(),
    max_queries: z.number().int().min(40).max(60).optional(),
    per_query_limit: z.number().int().min(10).max(20).optional(),
  }).parse(input))
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

    // 1. create scan row (scoped to this target / optional face profile)
    const scanInsert: Record<string, unknown> = {
      user_id: userId,
      target_name: data.target_name,
      aliases: data.aliases ?? [],
      handles: data.handles ?? [],
      status: "running",
    };

    if (data.profile_id) {
      scanInsert.profile_id = data.profile_id;
    }

    const { data: scan, error: sErr } = await supabase
      .from("deepfake_scans")
      .insert(scanInsert as any)
      .select("*")
      .single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "failed to create scan");
    const metrics = createDiscoveryFunnelMetrics();
try {
    const generatedQueries = generateDeepfakeQueries({
      name: data.target_name,
      aliases: data.aliases ?? [],
      handles: data.handles ?? [],
    }, {
      maxQueries: data.max_queries ?? 56,
    });
    metrics.queries_generated = generatedQueries.length;

    let importedQueries: string[] = [];

    if (data.google_images_url) {
      const {
        parseGoogleImagesUrl,
        createImportedImageQueries,
      } = await import(
        "./deepfake/google-images-import.server"
      );

      const imported = parseGoogleImagesUrl(
        data.google_images_url,
      );

      importedQueries = createImportedImageQueries(
        imported.query,
      );
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

      // 2. Firecrawl searches (bounded concurrency)
      const {
        firecrawlSearch,
        searchQueriesWithBoundedConcurrency,
      } = await import("./deepfake/firecrawl.server");
      const { isFirecrawlConfigured } = await import(
        "./firecrawl-client.server"
      );
      const perQuery = data.per_query_limit ?? 20;
      const CONCURRENCY = 3;
      const allHits: Array<{
        url: string;
        title?: string;
        description?: string;
        query: string;
        source?: string;
        thumbnail_url?: string;
        image_url?: string;
        is_sensitive?: boolean;
      }> = [];
      const providerHits: typeof allHits = [];

      if (isFirecrawlConfigured()) {
        const firecrawlResults =
          await searchQueriesWithBoundedConcurrency(plan.queries, {
            concurrency: CONCURRENCY,
            provider: "firecrawl",
            search: (query) => firecrawlSearch(query, perQuery),
          });

        metrics.queries_executed += firecrawlResults.queriesExecuted;
        metrics.query_failures += firecrawlResults.failures.length;
        metrics.provider_failures += firecrawlResults.failures.length;

        for (const failure of firecrawlResults.failures.slice(0, 10)) {
          console.warn("[DEEPFAKE] Search query failed:", failure);
        }

        providerHits.push(...firecrawlResults.hits);
      } else {
        console.warn("[DEEPFAKE] Firecrawl is not configured; skipping Firecrawl search provider.");
      }

      try {
        const { searchRecentYouTubeMentions } = await import(
          "./deepfake/youtube-discovery.server"
        );
        providerHits.push(
          ...(await searchRecentYouTubeMentions({
            name: data.target_name,
            aliases: data.aliases ?? [],
            handles: data.handles ?? [],
            maxResults: 40,
            pages: 2,
          })),
        );
      } catch (error) {
        metrics.provider_failures++;
        console.warn("[DEEPFAKE] YouTube discovery failed:", {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      try {
        const { searchRecentRedditMentions } = await import(
          "./deepfake/reddit-discovery.server"
        );
        providerHits.push(
          ...(await searchRecentRedditMentions({
            name: data.target_name,
            aliases: data.aliases ?? [],
            handles: data.handles ?? [],
            maxResults: 60,
            pages: 2,
          })),
        );
      } catch (error) {
        metrics.provider_failures++;
        console.warn("[DEEPFAKE] Reddit discovery failed:", {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      metrics.provider_candidates = providerHits.length;

      const seenDiscovered = new Set<string>();
      for (const h of providerHits) {
        if (!h.url) continue;
        const host = hostOf(h.url);
        const imageHost = h.image_url ? hostOf(h.image_url) : null;
        const thumbnailHost = h.thumbnail_url ? hostOf(h.thumbnail_url) : null;
        const explicitProviderResult =
          h.source === "youtube_api" ||
          h.source === "reddit_api";
        if (
          !host ||
          (
            !explicitProviderResult &&
            (
              isBlockedHost(host) ||
              (imageHost !== null && isBlockedHost(imageHost)) ||
              (thumbnailHost !== null && isBlockedHost(thumbnailHost))
            )
          )
        ) continue;

        const key = discoveredCandidateKey(h);
        if (seenDiscovered.has(key)) continue;
        seenDiscovered.add(key);

        allHits.push({
          ...h,
          query:
            typeof h.query === "string" && h.query.trim()
              ? h.query.trim()
              : data.target_name,
        });
      }

      metrics.unique_candidates = allHits.length;

      // 3. pre-filter and classify
      let classified: Awaited<ReturnType<typeof import("./deepfake/classify.server").classifyHits>> = [];

      if (allHits.length) {
        const target = {
          name: data.target_name,
          aliases: data.aliases ?? [],
          handles: data.handles ?? [],
        };

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
          { maxPages: 160 },
        );

        metrics.crawl_succeeded +=
          urlVerification.metrics.crawl_succeeded;
        metrics.crawl_failed += urlVerification.metrics.crawl_failed;
        metrics.identity_rejected +=
          urlVerification.metrics.identity_rejected;
        metrics.page_type_rejected +=
          urlVerification.metrics.page_type_rejected;
        metrics.url_rejected += urlVerification.metrics.url_rejected;

        const verifiedCanonical = new Set(
          urlVerification.verified.map((hit) => hit.canonical_url),
        );
        const relatedLinks = new Map<string, {
          url: string;
          title?: string;
          description?: string;
          query: string;
          source?: string;
        }>();

        for (const hit of urlVerification.verified) {
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
          relatedVerification = await verifyCandidateUrls(
            Array.from(relatedLinks.values()),
            target,
            { maxPages: 60 },
          );

          metrics.crawl_succeeded +=
            relatedVerification.metrics.crawl_succeeded;
          metrics.crawl_failed +=
            relatedVerification.metrics.crawl_failed;
          metrics.identity_rejected +=
            relatedVerification.metrics.identity_rejected;
          metrics.page_type_rejected +=
            relatedVerification.metrics.page_type_rejected;
          metrics.url_rejected +=
            relatedVerification.metrics.url_rejected;
        }

        const mediaCandidates = [
          ...urlVerification.verified,
          ...(relatedVerification?.verified ?? []),
        ];

        if (mediaCandidates.length) {
          const discoveryRows = mediaCandidates
            .filter(
              (hit, index, arr) =>
                arr.findIndex(
                  (other) => other.canonical_url === hit.canonical_url,
                ) === index,
            )
            .map((hit) => ({
              user_id: userId,
              scan_id: scan.id,
              source: (hit as any).source ?? "firecrawl",
              search_query: hit.query?.trim() || data.target_name,
              page_url: hit.final_url,
              canonical_url: hit.canonical_url,
              source_host: hit.verified_domain ?? hostOf(hit.final_url),
              page_title: hit.page_title ?? null,
              snippet: hit.page_description ?? null,
              image_url: (hit as any).image_url ?? null,
              thumbnail_url: (hit as any).thumbnail_url ?? null,
              media_type:
                (hit as any).image_url || (hit as any).thumbnail_url
                  ? "image"
                  : null,
              analysis_status: "url_verified",
              updated_at: new Date().toISOString(),
            }));

          const { error: discoveryError } = await (supabase as any)
            .from("deepfake_discoveries")
            .upsert(discoveryRows, { onConflict: "scan_id,page_url" });

          if (discoveryError) {
            console.warn(
              "[DEEPFAKE] Unable to store verified discoveries:",
              discoveryError.message,
            );
          }
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
            finding_classification:
              preEvidence.finding_classification,
            classification_explanation:
              preEvidence.classification_explanation,
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

        const analyzableCandidates = inspectedCandidates.filter(
          (hit) =>
            shouldAnalyzeMedia(hit._pre_evidence, {
              page_inspected: hit.page_inspected,
              page_text: hit.page_text,
            }),
        );

        let hiveCandidates: Array<
          (typeof analyzableCandidates)[number] | {
            url: string;
            title?: string;
            description?: string;
            query: string;
            page_text?: string;
            evidence_page_url?: string;
            media_url?: string;
            image_url?: string;
            thumbnail_url?: string;
            content_match_score?: number;
            threat_signals?: string[];
            target_face_match?: boolean;
            face_similarity?: number | null;
            matched_face_id?: string | null;
            page_type?: string;
            identity_confidence?: number;
            synthetic_media_confidence?: number;
            matched_evidence?: string[];
            finding_classification?: string;
            classification_explanation?: string;
          }
        > = analyzableCandidates;

        /*
         * When a face profile is selected, only media containing the
         * enrolled target identity may continue to Hive.
         */
        if (data.profile_id) {
          const { filterCandidatesByTargetFace } =
            await import("./deepfake/face-filter.server");

          const faceResults =
            await filterCandidatesByTargetFace({
              supabase,
              userId,
              profileId: data.profile_id,
              candidates: analyzableCandidates,
              similarityThreshold: 88,
            });

          /*
           * Keep verified face matches. Preserve synthetic-signal pages
           * when face verification cannot run due to missing media, so
           * page-evidence can still classify them as probable/unverified.
           */
          const syntheticUnavailable = faceResults.errors.filter(
            (item) => {
              const text = [
                item.title ?? "",
                item.description ?? "",
                item.page_text ?? "",
                item.url ?? "",
              ].join(" ");

              return (
                /\b(?:deepfake|face\s*swap|ai\s*nude|fake\s*nude|morphed|synthetic\s*media)\b/i.test(
                  text,
                )
              );
            },
          );

          hiveCandidates = [
            ...faceResults.matched,
            ...syntheticUnavailable.map((item) => ({
              ...item,
              target_face_match: false,
              face_similarity: 0,
              matched_face_id: null,
            })),
          ];
        }

        console.log("[DEEPFAKE] Hive input:", {
          acceptedPages:
            candidateFilter.accepted.length,
          inspectedPages: inspectedCandidates.length,
          analyzablePages: analyzableCandidates.length,
          mediaCandidates:
            mediaCandidates.length,
          faceProfileEnabled:
            Boolean(data.profile_id),
          hiveCandidates:
            hiveCandidates.length,
          directMedia:
            hiveCandidates.filter(
              (item) =>
                Boolean(
                  item.media_url ||
                  item.image_url,
                ),
            ).length,
        });

        const { classifyHitsWithHive } =
          await import("./deepfake/hive.server");

        const hiveResults =
          hiveCandidates.length
            ? await classifyHitsWithHive(hiveCandidates)
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
            console.warn(
              "[DEEPFAKE] Text-classifier fallback failed:",
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError),
            );
          }
        }

        const mediaByPage = new Map<string, (typeof mediaClassified)[number]>();
        for (const item of mediaClassified) {
          const pageUrl =
            (item as any).evidence_page_url ?? item.url;
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
        const finalized = inspectedCandidates.map((hit) => {
          const pageUrl =
            hit.final_url ?? hit.evidence_page_url ?? hit.url;
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
            content_match_score:
              (hit as any).content_match_score ?? 0,
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
            hive_deepfake_score:
              (media as any)?.hive_deepfake_score,
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
          };
        });

        const dedupedFinalized = new Map<string, (typeof finalized)[number]>();
        for (const item of finalized) {
          const key =
            (item as any).canonical_url ??
            item.evidence_page_url ??
            item.url;
          const existing = dedupedFinalized.get(key);
          if (
            !existing ||
            (item.confidence ?? 0) > (existing.confidence ?? 0)
          ) {
            dedupedFinalized.set(key, item as any);
          }
        }

        classified = Array.from(dedupedFinalized.values()).filter(
          (item) =>
            isUrlVerified((item as any).url_verification_status) &&
            shouldPersistFinding(
              item.finding_classification as FindingClassification,
            ),
        );

        metrics.unverified = classified.filter(
          (item) =>
            item.finding_classification === "UNVERIFIED_LEAD",
        ).length;
        metrics.probable = classified.filter(
          (item) =>
            item.finding_classification === "PROBABLE_DEEPFAKE",
        ).length;
        metrics.verified = classified.filter(
          (item) =>
            item.finding_classification === "VERIFIED_DEEPFAKE",
        ).length;
        metrics.client_visible = classified.filter(
          (item) =>
            isClientVisibleClassification(item.finding_classification) &&
            isUrlVerified((item as any).url_verification_status),
        ).length;

        console.log("[DEEPFAKE] Result routing:", {
          metrics,
          urlVerified: urlVerification.verified.length,
          urlRejected: urlVerification.rejected.length,
          inspected: inspectedCandidates.length,
          persisted: classified.length,
          clientVisible: classified.filter(
            (item) =>
              isClientVisibleClassification(item.finding_classification) &&
              isUrlVerified((item as any).url_verification_status),
          ).length,
          unverifiedLeads: classified.filter(
            (item) => item.finding_classification === "UNVERIFIED_LEAD",
          ).length,
          rejected: candidateFilter.rejected.length,
          classifications: classified.map((item) => ({
            url: item.url,
            final_url: (item as any).final_url,
            classification: item.finding_classification,
            page_type: item.page_type,
            identity: item.identity_confidence,
            synthetic: item.synthetic_media_confidence,
          })),
        });
      }

      // 4. persist findings
      let critical = 0, high = 0, medium = 0, low = 0;
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

        const rows = classified.map((c) => {
          const pageUrl =
            (c as any).final_url ??
            (c as any).evidence_page_url ??
            c.url;
          const clientVisible =
            isClientVisibleClassification(
              (c as any).finding_classification,
            ) &&
            isUrlVerified((c as any).url_verification_status);

          /*
           * Risk counters reflect client-visible deepfake findings only.
           */
          if (clientVisible) {
            if (c.risk_level === "CRITICAL") critical++;
            else if (c.risk_level === "HIGH") high++;
            else if (c.risk_level === "MEDIUM") medium++;
            else low++;
          }

          return {
            scan_id: scan.id,
            user_id: userId,
            url: pageUrl,
            source_host:
              (c as any).verified_domain ?? hostOf(pageUrl),
            page_title: c.title ?? null,
            snippet: c.description ?? null,
            query: c.query,
            risk_level: c.risk_level,
            content_category: c.content_category,
            confidence: c.confidence,
            is_synthetic: c.is_synthetic,
            face_referenced: c.face_referenced,
            takedown_recommended: c.takedown_recommended,
            target_face_match:
              (c as any).target_face_match ?? false,
            face_similarity:
              (c as any).face_similarity ?? null,
            matched_face_id:
              (c as any).matched_face_id ?? null,
            ai_reasoning:
              (c as any).classification_explanation
                ? `${(c as any).classification_explanation}${
                    c.ai_reasoning
                      ? ` ${c.ai_reasoning}`
                      : ""
                  }`
                : c.ai_reasoning,
            finding_classification:
              (c as any).finding_classification ?? null,
            page_type: (c as any).page_type ?? null,
            identity_confidence:
              (c as any).identity_confidence ?? null,
            synthetic_media_confidence:
              (c as any).synthetic_media_confidence ?? null,
            matched_evidence:
              (c as any).matched_evidence ?? [],
            classification_explanation:
              (c as any).classification_explanation ?? null,
            discovered_url:
              (c as any).discovered_url ?? pageUrl,
            final_url: (c as any).final_url ?? pageUrl,
            canonical_url:
              (c as any).canonical_url ?? pageUrl,
            http_status: (c as any).http_status ?? null,
            redirect_chain: (c as any).redirect_chain ?? [],
            crawled_at: (c as any).crawled_at ?? null,
            url_verification_status:
              (c as any).url_verification_status ?? null,
            url_rejection_reason:
              (c as any).url_rejection_reason ?? null,
          };
        });
        /*
         * Migration-safe write: try evidence + URL verification columns,
         * then fall back by stripping unknown columns if needed.
         */
        const { error: fErr } = await supabase
          .from("deepfake_findings")
          .upsert(rows as any, { onConflict: "scan_id,url" });

        if (fErr) {
          const missingColumn =
            /finding_classification|page_type|identity_confidence|synthetic_media_confidence|matched_evidence|classification_explanation|discovered_url|final_url|canonical_url|http_status|redirect_chain|crawled_at|url_verification_status|url_rejection_reason|column .* does not exist|schema cache/i.test(
              fErr.message,
            );

          if (missingColumn) {
            const legacyRows = rows.map((row) => {
              const {
                finding_classification: _fc,
                page_type: _pt,
                identity_confidence: _ic,
                synthetic_media_confidence: _sc,
                matched_evidence: _me,
                classification_explanation: _ce,
                discovered_url: _du,
                final_url: _fu,
                canonical_url: _cu,
                http_status: _hs,
                redirect_chain: _rc,
                crawled_at: _ca,
                url_verification_status: _uv,
                url_rejection_reason: _ur,
                ...legacy
              } = row as any;
              return legacy;
            });

            const { error: legacyErr } = await supabase
              .from("deepfake_findings")
              .upsert(legacyRows as any, { onConflict: "scan_id,url" });

            if (legacyErr) {
              console.warn(
                "[deepfake] findings insert (legacy fallback):",
                legacyErr.message,
              );
            } else {
              console.warn(
                "[deepfake] findings saved without URL-verification columns; apply migration 20260731190000_deepfake_url_verification.sql",
              );
            }
          } else {
            console.warn(
              "[deepfake] findings insert:",
              fErr.message,
            );
          }
        }

        /*
         * Preserve exact page/media URLs, metadata and SHA-256 hashes
         * for review and takedown preparation.
         * Only client-visible deepfake findings are sealed as evidence.
         */
        try {
          const { captureAndStoreEvidence } =
            await import(
              "./deepfake/evidence-capture.server"
            );

          const evidenceCandidates = classified.filter((item) =>
            isClientVisibleClassification(
              (item as any).finding_classification,
            ),
          );

          const evidenceResult =
            await captureAndStoreEvidence({
              supabase,
              userId,
              scanId: scan.id,
              candidates: evidenceCandidates as any[],
            });

          console.log(
            "[DEEPFAKE:EVIDENCE] Capture summary:",
            evidenceResult,
          );
        } catch (evidenceError) {
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
      }

      const clientVisibleCount = classified.filter(
        (item) =>
          isClientVisibleClassification(
            (item as any).finding_classification,
          ) &&
          isUrlVerified((item as any).url_verification_status),
      ).length;

      metrics.client_visible = clientVisibleCount;

      const scanUpdate = {
        status: "completed",
        total_queries: plan.queries.length,
        total_results: clientVisibleCount,
        critical_count: critical,
        high_count: high,
        medium_count: medium,
        low_count: low,
        discovery_metrics: metrics,
        finished_at: new Date().toISOString(),
      };

      const { error: scanUpdateError } = await supabase
        .from("deepfake_scans")
        .update(scanUpdate as any)
        .eq("id", scan.id);

      if (scanUpdateError) {
        const missingMetricsColumn =
          /discovery_metrics|column .* does not exist|schema cache/i.test(
            scanUpdateError.message,
          );

        if (!missingMetricsColumn) {
          throw new Error(scanUpdateError.message);
        }

        const { discovery_metrics: _metrics, ...legacyScanUpdate } =
          scanUpdate;

        const { error: legacyScanUpdateError } = await supabase
          .from("deepfake_scans")
          .update(legacyScanUpdate as any)
          .eq("id", scan.id);

        if (legacyScanUpdateError) {
          throw new Error(legacyScanUpdateError.message);
        }

        console.warn(
          "[deepfake] scan saved without discovery metrics; apply migration 20260731202000_deepfake_discovery_metrics.sql",
        );
      }

      return {
        scan_id: scan.id,
        total_results: clientVisibleCount,
        discovered_results: classified.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      const failedUpdate = {
        status: "failed",
        error_message: msg.slice(0, 500),
        discovery_metrics: metrics,
        finished_at: new Date().toISOString(),
      };
      const { error: failedUpdateError } = await supabase
        .from("deepfake_scans")
        .update(failedUpdate as any)
        .eq("id", scan.id);

      if (failedUpdateError) {
        const missingMetricsColumn =
          /discovery_metrics|column .* does not exist|schema cache/i.test(
            failedUpdateError.message,
          );

        if (missingMetricsColumn) {
          const { discovery_metrics: _metrics, ...legacyFailedUpdate } =
            failedUpdate;

          await supabase
            .from("deepfake_scans")
            .update(legacyFailedUpdate as any)
            .eq("id", scan.id);
        }
      }
      throw new Error(msg);
    }
  });

export const listDeepfakeScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
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
    const [scanRes, findingsRes, discoveriesRes] =
      await Promise.all([
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
      ((discoveriesRes.data ?? []) as Array<{
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
      }>),
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
  .inputValidator((input: unknown) => z.object({
    finding_id: z.string().uuid(),
    review_status: z.enum(["new", "reviewed", "dismissed", "queued_takedown"]),
  }).parse(input))
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
      target_name: (data?.full_name ?? data?.display_name ?? data?.company_name ?? "") as string,
      aliases: [] as string[],
      handles: [] as string[],
    };
  });
