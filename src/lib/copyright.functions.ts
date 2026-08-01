import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSignedPutUrl, putObject, sha256Hex } from "@/lib/aws/s3.server";
import { hostOf, canonicalUrl, type DiscoveryCandidate } from "@/lib/copyright/url.server";
import { analyzeReference, firecrawlDiscover } from "@/lib/copyright/discover.server";
import { bytesToDataUrl, copyrightImageTypes } from "@/lib/copyright/storage.server";
import { readStoredObject } from "@/lib/copyright/storage.server";

import { bandFor, gradeCandidate } from "@/lib/copyright/classify.server";
import { analyzeDistributionPage, releaseTimingFor } from "@/lib/copyright/distribution.server";
import {
  registerDistributionSource,
  runAutoMonitor,
  shouldRegisterMonitoredSource,
} from "@/lib/copyright/distribution-monitor.server";
import {
  isActionablePiracy,
  normalizeClassification,
} from "@/lib/copyright/taxonomy";
import { filterClientVisibleCopyrightMatches } from "@/lib/copyright/client-filter";
import { detectPrimaryPurpose } from "@/lib/copyright/page-classify.server";
import { expandTitleVariants } from "@/lib/copyright/title-identity";
import { explainZeroMatchFunnel } from "@/lib/copyright/scan-diagnostics";
import {
  acceptedKnownUrls,
  parseKnownUrlInputs,
  prioritizeKnownUrlLeads,
  validateKnownUrlSeeds,
} from "@/lib/copyright/known-urls.server";
import { isNeverMonitoredDomain } from "@/lib/copyright/official-platforms";

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
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(copyrightImageTypes),
    size: z.number().int().positive().max(12 * 1024 * 1024),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const key = `clients/${context.userId}/copyright/${crypto.randomUUID()}-${safe}`;
    return { key, uploadUrl: await getSignedPutUrl(key, data.contentType, 600) };
  });

