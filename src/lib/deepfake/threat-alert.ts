/**
 * Pure UI helpers for the Deepfake Intel multi-threat visual alert.
 * Recomputes from client-visible findings only — no persistence, no notifications.
 *
 * Scan lifecycle (idle/running/partial/…) and threat tone (cyan/amber/orange/red)
 * are separate: PARTIAL must never force the scanner back to amber when saved
 * threats warrant orange/red.
 */

import { sanitizeEvidenceUrl } from "./evidence-url";
import {
  asRiskLevel,
  displayableFindings,
  findingDomain,
  normalizeClassification,
  type ClientFinding,
  type RiskLevel,
} from "./results-dashboard";
import type { IdentityScanVizMode } from "./identity-scan-viz";

/** Visual threat escalation independent of scan lifecycle. */
export type ThreatAlertTone = "cyan" | "amber" | "orange" | "red";

/** @deprecated Prefer ThreatAlertTone — kept for older call sites during migration. */
export type ThreatAlertLevel = ThreatAlertTone;

export type ThreatAlertSummary = {
  /** Escalation tone used by the scanner / banner. */
  tone: ThreatAlertTone;
  /** Alias of tone for backward-compatible consumers. */
  level: ThreatAlertTone;
  total: number;
  verified: number;
  probable: number;
  domains: number;
  findingIds: string[];
};

export type ThreatDomainLabel = {
  domain: string;
  threatCount: number;
  verified: number;
  probable: number;
  highestRisk: RiskLevel;
  hasVerified: boolean;
  tone: "red" | "orange";
  /** Compact chip: `HIGH RISK · example.com · 6 threats` */
  chipLabel: string;
  /** Secondary line when space permits */
  detailLabel: string;
  wording: "Highest threat activity" | "Verified evidence domain" | "Multiple threat pages";
};

export type ThreatAlertAnnouncementState = {
  scanId: string | null;
  distinctTotal: number;
  tone: ThreatAlertTone;
  hasAnnouncedAlert: boolean;
  /** Legacy alias */
  hasAnnouncedMultiple?: boolean;
};

export type SeenThreatFindingsState = {
  scanId: string | null;
  ids: Set<string>;
  seeded: boolean;
};

const RISK_RANK: Record<RiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
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
 * Dedup key: sanitized final_url, then canonical_url, then stable finding id.
 */
export function threatDedupKey(finding: ClientFinding): string {
  return (
    sanitizeThreatDedupUrl(finding.final_url) ||
    sanitizeThreatDedupUrl(finding.canonical_url) ||
    `id:${finding.id}`
  );
}

export function classifyThreatFinding(
  finding: ClientFinding,
): "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE" | null {
  const normalized = normalizeClassification(finding.finding_classification);
  if (normalized === "VERIFIED_DEEPFAKE") return "VERIFIED_DEEPFAKE";
  if (normalized === "PROBABLE_DEEPFAKE") return "PROBABLE_DEEPFAKE";
  return null;
}

/**
 * Automatic colour escalation from distinct client-visible threats.
 * Any VERIFIED_DEEPFAKE forces RED immediately.
 */
export function threatAlertToneFromCounts(input: {
  total: number;
  verified: number;
}): ThreatAlertTone {
  if (input.verified > 0) return "red";
  if (input.total >= 5) return "red";
  if (input.total >= 2) return "orange";
  if (input.total === 1) return "amber";
  return "cyan";
}

/** @deprecated use threatAlertToneFromCounts */
export function threatAlertLevelFromTotal(total: number): ThreatAlertTone {
  return threatAlertToneFromCounts({ total, verified: 0 });
}

/**
 * Count distinct client-visible VERIFIED/PROBABLE threats from the complete
 * normalized findings array (before console filters / pagination).
 */
export function buildThreatAlertSummary(
  findings: ClientFinding[] | null | undefined,
): ThreatAlertSummary {
  const visible = displayableFindings(findings ?? []);
  const seen = new Set<string>();
  let verified = 0;
  let probable = 0;
  const domains = new Set<string>();
  const findingIds: string[] = [];

  for (const finding of visible) {
    const classification = classifyThreatFinding(finding);
    if (!classification) continue;

    const key = threatDedupKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    findingIds.push(finding.id);

    if (classification === "VERIFIED_DEEPFAKE") verified += 1;
    else probable += 1;

    domains.add(sanitizeThreatHostname(findingDomain(finding)) || "unknown");
  }

  const total = verified + probable;
  const tone = threatAlertToneFromCounts({ total, verified });
  return {
    tone,
    level: tone,
    total,
    verified,
    probable,
    domains: domains.size,
    findingIds,
  };
}

