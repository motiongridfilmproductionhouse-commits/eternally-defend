/**
 * Public-safe suspicious source model for the Copyright Intelligence UI.
 * Separates newly confirmed findings from preserved historical suspicious sources.
 */

import { hostOf } from "./url.server";
import { isClientVisibleCopyrightMatch } from "./client-filter";
import {
  isActionablePiracy,
  resolveClassification,
} from "./taxonomy";

/** JSON-serializable value, safe to send from a server function to the client. */
export type SerializableJson =
  | string
  | number
  | boolean
  | null
  | SerializableJson[]
  | { [key: string]: SerializableJson };

export type SuspiciousSourceState =
  | "new_confirmed"
  | "historical_reconfirmed"
  | "historical_unreachable"
  | "historical_requires_review"
  | "historical_preserved"
  | "redirected"
  | "removed";

export type HistoricalRecheckStatus =
  | "pending"
  | "active"
  | "reconfirmed_active"
  | "temporarily_unreachable"
  | "redirected"
  | "domain_changed"
  | "removed"
  | "insufficient_current_evidence"
  | "requires_review";

export interface PublicSuspiciousSource {
  id: string;
  domain: string | null;
  url: string;
  title: string | null;
  classification: string;
  confidence: number | null;
  confidence_band: string | null;
  source_state: SuspiciousSourceState;
  current_reachability: "reachable" | "unreachable" | "unknown";
  historical_preservation: boolean;
  recheck_status: HistoricalRecheckStatus | null;
  last_verified_at: string | null;
  evidence_summary: string | null;
  reason: string | null;
  discovery_query: string | null;
  contact?: SerializableJson;
  evidence?: SerializableJson;
  review_status?: string | null;
  detection_type?: string | null;
}

const HARD_NEGATIVE = new Set([
  "CINEMA_OR_SHOWTIME",
  "TRAILER_OR_PROMO",
  "REVIEW_OR_NEWS",
  "CAST_OR_INFORMATION",
  "SOCIAL_DISCUSSION",
  "OFFICIAL_OR_AUTHORIZED",
  "OFFICIAL_OR_AUTHORIZED_PAGE",
  "CATALOG_OR_LISTING",
]);

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  return evidence && typeof evidence === "object"
    ? (evidence as Record<string, unknown>)
    : {};
}

function distributionRecord(evidence: Record<string, unknown>): Record<string, unknown> {
  const dist = evidence.distribution;
  return dist && typeof dist === "object" ? (dist as Record<string, unknown>) : {};
}

function pageEvidenceRecord(evidence: Record<string, unknown>): Record<string, unknown> {
  const pe = evidence.page_evidence;
  return pe && typeof pe === "object" ? (pe as Record<string, unknown>) : {};
}

export function resolveHistoricalRecheckStatus(input: {
  crawlFailed: boolean;
  clientVisible: boolean;
  strongEvidence: boolean;
  suspectedReview: boolean;
  identityMatched: boolean;
  accessStrength: "none" | "weak" | "strong";
  redirected?: boolean;
  domainChanged?: boolean;
  removed?: boolean;
}): HistoricalRecheckStatus {
  if (input.removed) return "removed";
  if (input.redirected) return "redirected";
  if (input.domainChanged) return "domain_changed";
  if (input.crawlFailed) return "temporarily_unreachable";
  if (input.clientVisible && input.strongEvidence) return "reconfirmed_active";
  if (input.suspectedReview || input.accessStrength === "weak") return "requires_review";
  if (input.identityMatched && input.accessStrength === "none") {
    return "insufficient_current_evidence";
  }
  return "requires_review";
}

export function mapRecheckStatusToSourceState(
  recheckStatus: HistoricalRecheckStatus | null,
  clientVisibleNew: boolean,
): SuspiciousSourceState {
  if (clientVisibleNew) return "new_confirmed";
  switch (recheckStatus) {
    case "reconfirmed_active":
    case "active":
      return "historical_reconfirmed";
    case "temporarily_unreachable":
      return "historical_unreachable";
    case "redirected":
    case "domain_changed":
      return "redirected";
    case "removed":
      return "removed";
    case "insufficient_current_evidence":
    case "requires_review":
      return "historical_requires_review";
    case "pending":
      return "historical_preserved";
    default:
      return "historical_preserved";
  }
}

const PRESERVED_VISIBLE_RECHECK: HistoricalRecheckStatus[] = [
  "active",
  "reconfirmed_active",
  "temporarily_unreachable",
  "requires_review",
  "insufficient_current_evidence",
  "redirected",
  "domain_changed",
  "removed",
  "pending",
];

export function isPreviouslyConfirmedSuspicious(ev: Record<string, unknown>): boolean {
  const prior =
    typeof ev.prior_classification === "string" ? ev.prior_classification : null;
  if (prior && isActionablePiracy(prior) && !HARD_NEGATIVE.has(prior)) return true;
  const classification =
    typeof ev.classification === "string" ? ev.classification : null;
  return Boolean(classification && isActionablePiracy(classification) && !HARD_NEGATIVE.has(classification));
}

/** Whether a persisted match row may appear on the Suspicious Sources tab. */
export function isSuspiciousSourceForTab(match: {
  detection_type?: string | null;
  evidence?: unknown;
}): boolean {
  const ev = evidenceRecord(match.evidence);
  const dist = distributionRecord(ev);
  const classification = resolveClassification({
    detectionType: match.detection_type,
    distributionClassification:
      (typeof dist.classification === "string" && dist.classification) ||
      (typeof ev.prior_classification === "string" ? ev.prior_classification : null),
    contentType:
      (typeof dist.content_type === "string" && dist.content_type) ||
      (typeof ev.website_type === "string" ? ev.website_type : null),
    strongEvidence:
      typeof dist.strong_evidence === "boolean" ? dist.strong_evidence : undefined,
  });

  if (HARD_NEGATIVE.has(classification)) return false;

  if (ev.historical_preservation === true) {
    const recheck = ev.recheck_status as HistoricalRecheckStatus | undefined;
    if (!recheck || !PRESERVED_VISIBLE_RECHECK.includes(recheck)) return false;
    return isPreviouslyConfirmedSuspicious(ev);
  }

  return isClientVisibleCopyrightMatch(match);
}

