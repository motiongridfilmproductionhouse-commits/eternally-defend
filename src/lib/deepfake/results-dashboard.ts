/**
 * Pure presentation helpers for the Deepfake Intelligence results console.
 * Operates only on client-visible findings/metrics already returned by the API.
 * Never invents numbers or exposes raw provider candidates.
 */

import {
  buildVerifiedEvidenceLink,
  resolveVerifiedEvidenceDomain,
  type EvidenceUrlFields,
} from "./evidence-url";

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type FindingClassification = "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE" | string;

export type ClientFinding = EvidenceUrlFields & {
  id: string;
  url?: string | null;
  source_host?: string | null;
  page_title?: string | null;
  snippet?: string | null;
  query?: string | null;
  risk_level?: string | null;
  content_category?: string | null;
  confidence?: number | null;
  is_synthetic?: boolean | null;
  face_referenced?: boolean | null;
  takedown_recommended?: boolean | null;
  ai_reasoning?: string | null;
  review_status?: string | null;
  finding_classification?: string | null;
  page_type?: string | null;
  identity_confidence?: number | null;
  synthetic_media_confidence?: number | null;
  matched_evidence?: string[] | null;
  classification_explanation?: string | null;
  discovered_url?: string | null;
  http_status?: number | null;
  redirect_chain?: string[] | null;
  crawled_at?: string | null;
  created_at?: string | null;
  verified_domain?: string | null;
  face_similarity?: number | null;
  explicit_media_confirmed?: boolean | null;
  synthetic_media_confirmed?: boolean | null;
  hosting_or_distribution_confirmed?: boolean | null;
  finding_origin?: "NEW_DISCOVERY" | "HISTORICAL_FINDING" | "MANUAL_EVIDENCE" | string | null;
};

export type OverviewMetrics = {
  verified_deepfakes: number;
  probable_deepfakes: number;
  url_verified_pages: number;
  unique_domains: number;
  identity_rejected: number;
  url_rejected: number;
  crawl_failed: number;
  client_visible: number;
};

export type FunnelChartPoint = {
  key: string;
  label: string;
  value: number;
};

export type DomainRow = {
  domain: string;
  verified_pages: number;
  probable_pages: number;
  highest_risk: RiskLevel | null;
  last_verified: string | null;
  status: "active" | "reviewed" | "mixed";
};

export type NetworkFindingNode = {
  id: string;
  domain: string;
  title: string;
  classification: "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  risk: RiskLevel;
};

export type NetworkDomainNode = {
  domain: string;
  verifiedCount: number;
  probableCount: number;
  findings: NetworkFindingNode[];
};

export type NetworkGraph = {
  centerLabel: string;
  domains: NetworkDomainNode[];
  totalFindings: number;
};

export type FindingsSortKey =
  "risk" | "title" | "domain" | "identity" | "synthetic" | "http" | "classification";

const RISK_RANK: Record<RiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function asRiskLevel(value: string | null | undefined): RiskLevel {
  if (value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW") {
    return value;
  }
  return "LOW";
}

export function findingDomain(finding: ClientFinding): string {
  return (
    resolveVerifiedEvidenceDomain(finding) ||
    finding.verified_domain?.trim() ||
    finding.source_host?.trim() ||
    "unknown"
  );
}

export function normalizeClassification(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  return normalized || null;
}

export function normalizeUrlVerificationStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "_");
  if (!normalized) return null;
  // Defensive: discovery rows use url_verified; findings use URL_VERIFIED.
  if (normalized === "URL_VERIFIED") return "URL_VERIFIED";
  if (normalized === "URL_REJECTED") return "URL_REJECTED";
  return normalized;
}

