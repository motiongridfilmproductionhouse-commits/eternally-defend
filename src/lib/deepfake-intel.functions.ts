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
  generateDeepfakeQueries,
} from "./deepfake/query-generator.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

/** Kick off a deepfake intelligence scan. Runs synchronously and returns the scan id. */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    target_name: z.string().trim().min(1).max(200),
    profile_id: z.string().uuid().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    handles: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
    google_images_url: z.string().trim().max(5000).optional(),
    max_queries: z.number().int().min(1).max(40).optional(),
    per_query_limit: z.number().int().min(1).max(10).optional(),
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

    // 1. create scan row
    const { data: scan, error: sErr } = await supabase
      .from("deepfake_scans")
      .insert({
        user_id: userId,
        target_name: data.target_name,
        aliases: data.aliases ?? [],
        handles: data.handles ?? [],
        status: "running",
      })
      .select("*")
      .single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "failed to create scan");
try {
    const generatedQueries = generateDeepfakeQueries({
      name: data.target_name,
      aliases: data.aliases ?? [],
      handles: data.handles ?? [],
    });

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
    const combinedQueries = [
      ...importedQueries,
      ...generatedQueries,
    ];

    const uniqueQueries = Array.from(
      new Set(
        combinedQueries
          .map((query) => query.trim())
          .filter(Boolean),
      ),
    );

    const plan = {
       queries: uniqueQueries.slice(
        0,
         data.max_queries ?? 28,
      ),
    };

      // 2. Firecrawl searches (bounded concurrency)
      const { firecrawlSearch } = await import("./deepfake/firecrawl.server");
      const perQuery = data.per_query_limit ?? 10;
      const CONCURRENCY = 2;
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
      const seenUrl = new Set<string>();

      for (let i = 0; i < plan.queries.length; i += CONCURRENCY) {
        const batch = plan.queries.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (q) => {
            try {
              return await firecrawlSearch(q, perQuery);
            } catch (error) {
              console.warn("[DEEPFAKE] Search query skipped:", {
                query: q,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              });
              return [];
            }
          }),
        );

        for (const arr of results) {
          for (const h of arr) {
            if (!h.url) continue;
            const host = hostOf(h.url);
            const imageHost = h.image_url ? hostOf(h.image_url) : null;
            const thumbnailHost = h.thumbnail_url ? hostOf(h.thumbnail_url) : null;
            if (
              !host ||
              isBlockedHost(host) ||
              (imageHost !== null && isBlockedHost(imageHost)) ||
              (thumbnailHost !== null && isBlockedHost(thumbnailHost))
            ) continue;
            const canonical = canonicalUrl(h.url);
            if (seenUrl.has(canonical)) continue;
            seenUrl.add(canonical);

            allHits.push({
              ...h,
              url: canonical,
              query:
                typeof h.query === "string" && h.query.trim()
                  ? h.query.trim()
                  : batch[0] ?? data.target_name,
            });
          }
        }
      }

      // 3. pre-filter and classify
      let classified: Awaited<ReturnType<typeof import("./deepfake/classify.server").classifyHits>> = [];

      if (allHits.length) {
        const target = {
          name: data.target_name,
          aliases: data.aliases ?? [],
          handles: data.handles ?? [],
        };

        const candidateFilter = filterDeepfakeCandidates(allHits, target);

        /* Only high-signal synthetic/explicit pages belong in Deepfake Intel. */
        if (candidateFilter.accepted.length) {
          const discoveryRows = candidateFilter.accepted.map((hit) => ({
            user_id: userId,
            scan_id: scan.id,
            source: (hit as any).source ?? "firecrawl",
            search_query: hit.query?.trim() || data.target_name,
            page_url: hit.url,
            canonical_url: canonicalUrl(hit.url),
            source_host: hostOf(hit.url),
            page_title: hit.title ?? null,
            snippet: hit.description ?? null,
            image_url: (hit as any).image_url ?? null,
            thumbnail_url: (hit as any).thumbnail_url ?? null,
            media_type:
              (hit as any).image_url || (hit as any).thumbnail_url ? "image" : null,
            analysis_status: "discovered",
            updated_at: new Date().toISOString(),
          }));

          const { error: discoveryError } = await (supabase as any)
            .from("deepfake_discoveries")
            .upsert(discoveryRows, { onConflict: "scan_id,page_url" });

          if (discoveryError) {
            throw new Error(`Unable to store discovered URLs: ${discoveryError.message}`);
          }
        }

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

        const { enrichHitsWithMedia } =
          await import("./deepfake/media-discovery.server");

        /*
         * Crawl/inspect accepted pages and explicit triage leads before
         * classification. Listing/name-only false positives are filtered
         * using exact-page evidence rather than search snippets alone.
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

        const mediaCandidates = await enrichHitsWithMedia(
          pagesToInspect,
          60,
        );

        /*
         * Inspect each crawled page before media classification.
         * Exclude search/tag/category/listing pages and name-only mentions.
         */
        const inspectedCandidates = mediaCandidates.map((hit) => {
          const pageUrl = hit.evidence_page_url ?? hit.url;
          const preEvidence = classifyPageEvidence({
            url: pageUrl,
            title: hit.title,
            description: hit.description,
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
         * Finalize every inspected page with identity + synthetic evidence.
         * Only VERIFIED_DEEPFAKE / PROBABLE_DEEPFAKE are client-visible;
         * UNVERIFIED_LEAD is persisted for internal human review.
         */
        const finalized = inspectedCandidates.map((hit) => {
          const pageUrl = hit.evidence_page_url ?? hit.url;
          const media = mediaByPage.get(pageUrl);

          const finalizedFields = finalizeDeepfakeFinding({
            url: pageUrl,
            title: media?.title ?? hit.title,
            description: media?.description ?? hit.description,
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
            title: media?.title ?? hit.title,
            description: media?.description ?? hit.description,
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
            ...finalizedFields,
          };
        });

        const reputationLeads = candidateFilter.triage
          .filter((item) =>
            (item.threat_signals ?? []).some((signal) =>
              ["defamation", "harassment"].includes(signal),
            ),
          )
          .map((item) => {
            const finalizedFields = finalizeDeepfakeFinding({
              url: item.url,
              title: item.title,
              description: item.description,
              page_text: `${item.title ?? ""} ${item.description ?? ""}`,
              query: item.query,
              target,
              existing_reasoning:
                `The indexed content contains reputation-abuse indicators naming the protected identity. Retained as an unverified lead for human review.`,
              existing_confidence: 40,
            });

            return {
              ...item,
              evidence_page_url: item.url,
              ...finalizedFields,
              finding_classification:
                "UNVERIFIED_LEAD" as FindingClassification,
              client_visible: false,
              visibility: "triage" as const,
              content_category: "unverified_lead",
              risk_level: "MEDIUM" as const,
            };
          });

        const dedupedFinalized = new Map<string, (typeof finalized)[number]>();
        for (const item of [...finalized, ...reputationLeads]) {
          const key = item.evidence_page_url ?? item.url;
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
            shouldPersistFinding(
              item.finding_classification as FindingClassification,
            ),
        );

        console.log("[DEEPFAKE] Result routing:", {
          inspected: inspectedCandidates.length,
          persisted: classified.length,
          clientVisible: classified.filter((item) =>
            isClientVisibleClassification(item.finding_classification),
          ).length,
          unverifiedLeads: classified.filter(
            (item) => item.finding_classification === "UNVERIFIED_LEAD",
          ).length,
          rejected: candidateFilter.rejected.length,
          classifications: classified.map((item) => ({
            url: item.url,
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
          const pageUrl = (c as any).evidence_page_url ?? c.url;
          const clientVisible = isClientVisibleClassification(
            (c as any).finding_classification,
          );

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
            source_host: hostOf(pageUrl),
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
          };
        });
        /*
         * Migration-safe write: try the evidence columns first, then
         * fall back to legacy columns if the migration is not applied yet.
         */
        const { error: fErr } = await supabase
          .from("deepfake_findings")
          .upsert(rows as any, { onConflict: "scan_id,url" });

        if (fErr) {
          const missingEvidenceColumn =
            /finding_classification|page_type|identity_confidence|synthetic_media_confidence|matched_evidence|classification_explanation|column .* does not exist|schema cache/i.test(
              fErr.message,
            );

          if (missingEvidenceColumn) {
            const legacyRows = rows.map((row) => {
              const {
                finding_classification: _fc,
                page_type: _pt,
                identity_confidence: _ic,
                synthetic_media_confidence: _sc,
                matched_evidence: _me,
                classification_explanation: _ce,
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
                "[deepfake] findings saved without evidence columns; apply migration 20260731182000_deepfake_finding_evidence_classification.sql",
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

      const clientVisibleCount = classified.filter((item) =>
        isClientVisibleClassification(
          (item as any).finding_classification,
        ),
      ).length;

      await supabase
        .from("deepfake_scans")
        .update({
          status: "completed",
          total_queries: plan.queries.length,
          total_results: clientVisibleCount,
          critical_count: critical,
          high_count: high,
          medium_count: medium,
          low_count: low,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scan.id);

      return {
        scan_id: scan.id,
        total_results: clientVisibleCount,
        discovered_results: classified.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      await supabase.from("deepfake_scans").update({
        status: "failed", error_message: msg.slice(0, 500), finished_at: new Date().toISOString(),
      }).eq("id", scan.id);
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

    const riskRank: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    const allFindings = (findingsRes.data ?? []) as Array<
      FindingRow & {
        finding_classification?: string | null;
      }
    >;

    /*
     * Server-side client filter: only VERIFIED_DEEPFAKE / PROBABLE_DEEPFAKE.
     * UNVERIFIED_LEAD, ADULT_NAME_MENTION and UNRELATED_ADULT_CONTENT never
     * appear in history/polling API responses. Legacy null classifications
     * remain visible for pre-migration rows.
     */
    const findings = allFindings
      .filter((finding) => {
        const classification = finding.finding_classification;
        if (!classification) return true;
        return isClientVisibleClassification(classification);
      })
      .sort(
        (a, b) =>
          (riskRank[b.risk_level] ?? 0) - (riskRank[a.risk_level] ?? 0) ||
          b.confidence - a.confidence,
      );

    return {
      scan: scanRes.data as ScanRow | null,
      findings,
      discoveries:
        discoveriesRes.data ?? [],
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
