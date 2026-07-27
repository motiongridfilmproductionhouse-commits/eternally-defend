import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isBlockedHost } from "./deepfake/queries";
import type { Database } from "@/integrations/supabase/types";
import { filterDeepfakeCandidates } from "./deepfake/filter.server";
import {
  generateDeepfakeQueries,
} from "./deepfake/query-generator.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

const RunInput = z.object({
  target_name: z.string().trim().min(1).max(200),
  profile_id: z.string().uuid().optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
  handles: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
  google_images_url: z.string().trim().max(5000).optional(),
  max_queries: z.number().int().min(1).max(40).optional(),
  per_query_limit: z.number().int().min(1).max(10).optional(),
});

function hostOf(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}

/** Kick off a deepfake intelligence scan. Runs synchronously and returns the scan id. */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

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

      // The official YouTube Data API supplies newest-first video mentions.
      // This complements web indexing, which can lag behind new uploads.
      try {
        const { searchRecentYouTubeMentions } = await import(
          "./deepfake/youtube-discovery.server"
        );
        const youtubeHits = await searchRecentYouTubeMentions({
          name: data.target_name,
          aliases: data.aliases,
          handles: data.handles,
          maxResults: 25,
        });
        for (const hit of youtubeHits) {
          if (seenUrl.has(hit.url)) continue;
          seenUrl.add(hit.url);
          allHits.push(hit);
        }
      } catch (error) {
        console.warn("[DEEPFAKE:YOUTUBE] Latest mentions skipped:", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

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
            if (!host || isBlockedHost(host)) continue;
            if (seenUrl.has(h.url)) continue;
            seenUrl.add(h.url);

            allHits.push({
              ...h,
              query:
                typeof h.query === "string" && h.query.trim()
                  ? h.query.trim()
                  : batch[0] ?? data.target_name,
            });
          }
        }
      }

      /*
       * Save every public URL before candidate filtering.
       * A discovery is a lead, not a confirmed deepfake.
       */
      if (allHits.length) {
        const discoveryRows = allHits.map((hit) => ({
          user_id: userId,
          scan_id: scan.id,
          source: hit.source ?? "firecrawl",
          search_query:
            typeof hit.query === "string" && hit.query.trim()
              ? hit.query.trim()
              : data.target_name,
          page_url: hit.url,
          canonical_url: hit.url,
          source_host: hostOf(hit.url),
          page_title: hit.title ?? null,
          snippet: hit.description ?? null,
          image_url: hit.image_url ?? null,
          thumbnail_url: hit.thumbnail_url ?? null,
          media_type:
            hit.image_url || hit.thumbnail_url ? "image" : null,
          analysis_status: "discovered",
          updated_at: new Date().toISOString(),
        }));

        const { error: discoveryError } = await (
          supabase as any
        )
          .from("deepfake_discoveries")
          .upsert(discoveryRows, {
            onConflict: "scan_id,page_url",
          });

        if (discoveryError) {
          console.error(
            "[DEEPFAKE] Discovery storage failed:",
            discoveryError,
          );

          throw new Error(
            `Unable to store discovered URLs: ${discoveryError.message}`,
          );
        }

        console.log("[DEEPFAKE] Raw discoveries saved:", {
          scanId: scan.id,
          count: discoveryRows.length,
        });
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
         * Scrape high-risk result pages and extract direct image/video URLs.
         * Hive cannot analyse an ordinary webpage URL.
         */
        const mediaCandidates = await enrichHitsWithMedia(
          candidateFilter.accepted,
          60,
        );

        let hiveCandidates = mediaCandidates;

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
              candidates: mediaCandidates,
              similarityThreshold: 88,
            });

          /*
           * Keep verified face matches as primary media.
           * Also preserve explicit video/page leads when face verification
           * cannot run because no accessible thumbnail or image exists.
           */
          const explicitUnavailable = faceResults.errors.filter(
            (item) => {
              const text = [
                item.title ?? "",
                item.description ?? "",
                item.url ?? "",
                item.query ?? "",
              ].join(" ");

              return (
                item.media_type === "video" ||
                /\b(?:video|porn|xxx|sex|nude|naked|deepfake|fake nude|leaked)\b/i.test(
                  text,
                )
              );
            },
          );

          hiveCandidates = [
            ...faceResults.matched,
            ...explicitUnavailable.map((item) => ({
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
          await classifyHitsWithHive(
            hiveCandidates,
          );

        let primaryResults = hiveResults.filter(
          (item) =>
            (item.content_match_score ?? 0) >= 50 &&
            item.classification_status === "completed" &&
            item.confidence >= 10 &&
            item.content_category !== "unclassified" &&
            item.visibility === "primary",
        );

        /*
         * When the media classifier is unavailable (no key, provider error),
         * fall back to the cautious text classifier so accepted leads are
         * still surfaced for manual review instead of vanishing.
         */
        const hiveUsable = hiveResults.some(
          (item) => item.classification_status === "completed",
        );

        if (!primaryResults.length && !hiveUsable) {
          const { classifyHits } = await import(
            "./deepfake/classify.server"
          );

          const textPool = (
            hiveCandidates.length
              ? hiveCandidates
              : candidateFilter.accepted
          ).slice(0, 40);

          try {
            const textResults = await classifyHits(
              textPool.map((item) => ({
                url: item.url,
                title: item.title,
                description: item.description,
                query: item.query,
              })),
              target,
            );

            primaryResults = textResults.map((item, index) => ({
              ...item,
              content_match_score:
                (textPool[index] as any)?.content_match_score ?? 0,
              classification_status: "completed" as const,
              visibility: "primary" as const,
              ai_reasoning:
                `${item.ai_reasoning} (Text-only triage: media analysis unavailable.)`.trim(),
            }));

            console.log("[DEEPFAKE] Text-classifier fallback:", {
              classified: primaryResults.length,
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


        const triageResults = [
          ...candidateFilter.triage.map((item) => ({
            ...item,
            risk_level: "LOW" as const,
            content_category: "unclassified",
            confidence: 0,
            is_synthetic: false,
            face_referenced: false,
            takedown_recommended: false,
            ai_reasoning:
              item.rejection_reason ??
              "Weak target-content match; manual review required.",
            classification_status: "no_media" as const,
            visibility: "triage" as const,
          })),
          ...hiveResults.filter(
            (item) => item.visibility !== "primary",
          ),
        ];

        console.log("[DEEPFAKE] Result routing:", {
          primary: primaryResults.length,
          triage: triageResults.length,
          rejected: candidateFilter.rejected.length,
        });

        /*
         * Keep only verified Hive results in the primary findings table.
         * Triage results are logged for now and can later be stored in a
         * dedicated triage table.
         */
        const relevantTriageResults = triageResults.filter(
          (item: any) => {
            const signals = Array.isArray(item.threat_signals)
              ? item.threat_signals
              : [];

            const strongSignals = signals.some(
              (signal: string) =>
                [
                  "nude",
                  "pornographic",
                  "sexual-content",
                  "leaked-intimate-media",
                  "undressing",
                  "deepfake",
                  "ai-nude",
                  "morphed-media",
                   "defamation",
                   "harassment",
                ].includes(signal),
            );

            const explicitCategory =
              item.content_category ===
              "explicit_content_page";

            const analysedRisk =
              item.classification_status === "completed" &&
              [
                "deepfake",
                "synthetic_media",
                "explicit_content_page",
              ].includes(item.content_category);

            return (
              strongSignals ||
              explicitCategory ||
              analysedRisk
            );
          },
        );

        classified = [
          ...primaryResults,
          ...relevantTriageResults,
        ];
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
          if (c.risk_level === "CRITICAL") critical++;
          else if (c.risk_level === "HIGH") high++;
          else if (c.risk_level === "MEDIUM") medium++;
          else low++;
          return {
            scan_id: scan.id,
            user_id: userId,
            url: c.url,
            source_host: hostOf(c.url),
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
            ai_reasoning: c.ai_reasoning,
          };
        });
        // upsert to respect the unique(scan_id, url) index
        const { error: fErr } = await supabase
          .from("deepfake_findings")
          .upsert(rows, { onConflict: "scan_id,url" });
        if (fErr) {
          console.warn(
            "[deepfake] findings insert:",
            fErr.message,
          );
        }

        /*
         * Preserve exact page/media URLs, metadata and SHA-256 hashes
         * for review and takedown preparation.
         */
        try {
          const { captureAndStoreEvidence } =
            await import(
              "./deepfake/evidence-capture.server"
            );

          const evidenceResult =
            await captureAndStoreEvidence({
              supabase,
              userId,
              scanId: scan.id,
              candidates: classified as any[],
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

      await supabase
        .from("deepfake_scans")
        .update({
          status: "completed",
          total_queries: plan.queries.length,
          total_results: classified.length,
          critical_count: critical,
          high_count: high,
          medium_count: medium,
          low_count: low,
          finished_at: new Date().toISOString(),
        })
        .eq("id", scan.id);

      return {
        scan_id: scan.id,
        total_results: classified.length,
        discovered_results: allHits.length,
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
  .inputValidator((input: unknown) => z.object({ scan_id: z.string().uuid() }).parse(input))
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

    return {
      scan: scanRes.data as ScanRow | null,
      findings:
        (findingsRes.data ?? []) as FindingRow[],
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
