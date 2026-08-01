/**
 * Pure UI helpers for the Deepfake Intel multi-threat visual alert.
 * Recomputes from client-visible findings only — no persistence, no notifications.
 */

import { sanitizeEvidenceUrl } from "./evidence-url";
import {
  displayableFindings,
  findingDomain,
  type ClientFinding,
} from "./results-dashboard";
import type { IdentityScanVizMode } from "./identity-scan-viz";

export type ThreatAlertLevel = "none" | "single" | "multiple";

export type ThreatAlertSummary = {
  level: ThreatAlertLevel;
  total: number;
  verified: number;
  probable: number;
  domains: number;
};

export type ThreatAlertAnnouncementState = {
  scanId: string | null;
  distinctTotal: number;
  hasAnnouncedMultiple: boolean;
};

/** Sanitize and normalize a URL for distinct-threat deduplication. */
export function sanitizeThreatDedupUrl(
  value: string | null | undefined,
): string | null {
  const cleaned = sanitizeEvidenceUrl(value);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    let href = parsed.toString();
    if (href.endsWith("/") && parsed.pathname !== "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return null;
  }
}

/**
 * Dedup key: sanitized final_url, then canonical_url.
 * Falls back to finding id when both evidence URLs are unavailable so a
 * client-visible saved finding is never silently dropped from the count.
 */
export function threatDedupKey(finding: ClientFinding): string {
  return (
    sanitizeThreatDedupUrl(finding.final_url) ||
    sanitizeThreatDedupUrl(finding.canonical_url) ||
    `id:${finding.id}`
  );
}

export function threatAlertLevelFromTotal(total: number): ThreatAlertLevel {
  if (total >= 2) return "multiple";
  if (total === 1) return "single";
  return "none";
}

/**
 * Count distinct client-visible VERIFIED/PROBABLE + URL_VERIFIED threats.
 * Ignores raw/rejected/unrelated rows (via displayableFindings) and
 * collapses duplicate evidence URLs.
 */
export function buildThreatAlertSummary(
  findings: ClientFinding[] | null | undefined,
): ThreatAlertSummary {
  const visible = displayableFindings(findings ?? []);
  const seen = new Set<string>();
  let verified = 0;
  let probable = 0;
  const domains = new Set<string>();

  for (const finding of visible) {
    const key = threatDedupKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);

    if (finding.finding_classification === "VERIFIED_DEEPFAKE") {
      verified += 1;
    } else if (finding.finding_classification === "PROBABLE_DEEPFAKE") {
      probable += 1;
    } else {
      continue;
    }

    domains.add(findingDomain(finding));
  }

  const total = verified + probable;
  return {
    level: threatAlertLevelFromTotal(total),
    total,
    verified,
    probable,
    domains: domains.size,
  };
}

export function threatAlertHeadline(level: ThreatAlertLevel): string | null {
  if (level === "multiple") return "MULTIPLE DEEPFAKE THREATS DETECTED";
  if (level === "single") return "Threat detected";
  return null;
}

export function threatAlertCountLines(summary: ThreatAlertSummary): string[] {
  if (summary.level === "none") return [];
  return [
    `${summary.total} verified/probable threat${summary.total === 1 ? "" : "s"}`,
    `${summary.verified} verified`,
    `${summary.probable} probable`,
    `${summary.domains} affected domain${summary.domains === 1 ? "" : "s"}`,
  ];
}

export function threatAlertBannerMessage(summary: ThreatAlertSummary): string {
  return `Eterna detected ${summary.total} distinct deepfake threat${
    summary.total === 1 ? "" : "s"
  } across ${summary.domains} verified domain${
    summary.domains === 1 ? "" : "s"
  }.`;
}

/**
 * Decide live-region role for the multi-threat banner.
 * - Crossing <2 → 2+ during the same selected-scan session → role="alert" once
 * - Reload / history selection / later polls → role="status"
 */
export function resolveThreatAlertAnnouncement(input: {
  scanId: string | null;
  distinctTotal: number;
  previous: ThreatAlertAnnouncementState | null;
}): {
  role: "alert" | "status";
  announceMultiple: boolean;
  next: ThreatAlertAnnouncementState;
} {
  const scanId = input.scanId;
  const distinctTotal = Math.max(0, input.distinctTotal);
  const previous = input.previous;
  const scanChanged = !previous || previous.scanId !== scanId;

  if (scanChanged) {
    const announceMultiple = false;
    return {
      role: "status",
      announceMultiple,
      next: {
        scanId,
        distinctTotal,
        hasAnnouncedMultiple: distinctTotal >= 2,
      },
    };
  }

  const crossedToMultiple =
    previous.distinctTotal < 2 && distinctTotal >= 2;
  const announceMultiple =
    crossedToMultiple && !previous.hasAnnouncedMultiple;

  return {
    role: announceMultiple ? "alert" : "status",
    announceMultiple,
    next: {
      scanId,
      distinctTotal,
      hasAnnouncedMultiple:
        previous.hasAnnouncedMultiple || distinctTotal >= 2,
    },
  };
}

/** Visual ring tone — threat level overrides scan-status colors when elevated. */
export function resolveThreatAwareRingTone(input: {
  mode: IdentityScanVizMode;
  threatLevel: ThreatAlertLevel;
}): "cyan" | "amber" | "green" | "red" | "muted" {
  if (input.mode === "empty") return "muted";
  if (input.threatLevel === "multiple") return "red";
  if (input.threatLevel === "single") return "amber";
  // Preserve existing status tones when no threat alert.
  if (input.mode === "running" || input.mode === "idle") return "cyan";
  if (input.mode === "partial") return "amber";
  if (input.mode === "completed") return "green";
  if (input.mode === "failed") return "red";
  return "muted";
}

/**
 * Animation policy for threat-aware scanner.
 * Reduced motion: always static. Multiple threats: slow pulse while running,
 * slow breathing while partial, static when completed/failed.
 */
export function shouldAnimateThreatAwareScan(input: {
  mode: IdentityScanVizMode;
  threatLevel: ThreatAlertLevel;
  prefersReducedMotion: boolean;
}): boolean {
  if (input.prefersReducedMotion) return false;
  if (input.mode === "empty") return false;
  if (input.threatLevel === "multiple") {
    return input.mode === "running" || input.mode === "partial";
  }
  if (input.threatLevel === "single") {
    return input.mode === "running";
  }
  return input.mode === "running" || input.mode === "idle";
}

/** Scan beam only while RUNNING (paused on PARTIAL even during red alert). */
export function shouldShowThreatAwareScanBeam(input: {
  mode: IdentityScanVizMode;
  prefersReducedMotion: boolean;
}): boolean {
  if (input.prefersReducedMotion) return false;
  return input.mode === "running";
}

export function threatAwareStatusCopy(input: {
  mode: IdentityScanVizMode;
  threatLevel: ThreatAlertLevel;
  stage?: string | null;
  stageMessage?: string | null;
  statusHeadline?: string | null;
}): string {
  const threatHeadline = threatAlertHeadline(input.threatLevel);
  if (input.threatLevel === "multiple" && threatHeadline) {
    return threatHeadline;
  }
  if (input.threatLevel === "single" && threatHeadline) {
    if (input.mode === "partial") {
      return "Threat detected · Verified progress saved.";
    }
    return threatHeadline;
  }
  if (input.mode === "partial") return "Verified progress saved.";
  if (input.mode === "running") {
    return input.stageMessage || input.statusHeadline || "Identity scan in progress";
  }
  return input.statusHeadline || "";
}
