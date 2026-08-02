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
  };
}
