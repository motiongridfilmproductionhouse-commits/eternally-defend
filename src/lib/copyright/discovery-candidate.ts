/**
 * Discovery candidate scoring metadata — separate from verification outcome.
 * Poster mismatch alone must not reject pages with strong title/access evidence.
 */

import type { DistributionAnalysis } from "./distribution.server";
import { canonicalUrl } from "./url.server";

export type CandidateVerificationStatus =
  | "verified_threat"
  | "probable_threat"
  | "pending_review"
  | "unreachable"
  | "redirected"
  | "rejected_unrelated"
  | "not_processed_budget";

export interface DiscoveryCandidateRecord {
  candidate_url: string;
  normalized_url: string;
  source_provider: string;
  discovery_query: string | null;
  matched_title: string | null;
  title_confidence: number;
  year_confidence: number;
  filename_confidence: number;
  player_detected: boolean;
  download_detected: boolean;
  file_host_detected: boolean;
  archive_detected: boolean;
  torrent_detected: boolean;
  poster_similarity: number | null;
  evidence_score: number;
  verification_status: CandidateVerificationStatus;
  rejection_reason: string | null;
}

function filenameConfidenceFrom(url: string, title: string | null): number {
  const blob = `${url} ${title ?? ""}`.toLowerCase();
  let score = 0;
  if (/(1080p|720p|480p|hdrip|webrip|web-dl|dvdrip|camrip|hdts|\.mkv|\.mp4)/.test(blob)) {
    score += 40;
  }
  if (title && blob.includes(title.toLowerCase().replace(/\s+/g, ""))) score += 25;
  return Math.min(100, score);
}

export function discoveryCandidateFromDistribution(
  dist: DistributionAnalysis,
  meta: {
    sourceProvider: string;
    discoveryQuery: string | null;
    matchedTitle: string | null;
    posterSimilarity?: number | null;
    verificationStatus: CandidateVerificationStatus;
    rejectionReason?: string | null;
  },
): DiscoveryCandidateRecord {
  const keys = dist.indicatorKeys ?? [];
  const classification = dist.classification ?? "";
  const player =
    keys.includes("embedded_player") || /STREAM|REUPLOAD|VIDEO_HOST/.test(classification);
  const download =
    classification === "DOWNLOAD_PAGE" || keys.includes("download_button");
  const fileHost = classification === "FILE_HOST_DISTRIBUTION" || keys.includes("file_host");
  const archive =
    /archive\.org/i.test(dist.url) ||
    classification === "FILE_HOST_DISTRIBUTION" ||
    keys.includes("archive");
  const torrent =
    classification === "TORRENT_OR_MAGNET" || keys.includes("torrent") || keys.includes("magnet");

  const titleConf = dist.identityEvidence.length >= 2 ? 90 : dist.identityEvidence.length ? 70 : 20;
  const yearConf = /\b20\d{2}\b/.test(`${dist.pageTitle ?? ""} ${dist.url}`) ? 60 : 0;
  const filenameConf = filenameConfidenceFrom(dist.url, dist.pageTitle);
  const accessBonus =
    (player ? 15 : 0) +
    (download ? 20 : 0) +
    (fileHost ? 15 : 0) +
    (archive ? 10 : 0) +
    (torrent ? 15 : 0);
  const evidenceScore = Math.min(
    99,
    Math.max(0, dist.confidence + accessBonus - (meta.posterSimilarity != null && meta.posterSimilarity < 30 ? 0 : 0)),
  );

  return {
    candidate_url: dist.url,
    normalized_url: canonicalUrl(dist.url),
    source_provider: meta.sourceProvider,
    discovery_query: meta.discoveryQuery,
    matched_title: meta.matchedTitle,
    title_confidence: titleConf,
    year_confidence: yearConf,
    filename_confidence: filenameConf,
    player_detected: player,
    download_detected: download,
    file_host_detected: fileHost,
    archive_detected: archive,
    torrent_detected: torrent,
    poster_similarity: meta.posterSimilarity ?? null,
    evidence_score: evidenceScore,
    verification_status: meta.verificationStatus,
    rejection_reason: meta.rejectionReason ?? null,
  };
}

export function verificationStatusFromDistribution(
  dist: DistributionAnalysis,
  budgetSkipped = false,
): CandidateVerificationStatus {
  if (budgetSkipped) return "not_processed_budget";
  if (dist.crawlFailed) return "unreachable";
  if (dist.classification === "MIRROR_OR_REDIRECT") return "redirected";
  if (dist.clientVisible && dist.confidence >= 75) return "verified_threat";
  if (dist.clientVisible) return "probable_threat";
  if (dist.strongEvidence || dist.identityEvidence.length > 0) return "pending_review";
  return "rejected_unrelated";
}
