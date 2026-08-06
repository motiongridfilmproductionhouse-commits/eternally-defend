/**
 * Forensic evidence packages for high-confidence Google Images matches.
 * Evidence target is always the original source webpage — never a Google viewer URL.
 */

import { createHash } from "node:crypto";
import { isGoogleImagesViewerUrl, isUsableSourceWebsiteUrl } from "./google-images-source.server";

export interface GoogleImagesEvidencePackage {
  google_search_query: string;
  /** Provenance only — Google Images SERP/viewer URL that discovered the image. */
  google_result_url: string;
  /** Original hosting webpage (imgrefurl). Never a Google viewer URL. */
  source_website_url: string | null;
  image_url: string;
  screenshot_url: string | null;
  capture_timestamp: string;
  sha256: string | null;
  perceptual_hash: string | null;
  face_similarity_score: number;
  identity_confidence: number;
  crawl_metadata: Record<string, unknown>;
  evidence_status: "queued" | "captured" | "capture_failed";
}

export function buildGoogleImagesEvidencePackage(input: {
  query: string;
  googleResultUrl: string;
  sourceWebsiteUrl: string | null;
  imageUrl: string;
  faceSimilarity: number;
  identityConfidence: number;
  sha256?: string | null;
  perceptualHash?: string | null;
  screenshotUrl?: string | null;
  crawlMetadata?: Record<string, unknown>;
  evidenceStatus?: "queued" | "captured" | "capture_failed";
}): GoogleImagesEvidencePackage {
  // Never promote a Google viewer URL into the source/evidence page slot.
  const sourceWebsiteUrl = isUsableSourceWebsiteUrl(input.sourceWebsiteUrl)
    ? input.sourceWebsiteUrl
    : null;
  const googleResultUrl = input.googleResultUrl?.trim() || "";
  const hasCapture = Boolean(input.sha256 && sourceWebsiteUrl);

  return {
    google_search_query: input.query,
    google_result_url: googleResultUrl,
    source_website_url: sourceWebsiteUrl,
    image_url: input.imageUrl,
    screenshot_url: input.screenshotUrl ?? null,
    capture_timestamp: new Date().toISOString(),
    sha256: input.sha256 ?? null,
    perceptual_hash: input.perceptualHash ?? null,
    face_similarity_score: input.faceSimilarity,
    identity_confidence: input.identityConfidence,
    crawl_metadata: {
      ...(input.crawlMetadata ?? {}),
      google_viewer_rejected: isGoogleImagesViewerUrl(input.sourceWebsiteUrl),
      evidence_target: "original_source_webpage",
    },
    evidence_status: input.evidenceStatus ?? (hasCapture ? "captured" : "queued"),
  };
}

export function sha256OfUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/** Content SHA-256 of image bytes. */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Lightweight perceptual fingerprint from image bytes.
 * Not a full pHash, but content-derived (not URL-derived).
 */
export function perceptualHashOfBytes(bytes: Uint8Array): string {
  const sample = bytes.length > 4096 ? bytes.subarray(0, 4096) : bytes;
  return createHash("sha1").update(sample).digest("hex").slice(0, 16);
}

/** @deprecated Prefer perceptualHashOfBytes — URL hashes are not perceptual. */
export function perceptualHashOfUrl(url: string): string {
  return createHash("md5").update(url).digest("hex").slice(0, 16);
}

export function parseGoogleImagesEvidencePackages(
  metrics: Record<string, unknown> | null | undefined,
): GoogleImagesEvidencePackage[] {
  const raw = metrics?.google_images_evidence_packages;
  if (!Array.isArray(raw)) return [];
  const out: GoogleImagesEvidencePackage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.image_url !== "string" || typeof r.google_search_query !== "string") {
      continue;
    }
    const rawSource = typeof r.source_website_url === "string" ? r.source_website_url : null;
    out.push({
      google_search_query: r.google_search_query,
      google_result_url: typeof r.google_result_url === "string" ? r.google_result_url : "",
      source_website_url: isUsableSourceWebsiteUrl(rawSource) ? rawSource : null,
      image_url: r.image_url,
      screenshot_url: typeof r.screenshot_url === "string" ? r.screenshot_url : null,
      capture_timestamp:
        typeof r.capture_timestamp === "string" ? r.capture_timestamp : new Date().toISOString(),
      sha256: typeof r.sha256 === "string" ? r.sha256 : null,
      perceptual_hash: typeof r.perceptual_hash === "string" ? r.perceptual_hash : null,
      face_similarity_score: Number(r.face_similarity_score) || 0,
      identity_confidence: Number(r.identity_confidence) || 0,
      crawl_metadata:
        r.crawl_metadata && typeof r.crawl_metadata === "object"
          ? (r.crawl_metadata as Record<string, unknown>)
          : {},
      evidence_status:
        r.evidence_status === "captured" ||
        r.evidence_status === "capture_failed" ||
        r.evidence_status === "queued"
          ? r.evidence_status
          : "queued",
    });
  }
  return out;
}