export function buildEvidenceSummary(ev: Record<string, unknown>): string | null {
  const pe = pageEvidenceRecord(ev);
  const access = pe.accessEvidence as { strength?: string; signals?: string[] } | undefined;
  const title = pe.titleIdentity as { matched?: boolean; signals?: string[] } | undefined;
  const parts: string[] = [];
  if (title?.matched) parts.push("Exact title matched");
  if (access?.strength === "strong") parts.push("Strong access evidence");
  else if (access?.strength === "weak") parts.push("Inconclusive access signals");
  if (Array.isArray(access?.signals) && access.signals.length) {
    parts.push(access.signals.slice(0, 2).join(", "));
  }
  return parts.length ? parts.join(" · ") : null;
}

export function mapMatchToSuspiciousSource(match: {
  id: string;
  source_url: string;
  page_title?: string | null;
  confidence?: number | null;
  confidence_band?: string | null;
  detection_type?: string | null;
  reason?: string | null;
  review_status?: string | null;
  contact?: unknown;
  evidence?: unknown;
  created_at?: string | null;
}): PublicSuspiciousSource | null {
  if (!isSuspiciousSourceForTab(match)) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
      const ev = evidenceRecord(match.evidence);
      console.info(
        "[copyright-suspicious] excluded from tab",
        match.source_url,
        ev.historical_preservation ? "not_preservable" : "not_client_visible",
        ev.recheck_status ?? "",
      );
    }
    return null;
  }

  const ev = evidenceRecord(match.evidence);
  const dist = distributionRecord(ev);
  const crawlFailed = ev.crawl_failed === true || dist.crawl_failed === true;
  const historicalPreservation = ev.historical_preservation === true;
  const recheckStatus = (ev.recheck_status as HistoricalRecheckStatus | null) ?? null;
  const clientVisibleNew =
    !historicalPreservation && isClientVisibleCopyrightMatch(match);

  const sourceState = mapRecheckStatusToSourceState(recheckStatus, clientVisibleNew);

  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
    console.info("[copyright-suspicious] public mapping", match.source_url, sourceState, recheckStatus ?? "");
  }

  return {
    id: match.id,
    domain: hostOf(match.source_url),
    url: match.source_url,
    title: match.page_title ?? null,
    classification:
      (typeof dist.classification === "string" && dist.classification) ||
      (typeof ev.prior_classification === "string" ? ev.prior_classification : null) ||
      match.detection_type ||
      "UNVERIFIED_LEAD",
    confidence: match.confidence ?? null,
    confidence_band: match.confidence_band ?? null,
    source_state: sourceState,
    current_reachability: crawlFailed ? "unreachable" : historicalPreservation ? "unknown" : "reachable",
    historical_preservation: historicalPreservation,
    recheck_status: recheckStatus,
    last_verified_at:
      typeof ev.prior_verified_at === "string"
        ? ev.prior_verified_at
        : match.created_at ?? null,
    evidence_summary: buildEvidenceSummary(ev),
    reason: match.reason ?? null,
    discovery_query: null,
    contact: (match.contact ?? null) as SerializableJson,
    evidence: (match.evidence ?? null) as SerializableJson,
    review_status: match.review_status ?? null,
    detection_type: match.detection_type ?? null,
  };
}

export function buildSuspiciousSourcesFromMatches<T extends {
  id: string;
  source_url: string;
  page_title?: string | null;
  confidence?: number | null;
  confidence_band?: string | null;
  detection_type?: string | null;
  reason?: string | null;
  review_status?: string | null;
  contact?: unknown;
  evidence?: unknown;
  created_at?: string | null;
}>(matches: T[]): PublicSuspiciousSource[] {
  const byUrl = new Map<string, PublicSuspiciousSource>();
  for (const match of matches) {
    const mapped = mapMatchToSuspiciousSource(match);
    if (!mapped) continue;
    byUrl.set(mapped.url, mapped);
  }
  return [...byUrl.values()];
}

export function countSuspiciousSourceStates(sources: PublicSuspiciousSource[]): {
  new_confirmed: number;
  historical_reconfirmed: number;
  historical_unreachable: number;
  historical_requires_review: number;
  redirected: number;
  suspicious_sources_displayed: number;
} {
  const counts = {
    new_confirmed: 0,
    historical_reconfirmed: 0,
    historical_unreachable: 0,
    historical_requires_review: 0,
    redirected: 0,
    suspicious_sources_displayed: sources.length,
  };
  for (const s of sources) {
    switch (s.source_state) {
      case "new_confirmed":
        counts.new_confirmed += 1;
        break;
      case "historical_reconfirmed":
        counts.historical_reconfirmed += 1;
        break;
      case "historical_unreachable":
        counts.historical_unreachable += 1;
        break;
      case "historical_requires_review":
      case "historical_preserved":
        counts.historical_requires_review += 1;
        break;
      case "redirected":
      case "removed":
        counts.redirected += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

export function suspiciousSourcesDiagnosticLine(counts: ReturnType<typeof countSuspiciousSourceStates>): string {
  return `Suspicious sources: ${counts.new_confirmed} new confirmed, ${counts.historical_reconfirmed} historical reconfirmed, ${counts.historical_unreachable} historical unreachable, ${counts.historical_requires_review} requiring review.`;
}
