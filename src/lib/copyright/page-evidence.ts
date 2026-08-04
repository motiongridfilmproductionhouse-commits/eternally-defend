/**
 * Canonical per-page evidence result for Copyright Intelligence scans.
 * All diagnostic counters and UI summaries derive from this shape.
 */

import type { DistributionAnalysis } from "./distribution.server";
import { isActionablePiracy } from "./taxonomy";

export type AccessEvidenceStrength = "none" | "weak" | "strong";

export interface PageEvidenceResult {
  titleIdentity: {
    matched: boolean;
    confidence: number;
    signals: string[];
  };
  accessEvidence: {
    confirmed: boolean;
    strength: AccessEvidenceStrength;
    signals: string[];
  };
  classification: string | null;
  rejectionReason: string | null;
  embeddedPlayerDetected: boolean;
  suspectedReview: boolean;
  clientVisibleFinding: boolean;
  accessDiagnostics: {
    embeddedPlayersFound: number;
    watchButtonsFound: number;
    downloadLinksFound: number;
    fileHostLinksFound: number;
    torrentIndicatorsFound: number;
    releaseTagsFound: number;
    negativeSignalsFound: number;
    accessStrength: AccessEvidenceStrength;
    rejectionReason: string | null;
  };
}

export function buildPageEvidenceResult(
  dist: DistributionAnalysis,
): PageEvidenceResult {
  const identityMatched = dist.identityEvidence.length > 0;
  const embeddedPlayerDetected = dist.indicatorKeys.includes("embedded_player");
  const strongSignals = dist.accessEvidence.length > 0 && dist.strongEvidence;
  const weakSignals =
    !strongSignals &&
    identityMatched &&
    (embeddedPlayerDetected ||
      dist.indicatorKeys.some((k) =>
        ["download_links", "watch_now_cta", "file_host_links", "torrent_or_magnet"].includes(k),
      ));

  let strength: AccessEvidenceStrength = "none";
  if (strongSignals) strength = "strong";
  else if (weakSignals) strength = "weak";

  const hardNegative = [
    "CINEMA_OR_SHOWTIME",
    "TRAILER_OR_PROMO",
    "REVIEW_OR_NEWS",
    "OFFICIAL_OR_AUTHORIZED",
    "OFFICIAL_OR_AUTHORIZED_PAGE",
    "CATALOG_OR_LISTING",
  ].includes(dist.classification);

  const suspectedReview =
    identityMatched &&
    strength === "weak" &&
    !dist.clientVisible &&
    !hardNegative &&
    !dist.crawlFailed;

  let rejectionReason: string | null = null;
  if (dist.crawlFailed) {
    rejectionReason = dist.crawlFailureReason ?? dist.crawlFailureCategory ?? "crawl_failed";
  } else if (hardNegative) {
    rejectionReason = dist.classification;
  } else if (identityMatched && strength === "none") {
    rejectionReason = "missing_access_evidence";
  } else if (!identityMatched) {
    rejectionReason = "title_identity_missing";
  }

  return {
    titleIdentity: {
      matched: identityMatched,
      confidence: dist.confidence,
      signals: dist.identityEvidence.slice(0, 8),
    },
    accessEvidence: {
      confirmed: strength === "strong",
      strength,
      signals: dist.accessEvidence.slice(0, 8),
    },
    classification: dist.classification,
    rejectionReason,
    embeddedPlayerDetected,
    suspectedReview,
    clientVisibleFinding:
      dist.clientVisible &&
      dist.strongEvidence &&
      isActionablePiracy(dist.classification),
    accessDiagnostics: {
      embeddedPlayersFound: embeddedPlayerDetected ? 1 : 0,
      watchButtonsFound: dist.indicatorKeys.includes("watch_now_cta") ? 1 : 0,
      downloadLinksFound: dist.indicatorKeys.includes("download_links") ? 1 : 0,
      fileHostLinksFound: dist.indicatorKeys.includes("file_host_links") ? 1 : 0,
      torrentIndicatorsFound: dist.indicatorKeys.includes("torrent_or_magnet") ? 1 : 0,
      releaseTagsFound: dist.qualityTags.length,
      negativeSignalsFound: hardNegative ? 1 : 0,
      accessStrength: strength,
      rejectionReason,
    },
  };
}
