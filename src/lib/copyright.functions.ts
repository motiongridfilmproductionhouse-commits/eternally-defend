import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedPutUrl, putObject, sha256Hex } from "@/lib/aws/s3.server";
import {
  hostOf,
  canonicalUrl,
  isExcludedHost,
  websiteTypeFor,
  type DiscoveryCandidate,
} from "@/lib/copyright/url.server";
import {
  analyzeReference,
  firecrawlDiscover,
  CopyrightDiscoveryError,
} from "@/lib/copyright/discover.server";
import { bytesToDataUrl, copyrightImageTypes } from "@/lib/copyright/storage.server";
import { readStoredObject } from "@/lib/copyright/storage.server";

import { bandFor, gradeCandidate } from "@/lib/copyright/classify.server";
import { analyzeDistributionPage, releaseTimingFor } from "@/lib/copyright/distribution.server";
import {
  registerDistributionSource,
  runAutoMonitor,
} from "@/lib/copyright/distribution-monitor.server";

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

/** Presigned upload slot for a reference image or an extracted video frame. */
export const prepareCopyrightUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(copyrightImageTypes),
        size: z
          .number()
          .int()
          .positive()
          .max(12 * 1024 * 1024),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

/** Same-origin fallback upload used by the Copyright scanner to avoid fragile browser-to-S3 PUT failures. */
export const uploadCopyrightReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        fileName: z.string().min(1).max(180),
        contentType: z.enum(copyrightImageTypes),
        base64: z
          .string()
          .min(1)
          .max(20 * 1024 * 1024),
      })
      .parse(raw),
  )
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

