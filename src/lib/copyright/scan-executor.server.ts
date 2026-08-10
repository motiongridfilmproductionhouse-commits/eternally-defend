/**
 * Copyright Intelligence scan executor.
 *
 * Single authoritative pipeline used by both the inline server function and the
 * worker hook, so production always runs one version of discovery → crawl →
 * classification → persistence → truthful terminal state.
 *
 * Terminal states:
 *  - completed : discovery executed; findings may legitimately be 0
 *  - partial   : discovery produced coverage but a later required stage failed
 *  - failed    : the pipeline could not execute
 */

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
import { bytesToDataUrl, readStoredObject } from "@/lib/copyright/storage.server";
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
import { fetchImageBytes, sha256Hex } from "@/lib/aws/s3.server";
import { resolveAbuseContact } from "@/lib/copyright/contacts.server";
import {
  CopyrightScanTracker,
  resolveTerminalStatus,
  USER_SAFE_SCAN_FAILURE_MESSAGE,
} from "@/lib/copyright/scan-failure-diagnostics";
import {
  resolveCopyrightScanWorkerUrl,
  isCopyrightScanWorkerSecretConfigured,
} from "@/lib/copyright/scan-worker-dispatch.server";
import { signCopyrightScanWorkerRequest } from "@/lib/copyright/worker-auth.server";
import type { Database } from "@/integrations/supabase/types";

type MatchInsert = Database["public"]["Tables"]["copyright_matches"]["Insert"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/** Merge admin-only diagnostic keys into scan.stats without dropping existing data. */
export async function recordCopyrightScanDiagnostic(
  supabase: Db,
  scanId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { data } = await supabase
      .from("copyright_scans")
      .select("stats")
      .eq("id", scanId)
      .maybeSingle();
    const stats = (data?.stats ?? {}) as Record<string, unknown>;
    await supabase
      .from("copyright_scans")
      .update({ stats: { ...stats, ...patch } })
      .eq("id", scanId);
  } catch (error) {
    console.error("copyright_scan_diagnostic_persist_failed", {
      scan_id: scanId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Fire-and-forget dispatch of the signed worker hook for a scan. */
export async function dispatchCopyrightScanExecution(
  scanId: string,
  supabase: Db,
): Promise<{ dispatched: boolean; reason?: string }> {
  const url = resolveCopyrightScanWorkerUrl();
  if (!url || !isCopyrightScanWorkerSecretConfigured()) {
    await recordCopyrightScanDiagnostic(supabase, scanId, {
      worker_dispatch_skipped_at: new Date().toISOString(),
      worker_dispatch_skipped_reason: url ? "worker_secret_missing" : "worker_url_missing",
    });
    return { dispatched: false, reason: url ? "worker_secret_missing" : "worker_url_missing" };
  }
  const body = JSON.stringify({ scan_id: scanId });
  const signed = await signCopyrightScanWorkerRequest(body);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-eterna-timestamp": signed.timestamp,
        "x-eterna-signature": signed.signature,
      },
      body,
    });
    await recordCopyrightScanDiagnostic(supabase, scanId, {
      worker_dispatch_at: new Date().toISOString(),
      worker_dispatch_status: response.status,
    });
    return { dispatched: response.ok };
  } catch (error) {
    await recordCopyrightScanDiagnostic(supabase, scanId, {
      worker_dispatch_at: new Date().toISOString(),
      worker_dispatch_error: error instanceof Error ? error.message.slice(0, 200) : "dispatch failed",
    });
    return { dispatched: false, reason: "dispatch_failed" };
  }
}

export interface ExecuteCopyrightScanResult {
  scanId: string;
  status: "completed" | "partial" | "failed";
  stats: Record<string, unknown>;
}

/** Load a scan row and run the full pipeline against it. */
export async function executeCopyrightScanById(input: {
  supabase: Db;
  scanId: string;
  source: "inline" | "worker";
}): Promise<ExecuteCopyrightScanResult> {
  const { supabase, scanId } = input;
  const { data: scan, error } = await supabase
    .from("copyright_scans")
    .select("id, user_id, title, reference_kind, frame_paths, storage_path")
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) throw new Error("Scan not found.");

  const keys: string[] = Array.isArray(scan.frame_paths)
    ? (scan.frame_paths as string[])
    : scan.storage_path
      ? [scan.storage_path as string]
      : [];
  if (!keys.length) throw new Error("Scan has no reference material.");

  return executeCopyrightScanPipeline({
    supabase,
    scanId: scan.id as string,
    userId: scan.user_id as string,
    title: scan.title as string,
    keys,
    contentType: contentTypeForKey(keys[0]!),
    source: input.source,
  });
}

