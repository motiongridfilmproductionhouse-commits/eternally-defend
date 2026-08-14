/**
 * Public-web asset discovery worker.
 *
 * Pipeline (one `asset_discovery_jobs` row per run):
 *
 *   protected_asset (real perceptual hashes / keyframe hashes)
 *        -> reverse-image providers (Google Lens via SerpApi, Bing Visual)
 *        -> normalized `discovery_candidates` (exact page_url + media_url)
 *        -> real retrieval of the exact page + candidate media
 *        -> perceptual comparison against the protected fingerprint
 *        -> `copyright_matches` (review_status = 'pending') only when verified
 *
 * Guarantees:
 *  - A provider result is a LEAD. It is never written as a match.
 *  - Retrieval failure keeps the candidate as UNVERIFIED/FETCH_FAILED with the
 *    reason recorded, so coverage loss is visible instead of silent.
 *  - Candidate identity is the canonical page URL, so re-runs update rather
 *    than duplicate (rotating CDN media URLs do not create new rows).
 *  - No enforcement, no notices, no takedowns happen here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { getSignedGetUrl } from "@/lib/aws/s3.server";
import { reverseImageProvidersConfigured, reverseImageSearch } from "@/lib/discovery/reverse-image.server";
import { isHostDisabledForFeature } from "@/lib/policy/source-policy";
import { retrieveCopyrightPage } from "@/lib/copyright/page-retrieve.server";
import {
  verifyCandidateUrl,
  type CandidateVerification,
  type ProtectedFingerprint,
} from "@/lib/media/candidate-verification.server";
import { classifyPlatform } from "@/lib/media/platform-classifier";
import { decideCandidateOutcome } from "./candidate-match-decision";
import { normalizeCandidateBatch, type NormalizedCandidate } from "./candidate-normalize";

type Client = SupabaseClient<Database>;

const FEATURE = "copyright_intel" as const;
const MAX_CANDIDATES_PER_RUN = 60;
const MAX_VERIFY_PER_RUN = 40;

export interface DiscoveryRunResult {
  jobId: string;
  status: "completed" | "failed";
  discovered: number;
  fetched: number;
  verified: number;
  rejected: number;
  matchesCreated: number;
  diagnostics: Record<string, unknown>;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* fingerprint                                                         */
/* ------------------------------------------------------------------ */
export async function loadProtectedFingerprint(
  supabase: Client,
  userId: string,
  protectedAssetId: string,
): Promise<{
  fingerprint: ProtectedFingerprint;
  asset: Database["public"]["Tables"]["protected_assets"]["Row"];
  isVideo: boolean;
} | null> {
  const { data: asset, error } = await supabase
    .from("protected_assets")
    .select("*")
    .eq("id", protectedAssetId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!asset) return null;

  const { data: frames, error: fErr } = await supabase
    .from("protected_asset_frames")
    .select("frame_index,timestamp_seconds,phash,dhash,ahash")
    .eq("protected_asset_id", protectedAssetId)
    .eq("user_id", userId)
    .order("frame_index", { ascending: true });
  if (fErr) throw new Error(fErr.message);

  return {
    asset,
    isVideo: (asset.kind ?? "").toLowerCase().includes("video") || (frames?.length ?? 0) > 0,
    fingerprint: {
      protectedAssetId,
      phash: asset.phash,
      dhash: asset.dhash,
      ahash: asset.ahash,
      frames: (frames ?? []).map((f) => ({
        frameIndex: f.frame_index,
        timestampSeconds: f.timestamp_seconds,
        phash: f.phash,
        dhash: f.dhash,
        ahash: f.ahash,
      })),
    },
  };
}

function isFingerprinted(fp: ProtectedFingerprint): boolean {
  if (fp.phash || fp.dhash || fp.ahash) return true;
  return (fp.frames ?? []).some((f) => f.phash || f.dhash || f.ahash);
}

