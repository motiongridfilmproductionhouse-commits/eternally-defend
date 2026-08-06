/**
 * Threat Intelligence Report model.
 *
 * Pure, testable transformation from persisted copyright investigation data
 * (scan row + verified match rows + telemetry) into the dossier structure the
 * PDF renderer draws. No IO, no pdf-lib, no Supabase.
 */

import type { DomainIntel } from "./domain-intel";
import { isNeverDisplayHost, verifyIllegalDistribution } from "./verified-distribution";
import { TYPE_LABEL, type CopyrightClassification } from "./taxonomy";
import {
  CATEGORY_LABELS,
  classifyThreatCategory,
  severityFor,
  type ThreatSeverity,
} from "./threat-results";

export const REPORT_VERSION = "v1.0";

export type ReportPriority = "immediate" | "24_hours" | "monitor" | "no_action";

export interface ReportEvidenceLink {
  label: string;
  url: string;
  httpStatus: string;
  verifiedAt: string;
  live: "Live" | "Offline" | "Unverified";
}

export interface ReportThreat {
  index: number;
  evidenceId: string;
  matchId: string;
  website: string;
  domain: string;
  url: string;
  pageTitle: string | null;
  classification: string;
  classificationLabel: string;
  categoryLabel: string;
  severity: ThreatSeverity;
  status: "active" | "offline" | "removed";
  confidence: number;
  detectedAt: string;
  lastVerifiedAt: string;
  evidence: {
    hasScreenshot: boolean;
    screenshotCaption: string;
    highlightedCaption: string;
    titleDetected: string | null;
    downloadButtonDetected: boolean;
    embeddedPlayerDetected: boolean;
    streamingPlayerDetected: boolean;
    downloadLinks: string[];
    directFileUrls: string[];
    htmlEvidence: string | null;
    metadata: Array<[string, string]>;
    ocrResult: string | null;
    visualFingerprintScore: number | null;
    videoFingerprintScore: number | null;
    qualityTags: string[];
    indicators: string[];
  };
  aiSummary: string;
  links: ReportEvidenceLink[];
  domainIntel: {
    domain: string;
    registrar: string;
    registrationDate: string;
    expiryDate: string;
    hostingProvider: string;
    hostingCountry: string;
    ipAddress: string;
    asn: string;
    cloudProvider: string;
    ssl: string;
    nameservers: string;
    whoisStatus: string;
  };
  enforcement: {
    hostingProvider: string;
    hostingAbuseEmail: string;
    hostingComplaintUrl: string;
    registrarAbuseEmail: string;
    registrarComplaintUrl: string;
    dmcaContact: string;
    legalContact: string;
    jurisdiction: string;
    priority: ReportPriority;
    recommendedAction: string;
  };
  integrity: {
    evidenceId: string;
    collectionTime: string;
    verificationTime: string;
    sha256: string;
    status: string;
    chainOfCustody: string[];
  };
  relationships: {
    origin: string;
    mirrorDomains: string[];
    redirects: string[];
    embeddedPlayers: string[];
    downloadServers: string[];
    relatedInfrastructure: string[];
  };
  geography: {
    hostingCountry: string;
    serverCountry: string;
    cdnLocation: string;
    distributionRegion: string;
  };
}

export interface ReportTimelineEntry {
  time: string;
  label: string;
}

export interface ReportActionItem {
  priority: ReportPriority;
  action: string;
  target: string;
  route: string;
}

export interface CopyrightReportModel {
  reportId: string;
  investigationId: string;
  version: string;
  generatedAt: string;
  clientName: string;
  protectedAsset: string;
  assetKind: string;
  threatLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  riskScore: number;
  summary: {
    investigationDuration: string;
    websitesScanned: number;
    threatsDetected: number;
    verifiedSources: number;
    highRiskDomains: number;
    activeThreats: number;
    removedThreats: number;
    riskScore: number;
    immediateActions: string[];
  };
  threats: ReportThreat[];
  timeline: ReportTimelineEntry[];
  geography: Array<{ country: string; sources: number; region: string }>;
  actions: ReportActionItem[];
  finalSummary: {
    totalThreats: number;
    criticalThreats: number;
    highRiskDomains: number;
    activeSources: number;
    removedSources: number;
    enforcementWorkload: string;
    topTargets: Array<{
      rank: number;
      domain: string;
      severity: ThreatSeverity;
      confidence: number;
      action: string;
    }>;
  };
}

