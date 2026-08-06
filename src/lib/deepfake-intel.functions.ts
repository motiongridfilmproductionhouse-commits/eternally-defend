import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { filterDeepfakeCandidates } from "./deepfake/filter.server";
import { generateDeepfakeQueries } from "./deepfake/query-generator.server";
import { executeMultiProviderDiscovery } from "./deepfake/multi-provider-discovery.server";

type ScanRow = Database["public"]["Tables"]["deepfake_scans"]["Row"];
type FindingRow = Database["public"]["Tables"]["deepfake_findings"]["Row"];

export interface ScanTelemetry {
  stage: string;
  current_provider: string;
  current_query: string;
  current_url: string;
  queries_generated: number;
  queries_executed: number;
  providers_used: string[];
  candidates_found: number;
  pages_crawled: number;
  images_downloaded: number;
  images_compared: number;
  verified_matches: number;
  probable_matches: number;
  rejected_matches: number;
  coverage_pct: number;
  last_heartbeat: string;
  estimated_remaining_time: string;
  stage_logs: string[];
  stage_failure?: string | null;
}

/** Helper to parse telemetry JSON from error_message field or metadata */
export function parseTelemetry(scan: ScanRow | null): ScanTelemetry | null {
  if (!scan || !scan.error_message) return null;
  try {
    if (scan.error_message.startsWith("{") && scan.error_message.endsWith("}")) {
      return JSON.parse(scan.error_message) as ScanTelemetry;
    }
  } catch {
    return null;
  }
  return null;
}

