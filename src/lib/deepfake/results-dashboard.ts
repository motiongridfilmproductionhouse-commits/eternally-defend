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

export type FindingClassification =
  | "VERIFIED_DEEPFAKE"
  | "PROBABLE_DEEPFAKE"
  | string;

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
  http_status?: number | null;
  redirect_chain?: string[] | null;
  crawled_at?: string | null;
  created_at?: string | null;
  verified_domain?: string | null;
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
  | "risk"
  | "title"
  | "domain"
  | "identity"
  | "synthetic"
  | "http"
  | "classification";

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

export function isClientVisibleClassification(
  value: string | null | undefined,
): value is "VERIFIED_DEEPFAKE" | "PROBABLE_DEEPFAKE" {
  return value === "VERIFIED_DEEPFAKE" || value === "PROBABLE_DEEPFAKE";
}

/** Client findings are already filtered server-side; this is a defensive UI guard. */
export function isDisplayableFinding(finding: ClientFinding): boolean {
  if (!isClientVisibleClassification(finding.finding_classification)) {
    return false;
  }
  if (
    finding.url_verification_status &&
    finding.url_verification_status !== "URL_VERIFIED"
  ) {
    return false;
  }
  return true;
}

export function displayableFindings(findings: ClientFinding[]): ClientFinding[] {
  return findings.filter(isDisplayableFinding);
}

export function buildOverviewMetrics(input: {
  findings: ClientFinding[];
  diagnostics?: Record<string, number> | null;
}): OverviewMetrics {
  const findings = displayableFindings(input.findings);
  const domains = new Set(findings.map(findingDomain));
  const verified = findings.filter(
    (f) => f.finding_classification === "VERIFIED_DEEPFAKE",
  ).length;
  const probable = findings.filter(
    (f) => f.finding_classification === "PROBABLE_DEEPFAKE",
  ).length;
  const diagnostics = input.diagnostics ?? {};

  return {
    verified_deepfakes: verified,
    probable_deepfakes: probable,
    url_verified_pages: findings.length,
    unique_domains: domains.size,
    identity_rejected: Number(diagnostics.identity_rejected ?? 0) || 0,
    url_rejected: Number(diagnostics.url_rejected ?? 0) || 0,
    crawl_failed: Number(diagnostics.crawl_failed ?? 0) || 0,
    client_visible:
      Number(diagnostics.client_visible ?? findings.length) || findings.length,
  };
}

/**
 * Categorical funnel from real diagnostic counters + saved findings.
 * No fabricated time-series.
 */
export function buildFunnelChartData(input: {
  findings: ClientFinding[];
  diagnostics?: Record<string, number> | null;
}): FunnelChartPoint[] {
  const findings = displayableFindings(input.findings);
  const d = input.diagnostics ?? {};
  const discovered =
    Number(d.unique_candidates ?? d.provider_candidates ?? 0) || 0;
  const crawled = Number(d.crawl_succeeded ?? 0) || 0;
  const identityMatched =
    Number(d.verified ?? 0) + Number(d.probable ?? 0) ||
    findings.length;
  const evidenceVerified = findings.length;
  const clientVisible =
    Number(d.client_visible ?? findings.length) || findings.length;

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
    else if (reviews.size > 1) status = "mixed";

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
      verifiedCount: nodes.filter((n) => n.classification === "VERIFIED_DEEPFAKE")
        .length,
      probableCount: nodes.filter((n) => n.classification === "PROBABLE_DEEPFAKE")
        .length,
      findings: nodes,
    }))
    .sort(
      (a, b) =>
        b.findings.length - a.findings.length || a.domain.localeCompare(b.domain),
    );

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
        return (
          (a.synthetic_media_confidence ?? -1) -
          (b.synthetic_media_confidence ?? -1)
        );
      case "http":
        return (a.http_status ?? -1) - (b.http_status ?? -1);
      case "classification":
        return (a.finding_classification ?? "").localeCompare(
          b.finding_classification ?? "",
        );
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
    if (
      input.riskFilter &&
      input.riskFilter !== "ALL" &&
      asRiskLevel(finding.risk_level) !== input.riskFilter
    ) {
      return false;
    }
    if (input.domainFilter && findingDomain(finding) !== input.domainFilter) {
      return false;
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

/**
 * Only treat first-party Supabase storage URLs as safe preview sources.
 * Third-party discovery thumbnails must not be loaded.
 */
export function isSafeStoredThumbnail(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    // Exact Supabase project hosts only — no substring allowlist bypass.
    const supabaseHost =
      host.endsWith(".supabase.co") || host.endsWith(".supabase.in");
    if (!supabaseHost) return false;
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
    [evidence.kind === "link" ? evidence.href : null, input.finding.final_url, input.finding.canonical_url]
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