/** Hostname-only label — never a full URL or page title. */
export function sanitizeThreatHostname(
  value: string | null | undefined,
): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.replace(/^www\./, "").toLowerCase();
    }
  } catch {
    /* fall through */
  }
  const host = trimmed
    .replace(/^www\./, "")
    .split("/")[0]
    ?.split("?")[0]
    ?.split("#")[0];
  if (!host || /[^a-z0-9.-]/.test(host)) return null;
  return host;
}

export function buildThreatDomainLabels(
  findings: ClientFinding[] | null | undefined,
  limit = 3,
): ThreatDomainLabel[] {
  const visible = displayableFindings(findings ?? []);
  const seenUrls = new Set<string>();
  const byDomain = new Map<
    string,
    {
      verified: number;
      probable: number;
      risks: RiskLevel[];
    }
  >();

  for (const finding of visible) {
    const classification = classifyThreatFinding(finding);
    if (!classification) continue;
    const key = threatDedupKey(finding);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    const domain =
      sanitizeThreatHostname(findingDomain(finding)) ||
      sanitizeThreatHostname(finding.verified_domain) ||
      sanitizeThreatHostname(finding.source_host) ||
      "unknown";
    const bucket = byDomain.get(domain) ?? {
      verified: 0,
      probable: 0,
      risks: [],
    };
    if (classification === "VERIFIED_DEEPFAKE") bucket.verified += 1;
    else bucket.probable += 1;
    bucket.risks.push(asRiskLevel(finding.risk_level));
    byDomain.set(domain, bucket);
  }

  const rows: ThreatDomainLabel[] = [];
  for (const [domain, bucket] of byDomain) {
    const threatCount = bucket.verified + bucket.probable;
    const highestRisk =
      bucket.risks.reduce<RiskLevel | null>((best, risk) => {
        if (!best || RISK_RANK[risk] > RISK_RANK[best]) return risk;
        return best;
      }, null) ?? "LOW";
    const hasVerified = bucket.verified > 0;
    const tone: "red" | "orange" =
      hasVerified || highestRisk === "CRITICAL" ? "red" : "orange";
    const wording = hasVerified
      ? "Verified evidence domain"
      : threatCount >= 2
        ? "Multiple threat pages"
        : "Highest threat activity";
    const riskWord =
      highestRisk === "CRITICAL" || highestRisk === "HIGH"
        ? highestRisk
        : hasVerified
          ? "VERIFIED"
          : "HIGH RISK";
    rows.push({
      domain,
      threatCount,
      verified: bucket.verified,
      probable: bucket.probable,
      highestRisk,
      hasVerified,
      tone,
      chipLabel: `${riskWord} · ${domain} · ${threatCount} threat${
        threatCount === 1 ? "" : "s"
      }`,
      detailLabel: hasVerified
        ? `${bucket.verified} verified`
        : `${bucket.probable} probable`,
      wording,
    });
  }

  rows.sort((a, b) => {
    if (a.hasVerified !== b.hasVerified) return a.hasVerified ? -1 : 1;
    if (a.highestRisk === "CRITICAL" && b.highestRisk !== "CRITICAL") return -1;
    if (b.highestRisk === "CRITICAL" && a.highestRisk !== "CRITICAL") return 1;
    if (a.highestRisk === "HIGH" && b.highestRisk !== "HIGH") return -1;
    if (b.highestRisk === "HIGH" && a.highestRisk !== "HIGH") return 1;
    if (b.threatCount !== a.threatCount) return b.threatCount - a.threatCount;
    return a.domain.localeCompare(b.domain);
  });

  return rows.slice(0, Math.max(0, limit));
}

export function threatAlertHeadline(tone: ThreatAlertTone): string | null {
  if (tone === "red") return "HIGH-VOLUME DEEPFAKE THREAT ACTIVITY";
  if (tone === "orange") return "Multiple threats detected";
  if (tone === "amber") return "Threat detected";
  return null;
}

