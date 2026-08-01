/**
 * Client-visible filtering for Copyright Intelligence matches.
 * Raw provider candidates and non-actionable classifications never reach the UI
 * as confirmed piracy findings.
 */

import {
  isActionablePiracy,
  isClientVisiblePiracyMatch,
  normalizeClassification,
  type CopyrightClassification,
} from "./taxonomy";

export interface CopyrightMatchLike {
  detection_type?: string | null;
  confidence?: number | null;
  confidence_band?: string | null;
  source_url?: string | null;
  evidence?: unknown;
  reason?: string | null;
}

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  return evidence && typeof evidence === "object"
    ? (evidence as Record<string, unknown>)
    : {};
}

function distributionRecord(evidence: Record<string, unknown>): Record<string, unknown> {
  const dist = evidence.distribution;
  return dist && typeof dist === "object" ? (dist as Record<string, unknown>) : {};
}

/** True when a persisted match may appear in the Copyright Intelligence UI as piracy. */
export function isClientVisibleCopyrightMatch(match: CopyrightMatchLike): boolean {
  const ev = evidenceRecord(match.evidence);
  const dist = distributionRecord(ev);

  if (ev.client_visible === false) return false;
  if (dist.client_visible === false) return false;
  if (ev.snippet_only === true) return false;

  const classification =
    (typeof dist.classification === "string" && dist.classification) ||
    match.detection_type;

  return isClientVisiblePiracyMatch({
    detectionType: classification,
    clientVisible: ev.client_visible !== false && dist.client_visible !== false,
    strongEvidence:
      typeof dist.strong_evidence === "boolean" ? dist.strong_evidence : undefined,
  });
}

export function filterClientVisibleCopyrightMatches<T extends CopyrightMatchLike>(
  matches: T[],
): T[] {
  return matches.filter(isClientVisibleCopyrightMatch);
}

export function classificationOf(match: CopyrightMatchLike): CopyrightClassification {
  const ev = evidenceRecord(match.evidence);
  const dist = distributionRecord(ev);
  if (typeof dist.classification === "string") {
    return normalizeClassification(dist.classification);
  }
  return normalizeClassification(match.detection_type);
}

export function assertNoRawProviderLeak(matches: CopyrightMatchLike[]): void {
  for (const m of matches) {
    const ev = evidenceRecord(m.evidence);
    if (ev.discovery === "provider_raw" || ev.raw_provider_candidate === true) {
      throw new Error("Raw provider candidate leaked into client-visible results.");
    }
    if (!isActionablePiracy(classificationOf(m)) && isClientVisibleCopyrightMatch(m)) {
      throw new Error("Non-actionable classification marked client-visible.");
    }
  }
}