export const runCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        referenceKind: z.enum(["image", "video"]),
        contentType: z.enum(copyrightImageTypes),
        /** Frame keys: one for a still, several sampled frames for a video. */
        keys: z.array(z.string().min(10).max(500)).min(1).max(6),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `clients/${userId}/copyright/`;
    if (data.keys.some((k) => !k.startsWith(prefix)))
      throw new Error("Invalid reference storage path.");

    const { data: scan, error: sErr } = await supabase
      .from("copyright_scans")
      .insert({
        user_id: userId,
        title: data.title,
        reference_kind: data.referenceKind,
        storage_path: data.keys[0],
        frame_paths: data.keys,
        status: "running",
      })
      .select("id")
      .single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Could not start scan.");

    try {
      const firstBytes = await readStoredObject(data.keys[0]);
      if (!firstBytes.length) throw new Error("Reference file is empty.");
      const sha256 = await sha256Hex(firstBytes);
      const referenceDataUrl = bytesToDataUrl(firstBytes, data.contentType);

      // 1. AI-vision analysis + AWS Rekognition fingerprint of the reference material.
      const allFrames = await Promise.all(
        data.keys
          .slice(0, 4)
          .map(async (k, i) =>
            i === 0 ? firstBytes : await readStoredObject(k).catch(() => new Uint8Array()),
          ),
      );
      const [analysis, fingerprint] = await Promise.all([
        analyzeReference(referenceDataUrl, data.title),
        buildMovieFingerprint(
          allFrames.filter((b) => b.length > 0),
          data.title,
        ),
      ]);

      // 2. Reverse discovery across configured providers, seeded by that analysis.
      const byUrl = new Map<string, DiscoveryCandidate>();
      let discovery: Awaited<ReturnType<typeof firecrawlDiscover>>;
      try {
        discovery = await firecrawlDiscover(referenceDataUrl, data.title, 0, analysis, {
          scanId: scan.id,
        });
      } catch (err) {
        if (err instanceof CopyrightDiscoveryError) {
          await supabase
            .from("copyright_scans")
            .update({
              status: "failed",
              error: err.userMessage,
              stats: {
                discovery_diagnostics: err.diagnostics,
                admin_summary: err.adminSummary,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any,
            })
            .eq("id", scan.id);
          throw new Error(err.userMessage);
        }
        throw err;
      }

      const officialSources: DiscoveryCandidate[] = [];
      const validCandidates: DiscoveryCandidate[] = [];

      for (const c of discovery.candidates) {
        const url = c.url;
        if (!byUrl.has(url)) byUrl.set(url, c);
        if (isExcludedHost(url)) {
          officialSources.push(c);
        } else {
          validCandidates.push(c);
        }
      }

      // Ensure every valid candidate has a thumbnail URL so no valid result is lost.
      for (const c of validCandidates) {
        if (!c.thumbnail && !c.imageUrl) {
          const host = hostOf(c.url) ?? "domain";
          c.thumbnail = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
        }
      }

      // Prioritise high-signal piracy leads, keep the grading budget bounded.
      const ordered = [...validCandidates]
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, 40);

      // 3. Evidence grading with a multimodal comparison.
      const rows: MatchInsert[] = [];
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
        const thumb = candidate.thumbnail ?? candidate.imageUrl;
        return {
          scan_id: scan.id,
          user_id: userId,
          source_url: canonicalUrl(candidate.url),
          platform: contact.platform,
          page_title: candidate.title,
          thumbnail_url: thumb,
          confidence,
          confidence_band: bandFor(confidence),
          detection_type: detectionType,
          transformations,
          review_status: "pending",
          evidence: {
            client_visible: true,
            reference_frame_index: candidate.frameIndex,
            reference_frame_path: data.keys[candidate.frameIndex] ?? data.keys[0],
            candidate_image_url: thumb,
            discovery: candidate.exact ? "piracy_lead" : "visual_match",
            discovery_query: candidate.query ?? null,
            keyword_match: candidate.keywordMatch ?? candidate.query ?? null,
            piracy_category: candidate.category ?? null,
            website_type:
              candidate.websiteType ?? websiteTypeFor(candidate.url, candidate.title ?? ""),
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
        const graded = await Promise.all(
          batch.map(async (candidate) => {
            const img = candidate.imageUrl ?? candidate.thumbnail!;

            // AWS Rekognition corroboration on the candidate image (best effort).
            let rek: FingerprintMatch = EMPTY_MATCH;
            if (fingerprint.available && img && !img.includes("favicons?domain=")) {
              const fetched = await fetchImageBytes(img).catch(() => null);
              if (fetched?.bytes?.length) {
                rek = await matchCandidateAgainstFingerprint(
                  fingerprint,
                  fetched.bytes,
                  data.title,
                );
              }
            }

            const result = await gradeCandidate({
              referenceDataUrl,
              candidateImageUrl: img,
              candidatePageUrl: candidate.url,
              candidateTitle: candidate.title,
              platform: candidate.source,
              workTitle: data.title,
              highSignal: candidate.exact || rek.signals.length >= 2,
              referenceOcrText: analysis.ocrText,
              referenceWatermark: analysis.watermark,
            });
            return { candidate, result, rek };
          }),
        );

        for (const { candidate, result, rek } of graded) {
          const blended = blendConfidence(result ? result.confidence : null, rek);
          const rekStrong = rek.signals.length >= 2;
          // Multi-signal Rekognition corroboration overrides a soft AI false-positive call.
          const isMatch = result
            ? (!result.falsePositive || rek.signals.length >= 3) &&
              (result.detectionType !== "unrelated" || rekStrong) &&
              blended >= 50
            : rekStrong && blended >= 50;

          const rekReason = rek.signals.length
            ? ` AWS recognition: ${rek.signals.join("; ")}.`
            : "";

          if (isMatch) {
            rows.push(
              buildRow(
                candidate,
                blended,
                result?.detectionType && result.detectionType !== "unrelated"
                  ? result.detectionType
                  : candidate.websiteType === "duplicate_artwork"
                    ? "poster_copy"
                    : "ripped_copy",
                [
                  ...(result?.transformations ?? []),
                  ...(rek.watermarkMatch ? ["watermark_match"] : []),
                ],
                result?.ocrText ?? (rek.matchedOcrText.join(" | ") || null),
                result?.watermark ?? rek.watermarkMatch,
                `${result?.reason ?? "Multi-signal Rekognition match."}${rekReason}`,
                rek,
              ),
            );
            continue;
          }

          ignored++;
          fallbackRows.push(
            buildRow(
              candidate,
              Math.max(35, Math.min(49, blended || 35)),
              result?.detectionType && result.detectionType !== "unrelated"
                ? result.detectionType
                : "ripped_copy",
              result?.transformations ?? [],
              result?.ocrText ?? null,
              result?.watermark ?? rek.watermarkMatch,
              (result?.reason ||
                `Piracy-signal lead (${candidate.category ?? "web_lead"}) surfaced by "${candidate.keywordMatch ?? candidate.query ?? data.title}" — requires human review.`) +
                rekReason,
              rek,
            ),
          );
        }
      }

      // Add any remaining unverified valid candidates that were not graded into rows/fallbackRows
      const processedUrls = new Set([
        ...rows.map((r) => r.source_url),
        ...fallbackRows.map((r) => r.source_url),
      ]);
      for (const c of validCandidates) {
        const canon = canonicalUrl(c.url);
        if (!processedUrls.has(canon)) {
          fallbackRows.push(
            buildRow(
              c,
              40,
              c.websiteType === "duplicate_artwork" ? "poster_copy" : "ripped_copy",
              [],
              null,
              null,
              `Discovered candidate source (${c.category ?? "automated_lead"}) surfaced by "${c.keywordMatch ?? c.query ?? data.title}" — pending review.`,
            ),
          );
          processedUrls.add(canon);
        }
      }

      // 4. Unauthorized-distribution site inspection. Page leads are fetched and
      //    examined for hard evidence (players, download buttons, mirrors, file
      //    and torrent links). Title/poster/trailer/news mentions alone never
      //    qualify. Evidence only — nothing is reported or taken down.
      const titles = [data.title, analysis.title ?? "", ...analysis.altTitles].filter(Boolean);
      const releaseDate = analysis.releaseDate;
      const leadUrls = discovery.pageLeads
        .sort((a2, b2) => Number(b2.strong) - Number(a2.strong))
        .slice(0, 16);

      const distributionRows: MatchInsert[] = [];
      const inspectedDomains = new Set<string>();

      const distributionSummary: Array<{
        url: string;
        domain_risk: string;
        content_type: string;
        release_timing: string;
        confidence: number;
        strong_evidence: boolean;
        indicators: string[];
      }> = [];

      for (let offset = 0; offset < leadUrls.length; offset += 4) {
        const batch = leadUrls.slice(offset, offset + 4);
        const analyses = await Promise.all(
          batch.map(async (lead) => ({
            lead,
            analysis: await analyzeDistributionPage({
              url: lead.url,
              title: lead.title,
              titles,
              releaseDate,
            }).catch(() => null),
          })),
        );

        for (const { lead, analysis: dist } of analyses) {
          if (!dist) continue;
          inspectedDomains.add((dist.domain ?? "").toLowerCase());
          distributionSummary.push({
            url: dist.url,
            domain_risk: dist.domainRisk,
            content_type: dist.contentType,
            release_timing: dist.releaseTiming,
            confidence: dist.confidence,
            strong_evidence: dist.strongEvidence,
            indicators: dist.indicatorKeys,
          });
          // Strong evidence gate: only distribution sources become findings.
          if (!dist.strongEvidence || dist.domainRisk === "low") continue;

          // Register in the Unauthorized Distribution Sources database + Auto Monitor.
          const contact = resolveAbuseContact(dist.url);
          await registerDistributionSource(supabase, {
            userId,
            scanId: scan.id,
            workTitle: data.title,
            platform: contact.platform,
            analysis: dist,
          }).catch(() => null);

          distributionRows.push({
            scan_id: scan.id,
            user_id: userId,
            source_url: canonicalUrl(dist.url),
            platform: contact.platform,
            page_title: dist.pageTitle ?? lead.title,
            thumbnail_url: dist.screenshot,
            confidence: dist.confidence,
            confidence_band: bandFor(dist.confidence),
            detection_type:
              dist.contentType === "torrent_index_site"
                ? "ripped_copy"
                : dist.contentType === "unauthorized_streaming_site"
                  ? "video_clip"
                  : dist.contentType === "reupload_platform"
                    ? "video_clip"
                    : "ripped_copy",
            transformations: dist.qualityTags.slice(0, 8),
            review_status: "pending",
            evidence: {
              client_visible: true,
              discovery: "distribution_site",
              discovery_query: lead.query,
              keyword_match: lead.query,
              host: hostOf(dist.url),
              website_type: dist.contentType,
              detected_language: analysis.language,
              reference_release_date: releaseDate,
              distribution: {
                domain: dist.domain,
                domain_risk: dist.domainRisk,
                content_type: dist.contentType,
                release_timing: dist.releaseTiming,
                release_offset_days: dist.releaseOffsetDays,
                piracy_indicators: dist.indicators.map((i) => ({
                  key: i.key,
                  detail: i.detail,
                  weight: i.weight,
                  strong: i.strong,
                })),
                indicator_keys: dist.indicatorKeys,
                distribution_links: dist.distributionLinks,
                quality_tags: dist.qualityTags,
                strong_evidence: dist.strongEvidence,
                evidence_screenshot: dist.screenshot,
              },
            },
            ocr_text: null,
            reason: dist.reason,
            contact: contact as unknown as MatchInsert["contact"],
          });
        }
      }

      // 5. Auto Monitor pass: re-check already-known distribution sources.
      const monitorPass = await runAutoMonitor(supabase, {
        userId,
        limit: 8,
        force: true,
        runType: "scan",
        excludeDomains: [...inspectedDomains].filter(Boolean),
      }).catch(() => ({ checked: 0, incidents: 0 }));

      const seenUrls = new Set(distributionRows.map((r) => r.source_url));
      const allRows = [
        ...distributionRows,
        ...[...rows, ...fallbackRows].filter((r) => !seenUrls.has(r.source_url)),
      ];

      if (allRows.length > 0) {
        const { error: mErr } = await supabase
          .from("copyright_matches")
          .upsert(allRows, { onConflict: "scan_id,source_url" });
        if (mErr) throw new Error(mErr.message);
      }

      // Worker completion verification gate: confirm candidates are persisted before marking completed.
      if (byUrl.size > 0 && allRows.length === 0) {
        throw new Error(
          `Scan completion halted: ${byUrl.size} candidate(s) discovered but 0 candidate rows persisted.`,
        );
      }

      const pendingReviewCount = allRows.filter((r) => r.review_status === "pending").length;
      const verifiedCount = allRows.filter(
        (r) => (r.confidence ?? 0) >= 90 || r.confidence_band === "confirmed",
      ).length;
      const rejectedCount =
        allRows.filter((r) => r.review_status === "dismissed").length + officialSources.length;
      const crawledPagesCount = ordered.length + leadUrls.length;

      const diagnostics = {
        discovered_candidate_count: byUrl.size,
        persisted_candidate_count: allRows.length,
        client_visible_count: allRows.filter(
          (r) => (r.evidence as Record<string, unknown> | null)?.client_visible !== false,
        ).length,
        crawl_queue_count: byUrl.size,
        crawled_count: crawledPagesCount,
        pending_review_count: pendingReviewCount,
        verified_count: verifiedCount,
        rejected_count: rejectedCount,
        hidden_by_filter_count: officialSources.length,
        scan_id_and_client_id_consistency: allRows.every(
          (r) => r.scan_id === scan.id && r.user_id === userId,
        ),
      };

      const stats = {
        candidate_pages: byUrl.size,
        crawled_pages: crawledPagesCount,
        pending_verification: pendingReviewCount,
        verified_threats: verifiedCount,
        rejected: rejectedCount,

        candidates: byUrl.size,
        graded: ordered.length,
        matches: allRows.length,
        leads: fallbackRows.length,
        distribution_pages_inspected: leadUrls.length,
        distribution_sites: distributionRows.length,
        distribution_high_risk: distributionSummary.filter((d) => d.domain_risk === "high").length,
        distribution_summary: distributionSummary.slice(0, 25),
        monitored_sources_checked: monitorPass.checked,
        monitor_incidents: monitorPass.incidents,
        discovery_diagnostics: discovery.diagnostics,
        diagnostics,
        admin_summary: discovery.diagnostics.adminSummary,

        release_timing: releaseTimingFor(releaseDate).timing,
        queries_language: analysis.language,
        release_date: analysis.releaseDate,

        ignored,
        frames: data.keys.length,
        sha256,
        confirmed: verifiedCount,
        probable: allRows.filter((r) => r.confidence_band === "probable").length,
        review: allRows.filter((r) => r.confidence_band === "review").length,
      };
      await supabase
        .from("copyright_scans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status: "completed", sha256, stats: stats as any })
        .eq("id", scan.id);
      return { scanId: scan.id as string, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase
        .from("copyright_scans")
        .update({ status: "failed", error: message.slice(0, 500) })
        .eq("id", scan.id);
      throw new Error(message);
    }
  });

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCopyrightScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: scan, error } = await context.supabase
      .from("copyright_scans")
      .select("*")
      .eq("id", data.scanId)
      .single();
    if (error) throw new Error(error.message);

    const { data: matches, error: mErr } = await context.supabase
      .from("copyright_matches")
      .select("*")
      .eq("scan_id", data.scanId)
      .order("confidence", { ascending: false });
    if (mErr) throw new Error(mErr.message);

    const matchRows = matches ?? [];
    const stats = (scan.stats ?? {}) as Record<string, unknown>;
    const expectedCount = Number(stats.matches ?? 0);

    if (expectedCount > 0 && matchRows.length === 0) {
      console.warn(
        `[CopyrightScan] Diagnostic Warning: scan_id=${data.scanId} has stats.matches=${expectedCount} but copyright_matches query returned 0 rows.`,
      );
    }

    return { scan, matches: matchRows };
  });

