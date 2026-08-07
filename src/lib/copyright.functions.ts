import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedPutUrl, putObject } from "@/lib/aws/s3.server";
import { copyrightImageTypes } from "@/lib/copyright/storage.server";


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

    const executionId = crypto.randomUUID();
    const workerId = crypto.randomUUID();
    const now = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.now() + 180_000).toISOString();
    let currentStage = "preparing_reference";

    console.log("[COPYRIGHT_SCAN_CREATED]", { scanId: scan.id, executionId, title: data.title });
    console.log("[COPYRIGHT_WORKER_DISPATCH]", { scanId: scan.id, executionId, workerId });
    console.log("[COPYRIGHT_WORKER_STARTED]", { scanId: scan.id, executionId, workerId });

    const initialStats = {
      dispatch_status: "dispatched",
      dispatch_attempted_at: now,
      worker_started_at: now,
      worker_id: workerId,
      execution_id: executionId,
      lease_owner: "inline-executor",
      lease_expires_at: leaseExpiresAt,
      last_heartbeat_at: now,
      current_stage: currentStage,
      current_stage_started_at: now,
      last_checkpoint_at: now,
      reference_status: "processing",
      reference_started_at: now,
      queries_generated: 0,
      provider_requests_started: 0,
      provider_requests_succeeded: 0,
      provider_requests_failed: 0,
      unique_candidate_urls: 0,
      pages_crawled: 0,
      findings_verified: 0,
    };

    await supabase
      .from("copyright_scans")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ stats: initialStats as any })
      .eq("id", scan.id);

    try {
<<<<<<< HEAD
      const { executeCopyrightScanPipeline } = await import(
        "@/lib/copyright/scan-executor.server"
      );
      const result = await executeCopyrightScanPipeline({
        supabase,
        scanId: scan.id as string,
=======
      console.log("[COPYRIGHT_STAGE_START]", { scanId: scan.id, executionId, stage: "preparing_reference" });

      let firstBytes: Uint8Array = new Uint8Array();
      let sha256 = "";
      let referenceDataUrl = "";
      try {
        const stored = await readStoredObject(data.keys[0]);
        firstBytes = new Uint8Array(stored);
        if (firstBytes.length) {
          sha256 = await sha256Hex(firstBytes);
          referenceDataUrl = bytesToDataUrl(firstBytes, data.contentType);
        }
      } catch (err) {
        console.warn("[runCopyrightScan] Reference read warning, continuing with fallback:", err);
      }

      // 1. AI-vision analysis + AWS Rekognition fingerprint of the reference material.
      const allFrames = await Promise.all(
        data.keys
          .slice(0, 4)
          .map(async (k, i) =>
            i === 0 ? firstBytes : await readStoredObject(k).catch(() => new Uint8Array()),
          ),
      );

      const [analysis, fingerprint] = await Promise.all([
        analyzeReference(referenceDataUrl, data.title).catch(() => ({
          title: data.title,
          altTitles: [],
          language: null,
          audienceLanguages: [],
          region: null,
          actors: [],
          productionCompany: null,
          releaseDate: null,
          descriptors: [],
          ocrText: null,
          watermark: null,
          visualFeatures: [],
          mediaType: null,
        })),
        buildMovieFingerprint(
          allFrames.filter((b) => b.length > 0),
          data.title,
        ).catch(() => ({
          available: false,
          frames: [],
          labels: [],
          sceneCategories: [],
          ocrLines: [],
          ocrTokens: [],
          celebrities: [],
          faceCount: 0,
          watermarkHints: [],
        })),
      ]);

      console.log("[COPYRIGHT_STAGE_COMPLETE]", { scanId: scan.id, executionId, stage: "preparing_reference" });

      // 2. Query generation & pre-persistence.
      currentStage = "generating_queries";
      console.log("[COPYRIGHT_STAGE_START]", { scanId: scan.id, executionId, stage: "generating_queries" });

      const { data: histMatches } = await supabase
        .from("copyright_matches")
        .select("source_url")
        .eq("user_id", userId)
        .limit(50);
      const historicalUrls = (histMatches ?? []).map((m) => m.source_url).filter(Boolean);

      const queryPlans = buildQueries(analysis, data.title);
      console.log("[COPYRIGHT_QUERY_GENERATED]", { scanId: scan.id, executionId, queryCount: queryPlans.length });

      currentStage = "discovering";
      const checkpointStats = {
        ...initialStats,
        reference_status: "completed",
        reference_completed_at: new Date().toISOString(),
        current_stage: "discovering",
        current_stage_started_at: new Date().toISOString(),
        last_checkpoint_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        queries_generated: queryPlans.length,
        queries: queryPlans.map((p) => p.query),
      };

      await supabase
        .from("copyright_scans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ stats: checkpointStats as any })
        .eq("id", scan.id);

      console.log("[COPYRIGHT_STAGE_START]", { scanId: scan.id, executionId, stage: "discovering" });
      console.log("[COPYRIGHT_PROVIDER_START]", { scanId: scan.id, executionId });

      // Reverse discovery across configured providers, seeded by analysis + historical URLs.
      const byUrl = new Map<string, DiscoveryCandidate>();
      let discovery: Awaited<ReturnType<typeof firecrawlDiscover>>;
      try {
        discovery = await firecrawlDiscover(referenceDataUrl, data.title, 0, analysis, {
          scanId: scan.id,
          historicalUrls,
        });
        console.log("[COPYRIGHT_CHECKPOINT]", { scanId: scan.id, executionId, candidates: discovery.candidates.length });
      } catch (err) {
        if (err instanceof CopyrightDiscoveryError) {
          console.error("[COPYRIGHT_SCAN_FAILED]", { scanId: scan.id, executionId, error: err.userMessage });
          await supabase
            .from("copyright_scans")
            .update({
              status: "failed",
              error: err.userMessage,
              stats: {
                ...checkpointStats,
                status: "failed",
                current_stage: "discovering",
                failure_stage: "discovering",
                failure_code: "DISCOVERY_FAILED",
                failure_message: err.userMessage,
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

      // Prioritise high-signal piracy leads by priority score.
      const ordered = [...validCandidates]
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
        .slice(0, 45);

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
>>>>>>> 89d191a (fix copyright scan stalls and failure state handling)
        userId,
        title: data.title,
        keys: data.keys,
        contentType: data.contentType,
        source: "inline",
      });
      const num = (key: string) => {
        const v = result.stats[key];
        return typeof v === "number" ? v : 0;
      };
      return {
        scanId: result.scanId,
        status: result.status,
        summary: {
          candidates: num("candidates"),
          matches: num("matches"),
          graded: num("graded"),
        },
      };
<<<<<<< HEAD
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
=======
      const finalStats = {
        ...initialStats,
        ...stats,
        current_stage: "completed",
        current_stage_started_at: new Date().toISOString(),
        last_checkpoint_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };
      console.log("[COPYRIGHT_SCAN_COMPLETED]", { scanId: scan.id, executionId, matches: allRows.length });
      await supabase
        .from("copyright_scans")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status: "completed", sha256, stats: finalStats as any })
        .eq("id", scan.id);
      return { scanId: scan.id as string, stats: finalStats };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[COPYRIGHT_SCAN_FAILED]", { scanId: scan.id, executionId, stage: currentStage, error: message });
      await supabase
        .from("copyright_scans")
        .update({
          status: "failed",
          error: message.slice(0, 500),
          stats: {
            ...initialStats,
            status: "failed",
            current_stage: currentStage,
            failure_stage: currentStage,
            failure_code: "EXECUTION_FAILED",
            failure_message: message.slice(0, 500),
            failed_at: new Date().toISOString(),
          } as any,
        })
        .eq("id", scan.id);
      throw new Error(message);
>>>>>>> 89d191a (fix copyright scan stalls and failure state handling)
    }
  });

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans")
      .select("*")
      .neq("status", "archived")
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

    const matchRows = (matches ?? []).filter((m) => {
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });
    const stats = (scan.stats ?? {}) as Record<string, unknown>;
    const expectedCount = Number(stats.matches ?? 0);

    if (expectedCount > 0 && matchRows.length === 0) {
      console.warn(
        `[CopyrightScan] Diagnostic Warning: scan_id=${data.scanId} has stats.matches=${expectedCount} but copyright_matches query returned 0 rows.`,
      );
    }

    return { scan, matches: matchRows };
  });