/* ------------------------------------------------------------------ */
/* stage 1 — seed candidates                                           */
/* ------------------------------------------------------------------ */
async function seedCandidates(
  storagePath: string | null,
  sourceUrl: string | null,
  subjectHint: string,
): Promise<{
  candidates: NormalizedCandidate[];
  diagnostics: Record<string, unknown>;
}> {
  const configured = reverseImageProvidersConfigured();
  if (!configured.length) {
    return {
      candidates: [],
      diagnostics: { seed_error: "no_reverse_image_provider_configured", configured_providers: [] },
    };
  }

  const seedUrl = storagePath ? await getSignedGetUrl(storagePath, 900) : sourceUrl;
  if (!seedUrl) {
    return {
      candidates: [],
      diagnostics: { seed_error: "protected_asset_has_no_retrievable_media", configured_providers: configured },
    };
  }

  const report = await reverseImageSearch(seedUrl, { subjectHint });
  const { candidates, rejected } = normalizeCandidateBatch(
    report.candidates.map((c) => ({
      pageUrl: c.pageUrl,
      imageUrl: c.imageUrl,
      thumbnailUrl: c.thumbnailUrl,
      title: c.title,
      provider: c.provider,
      matchType: c.matchType,
      platform: c.platform,
    })),
  );

  // Product-rule source exclusions (see src/lib/policy/source-policy.ts).
  const allowed = candidates.filter((c) => !isHostDisabledForFeature(FEATURE, c.canonicalPageUrl));

  return {
    candidates: allowed.slice(0, MAX_CANDIDATES_PER_RUN),
    diagnostics: {
      configured_providers: configured,
      providers_succeeded: report.providersSucceeded,
      providers_failed: report.providersFailed,
      best_guess_labels: report.bestGuessLabels.slice(0, 5),
      raw_provider_candidates: report.candidates.length,
      normalized_candidates: candidates.length,
      policy_excluded: candidates.length - allowed.length,
      normalization_rejected: rejected.length,
      normalization_rejection_reasons: rejected.reduce<Record<string, number>>((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* stage 2 — persist candidates (idempotent)                           */
/* ------------------------------------------------------------------ */
async function persistCandidates(
  supabase: Client,
  userId: string,
  protectedAssetId: string,
  jobId: string,
  candidates: NormalizedCandidate[],
): Promise<number> {
  if (!candidates.length) return 0;
  const now = new Date().toISOString();
  const { error } = await supabase.from("discovery_candidates").upsert(
    candidates.map((c) => ({
      user_id: userId,
      protected_asset_id: protectedAssetId,
      job_id: jobId,
      page_url: c.pageUrl,
      canonical_page_url: c.canonicalPageUrl,
      media_url: c.mediaUrl,
      provider: c.provider,
      match_type: c.matchType,
      page_title: c.pageTitle,
      platform: c.platform,
      host: c.host,
      last_seen_at: now,
    })),
    { onConflict: "user_id,protected_asset_id,canonical_page_url" },
  );
  if (error) throw new Error(error.message);
  return candidates.length;
}

/* ------------------------------------------------------------------ */
/* stage 3 — retrieve + verify                                         */
/* ------------------------------------------------------------------ */
const IMG_SRC_RE = /<img[^>]+src=["']([^"']+)["']/gi;
const OG_IMAGE_RE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi;

/** Candidate media URLs found on the retrieved page, best-first. */
export function mediaUrlsFromPage(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    try {
      out.push(new URL(value, baseUrl).toString());
    } catch {
      /* ignore unusable src */
    }
  };
  for (const m of html.matchAll(OG_IMAGE_RE)) push(m[1]);
  for (const m of html.matchAll(IMG_SRC_RE)) {
    if (m[1].startsWith("data:")) continue;
    push(m[1]);
  }
  return Array.from(new Set(out)).slice(0, 12);
}

async function verifyOneCandidate(
  fingerprint: ProtectedFingerprint,
  referenceSha256: string | null,
  candidate: { page_url: string; media_url: string | null },
): Promise<{
  pageFetched: boolean;
  pageFailureReason: string | null;
  screenshot: string | null;
  pageTitle: string | null;
  verification: CandidateVerification | null;
  mediaTried: number;
}> {
  const page = await retrieveCopyrightPage(candidate.page_url);
  const mediaUrls = [
    ...(candidate.media_url ? [candidate.media_url] : []),
    ...(page.ok ? mediaUrlsFromPage(page.html, page.finalUrl) : []),
  ];
  const unique = Array.from(new Set(mediaUrls.filter(Boolean)));

  let best: CandidateVerification | null = null;
  for (const url of unique) {
    const verification = await verifyCandidateUrl(fingerprint, url, referenceSha256).catch(() => null);
    if (!verification) continue;
    if (!best || (verification.downloaded && verification.similarity > best.similarity)) {
      best = verification;
    }
    if (best.verdict === "EXACT") break;
  }

  return {
    pageFetched: page.ok,
    pageFailureReason: page.failureReason ?? page.failureCategory ?? null,
    screenshot: page.screenshot,
    pageTitle: page.pageTitle,
    verification: best,
    mediaTried: unique.length,
  };
}

/* ------------------------------------------------------------------ */
/* stage 4 — promote verified candidates to copyright_matches          */
/* ------------------------------------------------------------------ */
async function ensureScanId(
  supabase: Client,
  userId: string,
  job: { id: string; scan_id: string | null },
  assetName: string,
  referenceSha256: string | null,
): Promise<string> {
  if (job.scan_id) return job.scan_id;
  const { data, error } = await supabase
    .from("copyright_scans")
    .insert({
      user_id: userId,
      title: assetName,
      reference_kind: "protected_asset",
      status: "completed",
      sha256: referenceSha256,
      stats: { origin: "asset_discovery_job", job_id: job.id },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("asset_discovery_jobs").update({ scan_id: data.id }).eq("id", job.id);
  return data.id;
}

/* ------------------------------------------------------------------ */
/* run                                                                 */
/* ------------------------------------------------------------------ */
export async function runAssetDiscoveryJob(
  supabase: Client,
  jobId: string,
): Promise<DiscoveryRunResult> {
  const { data: job, error: jobErr } = await supabase
    .from("asset_discovery_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) throw new Error(jobErr.message);
  if (!job) throw new Error("Discovery job not found");

  const fail = async (message: string, diagnostics: Record<string, unknown> = {}) => {
    await supabase
      .from("asset_discovery_jobs")
      .update({
        status: "failed",
        stage: "failed",
        error: message.slice(0, 500),
        diagnostics: { ...(job.diagnostics as object), ...diagnostics } as Json,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return {
      jobId,
      status: "failed" as const,
      discovered: 0,
      fetched: 0,
      verified: 0,
      rejected: 0,
      matchesCreated: 0,
      diagnostics,
      error: message,
    };
  };

  await supabase
    .from("asset_discovery_jobs")
    .update({ status: "running", stage: "seeding", started_at: new Date().toISOString(), error: null })
    .eq("id", jobId);

  const loaded = await loadProtectedFingerprint(supabase, job.user_id, job.protected_asset_id);
  if (!loaded) return fail("Protected asset not found for this account");
  if (!isFingerprinted(loaded.fingerprint)) {
    return fail(
      "Protected asset has no perceptual fingerprint yet — hash the asset before discovery",
      { blocked_reason: "asset_not_fingerprinted" },
    );
  }

  const referenceSha256 =
    (loaded.asset.metadata as { sha256?: string } | null)?.sha256 ?? null;

  let diagnostics: Record<string, unknown> = {};
  let discovered = 0;
  try {
    const seeded = await seedCandidates(
      loaded.asset.storage_path,
      loaded.asset.source_url,
      loaded.asset.name,
    );
    diagnostics = { ...seeded.diagnostics };
    discovered = await persistCandidates(
      supabase,
      job.user_id,
      job.protected_asset_id,
      jobId,
      seeded.candidates,
    );
  } catch (error) {
    return fail((error as Error).message, diagnostics);
  }

  await supabase
    .from("asset_discovery_jobs")
    .update({ stage: "verifying", candidates_discovered: discovered, diagnostics: diagnostics as Json })
    .eq("id", jobId);

  // Verify every candidate for this asset that has not been decided yet.
  const { data: pending, error: pErr } = await supabase
    .from("discovery_candidates")
    .select("id,page_url,media_url,platform,page_title")
    .eq("user_id", job.user_id)
    .eq("protected_asset_id", job.protected_asset_id)
    .in("verification_status", ["UNVERIFIED", "FETCH_FAILED"])
    .order("last_seen_at", { ascending: false })
    .limit(MAX_VERIFY_PER_RUN);
  if (pErr) return fail(pErr.message, diagnostics);

  let fetched = 0;
  let verified = 0;
  let rejected = 0;
  let matchesCreated = 0;
  let scanId: string | null = job.scan_id;

  for (const candidate of pending ?? []) {
    let attempt: Awaited<ReturnType<typeof verifyOneCandidate>>;
    try {
      attempt = await verifyOneCandidate(loaded.fingerprint, referenceSha256, candidate);
    } catch (error) {
      await supabase
        .from("discovery_candidates")
        .update({
          crawl_status: "FETCH_FAILED",
          verification_status: "FETCH_FAILED",
          crawl_failure_reason: (error as Error).message.slice(0, 300),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);
      continue;
    }

    const outcome = decideCandidateOutcome({
      pageFetched: attempt.pageFetched,
      pageFailureReason: attempt.pageFailureReason,
      verification: attempt.verification,
      isVideoAsset: loaded.isVideo,
    });
    if (attempt.pageFetched) fetched += 1;
    if (outcome.verificationStatus === "REJECTED") rejected += 1;

    let copyrightMatchId: string | null = null;
    if (outcome.promoteToMatch && attempt.verification) {
      scanId = await ensureScanId(
        supabase,
        job.user_id,
        { id: jobId, scan_id: scanId },
        loaded.asset.name,
        referenceSha256,
      );
      const { data: match, error: mErr } = await supabase
        .from("copyright_matches")
        .insert({
          user_id: job.user_id,
          scan_id: scanId,
          source_url: candidate.page_url,
          page_title: attempt.pageTitle ?? candidate.page_title,
          platform: candidate.platform ?? classifyPlatform(candidate.page_url)?.kind ?? null,
          confidence: outcome.confidence,
          confidence_band: outcome.confidenceBand,
          detection_type: outcome.detectionType,
          reason: outcome.matchReason,
          review_status: outcome.reviewStatus,
          thumbnail_url: attempt.screenshot,
          evidence: {
            protected_asset_id: job.protected_asset_id,
            discovery_job_id: jobId,
            media_url_verified: attempt.verification.candidateUrl,
            similarity: attempt.verification.similarity,
            hamming_distance: attempt.verification.distance,
            algorithm: attempt.verification.algorithm,
            per_algorithm: attempt.verification.perAlgorithm,
            matched_frame_index: attempt.verification.matchedFrameIndex ?? null,
            matched_frame_seconds: attempt.verification.matchedFrameSeconds ?? null,
            byte_identical: attempt.verification.byteIdentical,
            candidate_sha256: attempt.verification.candidateSha256 ?? null,
            compared_at: attempt.verification.comparedAt,
            page_retrieved: attempt.pageFetched,
          },
        })
        .select("id")
        .single();
      if (mErr) {
        console.warn("[asset-discovery] match insert failed:", mErr.message);
      } else {
        copyrightMatchId = match.id;
        matchesCreated += 1;
        verified += 1;
      }
    }

    await supabase
      .from("discovery_candidates")
      .update({
        crawl_status: outcome.crawlStatus,
        verification_status: outcome.verificationStatus,
        crawl_failure_reason: attempt.pageFetched ? null : attempt.pageFailureReason,
        similarity: attempt.verification?.similarity ?? null,
        distance: attempt.verification?.distance ?? null,
        algorithm: attempt.verification?.algorithm ?? null,
        match_reason: outcome.matchReason,
        hashes: (attempt.verification?.candidateHashes ?? {}) as unknown as Json,
        signals: {
          confidence: outcome.confidence,
          confidence_band: outcome.confidenceBand,
          detection_type: outcome.detectionType,
          media_urls_tried: attempt.mediaTried,
          per_algorithm: attempt.verification?.perAlgorithm ?? {},
          matched_frame_index: attempt.verification?.matchedFrameIndex ?? null,
        },
        evidence: {
          page_retrieved: attempt.pageFetched,
          page_title: attempt.pageTitle,
          byte_identical: attempt.verification?.byteIdentical ?? false,
          candidate_sha256: attempt.verification?.candidateSha256 ?? null,
        },
        screenshot_url: attempt.screenshot,
        page_title: attempt.pageTitle ?? candidate.page_title,
        copyright_match_id: copyrightMatchId,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", candidate.id);
  }

  diagnostics = { ...diagnostics, candidates_examined: pending?.length ?? 0 };

  await supabase
    .from("asset_discovery_jobs")
    .update({
      status: "completed",
      stage: "completed",
      candidates_discovered: discovered,
      candidates_fetched: fetched,
      candidates_verified: verified,
      candidates_rejected: rejected,
      matches_created: matchesCreated,
      diagnostics: diagnostics as Json,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return {
    jobId,
    status: "completed",
    discovered,
    fetched,
    verified,
    rejected,
    matchesCreated,
    diagnostics,
  };
}
