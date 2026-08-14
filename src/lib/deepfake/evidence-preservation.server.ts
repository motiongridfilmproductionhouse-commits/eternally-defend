/**
 * Evidence preservation: stores a safe internal copy of media that Eterna's
 * evidence pipeline already captured/discovered for a finding or manual lead.
 *
 * Rules:
 * - Only media URLs already recorded by the pipeline are preserved. Nothing
 *   arbitrary is fetched on user click.
 * - Objects live in the tenant-scoped S3 prefix `clients/{userId}/evidence/deepfake/`.
 * - Provenance (original source URL) is always retained alongside the copy.
 */

import { createHash } from "node:crypto";
import { assertSafePublicUrlForFetch, fetchPublicHttpUrl } from "./url-safety.server";

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS_PER_TARGET = 12;
const FETCH_TIMEOUT_MS = 12_000;

export interface PreserveEvidenceInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  findingId?: string | null;
  leadId?: string | null;
}

export interface PreserveEvidenceSummary {
  source_page_url: string | null;
  candidates: number;
  preserved: number;
  skipped: number;
  failed: number;
  already_present: number;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function extToContentType(url: string): string {
  const ext = url.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) continue;
    if (!/^https?:\/\//i.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Preserve every already-captured media artifact attached to a finding/lead.
 * Idempotent: re-running only stores media that is not already preserved.
 */
export async function preserveEvidenceForTarget(
  input: PreserveEvidenceInput,
): Promise<PreserveEvidenceSummary> {
  const { supabase, userId } = input;
  const summary: PreserveEvidenceSummary = {
    source_page_url: null,
    candidates: 0,
    preserved: 0,
    skipped: 0,
    failed: 0,
    already_present: 0,
  };

  let sourcePageUrl: string | null = null;
  let scanId: string | null = null;
  let faceSimilarity: number | null = null;
  let identityConfidence: number | null = null;
  let syntheticConfidence: number | null = null;
  let sourceHttpStatus: number | null = null;
  let mediaUrls: string[] = [];

  if (input.leadId) {
    const { data: lead } = await supabase
      .from("deepfake_manual_leads")
      .select(
        "id,scan_id,submitted_url,source_page_url,original_image_url,reviewer_image_url,extracted_images,face_similarity_score,identity_confidence_score",
      )
      .eq("id", input.leadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!lead) throw new Error("Evidence lead not found for this account.");
    scanId = lead.scan_id ?? null;
    sourcePageUrl = lead.source_page_url ?? lead.submitted_url ?? null;
    faceSimilarity = lead.face_similarity_score ?? null;
    identityConfidence = lead.identity_confidence_score ?? null;
    mediaUrls = uniqueStrings([
      lead.original_image_url,
      lead.reviewer_image_url,
      ...((lead.extracted_images ?? []) as string[]),
    ]);
  } else if (input.findingId) {
    const { data: finding } = await supabase
      .from("deepfake_findings")
      .select(
        "id,scan_id,url,final_url,canonical_url,http_status,face_similarity,identity_confidence,synthetic_media_confidence",
      )
      .eq("id", input.findingId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!finding) throw new Error("Finding not found for this account.");
    scanId = finding.scan_id ?? null;
    sourcePageUrl = finding.final_url ?? finding.canonical_url ?? finding.url ?? null;
    sourceHttpStatus = finding.http_status ?? null;
    faceSimilarity = finding.face_similarity ?? null;
    identityConfidence = finding.identity_confidence ?? null;
    syntheticConfidence = finding.synthetic_media_confidence ?? null;

    const urlVariants = uniqueStrings([finding.url, finding.final_url, finding.canonical_url]);
    if (urlVariants.length) {
      const { data: discoveries } = await supabase
        .from("deepfake_discoveries")
        .select("page_url,canonical_url,image_url,thumbnail_url")
        .eq("user_id", userId)
        .or(
          urlVariants
            .map((u) => `page_url.eq.${u},canonical_url.eq.${u}`)
            .join(","),
        )
        .limit(50);
      mediaUrls = uniqueStrings(
        (discoveries ?? []).flatMap((d: Record<string, string | null>) => [
          d.image_url,
          d.thumbnail_url,
        ]),
      );
    }

    // Manual leads for the same page also carry captured images.
    if (sourcePageUrl) {
      const { data: leads } = await supabase
        .from("deepfake_manual_leads")
        .select("extracted_images,original_image_url,reviewer_image_url")
        .eq("user_id", userId)
        .eq("source_page_url", sourcePageUrl)
        .limit(5);
      mediaUrls = uniqueStrings([
        ...mediaUrls,
        ...(leads ?? []).flatMap((l: Record<string, unknown>) => [
          l.original_image_url as string | null,
          l.reviewer_image_url as string | null,
          ...((l.extracted_images ?? []) as string[]),
        ]),
      ]);
    }
  } else {
    throw new Error("A finding or evidence lead is required.");
  }

  summary.source_page_url = sourcePageUrl;
  mediaUrls = mediaUrls.slice(0, MAX_ITEMS_PER_TARGET);
  summary.candidates = mediaUrls.length;
  if (!mediaUrls.length || !sourcePageUrl) return summary;

  const { data: existing } = await supabase
    .from("preserved_evidence_media")
    .select("dedupe_key")
    .eq("user_id", userId)
    .eq("source_page_url", sourcePageUrl);
  const existingKeys = new Set<string>((existing ?? []).map((r: { dedupe_key: string }) => r.dedupe_key));

  const { putObject, getBucket } = await import("../aws/s3.server");
  const { computePerceptualHashes } = await import("../media/perceptual-hash.server");
  const bucket = getBucket();
  const platform = hostOf(sourcePageUrl);

  for (const mediaUrl of mediaUrls) {
    const dedupeKey = createHash("sha256").update(`${sourcePageUrl}|${mediaUrl}`).digest("hex");
    if (existingKeys.has(dedupeKey)) {
      summary.already_present += 1;
      continue;
    }

    try {
      await assertSafePublicUrlForFetch(mediaUrl);
    } catch {
      summary.skipped += 1;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchPublicHttpUrl(mediaUrl, {
        signal: controller.signal,
        headers: {
          accept: "image/*,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 (compatible; EternaEvidencePreservation/1.0)",
        },
      });
      if (!res.ok) {
        console.warn(`[EVIDENCE:PRESERVE] media fetch ${res.status} for ${mediaUrl}`);
        summary.failed += 1;
        continue;
      }
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0] ?? "";
      if (!/^image\//i.test(contentType)) {
        summary.skipped += 1;
        continue;
      }
      const buffer = new Uint8Array(await res.arrayBuffer());
      if (!buffer.byteLength || buffer.byteLength > MAX_MEDIA_BYTES) {
        summary.skipped += 1;
        continue;
      }

      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const key = `clients/${userId}/evidence/deepfake/${new Date().toISOString().slice(0, 10)}/${sha256.slice(0, 32)}`;
      await putObject({
        key,
        body: buffer,
        contentType: contentType || extToContentType(mediaUrl),
      });

      let perceptualHash: string | null = null;
      try {
        perceptualHash = computePerceptualHashes(buffer)?.phash ?? null;
      } catch {
        perceptualHash = null;
      }

      const { error } = await supabase.from("preserved_evidence_media").upsert(
        {
          user_id: userId,
          finding_id: input.findingId ?? null,
          lead_id: input.leadId ?? null,
          scan_id: scanId,
          media_kind: "image",
          source_page_url: sourcePageUrl,
          source_media_url: mediaUrl,
          platform_domain: platform,
          s3_bucket: bucket,
          s3_key: key,
          content_type: contentType || extToContentType(mediaUrl),
          bytes: buffer.byteLength,
          sha256,
          perceptual_hash: perceptualHash,
          face_similarity: faceSimilarity,
          identity_confidence: identityConfidence,
          synthetic_confidence: syntheticConfidence,
          evidence_status: "captured",
          source_http_status: sourceHttpStatus,
          source_reachable:
            sourceHttpStatus === null ? null : sourceHttpStatus >= 200 && sourceHttpStatus < 400,
          dedupe_key: dedupeKey,
        },
        { onConflict: "user_id,dedupe_key" },
      );
      if (error) {
        summary.failed += 1;
        continue;
      }
      existingKeys.add(dedupeKey);
      summary.preserved += 1;
    } catch {
      summary.failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  return summary;
}