export function threatAlertBadgeLabel(input: {
  mode: IdentityScanVizMode;
  tone: ThreatAlertTone;
}): string {
  if (input.tone === "red") {
    if (input.mode === "partial") return "PAUSED — HIGH THREAT VOLUME";
    if (input.mode === "running") return "HIGH THREAT VOLUME";
    if (input.mode === "completed") return "HIGH THREAT VOLUME";
    if (input.mode === "failed") return "HIGH THREAT VOLUME";
    return "HIGH THREAT VOLUME";
  }
  if (input.tone === "orange") {
    if (input.mode === "partial") return "PAUSED — MULTIPLE THREATS";
    return "MULTIPLE THREATS";
  }
  if (input.tone === "amber") {
    if (input.mode === "partial") return "PAUSED — THREAT DETECTED";
    return "THREAT DETECTED";
  }
  if (input.mode === "partial") return "PAUSED";
  if (input.mode === "running") return "SCANNING";
  if (input.mode === "completed") return "VERIFIED";
  if (input.mode === "failed") return "FAILED";
  if (input.mode === "idle") return "READY";
  return "READY";
}

export function threatAlertCountLines(summary: ThreatAlertSummary): string[] {
  if (summary.tone === "cyan" || summary.total <= 0) return [];
  return [
    `${summary.verified} verified deepfake${summary.verified === 1 ? "" : "s"}`,
    `${summary.probable} probable deepfake${summary.probable === 1 ? "" : "s"}`,
    `${summary.domains} affected domain${summary.domains === 1 ? "" : "s"}`,
  ];
}

export function threatAlertBannerMessage(summary: ThreatAlertSummary): string {
  return `Eterna identified ${summary.total} distinct client-visible threat page${
    summary.total === 1 ? "" : "s"
  } across ${summary.domains} verified domain${
    summary.domains === 1 ? "" : "s"
  }.`;
}

export function shouldShowThreatAlertBanner(summary: ThreatAlertSummary): boolean {
  return summary.tone === "orange" || summary.tone === "red";
}

/**
 * Live-region role for elevated threat banners.
 * - Crossing into orange/red during the same selected-scan session → alert once
 * - Reload / history selection / later polls → status
 */
export function resolveThreatAlertAnnouncement(input: {
  scanId: string | null;
  distinctTotal: number;
  tone?: ThreatAlertTone;
  previous: ThreatAlertAnnouncementState | null;
}): {
  role: "alert" | "status";
  announceMultiple: boolean;
  announceAlert: boolean;
  next: ThreatAlertAnnouncementState;
} {
  const scanId = input.scanId;
  const distinctTotal = Math.max(0, input.distinctTotal);
  const tone =
    input.tone ??
    threatAlertToneFromCounts({ total: distinctTotal, verified: 0 });
  const previous = input.previous;
  const scanChanged = !previous || previous.scanId !== scanId;
  const elevated = tone === "orange" || tone === "red";

  if (scanChanged) {
    return {
      role: "status",
      announceMultiple: false,
      announceAlert: false,
      next: {
        scanId,
        distinctTotal,
        tone,
        hasAnnouncedAlert: elevated,
        hasAnnouncedMultiple: elevated,
      },
    };
  }

  const prevElevated =
    previous.tone === "orange" ||
    previous.tone === "red" ||
    previous.hasAnnouncedAlert ||
    previous.hasAnnouncedMultiple ||
    previous.distinctTotal >= 2;
  const crossedToElevated = !prevElevated && elevated;
  const announceAlert = crossedToElevated && !previous.hasAnnouncedAlert;

  return {
    role: announceAlert ? "alert" : "status",
    announceMultiple: announceAlert,
    announceAlert,
    next: {
      scanId,
      distinctTotal,
      tone,
      hasAnnouncedAlert: previous.hasAnnouncedAlert || elevated,
      hasAnnouncedMultiple: previous.hasAnnouncedMultiple || elevated,
    },
  };
}

/**
 * Threat tone always wins over lifecycle colour when elevated.
 * PARTIAL must not force amber when threats are orange/red.
 */
export function resolveThreatAwareRingTone(input: {
  mode: IdentityScanVizMode;
  threatLevel?: ThreatAlertTone;
  tone?: ThreatAlertTone;
}): "cyan" | "amber" | "orange" | "red" | "green" | "muted" {
  if (input.mode === "empty") return "muted";
  const tone = input.tone ?? input.threatLevel ?? "cyan";
  if (tone === "red") return "red";
  if (tone === "orange") return "orange";
  if (tone === "amber") return "amber";
  // No elevated threat — lifecycle colours.
  if (input.mode === "running" || input.mode === "idle") return "cyan";
  if (input.mode === "partial") return "amber";
  if (input.mode === "completed") return "green";
  if (input.mode === "failed") return "red";
  return "muted";
}