/* -------------------------------------------------------------- helpers */

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
const NA = "Not available";
function shown(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return NA;
  return String(value);
}
function iso(value: unknown): string {
  const raw = typeof value === "string" ? value : null;
  if (!raw) return NA;
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
}

export function priorityForSeverity(severity: ThreatSeverity): ReportPriority {
  if (severity === "critical") return "immediate";
  if (severity === "high") return "24_hours";
  if (severity === "medium") return "monitor";
  return "no_action";
}

export const PRIORITY_LABEL: Record<ReportPriority, string> = {
  immediate: "Immediate",
  "24_hours": "Within 24 hours",
  monitor: "Monitor",
  no_action: "No action",
};

function recommendedActionFor(severity: ThreatSeverity, category: string): string {
  if (severity === "critical") {
    return `Send hosting abuse complaint and DMCA notice for this ${category.toLowerCase()} immediately; escalate to legal if unresolved in 48 hours.`;
  }
  if (severity === "high") {
    return `File a hosting complaint and registrar complaint within 24 hours and re-verify after removal.`;
  }
  if (severity === "medium") {
    return `Keep under continuous monitoring and collect further access evidence before filing.`;
  }
  return "No enforcement action recommended at this confidence level.";
}

function threatLevelFromScore(score: number): CopyrightReportModel["threatLevel"] {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function durationLabel(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return NA;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Under 1 minute";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes < 1) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function classificationLabel(classification: string): string {
  return TYPE_LABEL[classification as CopyrightClassification] ?? classification.replace(/_/g, " ");
}

/* --------------------------------------------------------------- inputs */

/** Persisted `copyright_matches` row shape used by the report. */
export interface ReportMatchRow {
  id: string;
  source_url: string;
  page_title?: string | null;
  detection_type?: string | null;
  confidence?: number | null;
  reason?: string | null;
  review_status?: string | null;
  ocr_text?: string | null;
  created_at?: string | null;
  evidence?: unknown;
  contact?: unknown;
}

export interface ReportScanRow {
  id: string;
  title: string;
  status?: string | null;
  reference_kind?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  stats?: unknown;
}

export interface BuildReportInput {
  scan: ReportScanRow;
  matches: ReportMatchRow[];
  clientName: string;
  generatedAt: string;
  /** Domain intelligence keyed by registrable domain, when enrichment succeeded. */
  domainIntel?: Record<string, DomainIntel | undefined>;
  /** Match ids whose evidence screenshot bytes were embedded in the PDF. */
  screenshotMatchIds?: string[];
  /** Sanitized investigation telemetry rows (verified findings only). */
  timelineEvents?: Array<{ occurred_at: string; label: string }>;
  /** Deterministic hasher (sha256 hex) supplied by the server layer. */
  hash: (value: unknown) => string;
}

/* ------------------------------------------------------------- builders */

function buildThreat(match: ReportMatchRow, index: number, input: BuildReportInput): ReportThreat {
  const ev = rec(match.evidence);
  const dist = rec(ev.distribution);
  const pageEvidence = rec(ev.page_evidence);
  const recognition = rec(ev.recognition);
  const url = match.source_url;
  const domain = str(dist.domain) ?? str(ev.host) ?? hostOfUrl(url);
  const classification =
    str(dist.classification) ??
    str(ev.prior_classification) ??
    str(match.detection_type) ??
    "UNVERIFIED_LEAD";
  const confidence = Math.round(num(match.confidence) ?? 0);
  const categoryKey = classifyThreatCategory({
    domain,
    url,
    classification,
    contentType: str(dist.content_type) ?? str(ev.website_type),
  });
  const severity = severityFor(confidence, true, {
    categoryKey,
    classification,
    domainRisk: str(dist.domain_risk) ?? str(ev.domain_risk),
  });
  const crawlFailed = ev.crawl_failed === true || dist.crawl_failed === true;
  const removed = match.review_status === "removed";
  const status: ReportThreat["status"] = removed ? "removed" : crawlFailed ? "offline" : "active";

  const distributionLinks = unique(
    list(dist.distribution_links).concat(list(ev.distribution_links)),
  );
  const embedSources = unique(list(dist.embed_sources).concat(list(ev.embed_sources)));
  const directFileUrls = distributionLinks.filter((link) =>
    /\.(mp4|mkv|avi|m3u8|torrent|zip)(\?|$)/i.test(link),
  );
  const indicators = rec(dist).piracy_indicators;
  const indicatorDetails = Array.isArray(indicators)
    ? indicators
        .map((item) => {
          const entry = rec(item);
          return str(entry.detail) ?? str(entry.key);
        })
        .filter((v): v is string => Boolean(v))
    : [];
  const accessEvidence = unique(
    list(rec(pageEvidence.accessEvidence).signals).concat(list(dist.access_evidence)),
  );
  const identityEvidence = unique(list(dist.identity_evidence).concat(list(ev.identity_evidence)));
  const qualityTags = unique(list(dist.quality_tags));
  const downloadButtonDetected = accessEvidence
    .concat(indicatorDetails)
    .some((signal) => /download|magnet|torrent|\.mp4|\.mkv/i.test(signal));
  const embeddedPlayerDetected =
    embedSources.length > 0 ||
    accessEvidence.concat(indicatorDetails).some((signal) => /iframe|embed/i.test(signal));
  const streamingPlayerDetected =
    /STREAM/i.test(classification) ||
    accessEvidence
      .concat(indicatorDetails)
      .some((signal) => /player|stream|watch online|m3u8/i.test(signal));

  const intel = input.domainIntel?.[domain];
  const investigation = intel?.investigation;
  const removal = intel?.removal;
  const contact = rec(match.contact);

  const evidenceId = `EV-${String(index).padStart(3, "0")}-${input.hash([match.id]).slice(0, 8).toUpperCase()}`;
  const collectedAt = iso(match.created_at);
  const verifiedAt = iso(str(ev.prior_verified_at) ?? match.created_at);
  const evidenceHash = input.hash({
    url,
    classification,
    confidence,
    evidence: match.evidence ?? null,
  });

  const links: ReportEvidenceLink[] = [
    {
      label: "Original URL",
      url,
      httpStatus: crawlFailed ? shown(str(ev.crawl_failure_reason)) : "200 OK",
      verifiedAt: collectedAt,
      live: crawlFailed ? "Offline" : "Live",
    },
    ...distributionLinks.slice(0, 6).map((link) => ({
      label: /\.(m3u8|mp4|mkv)(\?|$)/i.test(link) ? "Direct file URL" : "Download URL",
      url: link,
      httpStatus: "Recorded during investigation",
      verifiedAt: collectedAt,
      live: "Unverified" as const,
    })),
    ...embedSources.slice(0, 4).map((link) => ({
      label: "Embedded player URL",
      url: link,
      httpStatus: "Recorded during investigation",
      verifiedAt: collectedAt,
      live: "Unverified" as const,
    })),
    ...(str(dist.evidence_screenshot)
      ? [
          {
            label: "Poster / evidence image",
            url: str(dist.evidence_screenshot) as string,
            httpStatus: "Embedded in this report",
            verifiedAt: collectedAt,
            live: "Live" as const,
          },
        ]
      : []),
    ...unique(intel?.mirrorDomains ?? [])
      .slice(0, 4)
      .map((mirror) => ({
        label: "Mirror URL",
        url: mirror.startsWith("http") ? mirror : `https://${mirror}`,
        httpStatus: "Resolved from infrastructure intelligence",
        verifiedAt: iso(intel?.cachedAt),
        live: "Unverified" as const,
      })),
  ];

  const aiSummaryParts: string[] = [];
  if (identityEvidence.length) {
    aiSummaryParts.push(
      `the protected title was positively identified on the page (${identityEvidence.slice(0, 3).join(", ")})`,
    );
  }
  if (streamingPlayerDetected) aiSummaryParts.push("a streaming player was detected");
  if (embeddedPlayerDetected) aiSummaryParts.push("an embedded third-party player was found");
  if (downloadButtonDetected) aiSummaryParts.push("download actions were present on the page");
  if (distributionLinks.length) {
    aiSummaryParts.push(`${distributionLinks.length} distribution link(s) were captured`);
  }
  if (qualityTags.length)
    aiSummaryParts.push(`release quality markers (${qualityTags.slice(0, 3).join(", ")})`);
  const aiSummary =
    `Classified as ${classificationLabel(classification).toLowerCase()} at ${confidence}% confidence because ` +
    (aiSummaryParts.length
      ? aiSummaryParts.join(", ") + "."
      : "unauthorized distribution indicators were verified on the page.") +
    (str(match.reason) ? ` Analyst note: ${str(match.reason)}` : "") +
    " Evidence was captured and verified during this investigation; no takedown was submitted automatically.";

  const country = investigation?.country ?? removal?.country ?? null;

  return {
    index,
    evidenceId,
    matchId: match.id,
    website: domain,
    domain,
    url,
    pageTitle: str(match.page_title),
    classification,
    classificationLabel: classificationLabel(classification),
    categoryLabel: CATEGORY_LABELS[categoryKey] ?? categoryKey.replace(/_/g, " "),
    severity,
    status,
    confidence,
    detectedAt: collectedAt,
    lastVerifiedAt: verifiedAt,
    evidence: {
      hasScreenshot: (input.screenshotMatchIds ?? []).includes(match.id),
      screenshotCaption: `Full page capture — ${domain} (${collectedAt})`,
      highlightedCaption: `Highlighted distribution evidence — ${domain}`,
      titleDetected: identityEvidence[0] ?? str(match.page_title),
      downloadButtonDetected,
      embeddedPlayerDetected,
      streamingPlayerDetected,
      downloadLinks: distributionLinks.slice(0, 10),
      directFileUrls: directFileUrls.slice(0, 10),
      htmlEvidence: str(ev.page_excerpt),
      metadata: [
        ["Website type", shown(str(dist.content_type) ?? str(ev.website_type))],
        ["Domain risk", shown(str(dist.domain_risk))],
        ["Detected language", shown(str(ev.detected_language))],
        ["Release timing", shown(str(dist.release_timing))],
        ["Discovery method", shown(str(ev.discovery))],
        ["Retrieval method", shown(str(ev.retrieval_method) ?? str(dist.retrieval_method))],
      ],
      ocrResult: str(match.ocr_text) ?? str(recognition.matched_ocr_text),
      visualFingerprintScore:
        num(recognition.scene_similarity) ?? num(recognition.corroboration_score),
      videoFingerprintScore: num(recognition.face_similarity),
      qualityTags,
      indicators: indicatorDetails.slice(0, 8),
    },
    aiSummary,
    links,
    domainIntel: {
      domain,
      registrar: shown(removal?.registrar ?? investigation?.whoisRegistrar),
      registrationDate: shown(investigation?.whoisCreatedAt ?? null),
      expiryDate: shown(investigation?.whoisExpiresAt ?? null),
      hostingProvider: shown(removal?.hostingCompany ?? investigation?.hostingProvider),
      hostingCountry: shown(country),
      ipAddress: shown(investigation?.ipAddress ?? null),
      asn: shown(investigation?.hostingProvider ?? null),
      cloudProvider: shown(investigation?.cdn ?? investigation?.waf ?? null),
      ssl: shown(investigation?.sslStatus ?? null),
      nameservers: shown((investigation?.whoisNameservers ?? []).slice(0, 4).join(", ") || null),
      whoisStatus: removal?.whoisPrivacy
        ? "Privacy protected"
        : shown(removal?.whoisContact ?? null),
    },
    enforcement: {
      hostingProvider: shown(removal?.hostingCompany ?? investigation?.hostingProvider),
      hostingAbuseEmail: shown(removal?.hostingAbuseEmail ?? str(contact.abuseEmail)),
      hostingComplaintUrl: shown(removal?.hostingAbuseForm ?? str(contact.reportUrl)),
      registrarAbuseEmail: shown(removal?.registrarAbuseEmail),
      registrarComplaintUrl: shown(removal?.registrarComplaintUrl),
      dmcaContact: shown(
        removal?.dmcaPageUrl ?? removal?.copyrightComplaintUrl ?? str(contact.reportUrl),
      ),
      legalContact: shown(removal?.legalContact),
      jurisdiction: shown(removal?.jurisdiction ?? country),
      priority: priorityForSeverity(severity),
      recommendedAction: recommendedActionFor(severity, categoryKey.replace(/_/g, " ")),
    },
    integrity: {
      evidenceId,
      collectionTime: collectedAt,
      verificationTime: verifiedAt,
      sha256: evidenceHash,
      status: crawlFailed
        ? "Preserved — source unreachable at verification"
        : "Verified and preserved",
      chainOfCustody: [
        `Discovered by Eterna discovery engine (${shown(str(ev.discovery))})`,
        "Page retrieved and rendered by the investigation runtime",
        "Distribution evidence extracted and classified",
        `Evidence hashed (SHA-256) and sealed as ${evidenceId}`,
        `Compiled into report ${input.scan.id.slice(0, 8).toUpperCase()} on ${iso(input.generatedAt)}`,
      ],
    },
    relationships: {
      origin: url,
      mirrorDomains: unique(intel?.mirrorDomains ?? []).slice(0, 6),
      redirects: unique(list(ev.redirect_chain).concat(intel?.historicalDomains ?? [])).slice(0, 6),
      embeddedPlayers: embedSources.slice(0, 6),
      downloadServers: unique(distributionLinks.map(hostOfUrl)).slice(0, 6),
      relatedInfrastructure: unique(
        [
          intel?.reverseIpHost ?? "",
          investigation?.cdn ?? "",
          investigation?.hostingProvider ?? "",
        ].filter(Boolean),
      ),
    },
    geography: {
      hostingCountry: shown(country),
      serverCountry: shown(investigation?.country ?? country),
      cdnLocation: shown(investigation?.cdn ?? investigation?.city ?? null),
      distributionRegion: shown(removal?.regime ?? str(ev.reference_region)),
    },
  };
}

/** Verified illegal distribution matches only, newest/strongest first. */
export function selectReportMatches(matches: ReportMatchRow[]): ReportMatchRow[] {
  const byUrl = new Map<string, ReportMatchRow>();
  for (const match of matches) {
    if (isNeverDisplayHost(match.source_url)) continue;
    if (match.review_status === "dismissed") continue;
    const verdict = verifyIllegalDistribution({
      source_url: match.source_url,
      detection_type: match.detection_type,
      confidence: match.confidence,
      evidence: match.evidence,
    });
    if (!verdict.verified) continue;
    const existing = byUrl.get(match.source_url);
    if (!existing || (num(match.confidence) ?? 0) > (num(existing.confidence) ?? 0)) {
      byUrl.set(match.source_url, match);
    }
  }
  return [...byUrl.values()].sort((a, b) => (num(b.confidence) ?? 0) - (num(a.confidence) ?? 0));
}

export function buildCopyrightReportModel(input: BuildReportInput): CopyrightReportModel {
  const stats = rec(input.scan.stats);
  const selected = selectReportMatches(input.matches);
  const threats = selected.map((match, i) => buildThreat(match, i + 1, input));

  const active = threats.filter((t) => t.status === "active").length;
  const removed = threats.filter((t) => t.status === "removed").length;
  const critical = threats.filter((t) => t.severity === "critical").length;
  const high = threats.filter((t) => t.severity === "high").length;
  const highRiskDomains = new Set(
    threats.filter((t) => t.severity === "critical" || t.severity === "high").map((t) => t.domain),
  ).size;

  const websitesScanned =
    num(stats.pages_crawled) ??
    num(stats.unique_candidate_pages) ??
    num(stats.candidates) ??
    input.matches.length;

  const riskScore = threats.length
    ? Math.min(
        100,
        Math.round(
          critical * 18 +
            high * 9 +
            Math.max(0, threats.length - critical - high) * 3 +
            (active ? 10 : 0),
        ),
      )
    : 0;

  const immediateActions = threats
    .filter((t) => t.enforcement.priority === "immediate")
    .slice(0, 6)
    .map((t) => `Send hosting + DMCA complaint for ${t.domain} (${t.confidence}% confidence).`);
  if (!immediateActions.length && threats.length) {
    immediateActions.push(
      "Review the verified sources below and file complaints in priority order.",
    );
  }
  if (!threats.length) {
    immediateActions.push(
      "No verified unauthorized distribution was found in this investigation cycle.",
    );
  }

  const geoCounts = new Map<string, { sources: number; region: string }>();
  for (const threat of threats) {
    const key = threat.geography.hostingCountry;
    const current = geoCounts.get(key) ?? {
      sources: 0,
      region: threat.geography.distributionRegion,
    };
    current.sources += 1;
    geoCounts.set(key, current);
  }

  const timeline: ReportTimelineEntry[] = [
    { time: iso(input.scan.created_at), label: "Investigation started" },
    ...(num(stats.provider_queries) || num(stats.queries)
      ? [
          {
            time: iso(input.scan.created_at),
            label: `Discovery completed — ${num(stats.provider_queries) ?? num(stats.queries)} search sweeps`,
          },
        ]
      : []),
    ...(input.timelineEvents ?? []).slice(0, 12).map((event) => ({
      time: iso(event.occurred_at),
      label: event.label,
    })),
    ...(threats.length
      ? [
          {
            time: iso(input.scan.completed_at ?? input.scan.updated_at),
            label: `Evidence captured for ${threats.length} verified source(s)`,
          },
        ]
      : []),
    { time: iso(input.generatedAt), label: "Threat intelligence report generated" },
  ];

  const actions: ReportActionItem[] = threats.map((threat) => ({
    priority: threat.enforcement.priority,
    action:
      threat.enforcement.priority === "immediate"
        ? "Hosting complaint + DMCA notice"
        : threat.enforcement.priority === "24_hours"
          ? "Hosting complaint + registrar complaint"
          : threat.enforcement.priority === "monitor"
            ? "Continuous monitoring"
            : "No action",
    target: threat.domain,
    route:
      threat.enforcement.hostingAbuseEmail !== NA
        ? threat.enforcement.hostingAbuseEmail
        : threat.enforcement.dmcaContact,
  }));

  const workloadHours = critical * 1.5 + high * 1 + (threats.length - critical - high) * 0.25;

  return {
    reportId: `ETR-CI-${input.hash([input.scan.id, input.generatedAt]).slice(0, 10).toUpperCase()}`,
    investigationId: input.scan.id,
    version: REPORT_VERSION,
    generatedAt: input.generatedAt,
    clientName: input.clientName,
    protectedAsset: input.scan.title,
    assetKind: input.scan.reference_kind === "video" ? "Video / film" : "Image / artwork",
    threatLevel: threatLevelFromScore(riskScore),
    riskScore,
    summary: {
      investigationDuration: durationLabel(
        input.scan.created_at ?? null,
        input.scan.completed_at ?? input.scan.updated_at ?? null,
      ),
      websitesScanned,
      threatsDetected: threats.length,
      verifiedSources: threats.length,
      highRiskDomains,
      activeThreats: active,
      removedThreats: removed,
      riskScore,
      immediateActions,
    },
    threats,
    timeline,
    geography: [...geoCounts.entries()].map(([country, value]) => ({
      country,
      sources: value.sources,
      region: value.region,
    })),
    actions,
    finalSummary: {
      totalThreats: threats.length,
      criticalThreats: critical,
      highRiskDomains,
      activeSources: active,
      removedSources: removed,
      enforcementWorkload: threats.length
        ? `${Math.max(1, Math.round(workloadHours))} analyst hour(s) across ${threats.length} target(s)`
        : "None",
      topTargets: threats.slice(0, 10).map((threat, i) => ({
        rank: i + 1,
        domain: threat.domain,
        severity: threat.severity,
        confidence: threat.confidence,
        action: PRIORITY_LABEL[threat.enforcement.priority],
      })),
    },
  };
}