export function isClientVisibleClassification(
  value: string | null | undefined,
): boolean {
  if (!value || typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return (
    normalized.includes("VERIFIED") ||
    normalized.includes("PROBABLE") ||
    normalized.includes("DEEPFAKE") ||
    normalized.includes("SYNTHETIC") ||
    normalized.includes("FACE_SWAP") ||
    normalized.includes("EXPLICIT")
  );
}

function readField(row: Record<string, unknown>, snake: string, camel: string): unknown {
  if (snake in row) return row[snake];
  if (camel in row) return row[camel];
  return undefined;
}

/**
 * Normalize production getDeepfakeScan finding rows (snake_case) into the
 * console ClientFinding shape. Tolerates accidental camelCase without
 * inventing evidence fields.
 */
export function normalizeClientFinding(row: unknown): ClientFinding | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  const idRaw = readField(source, "id", "id");
  if (typeof idRaw !== "string" || !idRaw.trim()) return null;

  const classification = normalizeClassification(
    readField(source, "finding_classification", "findingClassification"),
  );
  const urlStatus = normalizeUrlVerificationStatus(
    readField(source, "url_verification_status", "urlVerificationStatus"),
  );

  const asString = (value: unknown): string | null =>
    typeof value === "string" ? value : value == null ? null : String(value);
  const asNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const asBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
  const asStringArray = (value: unknown): string[] | null =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;

  return {
    id: idRaw,
    url: asString(readField(source, "url", "url")),
    source_host: asString(readField(source, "source_host", "sourceHost")),
    page_title: asString(readField(source, "page_title", "pageTitle")),
    snippet: asString(readField(source, "snippet", "snippet")),
    query: asString(readField(source, "query", "query")),
    risk_level: asString(readField(source, "risk_level", "riskLevel")),
    content_category: asString(readField(source, "content_category", "contentCategory")),
    confidence: asNumber(readField(source, "confidence", "confidence")),
    is_synthetic: asBoolean(readField(source, "is_synthetic", "isSynthetic")),
    face_referenced: asBoolean(readField(source, "face_referenced", "faceReferenced")),
    takedown_recommended: asBoolean(
      readField(source, "takedown_recommended", "takedownRecommended"),
    ),
    ai_reasoning: asString(readField(source, "ai_reasoning", "aiReasoning")),
    review_status: asString(readField(source, "review_status", "reviewStatus")),
    finding_classification: classification,
    page_type: asString(readField(source, "page_type", "pageType")),
    identity_confidence: asNumber(readField(source, "identity_confidence", "identityConfidence")),
    face_similarity: asNumber(readField(source, "face_similarity", "faceSimilarity")),
    synthetic_media_confidence: asNumber(
      readField(source, "synthetic_media_confidence", "syntheticMediaConfidence"),
    ),
    matched_evidence: asStringArray(readField(source, "matched_evidence", "matchedEvidence")),
    classification_explanation: asString(
      readField(source, "classification_explanation", "classificationExplanation"),
    ),
    url_verification_status: urlStatus,
    final_url: asString(readField(source, "final_url", "finalUrl")),
    canonical_url: asString(readField(source, "canonical_url", "canonicalUrl")),
    discovered_url: asString(readField(source, "discovered_url", "discoveredUrl")),
    verified_domain: asString(readField(source, "verified_domain", "verifiedDomain")),
    http_status: asNumber(readField(source, "http_status", "httpStatus")),
    redirect_chain: asStringArray(readField(source, "redirect_chain", "redirectChain")),
    crawled_at: asString(readField(source, "crawled_at", "crawledAt")),
    created_at: asString(readField(source, "created_at", "createdAt")),
    finding_origin: asString(readField(source, "finding_origin", "findingOrigin")),
  };
}