/**
 * Slow alert animation for orange/red during running OR partial.
 * Fast scan beam is gated separately.
 */
export function shouldAnimateThreatAwareScan(input: {
  mode: IdentityScanVizMode;
  threatLevel?: ThreatAlertTone;
  tone?: ThreatAlertTone;
  prefersReducedMotion: boolean;
}): boolean {
  if (input.prefersReducedMotion) return false;
  if (input.mode === "empty") return false;
  const tone = input.tone ?? input.threatLevel ?? "cyan";
  if (tone === "red" || tone === "orange") {
    return input.mode === "running" || input.mode === "partial";
  }
  if (tone === "amber") return input.mode === "running";
  return input.mode === "running" || input.mode === "idle";
}

export function shouldShowThreatAwareScanBeam(input: {
  mode: IdentityScanVizMode;
  prefersReducedMotion: boolean;
}): boolean {
  if (input.prefersReducedMotion) return false;
  return input.mode === "running";
}

export function threatAwareStatusCopy(input: {
  mode: IdentityScanVizMode;
  threatLevel?: ThreatAlertTone;
  tone?: ThreatAlertTone;
  stage?: string | null;
  stageMessage?: string | null;
  statusHeadline?: string | null;
}): string {
  const tone = input.tone ?? input.threatLevel ?? "cyan";
  const threatHeadline = threatAlertHeadline(tone);
  if ((tone === "red" || tone === "orange") && threatHeadline) {
    return threatHeadline;
  }
  if (tone === "amber" && threatHeadline) {
    if (input.mode === "partial") {
      return "Threat detected · Verified progress saved.";
    }
    return threatHeadline;
  }
  if (input.mode === "partial") return "Verified progress saved.";
  if (input.mode === "idle") return "Identity model ready";
  if (input.mode === "running") {
    return input.stageMessage || input.statusHeadline || "Identity scan in progress";
  }
  return input.statusHeadline || "";
}

/**
 * Track newly persisted finding ids per scan for one-shot pulse animations.
 * Seeds without animating on reload / history selection.
 */
export function resolveNewThreatFindingPulse(input: {
  scanId: string | null;
  findingIds: string[];
  previous: SeenThreatFindingsState | null;
}): {
  newIds: string[];
  isInitialSeed: boolean;
  next: SeenThreatFindingsState;
} {
  const scanId = input.scanId;
  const ids = input.findingIds;
  const previous = input.previous;

  if (!scanId) {
    return {
      newIds: [],
      isInitialSeed: true,
      next: { scanId: null, ids: new Set(), seeded: false },
    };
  }

  if (!previous || previous.scanId !== scanId || !previous.seeded) {
    return {
      newIds: [],
      isInitialSeed: true,
      next: { scanId, ids: new Set(ids), seeded: true },
    };
  }

  const newIds = ids.filter((id) => !previous.ids.has(id));
  const nextIds = new Set(previous.ids);
  for (const id of ids) nextIds.add(id);
  return {
    newIds,
    isInitialSeed: false,
    next: { scanId, ids: nextIds, seeded: true },
  };
}

/** Presentation-only ordering for the results console under red alert. */
export function compareThreatPresentationOrder(
  a: ClientFinding,
  b: ClientFinding,
): number {
  const classRank = (finding: ClientFinding) => {
    const c = classifyThreatFinding(finding);
    if (c === "VERIFIED_DEEPFAKE") return 0;
    if (c === "PROBABLE_DEEPFAKE") return 1;
    return 2;
  };
  const riskRank = (finding: ClientFinding) =>
    -RISK_RANK[asRiskLevel(finding.risk_level)];
  return (
    classRank(a) - classRank(b) ||
    riskRank(a) - riskRank(b) ||
    a.id.localeCompare(b.id)
  );
}

export function isElevatedThreatTone(tone: ThreatAlertTone): boolean {
  return tone === "orange" || tone === "red";
}

export function isRedThreatTone(tone: ThreatAlertTone): boolean {
  return tone === "red";
}