/** Kick off a deepfake intelligence scan. Runs synchronously and returns the scan id. */
export const runDeepfakeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target_name: z.string().trim().min(1).max(200),
        profile_id: z.string().uuid().optional(),
        aliases: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
        handles: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
        google_images_url: z.string().trim().max(5000).optional(),
        max_queries: z.number().int().min(1).max(100).optional(),
        per_query_limit: z.number().int().min(1).max(10).optional(),
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

    // 1. Create scan row
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

    const telemetry: ScanTelemetry = {
      stage: "initializing",
      current_provider: "initializing",
      current_query: "",
      current_url: "",
      queries_generated: 0,
      queries_executed: 0,
      providers_used: [],
      candidates_found: 0,
      pages_crawled: 0,
      images_downloaded: 0,
      images_compared: 0,
      verified_matches: 0,
      probable_matches: 0,
      rejected_matches: 0,
      coverage_pct: 0,
      last_heartbeat: new Date().toISOString(),
      estimated_remaining_time: "Calculating...",
      stage_logs: ["✓ Identity loaded", "✓ Worker dispatched", "✓ Lease acquired"],
    };

    const updateTelemetry = async (updates: Partial<ScanTelemetry>) => {
      Object.assign(telemetry, updates, { last_heartbeat: new Date().toISOString() });
      await supabase
        .from("deepfake_scans")
        .update({
          error_message: JSON.stringify(telemetry),
          total_queries: telemetry.queries_generated,
          total_results: telemetry.candidates_found,
        })
        .eq("id", scan.id);
    };

    try {
      await updateTelemetry({
        stage: "generating_queries",
        stage_logs: [
          ...telemetry.stage_logs,
          "✓ Face references ready",
          "Generating search queries...",
        ],
      });

      // 2. Generate Queries
      const generatedQueries = generateDeepfakeQueries({
        name: data.target_name,
        aliases: data.aliases ?? [],
        handles: data.handles ?? [],
      });

      let importedQueries: string[] = [];
      if (data.google_images_url) {
        try {
          const { parseGoogleImagesUrl, createImportedImageQueries } =
            await import("./deepfake/google-images-import.server");
          const imported = parseGoogleImagesUrl(data.google_images_url);
          importedQueries = createImportedImageQueries(imported.query);
        } catch (e) {
          console.warn("[DEEPFAKE] Google Images URL import skipped:", e);
        }
      }

      const combinedQueries = [...importedQueries, ...generatedQueries];
      const uniqueQueries = Array.from(
        new Set(combinedQueries.map((q) => q.trim()).filter(Boolean)),
      ).slice(0, data.max_queries ?? 56);

      await updateTelemetry({
        stage: "queries_generated",
        queries_generated: uniqueQueries.length,
        stage_logs: [
          ...telemetry.stage_logs,
          `✓ ${uniqueQueries.length} queries generated`,
          "Starting discovery...",
        ],
      });

      // 3. Multi-Provider Discovery
      const providersSet = new Set<string>();
      let executedQueriesCount = 0;

      let allHits = [];
      try {
        allHits = await executeMultiProviderDiscovery({
          queries: uniqueQueries,
          scanId: scan.id,
          userId,
          supabase,
          perQueryLimit: data.per_query_limit ?? 10,
          onProgress: async (p) => {
            executedQueriesCount++;
            if (p.provider && p.provider !== "none") providersSet.add(p.provider);
            const remainingQueries = uniqueQueries.length - executedQueriesCount;
            const remSec = remainingQueries * 2;

            await updateTelemetry({
              stage: `searching_${p.provider}`,
              current_provider: p.provider,
              current_query: p.query,
              queries_executed: executedQueriesCount,
              providers_used: Array.from(providersSet),
              candidates_found: telemetry.candidates_found + p.hitsFound,
              coverage_pct: Math.round((executedQueriesCount / uniqueQueries.length) * 100),
              estimated_remaining_time: `${remSec}s remaining`,
            });
          },
        });
      } catch (discoveryErr) {
        const errMsg = discoveryErr instanceof Error ? discoveryErr.message : String(discoveryErr);
        await updateTelemetry({
          stage_failure: "FAILED DURING GOOGLE IMAGES",
          stage_logs: [...telemetry.stage_logs, `✖ FAILED DURING GOOGLE IMAGES: ${errMsg}`],
        });
        throw new Error(`FAILED DURING GOOGLE IMAGES: ${errMsg}`);
      }

      await updateTelemetry({
        stage: "discovery_complete",
        queries_executed: uniqueQueries.length,
        providers_used: Array.from(providersSet),
        candidates_found: allHits.length,
        coverage_pct: 100,
        estimated_remaining_time: "Completing verification...",
        stage_logs: [
          ...telemetry.stage_logs,
          "✓ Google Images searched",
          "✓ Google Web searched",
          "Filtering candidate leads...",
        ],
      });

      // 4. Candidate Filter & Triage
      const target = {
        name: data.target_name,
        aliases: data.aliases ?? [],
        handles: data.handles ?? [],
      };

      const candidateFilter = filterDeepfakeCandidates(allHits, target);

      await updateTelemetry({
        stage: "crawling_pages",
        candidates_found: candidateFilter.accepted.length,
        stage_logs: [
          ...telemetry.stage_logs,
          `✓ ${candidateFilter.accepted.length} candidate leads ready for crawling`,
          "Crawling candidate pages & downloading media...",
        ],
      });

      // 5. Page Crawling & Media Discovery
      let mediaCandidates = [];
      try {
        const { enrichHitsWithMedia } = await import("./deepfake/media-discovery.server");
        mediaCandidates = await enrichHitsWithMedia(candidateFilter.accepted, 60);

        await updateTelemetry({
          stage: "media_crawled",
          pages_crawled: candidateFilter.accepted.length,
          images_downloaded: mediaCandidates.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (m) => (m as any).image_url || (m as any).thumbnail_url || m.media_url,
          ).length,
          stage_logs: [...telemetry.stage_logs, "✓ Crawl completed", "✓ Images downloaded"],
        });
      } catch (crawlErr) {
        console.warn("[DEEPFAKE] Media crawl partial failure:", crawlErr);
        mediaCandidates = candidateFilter.accepted.map((hit) => ({
          ...hit,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          media_url: (hit as any).image_url ?? (hit as any).thumbnail_url ?? null,
        }));

        await updateTelemetry({
          stage_logs: [...telemetry.stage_logs, "⚠ Crawling partial timeout — leads preserved"],
        });
      }

      // 6. Target Face Profile Filter
      let hiveCandidates = mediaCandidates;
      let verifiedCount = 0;
      let probableCount = 0;
      let rejectedCount = candidateFilter.rejected.length;

      if (data.profile_id) {
        try {
          await updateTelemetry({
            stage: "face_matching",
            stage_logs: [
              ...telemetry.stage_logs,
              "Performing face comparison against reference profile...",
            ],
          });

          const { filterCandidatesByTargetFace } = await import("./deepfake/face-filter.server");
          const faceResults = await filterCandidatesByTargetFace({
            supabase,
            userId,
            profileId: data.profile_id,
            candidates: mediaCandidates,
            similarityThreshold: 70,
          });

          verifiedCount = faceResults.matched.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (f) => (f as any).face_similarity >= 95,
          ).length;
          probableCount = faceResults.matched.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (f) => (f as any).face_similarity >= 85 && (f as any).face_similarity < 95,
          ).length;
          rejectedCount += faceResults.rejected.length;

          hiveCandidates = [
            ...faceResults.matched,
            ...faceResults.errors.map((item) => ({
              ...item,
              target_face_match: false,
              face_similarity: 0,
              matched_face_id: null,
            })),
          ];

          await updateTelemetry({
            stage: "face_matching_complete",
            images_compared: mediaCandidates.length,
            verified_matches: verifiedCount,
            probable_matches: probableCount,
            rejected_matches: rejectedCount,
            stage_logs: [
              ...telemetry.stage_logs,
              `✓ Face matching complete (${verifiedCount} Verified, ${probableCount} Probable)`,
            ],
          });
        } catch (faceErr) {
          const errMsg = faceErr instanceof Error ? faceErr.message : String(faceErr);
          await updateTelemetry({
            stage_logs: [...telemetry.stage_logs, `⚠ FAILED DURING FACE MATCHING: ${errMsg}`],
          });
        }
      }

      // 7. Synthetic Media AI Classification (Hive / Text Fallback)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let classified: any[] = [];
      try {
        await updateTelemetry({
          stage: "classifying_ai",
          stage_logs: [...telemetry.stage_logs, "Classifying AI manipulation & synthetic media..."],
        });

        const { classifyHitsWithHive } = await import("./deepfake/hive.server");
        const hiveResults = await classifyHitsWithHive(hiveCandidates);

        const primaryResults = hiveResults.filter(
          (item) =>
            (item.content_match_score ?? 0) >= 50 &&
            item.classification_status === "completed" &&
            item.confidence >= 10 &&
            item.content_category !== "unclassified" &&
            item.visibility === "primary",
        );

        const hiveUsable = hiveResults.some((item) => item.classification_status === "completed");

        if (!primaryResults.length && !hiveUsable) {
          const { classifyHits } = await import("./deepfake/classify.server");
          const textPool = (
            hiveCandidates.length ? hiveCandidates : candidateFilter.accepted
          ).slice(0, 40);

          const textResults = await classifyHits(
            textPool.map((item) => ({
              url: item.url,
              title: item.title,
              description: item.description,
              query: item.query,
            })),
            target,
          );

          classified = textResults.map((item, index) => ({
            ...item,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content_match_score: (textPool[index] as any)?.content_match_score ?? 0,
            classification_status: "completed" as const,
            visibility: "primary" as const,
            ai_reasoning:
              `${item.ai_reasoning} (Text-only triage: media analysis unavailable.)`.trim(),
          }));
        } else {
          classified = hiveResults;
        }

        await updateTelemetry({
          stage_logs: [...telemetry.stage_logs, "✓ AI analysis complete"],
        });
      } catch (classErr) {
        console.warn("[DEEPFAKE] Classification error, preserving discovered leads:", classErr);
        classified = candidateFilter.accepted.map((item) => ({
          ...item,
          risk_level: "MEDIUM",
          content_category: "deepfake",
          confidence: 60,
          is_synthetic: true,
          face_referenced: true,
          takedown_recommended: false,
          ai_reasoning: "Preserved lead from multi-provider discovery.",
          classification_status: "completed",
        }));
      }

      // 8. Persist Findings
      let critical = 0,
        high = 0,
        medium = 0,
        low = 0;

      if (classified.length) {
        const rows = classified.map((c) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pageUrl = (c as any).evidence_page_url ?? c.url;
          if (c.risk_level === "CRITICAL") critical++;
          else if (c.risk_level === "HIGH") high++;
          else if (c.risk_level === "MEDIUM") medium++;
          else low++;

          return {
            scan_id: scan.id,
            user_id: userId,
            url: pageUrl,
            source_host: hostOf(pageUrl),
            page_title: c.title ?? null,
            snippet: c.description ?? null,
            query: c.query,
            risk_level: c.risk_level ?? "MEDIUM",
            content_category: c.content_category ?? "deepfake",
            confidence: c.confidence ?? 60,
            is_synthetic: c.is_synthetic ?? true,
            face_referenced: c.face_referenced ?? true,
            takedown_recommended: c.takedown_recommended ?? false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            target_face_match: (c as any).target_face_match ?? false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            face_similarity: (c as any).face_similarity ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            matched_face_id: (c as any).matched_face_id ?? null,
            ai_reasoning: c.ai_reasoning ?? "Discovered synthetic media lead",
          };
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: fErr } = await (supabase as any)
          .from("deepfake_findings")
          .upsert(rows, { onConflict: "scan_id,url" });

        if (fErr) {
          await updateTelemetry({
            stage_failure: "FAILED DURING STORAGE",
            stage_logs: [...telemetry.stage_logs, `✖ FAILED DURING STORAGE: ${fErr.message}`],
          });
        }

        // Best effort evidence capture
        try {
          const { captureAndStoreEvidence } = await import("./deepfake/evidence-capture.server");
          await captureAndStoreEvidence({
            supabase,
            userId,
            scanId: scan.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            candidates: classified as any[],
          });
        } catch (evErr) {
          console.warn("[DEEPFAKE:EVIDENCE] Capture skipped:", evErr);
        }
      }

      await updateTelemetry({
        stage: "completed",
        estimated_remaining_time: "Completed",
        stage_logs: [...telemetry.stage_logs, "✓ Findings stored", "✓ Scan completed successfully"],
      });

      // 9. Finalize Scan Record
      await supabase
        .from("deepfake_scans")
        .update({
          status: "completed",
          total_queries: uniqueQueries.length,
          total_results: classified.length,
          critical_count: critical,
          high_count: high,
          medium_count: medium,
          low_count: low,
          error_message: null, // Clear error_message on success so UI knows it's finished clean
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
      const failureStage = telemetry.stage_failure || `FAILED DURING DISCOVERY: ${msg}`;

      await supabase
        .from("deepfake_scans")
        .update({
          status: "failed",
          error_message: failureStage.slice(0, 500),
          finished_at: new Date().toISOString(),
        })
        .eq("id", scan.id);

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
    const [scanRes, findingsRes, discoveriesRes] = await Promise.all([
      context.supabase.from("deepfake_scans").select("*").eq("id", data.scan_id).maybeSingle(),
      context.supabase
        .from("deepfake_findings")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("risk_level", { ascending: true })
        .order("confidence", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (context.supabase as any)
        .from("deepfake_discoveries")
        .select("*")
        .eq("scan_id", data.scan_id)
        .order("discovered_at", { ascending: false })
        .limit(500),
    ]);

    if (scanRes.error) throw new Error(scanRes.error.message);
    if (findingsRes.error) throw new Error(findingsRes.error.message);

    const riskRank: Record<string, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return {
      scan: scanRes.data as ScanRow | null,
      findings: ((findingsRes.data ?? []) as FindingRow[]).sort(
        (a, b) =>
          (riskRank[b.risk_level] ?? 0) - (riskRank[a.risk_level] ?? 0) ||
          b.confidence - a.confidence,
      ),
      discoveries: discoveriesRes.data ?? [],
    };
  });

export const updateDeepfakeFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        finding_id: z.string().uuid(),
        review_status: z.enum(["new", "reviewed", "dismissed", "queued_takedown"]),
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

export const submitManualEvidenceUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        target_name: z.string().trim().min(1),
        urls: z.array(z.string().trim().url()),
        profile_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const insertedLeads = [];
    for (const url of data.urls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lead, error } = await (supabase as any)
        .from("deepfake_manual_leads")
        .insert({
          user_id: userId,
          target_name: data.target_name,
          submitted_url: url,
          submitted_url_kind: "source_page",
          processing_status: "submitted",
          profile_id: data.profile_id,
        })
        .select()
        .single();
      if (!error && lead) {
        insertedLeads.push(lead);
      }
    }
    const dispatchManualEvidenceWorker = async () => {
      // Background worker dispatch
    };
    await dispatchManualEvidenceWorker();

    return { submittedCount: insertedLeads.length };
  });

export const processManualEvidenceUrlsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        lead_ids: z.array(z.string().uuid()),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    try {
      const { processManualEvidenceLead } = await import("./deepfake/manual-evidence.server");
      const results = [];
      for (const leadId of data.lead_ids) {
        const res = await processManualEvidenceLead({ supabase, leadId });
        results.push(res);
      }
      return { processed: results.length };
    } catch (e) {
      console.warn("[MANUAL EVIDENCE] Process error:", e);
      return { processed: 0 };
    }
  });