/** Same-origin fallback upload used by the Copyright scanner to avoid fragile browser-to-S3 PUT failures. */
export const uploadCopyrightReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    fileName: z.string().min(1).max(180),
    contentType: z.enum(copyrightImageTypes),
    base64: z.string().min(1).max(20 * 1024 * 1024),
  }).parse(raw))
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
  .inputValidator((raw) => z.object({
    title: z.string().trim().min(1).max(200),
    referenceKind: z.enum(["image", "video"]),
    contentType: z.enum(copyrightImageTypes),
    /** Frame keys: one for a still, several sampled frames for a video. */
    keys: z.array(z.string().min(10).max(500)).min(1).max(6),
    /** Optional known public URLs to investigate first (max 10). Never auto-guilty. */
    knownUrls: z.array(z.string().trim().min(8).max(2000)).max(10).optional(),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `clients/${userId}/copyright/`;
    if (data.keys.some((k) => !k.startsWith(prefix))) throw new Error("Invalid reference storage path.");

    const { data: scan, error: sErr } = await supabase.from("copyright_scans").insert({
      user_id: userId,
      title: data.title,
      reference_kind: data.referenceKind,
      storage_path: data.keys[0],
      frame_paths: data.keys,
      status: "running",
    }).select("id").single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Could not start scan.");

    try {
      const firstBytes = await readStoredObject(data.keys[0]);
      if (!firstBytes.length) throw new Error("Reference file is empty.");
      const sha256 = await sha256Hex(firstBytes);
      const referenceDataUrl = bytesToDataUrl(firstBytes, data.contentType);

      // 1. AI-vision analysis + AWS Rekognition fingerprint of the reference material.
      const allFrames = await Promise.all(
        data.keys.slice(0, 4).map(async (k, i) => (i === 0 ? firstBytes : await readStoredObject(k).catch(() => new Uint8Array()))),
      );
      const [analysis, fingerprint] = await Promise.all([
        analyzeReference(referenceDataUrl, data.title),
        buildMovieFingerprint(allFrames.filter((b) => b.length > 0), data.title),
      ]);

      // 2a. Optional known-URL seeds (high priority) — validated before provider search.
      const knownInputs = parseKnownUrlInputs(data.knownUrls ?? []);
      const knownSeeds = await validateKnownUrlSeeds(knownInputs);
      const knownAccepted = acceptedKnownUrls(knownSeeds);

      // 2b. Firecrawl reverse discovery, seeded by that analysis.
      const byUrl = new Map<string, DiscoveryCandidate>();
      const discovery = await firecrawlDiscover(referenceDataUrl, data.title, 0, analysis);
      for (const c of discovery.candidates) {
        if (!byUrl.has(c.url)) byUrl.set(c.url, c);
      }


      // Prioritise high-signal piracy leads, keep the grading budget bounded.
      const ordered = [...byUrl.values()]
        .filter((c) => c.thumbnail || c.imageUrl)
        .sort((a, b) => Number(b.exact) - Number(a.exact))
        .slice(0, 40);

      // 3. Evidence grading with a multimodal comparison.
      // Image/OCR path produces identity-only internal leads — never actionable piracy.
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
        return {
          scan_id: scan.id,
          user_id: userId,
          source_url: canonicalUrl(candidate.url),
          platform: contact.platform,
          page_title: candidate.title,
          thumbnail_url: candidate.thumbnail ?? candidate.imageUrl,
          confidence,
          confidence_band: bandFor(confidence),
          detection_type: detectionType,
          transformations,
          evidence: {
            reference_frame_index: candidate.frameIndex,
            reference_frame_path: data.keys[candidate.frameIndex] ?? data.keys[0],
            candidate_image_url: candidate.imageUrl ?? candidate.thumbnail,
            discovery: candidate.exact ? "piracy_lead" : "visual_match",
            discovery_query: candidate.query ?? null,
            keyword_match: candidate.keywordMatch ?? candidate.query ?? null,
            piracy_category: candidate.category ?? null,
            website_type: candidate.websiteType ?? null,
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
        const graded = await Promise.all(batch.map(async (candidate) => {
          const img = candidate.imageUrl ?? candidate.thumbnail!;

          // AWS Rekognition corroboration on the candidate image (best effort).
          let rek: FingerprintMatch = EMPTY_MATCH;
          if (fingerprint.available) {
            const fetched = await fetchImageBytes(img).catch(() => null);
            if (fetched?.bytes?.length) {
              rek = await matchCandidateAgainstFingerprint(fingerprint, fetched.bytes, data.title);
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
        }));


        for (const { candidate, result, rek } of graded) {
          const blended = blendConfidence(result ? result.confidence : null, rek);
          const rekStrong = rek.signals.length >= 2;
          // Identity match only — poster/OCR/actors never prove illegal distribution.
          const identityMatch = result
            ? (!result.falsePositive || rek.signals.length >= 3) &&
              (result.detectionType !== "unrelated" && result.detectionType !== "UNRELATED") &&
              blended >= 50
            : rekStrong && blended >= 50;

          const rekReason = rek.signals.length
            ? ` AWS recognition: ${rek.signals.join("; ")}.`
            : "";

          const purpose = detectPrimaryPurpose({
            url: candidate.url,
            pageTitle: candidate.title,
            text: `${candidate.title ?? ""} ${candidate.category ?? ""} ${candidate.query ?? ""}`,
            host: hostOf(candidate.url),
          });

          // Image/OCR path can only produce non-actionable identity leads.
          // Actionable piracy requires exact-page distribution evidence (below).
          let identityType = "DUPLICATE_ARTWORK_ONLY";
          if (purpose === "cinema_or_showtime" || candidate.category === "cinema_or_showtime") {
            identityType = "CINEMA_OR_SHOWTIME";
          } else if (purpose === "trailer_or_promo" || result?.detectionType === "trailer_copy") {
            identityType = "TRAILER_OR_PROMO";
          } else if (purpose === "review_or_news") {
            identityType = "REVIEW_OR_NEWS";
          } else if (purpose === "cast_or_information") {
            identityType = "CAST_OR_INFORMATION";
          } else if (purpose === "social_discussion" || candidate.category === "forum_post") {
            identityType = "SOCIAL_DISCUSSION";
          } else if (purpose === "official_or_authorized") {
            identityType = "OFFICIAL_OR_AUTHORIZED";
          } else if (
            result?.detectionType &&
            !isActionablePiracy(result.detectionType) &&
            result.detectionType !== "unrelated" &&
            result.detectionType !== "ripped_copy" &&
            result.detectionType !== "video_clip" &&
            result.detectionType !== "cam_recording"
          ) {
            identityType = normalizeClassification(result.detectionType);
          }

          if (identityMatch) {
            const row = buildRow(
              candidate,
              Math.min(blended, 49),
              identityType,
              [...(result?.transformations ?? []), ...(rek.watermarkMatch ? ["watermark_match"] : [])],
              result?.ocrText ?? (rek.matchedOcrText.join(" | ") || null),
              result?.watermark ?? rek.watermarkMatch,
              `${result?.reason ?? "Identity/artwork match."}${rekReason} Artwork, OCR, or actor similarity proves relevance only — not unauthorized distribution.`,
              rek,
            );
            row.evidence = {
              ...(row.evidence as Record<string, unknown>),
              client_visible: false,
              identity_only: true,
              classification: identityType,
            };
            // Persist non-actionable identity leads internally; never as piracy.
            fallbackRows.push(row);
            continue;
          }

          ignored++;
          if ((candidate.exact || rek.signals.length >= 1) && !(result?.falsePositive && blended < 20)) {
            const leadRow = buildRow(
              candidate,
              Math.max(20, Math.min(40, blended || 25)),
              "UNVERIFIED_LEAD",
              result?.transformations ?? [],
              result?.ocrText ?? null,
              result?.watermark ?? rek.watermarkMatch,
              (result?.reason ||
                `Unverified discovery lead (${candidate.category ?? "web_lead"}) from "${candidate.keywordMatch ?? candidate.query ?? data.title}" — requires exact-page distribution evidence.`) + rekReason,
              rek,
            );
            leadRow.evidence = {
              ...(leadRow.evidence as Record<string, unknown>),
              client_visible: false,
              classification: "UNVERIFIED_LEAD",
            };
            fallbackRows.push(leadRow);
          }
        }
      }

      // 4. Unauthorized-distribution site inspection. Exact-page crawl required.
      //    Identity (title/poster/OCR) alone never qualifies. Fail closed on crawl failure.
      const titleSeeds = [data.title, analysis.title ?? "", ...analysis.altTitles].filter(Boolean);
      const titles = [...new Set([
        ...titleSeeds,
        ...titleSeeds.flatMap((t) => expandTitleVariants(t).filter((v) => /[\s-]/.test(v))),
      ])].slice(0, 12);
      const releaseDate = analysis.releaseDate;
      // Known URLs first so they receive crawl budget before provider candidates.
      const knownLeadUrls = knownAccepted.map((url) => ({
        url,
        title: data.title,
        query: "known_url_seed",
        text: data.title,
        strong: true as const,
      }));
      const providerLeads = discovery.pageLeads
        .sort((a2, b2) => Number(b2.strong) - Number(a2.strong));
      const leadUrls = prioritizeKnownUrlLeads(knownLeadUrls, providerLeads, 32);

      const distributionRows: MatchInsert[] = [];
      const internalRows: MatchInsert[] = [];
      const inspectedDomains = new Set<string>();
      const inspectedUrls = new Set<string>();
      const detailFollowQueue: string[] = [];
      type KnownUrlInvestigation = {
        url: string;
        host?: string | null;
        accepted?: boolean;
        reject_reason?: string | null;
        reject_detail?: string | null;
        classification: string;
        client_visible: boolean;
        strong_evidence?: boolean;
        crawl_failed?: boolean;
        page_title?: string | null;
        identity_evidence?: string[];
        access_evidence?: string[];
        indicator_keys?: string[];
        embed_sources?: string[];
        distribution_links?: string[];
        reason?: string | null;
        registered?: boolean;
        visibility_decision?: string;
      };
      const knownUrlInvestigations: KnownUrlInvestigation[] = [];

      // Persist unsafe/rejected known URLs as internal investigation leads (fail closed).
      for (const seed of knownSeeds.filter((s) => !s.accepted)) {
        const contact = resolveAbuseContact(seed.url);
        internalRows.push({
          scan_id: scan.id,
          user_id: userId,
          source_url: canonicalUrl(seed.url),
          platform: contact.platform,
          page_title: `Known URL rejected: ${seed.rejectReason ?? "unsafe"}`,
          thumbnail_url: null,
          confidence: 0,
          confidence_band: "review",
          detection_type: "INVESTIGATION_LEAD",
          transformations: [],
          evidence: {
            discovery: "known_url_seed",
            client_visible: false,
            classification: "INVESTIGATION_LEAD",
            known_url: {
              input: seed.input,
              accepted: false,
              reject_reason: seed.rejectReason,
              reject_detail: seed.rejectDetail,
            },
          },
          ocr_text: null,
          reason:
            seed.rejectDetail ||
            `Known URL failed safety validation (${seed.rejectReason ?? "rejected"}) — fail closed, not classified as infringement.`,
          contact: contact as unknown as MatchInsert["contact"],
        });
        knownUrlInvestigations.push({
          url: seed.url,
          accepted: false,
          reject_reason: seed.rejectReason,
          reject_detail: seed.rejectDetail,
          classification: "INVESTIGATION_LEAD",
          client_visible: false,
        });
      }

      let pagesCrawled = 0;
      let pagesFailed = 0;
      let cinemaRejected = 0;
      let trailerRejected = 0;
      let reviewRejected = 0;
      let socialRejected = 0;
      let artworkRejected = 0;
      let officialRejected = 0;
      let youtubePromoRejected = 0;
      let catalogListingRejected = 0;
      let titleIdentityRejected = 0;
      let accessEvidenceRejected = 0;
      let hardNegativeRejected = 0;
      let listingPagesFound = 0;
      let accessEvidencePages = 0;
      let embeddedPlayers = 0;
      let downloadPages = 0;
      let fileHostDestinations = 0;
      let torrentsMagnets = 0;
      let theatrePrintFindings = 0;
      let detailPagesFollowed = 0;
      let registeredMonitoredSources = 0;

      const distributionSummary: Array<{
        url: string;
        domain_risk: string;
        content_type: string;
        classification: string;
        release_timing: string;
        confidence: number;
        strong_evidence: boolean;
        client_visible: boolean;
        indicators: string[];
      }> = [];

      const ingestDistribution = async (
        dist: Awaited<ReturnType<typeof analyzeDistributionPage>>,
        leadQuery: string | null,
        leadTitle: string | null,
      ) => {
        const key = canonicalUrl(dist.url);
        if (inspectedUrls.has(key)) return;
        inspectedUrls.add(key);
        inspectedDomains.add((dist.domain ?? "").toLowerCase());
        pagesCrawled += 1;

        if (dist.crawlFailed) pagesFailed += 1;

        switch (dist.classification) {
          case "CINEMA_OR_SHOWTIME":
            cinemaRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "TRAILER_OR_PROMO":
            trailerRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "REVIEW_OR_NEWS":
          case "CAST_OR_INFORMATION":
            reviewRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "SOCIAL_DISCUSSION":
            socialRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "OFFICIAL_OR_AUTHORIZED":
          case "OFFICIAL_OR_AUTHORIZED_PAGE":
            officialRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "CATALOG_OR_LISTING":
            catalogListingRejected += 1;
            hardNegativeRejected += 1;
            break;
          case "DUPLICATE_ARTWORK_ONLY":
            artworkRejected += 1;
            break;
          default:
            break;
        }
        if (
          dist.classification === "TRAILER_OR_PROMO" &&
          isNeverMonitoredDomain(dist.url)
        ) {
          youtubePromoRejected += 1;
        }

        if (dist.detailFollowUrls.length) listingPagesFound += 1;

        if (!dist.crawlFailed && !dist.identityEvidence.length && !dist.clientVisible) {
          titleIdentityRejected += 1;
        }
        if (
          dist.identityEvidence.length &&
          !dist.strongEvidence &&
          !dist.clientVisible &&
          dist.classification !== "CINEMA_OR_SHOWTIME" &&
          dist.classification !== "TRAILER_OR_PROMO" &&
          dist.classification !== "REVIEW_OR_NEWS" &&
          dist.classification !== "CAST_OR_INFORMATION" &&
          dist.classification !== "SOCIAL_DISCUSSION" &&
          dist.classification !== "OFFICIAL_OR_AUTHORIZED" &&
          dist.classification !== "DUPLICATE_ARTWORK_ONLY"
        ) {
          accessEvidenceRejected += 1;
        }

        if (dist.indicatorKeys.includes("embedded_player")) embeddedPlayers += 1;
        if (dist.classification === "DOWNLOAD_PAGE") downloadPages += 1;
        if (dist.classification === "FILE_HOST_DISTRIBUTION") fileHostDestinations += 1;
        if (dist.classification === "TORRENT_OR_MAGNET") torrentsMagnets += 1;
        if (dist.classification === "THEATRE_PRINT_DISTRIBUTION") theatrePrintFindings += 1;
        if (dist.strongEvidence) accessEvidencePages += 1;

        for (const detail of dist.detailFollowUrls) {
          if (!inspectedUrls.has(canonicalUrl(detail))) detailFollowQueue.push(detail);
        }

        distributionSummary.push({
          url: dist.url,
          domain_risk: dist.domainRisk,
          content_type: dist.contentType,
          classification: dist.classification,
          release_timing: dist.releaseTiming,
          confidence: dist.confidence,
          strong_evidence: dist.strongEvidence,
          client_visible: dist.clientVisible,
          indicators: dist.indicatorKeys,
        });

        const contact = resolveAbuseContact(dist.url);
        const matchRow: MatchInsert = {
          scan_id: scan.id,
          user_id: userId,
          source_url: key,
          platform: contact.platform,
          page_title: dist.pageTitle ?? leadTitle,
          thumbnail_url: dist.screenshot,
          confidence: dist.confidence,
          confidence_band: bandFor(dist.confidence),
          detection_type: dist.classification,
          transformations: dist.qualityTags.slice(0, 8),
          evidence: {
            discovery: "distribution_site",
            discovery_query: leadQuery,
            keyword_match: leadQuery,
            host: hostOf(dist.url),
            website_type: dist.contentType,
            detected_language: analysis.language,
            reference_release_date: releaseDate,
            client_visible: dist.clientVisible,
            classification: dist.classification,
            identity_evidence: dist.identityEvidence,
            access_evidence: dist.accessEvidence,
            confidence_breakdown: dist.confidenceBreakdown,
            embed_sources: dist.embedSources,
            distribution: {
              domain: dist.domain,
              domain_risk: dist.domainRisk,
              content_type: dist.contentType,
              classification: dist.classification,
              release_timing: dist.releaseTiming,
              release_offset_days: dist.releaseOffsetDays,
              piracy_indicators: dist.indicators.map((i) => ({
                key: i.key, detail: i.detail, weight: i.weight, strong: i.strong,
              })),
              indicator_keys: dist.indicatorKeys,
              distribution_links: dist.distributionLinks,
              quality_tags: dist.qualityTags,
              strong_evidence: dist.strongEvidence,
              client_visible: dist.clientVisible,
              identity_evidence: dist.identityEvidence,
              access_evidence: dist.accessEvidence,
              confidence_breakdown: dist.confidenceBreakdown,
              evidence_screenshot: dist.screenshot,
              embed_sources: dist.embedSources,
            },
          },
          ocr_text: null,
          reason: dist.reason,
          contact: contact as unknown as MatchInsert["contact"],
        };

        if (leadQuery === "known_url_seed") {
          knownUrlInvestigations.push({
            url: dist.url,
            host: dist.domain,
            classification: dist.classification,
            client_visible: dist.clientVisible,
            strong_evidence: dist.strongEvidence,
            crawl_failed: dist.crawlFailed,
            page_title: dist.pageTitle,
            identity_evidence: dist.identityEvidence,
            access_evidence: dist.accessEvidence,
            indicator_keys: dist.indicatorKeys,
            embed_sources: dist.embedSources,
            distribution_links: dist.distributionLinks,
            reason: dist.reason,
            registered: false,
            visibility_decision: dist.clientVisible
              ? "client_visible_actionable"
              : dist.crawlFailed
                ? "fail_closed_crawl"
                : "internal_or_non_actionable",
          });
        }

        if (
          dist.clientVisible &&
          dist.strongEvidence &&
          isActionablePiracy(dist.classification) &&
          shouldRegisterMonitoredSource(dist)
        ) {
          const registered = await registerDistributionSource(supabase, {
            userId,
            scanId: scan.id,
            workTitle: data.title,
            platform: contact.platform,
            analysis: dist,
          }).catch(() => null);
          if (registered) {
            registeredMonitoredSources += 1;
            if (leadQuery === "known_url_seed") {
              const last = knownUrlInvestigations[knownUrlInvestigations.length - 1];
              if (last) last.registered = true;
            }
          }
          distributionRows.push(matchRow);
        } else if (
          dist.clientVisible &&
          dist.strongEvidence &&
          isActionablePiracy(dist.classification)
        ) {
          // Actionable finding for UI but not eligible for domain monitoring
          // (e.g. never-monitor hosts) — still show as client-visible match.
          distributionRows.push(matchRow);
        } else if (dist.classification !== "UNRELATED") {
          // Retain internal diagnostics / non-actionable classifications.
          matchRow.evidence = {
            ...(matchRow.evidence as Record<string, unknown>),
            client_visible: false,
          };
          internalRows.push(matchRow);
        }
      };

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
            }),
          })),
        );

        for (const { lead, analysis: dist } of analyses) {
          await ingestDistribution(dist, lead.query, lead.title);
        }
      }

      // Bounded same-domain detail follow from listing pages.
      const details = detailFollowQueue.slice(0, 12);
      for (let offset = 0; offset < details.length; offset += 4) {
        const batch = details.slice(offset, offset + 4);
        const analyses = await Promise.all(
          batch.map(async (url) =>
            analyzeDistributionPage({
              url,
              titles,
              releaseDate,
              skipDetailFollow: true,
            }),
          ),
        );
        for (const dist of analyses) {
          detailPagesFollowed += 1;
          await ingestDistribution(dist, "detail_follow", dist.pageTitle);
        }
      }

      // 5. Auto Monitor pass: re-check already-known distribution sources that
      //    were not crawled by this scan, so every movie scan covers the full
      //    registered source list without duplicating crawls.
      const monitorPass = await runAutoMonitor(supabase, {
        userId,
        limit: 8,
        force: true,
        runType: "scan",
        excludeDomains: [...inspectedDomains].filter(Boolean),
      }).catch(() => ({ checked: 0, incidents: 0 }));

      // Persist actionable findings + a bounded set of internal non-piracy leads.
      // Internal leads never use ripped_copy and are marked client_visible: false.
      const seenUrls = new Set(distributionRows.map((r) => r.source_url));
      const internalPersist = [...internalRows, ...fallbackRows]
        .filter((r) => !seenUrls.has(r.source_url) && !isActionablePiracy(r.detection_type))
        .slice(0, 20);
      const allRows = [...distributionRows, ...internalPersist];

      if (allRows.length) {
        const { error: mErr } = await supabase.from("copyright_matches").upsert(allRows, { onConflict: "scan_id,source_url" });
        if (mErr) throw new Error(mErr.message);
      }

      const clientVisibleFindings = filterClientVisibleCopyrightMatches(distributionRows);

      const uniqueCandidatePages = new Set([
        ...byUrl.keys(),
        ...discovery.pageLeads.map((l) => canonicalUrl(l.url)),
      ]).size;
      const artworkOnlyRejected =
        artworkRejected +
        fallbackRows.filter((r) => r.detection_type === "DUPLICATE_ARTWORK_ONLY").length;

      const stats = {
        candidates: byUrl.size,
        graded: ordered.length,
        rekognition: fingerprint.available,
        recognized_actors: fingerprint.celebrities,
        scene_labels: fingerprint.labels.slice(0, 12),
        reference_faces: fingerprint.faceCount,
        matches: clientVisibleFindings.length,
        leads: internalPersist.length,
        queries_generated: discovery.queriesGenerated,
        queries_executed: discovery.queriesExecuted,
        provider_candidates: byUrl.size,
        provider_results: byUrl.size + discovery.pageLeads.length,
        unique_candidate_pages: uniqueCandidatePages,
        known_urls_submitted: knownInputs.length,
        known_urls_accepted: knownAccepted.length,
        known_urls_rejected: knownSeeds.filter((s) => !s.accepted).length,
        known_url_investigations: knownUrlInvestigations.slice(0, 12),
        listing_pages_found: listingPagesFound,
        detail_pages_followed: detailPagesFollowed,
        pages_crawled: pagesCrawled,
        pages_failed: pagesFailed,
        title_identity_rejected: titleIdentityRejected,
        hard_negative_rejected: hardNegativeRejected,
        access_evidence_rejected: accessEvidenceRejected,
        official_authorized_rejected: officialRejected,
        youtube_promotional_rejected: youtubePromoRejected,
        catalog_listing_rejected: catalogListingRejected,
        cinema_showtime_rejected: cinemaRejected,
        trailer_promo_rejected: trailerRejected,
        review_news_rejected: reviewRejected,
        social_discussion_rejected: socialRejected,
        artwork_only_rejected: artworkOnlyRejected,
        registered_monitored_sources: registeredMonitoredSources,
        access_evidence_pages: accessEvidencePages,
        embedded_players: embeddedPlayers,
        download_pages: downloadPages,
        file_host_destinations: fileHostDestinations,
        torrents_magnets: torrentsMagnets,
        theatre_print_findings: theatrePrintFindings,
        internal_leads_persisted: internalPersist.length,
        client_visible_findings: clientVisibleFindings.length,
        verified_client_visible_findings: clientVisibleFindings.length,
        distribution_pages_inspected: leadUrls.length + detailPagesFollowed,
        distribution_sites: distributionRows.length,
        distribution_high_risk: distributionSummary.filter((d) => d.domain_risk === "high").length,
        distribution_summary: distributionSummary.slice(0, 25),
        rejection_funnel: explainZeroMatchFunnel({
          queries_generated: discovery.queriesGenerated,
          queries_executed: discovery.queriesExecuted,
          provider_results: byUrl.size + discovery.pageLeads.length,
          unique_candidate_pages: uniqueCandidatePages,
          listing_pages_found: listingPagesFound,
          detail_pages_followed: detailPagesFollowed,
          pages_crawled: pagesCrawled,
          pages_failed: pagesFailed,
          title_identity_rejected: titleIdentityRejected,
          hard_negative_rejected: hardNegativeRejected,
          access_evidence_rejected: accessEvidenceRejected,
          artwork_only_rejected: artworkOnlyRejected,
          access_evidence_pages: accessEvidencePages,
          embedded_players: embeddedPlayers,
          download_pages: downloadPages,
          file_host_destinations: fileHostDestinations,
          torrents_magnets: torrentsMagnets,
          theatre_print_findings: theatrePrintFindings,
          internal_leads_persisted: internalPersist.length,
          client_visible_findings: clientVisibleFindings.length,
        }),
        title_variants_used: titles.slice(0, 8),
        monitored_sources_checked: monitorPass.checked,
        monitor_incidents: monitorPass.incidents,

        release_timing: releaseTimingFor(releaseDate).timing,
        queries_language: analysis.language,
        release_date: analysis.releaseDate,

        ignored,
        frames: data.keys.length,
        sha256,
        confirmed: clientVisibleFindings.filter((r) => r.confidence_band === "confirmed").length,
        probable: clientVisibleFindings.filter((r) => r.confidence_band === "probable").length,
        review: clientVisibleFindings.filter((r) => r.confidence_band === "review").length,
      };
      await supabase.from("copyright_scans").update({ status: "completed", sha256, stats }).eq("id", scan.id);
      return { scanId: scan.id as string, stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase.from("copyright_scans").update({ status: "failed", error: message.slice(0, 500) }).eq("id", scan.id);
      throw new Error(message);
    }
  });

export const listCopyrightScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copyright_scans").select("*")
      .order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCopyrightScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scanId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: scan, error } = await context.supabase
      .from("copyright_scans").select("*").eq("id", data.scanId).single();
    if (error) throw new Error(error.message);
    const { data: matches, error: mErr } = await context.supabase
      .from("copyright_matches").select("*").eq("scan_id", data.scanId)
      .order("confidence", { ascending: false });
    if (mErr) throw new Error(mErr.message);
    // Raw / non-actionable / identity-only rows stay internal — never as piracy UI.
    return {
      scan,
      matches: filterClientVisibleCopyrightMatches(matches ?? []),
    };
  });

export const updateCopyrightMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({
    matchId: z.string().uuid(),
    reviewStatus: z.enum(["pending", "evidence_ready", "dismissed"]),
  }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("copyright_matches").update({ review_status: data.reviewStatus }).eq("id", data.matchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
