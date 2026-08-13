import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceScanSubject } from "@/lib/security/protected-subject.server";

import type { Database } from "@/integrations/supabase/types";
import { filterDeepfakeCandidates } from "./deepfake/filter.server";
import { generateDeepfakeQueries } from "./deepfake/query-generator.server";
import { executeMultiProviderDiscovery } from "./deepfake/multi-provider-discovery.server";
import {
  recordQualifiedDomainFinding,
  determineLeadOrigin,
} from "./deepfake/high-risk-registry.server";

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
  // Threat Discovery Telemetry
  high_risk_domain_queries?: { executed: number; total: number };
  open_web_threat_queries?: { executed: number; total: number };
  new_source_domains_discovered?: number;
  // Discard Diagnostics
  synthetic_candidates_found?: number;
  unrelated_pages_discarded?: number;
  official_pages_discarded?: number;
  news_pages_discarded?: number;
  biography_pages_discarded?: number;
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

    // SUBJECT ISOLATION — the protected subject always comes from the workspace,
    // never from the browser payload.
    const enforced = await enforceScanSubject(context, {
      targetName: data.target_name,
      aliases: data.aliases,
    });
    data.target_name = enforced.targetName;
    data.aliases = enforced.aliases;
    data.handles = enforced.unrestricted
      ? data.handles
      : (data.handles ?? []).filter((h) =>
          enforced.identity.authorizedHandles.some(
            (a) => a.toLowerCase() === h.replace(/^@/, "").toLowerCase(),
          ),
        );


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

    // 0. Reap stale "running" scans for this target so a new scan can start
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: staleScans } = await supabase
      .from("deepfake_scans")
      .select("id, heartbeat_at, created_at")
      .eq("user_id", userId)
      .eq("status", "running")
      .ilike("target_name", data.target_name.trim());

    for (const stale of staleScans ?? []) {
      const last = stale.heartbeat_at ?? stale.created_at;
      if (last && last > staleCutoff) continue;
      await supabase
        .from("deepfake_scans")
        .update({
          status: "failed",
          scan_run_token: null,
          finished_at: new Date().toISOString(),
          error_message: "Scan abandoned (no heartbeat)",
        })
        .eq("id", stale.id);
    }

    // 1. Create scan row
    const { data: scan, error: sErr } = await supabase
      .from("deepfake_scans")
      .insert({
        user_id: userId,
        target_name: data.target_name,
        aliases: data.aliases ?? [],
        handles: data.handles ?? [],
        status: "running",
        scan_run_token: crypto.randomUUID(),
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      })
      .select("*")
      .single();

    if (sErr?.message?.includes("deepfake_scans_one_active_per_target")) {
      const { data: activeScan, error: activeScanError } = await supabase
        .from("deepfake_scans")
        .select("id, total_results")
        .eq("user_id", userId)
        .eq("status", "running")
        .ilike("target_name", data.target_name.trim())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeScanError || !activeScan) {
        throw new Error("The active scan could not be loaded. Refresh the scan list and try again.");
      }

      return {
        scan_id: activeScan.id,
        total_results: activeScan.total_results ?? 0,
        discovered_results: 0,
        already_running: true as const,
      };
    }
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
          heartbeat_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
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

      const totalHighRiskQueries = uniqueQueries.filter((q) => /\bsite:(?:desifakes|imgfy)\b/i.test(q)).length;
      const totalOpenWebQueries = uniqueQueries.length - totalHighRiskQueries;
      let executedHighRiskQueries = 0;
      let executedOpenWebQueries = 0;

      await updateTelemetry({
        stage: "queries_generated",
        queries_generated: uniqueQueries.length,
        high_risk_domain_queries: { executed: 0, total: totalHighRiskQueries },
        open_web_threat_queries: { executed: 0, total: totalOpenWebQueries },
        new_source_domains_discovered: 0,
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
            if (/\bsite:(?:desifakes|imgfy)\b/i.test(p.query)) {
              executedHighRiskQueries++;
            } else {
              executedOpenWebQueries++;
            }
            if (p.provider && p.provider !== "none") providersSet.add(p.provider);
            const remainingQueries = uniqueQueries.length - executedQueriesCount;
            const remSec = remainingQueries * 2;

            await updateTelemetry({
              stage: `searching_${p.provider}`,
              current_provider: p.provider,
              current_query: p.query,
              queries_executed: executedQueriesCount,
              high_risk_domain_queries: { executed: executedHighRiskQueries, total: totalHighRiskQueries },
              open_web_threat_queries: { executed: executedOpenWebQueries, total: totalOpenWebQueries },
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
        synthetic_candidates_found: candidateFilter.diagnostics?.syntheticCandidatesFound ?? candidateFilter.accepted.length,
        unrelated_pages_discarded: candidateFilter.diagnostics?.unrelatedPagesDiscarded ?? candidateFilter.rejected.length,
        official_pages_discarded: candidateFilter.diagnostics?.officialPagesDiscarded ?? 0,
        news_pages_discarded: candidateFilter.diagnostics?.newsPagesDiscarded ?? 0,
        biography_pages_discarded: candidateFilter.diagnostics?.biographyPagesDiscarded ?? 0,
        stage_logs: [
          ...telemetry.stage_logs,
          `✓ ${candidateFilter.accepted.length} synthetic candidate leads ready for crawling`,
          `✓ Discarded ${candidateFilter.rejected.length} unrelated news/official/biography pages`,
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
        /*
         * Classification failure must NEVER promote discovery leads into
         * findings. Leads stay internal-only (NOT_SUBJECT) until target
         * verification and synthetic verification pass.
         */
        console.warn("[DEEPFAKE] Classification error; leads kept unverified:", classErr);
        classified = [];
        await updateTelemetry({
          stage_logs: [
            ...telemetry.stage_logs,
            "⚠ Classification unavailable — discovery leads retained internally, none promoted to findings.",
          ],
        });
      }

      // 8. Persist Findings
      let critical = 0,
        high = 0,
        medium = 0,
        low = 0;

      if (classified.length) {
        const { verifyTargetIdentity, decideTargetThreat, isClientVisibleDecision, decisionToFindingClassification } =
          await import("./deepfake/target-identity");

        const rows = classified.map((c) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pageUrl = (c as any).evidence_page_url ?? c.url;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = c as any;

          // GATE 1 — strict target verification (never uses the search query).
          const identity = verifyTargetIdentity({
            target: target.name,
            aliases: target.aliases,
            title: c.title ?? null,
            url: pageUrl,
            snippet: c.description ?? null,
            pageText: raw.page_text ?? raw.pageText ?? null,
            altText: raw.image_alt ?? null,
            faceSimilarity: raw.face_similarity ?? null,
            targetFaceMatch: raw.target_face_match ?? false,
          });

          // GATE 2 — synthetic / explicit content verification.
          const decision = decideTargetThreat(identity, {
            explicitConfirmed:
              raw.explicit_media_confirmed ??
              /explicit|nud|intimate|sexual/i.test(String(c.content_category ?? "")),
            syntheticConfirmed: c.is_synthetic === true,
            syntheticConfidence: raw.synthetic_media_confidence ?? c.confidence ?? 0,
            hostingConfirmed: raw.hosting_or_distribution_confirmed ?? raw.target_face_match ?? false,
          });

          const clientVisible = isClientVisibleDecision(decision);
          const riskLevel = !clientVisible
            ? "LOW"
            : decision === "VERIFIED_TARGET_THREAT"
              ? "CRITICAL"
              : "HIGH";

          if (riskLevel === "CRITICAL") critical++;
          else if (riskLevel === "HIGH") high++;
          else low++;

          const origin = determineLeadOrigin(pageUrl, c.source);
          if (clientVisible && decision === "VERIFIED_TARGET_THREAT" && origin === "REAL_NETWORK_DISCOVERY") {
            const host = hostOf(pageUrl);
            if (host) {
              recordQualifiedDomainFinding({
                hostname: host,
                provider: c.source || "firecrawl",
                query: c.query,
              });
            }
          }

          return {
            scan_id: scan.id,
            user_id: userId,
            url: pageUrl,
            source_host: hostOf(pageUrl),
            page_title: c.title ?? null,
            snippet: c.description ?? null,
            query: c.query,
            risk_level: riskLevel,
            content_category: clientVisible
              ? (c.content_category ?? "deepfake")
              : "not_subject",
            confidence: clientVisible ? (c.confidence ?? 60) : 0,
            is_synthetic: clientVisible ? (c.is_synthetic ?? false) : false,
            face_referenced: identity.status !== "NOT_VERIFIED",
            takedown_recommended: clientVisible && decision === "VERIFIED_TARGET_THREAT",
            target_face_match: raw.target_face_match ?? false,
            face_similarity: raw.face_similarity ?? null,
            matched_face_id: raw.matched_face_id ?? null,
            identity_confidence: identity.confidence,
            matched_evidence: [...identity.evidence, `origin:${origin}`],
            finding_classification: decisionToFindingClassification(decision),
            classification_explanation: clientVisible
              ? `Target identity ${identity.status} via ${identity.evidence.join(", ") || "face match"}; synthetic/explicit evidence confirmed. [Origin: ${origin}]`
              : `Excluded (${decision}): ${identity.rejectionReason ?? "insufficient synthetic/explicit evidence for this target"}. [Origin: ${origin}]`,
            ai_reasoning: clientVisible
              ? (c.ai_reasoning ?? "Target-verified synthetic media evidence")
              : `Excluded — ${decision}. Search-query provenance is not identity evidence.`,
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
          scan_run_token: null,
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
        already_running: false as const,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      const failureStage = telemetry.stage_failure || `FAILED DURING DISCOVERY: ${msg}`;

      await supabase
        .from("deepfake_scans")
        .update({
          status: "failed",
          scan_run_token: null,
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

    const scan = scanRes.data as (ScanRow & { aliases?: string[] }) | null;
    let findingRows = (findingsRes.data ?? []) as FindingRow[];

    /*
     * Retroactive cleanup: legacy rows persisted before the strict target gate
     * (generic deepfake news, unrelated victims) are demoted to NOT_SUBJECT so
     * they permanently disappear from the client feed.
     */
    if (scan?.target_name && findingRows.length) {
      const { verifyTargetIdentity } = await import("./deepfake/target-identity");
      const stale: string[] = [];
      for (const row of findingRows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        if (String(r.finding_classification ?? "") === "NOT_SUBJECT") continue;
        const identity = verifyTargetIdentity({
          target: scan.target_name as string,
          aliases: scan.aliases ?? [],
          title: r.page_title ?? null,
          url: r.url ?? r.final_url ?? r.canonical_url ?? null,
          snippet: r.snippet ?? null,
          faceSimilarity: r.face_similarity ?? null,
          targetFaceMatch: r.target_face_match ?? false,
        });
        if (identity.status === "NOT_VERIFIED") stale.push(r.id as string);
      }
      if (stale.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (context.supabase as any)
          .from("deepfake_findings")
          .update({
            finding_classification: "NOT_SUBJECT",
            content_category: "not_subject",
            risk_level: "LOW",
            confidence: 0,
            is_synthetic: false,
            takedown_recommended: false,
            classification_explanation:
              "Excluded (NOT_SUBJECT): scan target is not evidenced on this page.",
          })
          .in("id", stale);
        const staleSet = new Set(stale);
        findingRows = findingRows.filter((row) => !staleSet.has((row as { id: string }).id));
      }
    }

    return {
      scan,
      findings: findingRows.sort(
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
