/**
 * Deepfake Threat Report model.
 *
 * Pure transformation from persisted Deepfake Intelligence data
 * (scan + client-visible findings + profile + diagnostics) into the
 * dossier structure the PDF renderer draws.
 *
 * Never invents findings, URLs, screenshots, confidence scores, or legal
 * conclusions — only projects fields that already exist on the input rows.
 */

import {
  asRiskLevel,
  findingDomain,
  isClientVisibleClassification,
  normalizeClassification,
  type ClientFinding,
  type RiskLevel,
} from "./results-dashboard";
import {
  resolveVerifiedEvidenceHref,
  sanitizeEvidenceUrl,
} from "./evidence-url";

export const DEEPFAKE_REPORT_VERSION = "v1.0";

export type DeepfakeReportPriority =
  | "immediate_review"
  | "priority_review"
  | "monitor"
  | "no_action";

export interface DeepfakeReportFinding {
  index: number;
  findingId: string;
  domain: string;
  url: string | null;
  pageTitle: string | null;
  classification: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  classificationLabel: string;
  riskLevel: RiskLevel;
  confidence: number | null;
  identityConfidence: number | null;
  syntheticMediaConfidence: number | null;
  contentCategory: string | null;
  pageType: string | null;
  faceReferenced: boolean;
  targetFaceMatch: boolean | null;
  faceSimilarity: number | null;
  isSynthetic: boolean | null;
  httpStatus: number | null;
  urlVerificationStatus: string | null;
  matchedEvidence: string[];
  classificationExplanation: string | null;
  aiReasoning: string | null;
  snippet: string | null;
  query: string | null;
  reviewStatus: string | null;
  takedownRecommended: boolean | null;
  detectedAt: string;
  crawledAt: string | null;
  redirectChain: string[];
  priority: DeepfakeReportPriority;
  recommendedNextStep: string;
  analystSummary: string;
}

export interface DeepfakeReportDomainRow {
  domain: string;
  verified: number;
  probable: number;
  highestRisk: RiskLevel;
  findingCount: number;
}

export interface DeepfakeReportTimelineEntry {
  time: string;
  label: string;
}

export interface DeepfakeReportModel {
  reportId: string;
  scanId: string;
  profileId: string | null;
  version: string;
  generatedAt: string;
  clientName: string;
  protectedIdentity: string;
  aliases: string[];
  handles: string[];
  authorizationStatus: string | null;
  referenceFaceCount: number;
  threatLevel: RiskLevel;
  riskScore: number;
  summary: {
    scanStatus: string;
    investigationDuration: string;
    queriesPlanned: number | null;
    queriesExecuted: number | null;
    pagesVerified: number | null;
    clientVisibleFindings: number;
    verifiedDeepfakes: number;
    probableDeepfakes: number;
    uniqueDomains: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    identityRejected: number | null;
    urlRejected: number | null;
    crawlFailed: number | null;
    immediateReviewItems: string[];
  };
  identity: {
    targetName: string;
    aliases: string[];
    handles: string[];
    authorizationStatus: string | null;
    referenceFaceCount: number;
    faceCollectionConfigured: boolean;
  };
  diagnostics: Array<{ key: string; label: string; value: number }>;
  findings: DeepfakeReportFinding[];
  domains: DeepfakeReportDomainRow[];
  timeline: DeepfakeReportTimelineEntry[];
  disclaimer: string[];
}

export interface ReportScanInput {
  id: string;
  target_name: string;
  status: string;
  aliases?: string[] | null;
  handles?: string[] | null;
  profile_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  total_queries?: number | null;
  total_results?: number | null;
  critical_count?: number | null;
  high_count?: number | null;
  medium_count?: number | null;
  low_count?: number | null;
  discovery_metrics?: unknown;
}

export interface ReportProfileInput {
  id: string;
  target_name: string;
  authorization_status?: string | null;
  rekognition_collection_id?: string | null;
  reference_face_count?: number;
}

export interface ReportFindingInput extends ClientFinding {
  face_similarity?: number | null;
  target_face_match?: boolean | null;
}

export interface BuildDeepfakeReportInput {
  scan: ReportScanInput;
  findings: ReportFindingInput[];
  profile: ReportProfileInput | null;
  clientName: string;
  generatedAt: string;
  hash: (value: unknown) => string;
}

