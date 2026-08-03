/**
 * Forensic evidence packages for high-confidence Google Images matches.
 */

import { createHash } from "node:crypto";

export interface GoogleImagesEvidencePackage {
  google_search_query: string;
  google_result_url: string;
  source_website_url: string | null;
  image_url: string;
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
  crawlMetadata?: Record<string, unknown>;
}): GoogleImagesEvidencePackage {
  return {
    google_search_query: input.query,
    google_result_url: input.googleResultUrl,
    source_website_url: input.sourceWebsiteUrl,
    image_url: input.imageUrl,
    capture_timestamp: new Date().toISOString(),
    sha256: input.sha256 ?? null,
    perceptual_hash: input.perceptualHash ?? null,
    face_similarity_score: input.faceSimilarity,
    identity_confidence: input.identityConfidence,
    crawl_metadata: input.crawlMetadata ?? {},
    evidence_status: "queued",
  };
}

export function sha256OfUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

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
    out.push({
      google_search_query: r.google_search_query,
      google_result_url:
        typeof r.google_result_url === "string" ? r.google_result_url : "",
      source_website_url:
        typeof r.source_website_url === "string" ? r.source_website_url : null,
      image_url: r.image_url,
      capture_timestamp:
        typeof r.capture_timestamp === "string"
          ? r.capture_timestamp
          : new Date().toISOString(),
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