export async function executeCopyrightScanPipeline(input: {
  supabase: Db;
  scanId: string;
  userId: string;
  title: string;
  keys: string[];
  contentType: string;
  source: "inline" | "worker";
}): Promise<ExecuteCopyrightScanResult> {
  const { supabase, scanId, userId, title, keys, contentType } = input;
  const tracker = new CopyrightScanTracker();
  const startedAt = Date.now();

  await recordCopyrightScanDiagnostic(supabase, scanId, {
    worker_started_at: tracker.workerStartedAt,
    worker_source: input.source,
  });

  try {
    tracker.enter("reference_read", "reference_unreadable");
    let firstBytes: Uint8Array;
    try {
      firstBytes = await readStoredObject(keys[0]!);
      if (!firstBytes.length) throw new Error("Reference file is empty.");
    } catch (refErr) {
      await recordCopyrightScanDiagnostic(supabase, scanId, {
        reference_diagnostics: {
          reference_record_found: true,
          reference_object_found: false,
          reference_download_success: false,
          reference_decode_success: false,
          reference_fingerprint_ready: false,
          reference_storage_key: keys[0],
          reference_status: "REFERENCE_IMAGE_UNAVAILABLE",
          error: refErr instanceof Error ? refErr.message : String(refErr),
        },
      });
      throw refErr;
    }

    const sha256 = await sha256Hex(firstBytes);
    const referenceDataUrl = bytesToDataUrl(firstBytes, contentType);

    // 1. AI-vision analysis + AWS Rekognition fingerprint of the reference material.
    tracker.enter("reference_analysis", "reference_analysis_failed");
    const allFrames = await Promise.all(
      keys
        .slice(0, 4)
        .map(async (k, i) =>
          i === 0 ? firstBytes : await readStoredObject(k).catch(() => new Uint8Array()),
        ),
    );
    const [analysis, fingerprint] = await Promise.all([
      analyzeReference(referenceDataUrl, title),
      buildMovieFingerprint(
        allFrames.filter((b) => b.length > 0),
        title,
      ),
    ]);

    await recordCopyrightScanDiagnostic(supabase, scanId, {
      reference_diagnostics: {
        reference_record_found: true,
        reference_object_found: true,
        reference_download_success: true,
        reference_decode_success: true,
        reference_fingerprint_ready: true,
        reference_storage_key: keys[0],
        reference_status: "REFERENCE_FINGERPRINT_READY",
      },
    });

    // 2. Historical suspicious URLs for the same client, seeded into the scan recheck.
    tracker.enter("historical_seed");
    const { data: histMatches } = await supabase
      .from("copyright_matches")
      .select("source_url")
      .eq("user_id", userId)
      .limit(50);
    const historicalUrls = (histMatches ?? [])
      .map((m: { source_url: string | null }) => m.source_url)
      .filter(Boolean) as string[];

    // 3. Discovery across configured providers.
    const byUrl = new Map<string, DiscoveryCandidate>();
    tracker.enter("provider_discovery", "discovery_providers_unavailable");
    let discovery: Awaited<ReturnType<typeof firecrawlDiscover>>;
    try {
      discovery = await firecrawlDiscover(referenceDataUrl, title, 0, analysis, {
        scanId,
        historicalUrls,
      });
    } catch (err) {
      if (err instanceof CopyrightDiscoveryError) {
        tracker.absorbDiscovery(err.diagnostics);
        tracker.failureCode =
          tracker.queriesGenerated === 0
            ? "query_generation_empty"
            : "discovery_providers_unavailable";
        await failScan(supabase, scanId, tracker, err, "failed", {
          discovery_diagnostics: err.diagnostics,
          admin_summary: err.adminSummary,
        });
        return { scanId, status: "failed", stats: {} };
      }
      throw err;
    }
    tracker.absorbDiscovery(discovery.diagnostics);

    tracker.enter("candidate_evaluation");
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
    tracker.candidatePagesDiscovered = byUrl.size;

    // Ensure every valid candidate has a thumbnail URL so no valid result is lost.
    for (const c of validCandidates) {
      if (!c.thumbnail && !c.imageUrl) {
        const host = hostOf(c.url) ?? "domain";
        c.thumbnail = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
      }
    }

    const ordered = [...validCandidates]
      .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
      .slice(0, 45);

    // 4. Evidence grading with a multimodal comparison.
    tracker.enter("classification", "classification_failed");
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
        scan_id: scanId,
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
          reference_frame_path: keys[candidate.frameIndex] ?? keys[0],
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
      tracker.heartbeat();
      const graded = await Promise.all(
        batch.map(async (candidate) => {
          const img = candidate.imageUrl ?? candidate.thumbnail!;
          let rek: FingerprintMatch = EMPTY_MATCH;
          if (fingerprint.available && img && !img.includes("favicons?domain=")) {
            const fetched = await fetchImageBytes(img).catch(() => null);
            if (fetched?.bytes?.length) {
              rek = await matchCandidateAgainstFingerprint(fingerprint, fetched.bytes, title);
            }
          }

          const result = await gradeCandidate({
            referenceDataUrl,
            candidateImageUrl: img,
            candidatePageUrl: candidate.url,
            candidateTitle: candidate.title,
            platform: candidate.source,
            workTitle: title,
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
              `Piracy-signal lead (${candidate.category ?? "web_lead"}) surfaced by "${candidate.keywordMatch ?? candidate.query ?? title}" — requires human review.`) +
              rekReason,
            rek,
          ),
        );
      }
    }

    // Any remaining ungraded valid candidate is still persisted as a review lead.
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
            `Discovered candidate source (${c.category ?? "automated_lead"}) surfaced by "${c.keywordMatch ?? c.query ?? title}" — pending review.`,
          ),
        );
        processedUrls.add(canon);
      }
    }

    // 5. Unauthorized-distribution site inspection (evidence only).
    tracker.enter("page_crawl", "crawl_failed");
    const titles = [title, analysis.title ?? "", ...analysis.altTitles].filter(Boolean);
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
      tracker.heartbeat();
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
        tracker.pagesCrawled += 1;
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
        if (!dist.strongEvidence || dist.domainRisk === "low") continue;

        const contact = resolveAbuseContact(dist.url);
        await registerDistributionSource(supabase, {
          userId,
          scanId,
          workTitle: title,
          platform: contact.platform,
          analysis: dist,
        }).catch(() => null);

        distributionRows.push({
          scan_id: scanId,
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

    // 6. Auto Monitor pass: re-check already-known distribution sources.
    tracker.enter("monitor_pass");
    const monitorPass = await runAutoMonitor(supabase, {
      userId,
      limit: 8,
      force: true,
      runType: "scan",
      excludeDomains: [...inspectedDomains].filter(Boolean),
    }).catch(() => ({ checked: 0, incidents: 0 }));

    tracker.enter("persistence", "persistence_failed");
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

    if (byUrl.size > 0 && allRows.length === 0) {
      throw new Error(
        `Scan completion halted: ${byUrl.size} candidate(s) discovered but 0 candidate rows persisted.`,
      );
    }

    tracker.enter("completion");
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
        (r) => r.scan_id === scanId && r.user_id === userId,
      ),
    };

    const stats: Record<string, unknown> = {
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
      frames: keys.length,
      sha256,
      confirmed: verifiedCount,
      probable: allRows.filter((r) => r.confidence_band === "probable").length,
      review: allRows.filter((r) => r.confidence_band === "review").length,

      // Durable stage accounting (admin-only surfaces).
      terminal_status: "completed",
      queries_generated: tracker.queriesGenerated,
      providers_attempted: tracker.providersAttempted,
      provider_requests_succeeded: tracker.providerRequestsSucceeded,
      candidate_pages_discovered: byUrl.size,
      pages_crawled: crawledPagesCount,
      worker_started_at: tracker.workerStartedAt,
      worker_last_heartbeat_at: new Date().toISOString(),
      worker_source: input.source,
      scan_elapsed_ms: Date.now() - startedAt,
    };

    await supabase
      .from("copyright_scans")
      .update({ status: "completed", sha256, stats })
      .eq("id", scanId);
    return { scanId, status: "completed", stats };
  } catch (e) {
    const terminal = resolveTerminalStatus(tracker);
    await failScan(supabase, scanId, tracker, e, terminal);
    throw new Error(USER_SAFE_SCAN_FAILURE_MESSAGE);
  }
}

/** Write a truthful non-completed terminal state with durable diagnostics. */
async function failScan(
  supabase: Db,
  scanId: string,
  tracker: CopyrightScanTracker,
  error: unknown,
  terminal: "failed" | "partial",
  extra: Record<string, unknown> = {},
): Promise<void> {
  const failure = tracker.build(error, terminal);
  console.error("copyright_scan_failed", { scan_id: scanId, ...failure });

  const { data } = await supabase
    .from("copyright_scans")
    .select("stats")
    .eq("id", scanId)
    .maybeSingle();
  const prior = (data?.stats ?? {}) as Record<string, unknown>;

  await supabase
    .from("copyright_scans")
    .update({
      status: terminal,
      error: USER_SAFE_SCAN_FAILURE_MESSAGE,
      stats: {
        ...prior,
        ...extra,
        ...failure,
        failure_diagnostics: failure,
        candidate_pages: tracker.candidatePagesDiscovered,
        crawled_pages: tracker.pagesCrawled,
      },
    })
    .eq("id", scanId);
}