export const listAllCopyrightMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ includeArchived: z.boolean().optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.auth.user.id;
    const { data: matches, error } = await context.supabase
      .from("copyright_matches")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = matches ?? [];
    if (data.includeArchived) return rows;
    return rows.filter((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });
  });

export const archivePreviousCopyrightResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ keepScanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.auth.user.id;
    console.log("[archivePreviousCopyrightResults] Starting archive", {
      userId,
      keepScanId: data.keepScanId,
    });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, scan_id, evidence")
      .eq("user_id", userId)
      .neq("scan_id", data.keepScanId);

    if (fetchErr) {
      console.error("[archivePreviousCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch previous copyright matches: ${fetchErr.message}`);
    }

    const rowsToArchive = (matches ?? []).filter((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });

    if (rowsToArchive.length === 0) {
      console.log("[archivePreviousCopyrightResults] No active rows to archive.");
      return { success: true, archivedCount: 0 };
    }

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const row of rowsToArchive) {
      const ev = (row.evidence ?? {}) as Record<string, unknown>;
      const updatedEvidence = {
        ...ev,
        client_visible: false,
        archived_at: now,
      };

      const { error: updErr } = await context.supabase
        .from("copyright_matches")
        .update({ evidence: updatedEvidence })
        .eq("id", row.id)
        .eq("user_id", userId);

      if (updErr) {
        console.error(
          `[archivePreviousCopyrightResults] Update error for row_id=${row.id}:`,
          updErr,
        );
        throw new Error(`Failed to archive copyright match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    console.log("[archivePreviousCopyrightResults] Completed successfully", {
      archivedCount: updatedCount,
    });
    return { success: true, archivedCount: updatedCount };
  });

export const archiveScanCopyrightResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.auth.user.id;
    console.log("[archiveScanCopyrightResults] Starting archive", { userId, scanId: data.scanId });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, evidence")
      .eq("scan_id", data.scanId)
      .eq("user_id", userId);

    if (fetchErr) {
      console.error("[archiveScanCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch scan copyright matches: ${fetchErr.message}`);
    }

    const now = new Date().toISOString();
    let updatedCount = 0;

    for (const row of matches ?? []) {
      const ev = (row.evidence ?? {}) as Record<string, unknown>;
      const updatedEvidence = {
        ...ev,
        client_visible: false,
        archived_at: now,
      };

      const { error: updErr } = await context.supabase
        .from("copyright_matches")
        .update({ evidence: updatedEvidence })
        .eq("id", row.id)
        .eq("user_id", userId);

      if (updErr) {
        console.error(`[archiveScanCopyrightResults] Update error for row_id=${row.id}:`, updErr);
        throw new Error(`Failed to archive match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    console.log("[archiveScanCopyrightResults] Completed successfully", {
      archivedCount: updatedCount,
    });
    return { success: true, archivedCount: updatedCount };
  });

export const updateCopyrightMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        matchId: z.string().uuid(),
        reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_matches")
      .update({ review_status: data.reviewStatus })
      .eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