export function normalizeClientFindings(rows: unknown): ClientFinding[] {
  if (!Array.isArray(rows)) return [];
  const out: ClientFinding[] = [];
  for (const row of rows) {
    const normalized = normalizeClientFinding(row);
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * Client findings are already filtered server-side; this is a defensive UI
 * guard that accepts normalized production shapes.
 */
export function isDisplayableFinding(finding: ClientFinding): boolean {
  if (!isClientVisibleClassification(finding.finding_classification)) {
    return false;
  }
  const status = normalizeUrlVerificationStatus(finding.url_verification_status);
  // Missing status is allowed: getDeepfakeScan already applied server filters.
  if (status && status !== "URL_VERIFIED") {
    return false;
  }
  return true;
}

export function displayableFindings(findings: ClientFinding[]): ClientFinding[] {
  return normalizeClientFindings(findings).filter(isDisplayableFinding);
}

export function buildOverviewMetrics(input: {
  findings: ClientFinding[];
  diagnostics?: Record<string, number> | null;
}): OverviewMetrics {
  const findings = displayableFindings(input.findings);
  const domains = new Set(findings.map(findingDomain));
  const verified = findings.filter((f) => f.finding_classification === "VERIFIED_DEEPFAKE").length;
  const probable = findings.filter((f) => f.finding_classification === "PROBABLE_DEEPFAKE").length;
  const diagnostics = input.diagnostics ?? {};

  return {
    verified_deepfakes: verified,
    probable_deepfakes: probable,
    url_verified_pages: findings.length,
    unique_domains: domains.size,
    // Reject counters remain scan-wide diagnostic facts (not finding-derived).
    identity_rejected: Number(diagnostics.identity_rejected ?? 0) || 0,
    url_rejected: Number(diagnostics.url_rejected ?? 0) || 0,
    crawl_failed: Number(diagnostics.crawl_failed ?? 0) || 0,
    // Finding-derived visibility follows the scoped findings list.
    client_visible: findings.length,
  };
}

/**
 * Categorical funnel from real diagnostic counters + saved findings.
 * No fabricated time-series. Finding-derived steps follow scoped findings;
 * discovery/crawl steps remain scan-wide diagnostics when available.
 */
export function buildFunnelChartData(input: {
  findings: ClientFinding[];
  diagnostics?: Record<string, number> | null;
}): FunnelChartPoint[] {
  const findings = displayableFindings(input.findings);
  const d = input.diagnostics ?? {};
  const discovered = Number(d.unique_candidates ?? d.provider_candidates ?? 0) || 0;
  const crawled = Number(d.crawl_succeeded ?? 0) || 0;
  const identityMatched = findings.length;
  const evidenceVerified = findings.length;
  const clientVisible = findings.length;

  return [
    { key: "discovered", label: "Discovered candidates", value: discovered },
    { key: "crawled", label: "Successfully crawled", value: crawled },
    { key: "identity", label: "Identity matched", value: identityMatched },
    { key: "evidence", label: "Evidence verified", value: evidenceVerified },
    { key: "client", label: "Client-visible findings", value: clientVisible },
  ];
}

export function highestRisk(levels: Array<string | null | undefined>): RiskLevel | null {
  let best: RiskLevel | null = null;
  for (const level of levels) {
    const risk = asRiskLevel(level);
    if (!best || RISK_RANK[risk] > RISK_RANK[best]) best = risk;
  }
  return best;
}

export function buildDomainRows(findings: ClientFinding[]): DomainRow[] {
  const groups = new Map<string, ClientFinding[]>();
  for (const finding of displayableFindings(findings)) {
    const domain = findingDomain(finding);
    const list = groups.get(domain) ?? [];
    list.push(finding);
    groups.set(domain, list);
  }

  const rows: DomainRow[] = [];
  for (const [domain, list] of groups) {
    const verified_pages = list.filter(
      (f) => f.finding_classification === "VERIFIED_DEEPFAKE",
    ).length;
    const probable_pages = list.filter(
      (f) => f.finding_classification === "PROBABLE_DEEPFAKE",
    ).length;
    const timestamps = list
      .map((f) => f.crawled_at || f.created_at)
      .filter((value): value is string => Boolean(value))
      .sort();
    const reviews = new Set(list.map((f) => f.review_status ?? "new"));
    let status: DomainRow["status"] = "active";
    if (reviews.size === 1 && reviews.has("reviewed")) status = "reviewed";
    else if (reviews.size === 1 && (reviews.has("dismissed") || reviews.has("queued_takedown"))) {
      status = "reviewed";
    } else if (reviews.size > 1) status = "mixed";

    rows.push({
      domain,
      verified_pages,
      probable_pages,
      highest_risk: highestRisk(list.map((f) => f.risk_level)),
      last_verified: timestamps.length ? timestamps[timestamps.length - 1]! : null,
      status,
    });
  }

  return rows.sort(
    (a, b) =>
      b.verified_pages + b.probable_pages - (a.verified_pages + a.probable_pages) ||
      a.domain.localeCompare(b.domain),
  );
}

export function buildNetworkGraph(input: {
  findings: ClientFinding[];
  centerLabel: string;
}): NetworkGraph {
  const findings = displayableFindings(input.findings);
  const byDomain = new Map<string, NetworkFindingNode[]>();

  for (const finding of findings) {
    const domain = findingDomain(finding);
    const classification =
      finding.finding_classification === "VERIFIED_DEEPFAKE"
        ? "VERIFIED_DEEPFAKE"
        : "PROBABLE_DEEPFAKE";
    const node: NetworkFindingNode = {
      id: finding.id,
      domain,
      title: finding.page_title?.trim() || "Verified evidence page",
      classification,
      risk: asRiskLevel(finding.risk_level),
    };
    const list = byDomain.get(domain) ?? [];
    list.push(node);
    byDomain.set(domain, list);
  }

  const domains: NetworkDomainNode[] = [...byDomain.entries()]
    .map(([domain, nodes]) => ({
      domain,
      verifiedCount: nodes.filter((n) => n.classification === "VERIFIED_DEEPFAKE").length,
      probableCount: nodes.filter((n) => n.classification === "PROBABLE_DEEPFAKE").length,
      findings: nodes,
    }))
    .sort((a, b) => b.findings.length - a.findings.length || a.domain.localeCompare(b.domain));

  return {
    centerLabel: input.centerLabel.trim() || "Protected identity",
    domains,
    totalFindings: findings.length,
  };
}

/** Bound visible network nodes; findings remain available in the list. */
export function boundNetworkGraph(
  graph: NetworkGraph,
  options?: { maxDomains?: number; maxFindingsPerDomain?: number },
): { visible: NetworkGraph; hiddenDomainCount: number; hiddenFindingCount: number } {
  const maxDomains = options?.maxDomains ?? 8;
  const maxFindingsPerDomain = options?.maxFindingsPerDomain ?? 5;
  const domains = graph.domains.slice(0, maxDomains).map((domain) => ({
    ...domain,
    findings: domain.findings.slice(0, maxFindingsPerDomain),
  }));
  const visibleFindings = domains.reduce((sum, d) => sum + d.findings.length, 0);
  return {
    visible: {
      centerLabel: graph.centerLabel,
      domains,
      totalFindings: visibleFindings,
    },
    hiddenDomainCount: Math.max(0, graph.domains.length - maxDomains),
    hiddenFindingCount: Math.max(0, graph.totalFindings - visibleFindings),
  };
}

export function formatDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function formatConfidence(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

function hasVisualConfirmation(finding: ClientFinding): boolean {
  return (
    finding.finding_classification === "VERIFIED_DEEPFAKE" ||
    (finding.matched_evidence ?? []).some((item) => /\b(?:hive|face-match)\b/i.test(item))
  );
}

/** Preserve prior probable/text-only confidence wording. */
export function formatEvidenceConfidence(input: {
  value: number | null | undefined;
  kind: "identity" | "synthetic";
  finding: ClientFinding;
}): string {
  if (
    input.finding.finding_classification === "PROBABLE_DEEPFAKE" &&
    !hasVisualConfirmation(input.finding)
  ) {
    return input.kind === "synthetic" ? "synth text evidence" : "id text evidence";
  }
  return formatConfidence(input.value);
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function sortFindings(
  findings: ClientFinding[],
  sortKey: FindingsSortKey,
  direction: "asc" | "desc" = "desc",
): ClientFinding[] {
  const sorted = [...findings].sort((a, b) => {
    switch (sortKey) {
      case "risk":
        return RISK_RANK[asRiskLevel(a.risk_level)] - RISK_RANK[asRiskLevel(b.risk_level)];
      case "title":
        return (a.page_title ?? "").localeCompare(b.page_title ?? "");
      case "domain":
        return findingDomain(a).localeCompare(findingDomain(b));
      case "identity":
        return (a.identity_confidence ?? -1) - (b.identity_confidence ?? -1);
      case "synthetic":
        return (a.synthetic_media_confidence ?? -1) - (b.synthetic_media_confidence ?? -1);
      case "http":
        return (a.http_status ?? -1) - (b.http_status ?? -1);
      case "classification":
        return (a.finding_classification ?? "").localeCompare(b.finding_classification ?? "");
      default:
        return 0;
    }
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

export function filterFindings(input: {
  findings: ClientFinding[];
  riskFilter?: "ALL" | RiskLevel;
  domainFilter?: string | null;
  classificationFilter?: "ALL" | "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE";
  search?: string;
}): ClientFinding[] {
  const query = input.search?.trim().toLowerCase() ?? "";
  return displayableFindings(input.findings).filter((finding) => {
    if (input.riskFilter && input.riskFilter !== "ALL" && finding.risk_level !== input.riskFilter) {
      return false;
    }
    if (input.domainFilter) {
      const wanted = input.domainFilter
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");
      const actual = findingDomain(finding)
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");
      if (actual !== wanted) return false;
    }
    if (
      input.classificationFilter &&
      input.classificationFilter !== "ALL" &&
      finding.finding_classification !== input.classificationFilter
    ) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      finding.page_title,
      findingDomain(finding),
      finding.snippet,
      finding.finding_classification,
      finding.review_status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function paginateFindings<T>(
  items: T[],
  page: number,
  pageSize: number,
): { items: T[]; total: number; page: number; pageSize: number; hasMore: boolean } {
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, pageSize);
  const start = (safePage - 1) * safeSize;
  const slice = items.slice(0, start + safeSize);
  return {
    items: slice,
    total: items.length,
    page: safePage,
    pageSize: safeSize,
    hasMore: slice.length < items.length,
  };
}

function configuredSupabaseHost(): string | null {
  try {
    const raw =
      (typeof import.meta !== "undefined" &&
        (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_SUPABASE_URL) ||
      process.env.VITE_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      null;
    if (!raw) return null;
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Only treat this project's Supabase storage URLs as safe preview sources.
 * Third-party discovery thumbnails must not be loaded.
 */
export function isSafeStoredThumbnail(
  url: string | null | undefined,
  allowedHost = configuredSupabaseHost(),
): boolean {
  if (!url || typeof url !== "string") return false;
  if (!allowedHost) return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== allowedHost) return false;
    return parsed.pathname.includes("/storage/");
  } catch {
    return false;
  }
}

export function resolveSafeFindingThumbnail(input: {
  finding: ClientFinding;
  discoveries?: Array<{
    page_url?: string | null;
    canonical_url?: string | null;
    thumbnail_url?: string | null;
    image_url?: string | null;
  }>;
}): string | null {
  const discoveries = input.discoveries ?? [];
  const evidence = buildVerifiedEvidenceLink(input.finding);
  const targets = new Set(
    [
      evidence.kind === "link" ? evidence.href : null,
      input.finding.final_url,
      input.finding.canonical_url,
    ]
      .filter(Boolean)
      .map((value) => String(value).trim()),
  );

  for (const discovery of discoveries) {
    const page = discovery.page_url?.trim();
    const canonical = discovery.canonical_url?.trim();
    if (!page && !canonical) continue;
    if (!targets.has(page ?? "") && !targets.has(canonical ?? "")) continue;
    const candidate = discovery.thumbnail_url ?? discovery.image_url ?? null;
    if (isSafeStoredThumbnail(candidate)) return candidate!.trim();
  }
  return null;
}

export function evidenceLinkProps(finding: ClientFinding) {
  return buildVerifiedEvidenceLink(finding);
}

export type DisplayGroupCategory =
  | "VERIFIED_EXPLICIT_DEEPFAKES"
  | "VERIFIED_FACE_SWAPS"
  | "PROBABLE_DEEPFAKES"
  | "SYNTHETIC_AI_IMAGES"
  | "SYNTHETIC_AI_VIDEOS"
  | "DOWNLOAD_MIRRORS"
  | "HOSTING_SITES"
  | "DISCUSSIONS"
  | "NEWS"
  | "OFFICIAL";

export function categorizeFindingDisplayGroup(f: ClientFinding): DisplayGroupCategory {
  const cls = (f.finding_classification || "").toUpperCase();
  const pageType = (f.page_type || "").toUpperCase();
  const title = (f.page_title || "").toLowerCase();
  const snippet = (f.snippet || "").toLowerCase();

  if (cls.includes("VERIFIED") && (snippet.includes("explicit") || snippet.includes("nude") || title.includes("explicit"))) {
    return "VERIFIED_EXPLICIT_DEEPFAKES";
  }
  if (cls.includes("VERIFIED") || cls.includes("FACE_SWAP")) {
    return "VERIFIED_FACE_SWAPS";
  }
  if (cls.includes("PROBABLE")) {
    return "PROBABLE_DEEPFAKES";
  }
  if (pageType === "DOWNLOAD_PAGE" || f.source_host?.includes("t.me") || f.source_host?.includes("terabox") || f.source_host?.includes("mega")) {
    return "DOWNLOAD_MIRRORS";
  }
  if (pageType === "HOSTING_PAGE" || f.source_host?.includes("mrdeepfakes") || f.source_host?.includes("sexcelebrity")) {
    return "HOSTING_SITES";
  }
  if (title.includes("video") || pageType === "VIDEO_PAGE") {
    return "SYNTHETIC_AI_VIDEOS";
  }
  if (f.is_synthetic || pageType === "IMAGE_PAGE" || pageType === "GALLERY_PAGE") {
    return "SYNTHETIC_AI_IMAGES";
  }
  if (pageType === "FORUM_THREAD" || pageType === "SOCIAL_POST" || pageType === "DISCUSSION") {
    return "DISCUSSIONS";
  }
  if (pageType === "NEWS" || pageType === "BLOG" || pageType === "IMDB" || pageType === "BIOGRAPHY") {
    return "NEWS";
  }
  if (pageType === "OFFICIAL" || pageType === "WIKIPEDIA") {
    return "OFFICIAL";
  }

  return "HOSTING_SITES";
}