const NA = "Not available";

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function iso(value: unknown): string {
  const raw = typeof value === "string" ? value : null;
  if (!raw) return NA;
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
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

function metricLabel(key: string): string {
  return key.replace(/_/g, " ");
}

export const PRIORITY_LABEL: Record<DeepfakeReportPriority, string> = {
  immediate_review: "Immediate human review",
  priority_review: "Priority review",
  monitor: "Monitor",
  no_action: "No action",
};

export function priorityForRisk(risk: RiskLevel): DeepfakeReportPriority {
  if (risk === "CRITICAL") return "immediate_review";
  if (risk === "HIGH") return "priority_review";
  if (risk === "MEDIUM") return "monitor";
  return "no_action";
}

/** Operational next step only — never a legal conclusion. */
export function recommendedNextStepFor(
  risk: RiskLevel,
  classification: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE",
): string {
  if (risk === "CRITICAL" && classification === "VERIFIED_DEEPFAKE") {
    return "Escalate this URL-verified finding for immediate human review and evidence preservation. No legal conclusion is asserted by this report.";
  }
  if (risk === "CRITICAL" || risk === "HIGH") {
    return "Prioritize human review of this client-visible finding and preserve the verified page URL. Enforcement decisions remain with authorized counsel.";
  }
  if (risk === "MEDIUM") {
    return "Keep under monitoring and re-verify the page if distribution expands.";
  }
  return "No enforcement action is recommended at this confidence/risk level.";
}

function classificationLabel(
  classification: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE",
): string {
  return classification === "VERIFIED_DEEPFAKE"
    ? "Verified deepfake"
    : "Probable deepfake";
}

function analystSummaryFor(finding: ReportFindingInput): string {
  const classification = normalizeClassification(finding.finding_classification);
  const parts: string[] = [];

  if (classification === "VERIFIED_DEEPFAKE" || classification === "PROBABLE_DEEPFAKE") {
    parts.push(`classified as ${classificationLabel(classification).toLowerCase()}`);
  }

  if (typeof finding.confidence === "number") {
    parts.push(`recorded confidence ${finding.confidence}%`);
  }
  if (typeof finding.identity_confidence === "number") {
    parts.push(`identity confidence ${finding.identity_confidence}%`);
  }
  if (typeof finding.synthetic_media_confidence === "number") {
    parts.push(`synthetic-media confidence ${finding.synthetic_media_confidence}%`);
  }
  if (finding.face_referenced) {
    parts.push("face reference matched during analysis");
  }
  if (finding.target_face_match === true) {
    parts.push("target face match flagged");
  }
  if (finding.url_verification_status) {
    parts.push(`URL status ${finding.url_verification_status}`);
  }

  const explanation =
    str(finding.classification_explanation) ?? str(finding.ai_reasoning);
  const base =
    parts.length > 0
      ? `Finding ${parts.join("; ")}.`
      : "Finding retained from persisted Deepfake Intelligence results.";

  const note = explanation ? ` Classifier note: ${explanation}` : "";
  return `${base}${note} This report does not assert that the content is unlawful or submit any takedown.`;
}

/** Only client-visible verified/probable findings with a usable evidence URL or stable id. */
export function selectReportFindings(
  findings: ReportFindingInput[],
): ReportFindingInput[] {
  const byKey = new Map<string, ReportFindingInput>();

  for (const finding of findings) {
    const classification = normalizeClassification(finding.finding_classification);
    if (!isClientVisibleClassification(classification)) continue;
    if (finding.review_status === "dismissed") continue;

    const href =
      resolveVerifiedEvidenceHref(finding) ??
      sanitizeEvidenceUrl(finding.url) ??
      null;
    const key = href ?? finding.id;
    const existing = byKey.get(key);
    if (
      !existing ||
      (finding.confidence ?? 0) > (existing.confidence ?? 0)
    ) {
      byKey.set(key, finding);
    }
  }

  const riskRank: Record<RiskLevel, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  return [...byKey.values()].sort(
    (a, b) =>
      (riskRank[asRiskLevel(b.risk_level)] ?? 0) -
        (riskRank[asRiskLevel(a.risk_level)] ?? 0) ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

function buildFinding(
  finding: ReportFindingInput,
  index: number,
): DeepfakeReportFinding {
  const classification = normalizeClassification(
    finding.finding_classification,
  ) as "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  const risk = asRiskLevel(finding.risk_level);
  const href =
    resolveVerifiedEvidenceHref(finding) ??
    sanitizeEvidenceUrl(finding.url) ??
    null;

  return {
    index,
    findingId: finding.id,
    domain: findingDomain(finding),
    url: href,
    pageTitle: str(finding.page_title),
    classification,
    classificationLabel: classificationLabel(classification),
    riskLevel: risk,
    confidence: num(finding.confidence),
    identityConfidence: num(finding.identity_confidence),
    syntheticMediaConfidence: num(finding.synthetic_media_confidence),
    contentCategory: str(finding.content_category),
    pageType: str(finding.page_type),
    faceReferenced: Boolean(finding.face_referenced),
    targetFaceMatch:
      typeof finding.target_face_match === "boolean"
        ? finding.target_face_match
        : null,
    faceSimilarity: num(finding.face_similarity),
    isSynthetic:
      typeof finding.is_synthetic === "boolean" ? finding.is_synthetic : null,
    httpStatus: num(finding.http_status),
    urlVerificationStatus: str(finding.url_verification_status),
    matchedEvidence: list(finding.matched_evidence).slice(0, 12),
    classificationExplanation: str(finding.classification_explanation),
    aiReasoning: str(finding.ai_reasoning),
    snippet: str(finding.snippet),
    query: str(finding.query),
    reviewStatus: str(finding.review_status),
    takedownRecommended:
      typeof finding.takedown_recommended === "boolean"
        ? finding.takedown_recommended
        : null,
    detectedAt: iso(finding.created_at),
    crawledAt: finding.crawled_at ? iso(finding.crawled_at) : null,
    redirectChain: list(finding.redirect_chain).slice(0, 8),
    priority: priorityForRisk(risk),
    recommendedNextStep: recommendedNextStepFor(risk, classification),
    analystSummary: analystSummaryFor(finding),
  };
}

function buildDomains(
  findings: DeepfakeReportFinding[],
): DeepfakeReportDomainRow[] {
  const map = new Map<string, DeepfakeReportDomainRow>();
  const riskRank: Record<RiskLevel, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  for (const finding of findings) {
    const current = map.get(finding.domain) ?? {
      domain: finding.domain,
      verified: 0,
      probable: 0,
      highestRisk: finding.riskLevel,
      findingCount: 0,
    };
    current.findingCount += 1;
    if (finding.classification === "VERIFIED_DEEPFAKE") current.verified += 1;
    else current.probable += 1;
    if (
      (riskRank[finding.riskLevel] ?? 0) > (riskRank[current.highestRisk] ?? 0)
    ) {
      current.highestRisk = finding.riskLevel;
    }
    map.set(finding.domain, current);
  }

  return [...map.values()].sort(
    (a, b) =>
      (riskRank[b.highestRisk] ?? 0) - (riskRank[a.highestRisk] ?? 0) ||
      b.findingCount - a.findingCount,
  );
}

const DIAGNOSTIC_KEYS = [
  "queries_generated",
  "queries_executed",
  "provider_candidates",
  "unique_candidates",
  "crawl_succeeded",
  "crawl_failed",
  "identity_rejected",
  "page_type_rejected",
  "url_rejected",
  "unverified",
  "probable",
  "verified",
  "client_visible",
  "serpapi_requests",
  "serpapi_failures",
  "serpapi_candidates",
  "serpapi_unique_pages",
  "serpapi_face_rejected",
  "serpapi_verified",
] as const;

function extractDiagnostics(
  metrics: Record<string, unknown>,
): Array<{ key: string; label: string; value: number }> {
  const out: Array<{ key: string; label: string; value: number }> = [];
  for (const key of DIAGNOSTIC_KEYS) {
    const value = num(metrics[key]);
    if (value === null) continue;
    out.push({ key, label: metricLabel(key), value });
  }
  return out;
}

function threatLevelFromFindings(
  findings: DeepfakeReportFinding[],
  riskScore: number,
): RiskLevel {
  if (findings.some((f) => f.riskLevel === "CRITICAL") || riskScore >= 80) {
    return "CRITICAL";
  }
  if (findings.some((f) => f.riskLevel === "HIGH") || riskScore >= 60) {
    return "HIGH";
  }
  if (findings.some((f) => f.riskLevel === "MEDIUM") || riskScore >= 35) {
    return "MEDIUM";
  }
  return "LOW";
}

export function buildDeepfakeReportModel(
  input: BuildDeepfakeReportInput,
): DeepfakeReportModel {
  const selected = selectReportFindings(input.findings);
  const findings = selected.map((finding, index) =>
    buildFinding(finding, index + 1),
  );
  const domains = buildDomains(findings);
  const metrics = rec(input.scan.discovery_metrics);
  const diagnostics = extractDiagnostics(metrics);

  const verified = findings.filter(
    (f) => f.classification === "VERIFIED_DEEPFAKE",
  ).length;
  const probable = findings.filter(
    (f) => f.classification === "PROBABLE_DEEPFAKE",
  ).length;
  const critical = findings.filter((f) => f.riskLevel === "CRITICAL").length;
  const high = findings.filter((f) => f.riskLevel === "HIGH").length;
  const medium = findings.filter((f) => f.riskLevel === "MEDIUM").length;
  const low = findings.filter((f) => f.riskLevel === "LOW").length;

  const riskScore = findings.length
    ? Math.min(
        100,
        Math.round(
          critical * 20 +
            high * 10 +
            medium * 4 +
            low * 1 +
            verified * 4 +
            probable * 2,
        ),
      )
    : 0;

  const immediateReviewItems = findings
    .filter((f) => f.priority === "immediate_review")
    .slice(0, 6)
    .map(
      (f) =>
        `Review ${f.domain}${f.url ? ` (${f.url})` : ""} — ${f.classificationLabel}, risk ${f.riskLevel}.`,
    );

  if (!immediateReviewItems.length && findings.length) {
    immediateReviewItems.push(
      "Review the client-visible findings below in priority order. No automated enforcement was submitted.",
    );
  }
  if (!findings.length) {
    immediateReviewItems.push(
      "No client-visible verified or probable deepfake findings were available for this scan.",
    );
  }

  const aliases = list(input.scan.aliases);
  const handles = list(input.scan.handles);
  const protectedIdentity =
    str(input.profile?.target_name) ??
    str(input.scan.target_name) ??
    "Protected identity";

  const timeline: DeepfakeReportTimelineEntry[] = [
    {
      time: iso(input.scan.started_at ?? input.scan.created_at),
      label: "Deepfake Intelligence scan started",
    },
  ];

  const queriesExecuted =
    num(metrics.queries_executed) ?? num(input.scan.total_queries);
  if (queriesExecuted !== null) {
    timeline.push({
      time: iso(input.scan.started_at ?? input.scan.created_at),
      label: `Discovery progress — ${queriesExecuted} quer${queriesExecuted === 1 ? "y" : "ies"} executed`,
    });
  }

  if (findings.length) {
    timeline.push({
      time: iso(input.scan.finished_at ?? input.generatedAt),
      label: `${findings.length} client-visible finding(s) included in report`,
    });
  }

  timeline.push({
    time: iso(input.generatedAt),
    label: "Deepfake threat report generated",
  });

  return {
    reportId: `ETR-DF-${input
      .hash([input.scan.id, input.generatedAt])
      .slice(0, 10)
      .toUpperCase()}`,
    scanId: input.scan.id,
    profileId: input.profile?.id ?? input.scan.profile_id ?? null,
    version: DEEPFAKE_REPORT_VERSION,
    generatedAt: input.generatedAt,
    clientName: input.clientName,
    protectedIdentity,
    aliases,
    handles,
    authorizationStatus: str(input.profile?.authorization_status),
    referenceFaceCount: input.profile?.reference_face_count ?? 0,
    threatLevel: threatLevelFromFindings(findings, riskScore),
    riskScore,
    summary: {
      scanStatus: str(input.scan.status) ?? "unknown",
      investigationDuration: durationLabel(
        input.scan.started_at ?? input.scan.created_at ?? null,
        input.scan.finished_at ?? null,
      ),
      queriesPlanned: num(metrics.queries_generated),
      queriesExecuted,
      pagesVerified:
        num(metrics.verified) ??
        num(metrics.serpapi_verified) ??
        num(metrics.client_visible),
      clientVisibleFindings: findings.length,
      verifiedDeepfakes: verified,
      probableDeepfakes: probable,
      uniqueDomains: domains.length,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      identityRejected: num(metrics.identity_rejected),
      urlRejected: num(metrics.url_rejected),
      crawlFailed: num(metrics.crawl_failed),
      immediateReviewItems,
    },
    identity: {
      targetName: protectedIdentity,
      aliases,
      handles,
      authorizationStatus: str(input.profile?.authorization_status),
      referenceFaceCount: input.profile?.reference_face_count ?? 0,
      faceCollectionConfigured: Boolean(
        input.profile?.rekognition_collection_id,
      ),
    },
    diagnostics,
    findings,
    domains,
    timeline,
    disclaimer: [
      "This report is an evidence compilation from Deepfake Intelligence scan results only.",
      "Findings, URLs, confidence scores, and diagnostics are copied from persisted scan data and are not fabricated for this document.",
      "Classifications (verified / probable) are automated triage labels, not legal determinations of deepfake status, consent, or liability.",
      "No takedown, abuse complaint, or legal notice was submitted automatically by generating this report.",
      "Enforcement and legal conclusions remain with the authorized rights holder and their counsel.",
    ],
  };
}