export const retryCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: scan, error } = await supabase
      .from("copyright_scans")
      .select("id, title, frame_paths, storage_path, reference_kind")
      .eq("id", data.scanId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!scan) throw new Error("Scan not found.");

    const framePaths = Array.isArray(scan.frame_paths) ? (scan.frame_paths as string[]) : [];
    const keys = framePaths.length
      ? framePaths
      : scan.storage_path
        ? [scan.storage_path as string]
        : [];
    if (!keys.length) throw new Error("Original reference material is unavailable for retry.");

    await supabase
      .from("copyright_scans")
      .update({ status: "running" })
      .eq("id", scan.id)
      .eq("user_id", userId);

    const { executeCopyrightScanPipeline } = await import("@/lib/copyright/scan-executor.server");
    const result = await executeCopyrightScanPipeline({
      supabase,
      scanId: scan.id as string,
      userId,
      title: scan.title as string,
      keys,
      contentType: "image/jpeg",
      source: "inline",
    });
    return { scanId: result.scanId, status: result.status };
  });

export const listAllCopyrightMatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ includeArchived: z.boolean().optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: matches, error } = await context.supabase
      .from("copyright_matches")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
      return true;
    });

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
    const userId = context.userId;
    console.log("[archivePreviousCopyrightResults] Starting archive", {
      userId,
      keepScanId: data.keepScanId,
    });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, scan_id, evidence, user_id")
      .neq("scan_id", data.keepScanId);

    if (fetchErr) {
      console.error("[archivePreviousCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch previous copyright matches: ${fetchErr.message}`);
    }

    const rowsToArchive = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
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
        .eq("id", row.id);

      if (updErr) {
        console.error(
          `[archivePreviousCopyrightResults] Update error for row_id=${row.id}:`,
          updErr,
        );
        throw new Error(`Failed to archive copyright match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    // Mark previous scans as archived
    await context.supabase
      .from("copyright_scans")
      .update({ status: "archived" })
      .neq("id", data.keepScanId)
      .eq("user_id", userId);

    console.log("[archivePreviousCopyrightResults] Completed successfully", {
      archivedCount: updatedCount,
    });
    return { success: true, archivedCount: updatedCount };
  });

export const archiveScanCopyrightResults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    console.log("[archiveScanCopyrightResults] Starting archive", { userId, scanId: data.scanId });

    const { data: matches, error: fetchErr } = await context.supabase
      .from("copyright_matches")
      .select("id, evidence, user_id")
      .eq("scan_id", data.scanId);

    if (fetchErr) {
      console.error("[archiveScanCopyrightResults] Fetch error:", fetchErr);
      throw new Error(`Failed to fetch scan copyright matches: ${fetchErr.message}`);
    }

    const rowsToArchive = (matches ?? []).filter((m) => {
      if (m.user_id && m.user_id !== userId) return false;
      const ev = (m.evidence ?? {}) as Record<string, unknown>;
      return ev.client_visible !== false;
    });

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
        .eq("id", row.id);

      if (updErr) {
        console.error(`[archiveScanCopyrightResults] Update error for row_id=${row.id}:`, updErr);
        throw new Error(`Failed to archive match ${row.id}: ${updErr.message}`);
      }
      updatedCount++;
    }

    // Mark the scan itself as archived
    await context.supabase
      .from("copyright_scans")
      .update({ status: "archived" })
      .eq("id", data.scanId);

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

export const retryCopyrightScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: scan, error: sErr } = await supabase
      .from("copyright_scans")
      .select("*")
      .eq("id", data.scanId)
      .eq("user_id", userId)
      .single();

    if (sErr || !scan) throw new Error("Scan not found or access denied.");

    await supabase
      .from("copyright_scans")
      .update({
        status: "running",
        stats: {
          ...((scan.stats as Record<string, unknown>) || {}),
          retried_at: new Date().toISOString(),
          status: "running",
          failure_reason: null,
          error: null,
        },
      })
      .eq("id", data.scanId);

    return { success: true, scanId: data.scanId };
  });
