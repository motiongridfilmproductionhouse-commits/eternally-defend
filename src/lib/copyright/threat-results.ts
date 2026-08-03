/**
 * Unified threat-results model for the Copyright Intelligence results list.
 *
 * The UI must show *every* detected source, one row per unique domain, with a
 * compact summary by default and forensic detail only on demand. This module
 * holds the pure data logic (merge, dedupe, severity, category, filtering) so
 * the component stays presentational and the behaviour stays testable.
 */

import type { PublicSuspiciousSource } from "./suspicious-sources";

export type ThreatSeverity = "critical" | "high" | "medium" | "low";

export type ThreatLiveStatus = "active" | "offline" | "removed";

export type ThreatCategoryKey =
  | "download"
  | "streaming"
  | "file_host"
  | "archive"
  | "mirror"
  | "telegram"
  | "social"
  | "torrent"
  | "other";

/** One row of the results list — always exactly one unique domain. */
export interface ThreatResultRow {
  /** Stable row id (the primary match id for this domain). */
  id: string;
  domain: string;
  url: string;
  title: string | null;
  classification: string;
  categoryKey: ThreatCategoryKey;
  categoryLabel: string;
  severity: ThreatSeverity;
  status: ThreatLiveStatus;
  confidence: number;
  lastVerifiedAt: string | null;
  evidenceSummary: string | null;
  reason: string | null;
  discoveryQuery: string | null;
  screenshotUrl: string | null;
  pageExcerpt: string | null;
  /** Additional URLs found on the same domain, newest/strongest first. */
  additionalUrls: string[];
  /** How many findings collapsed into this domain row (>= 1). */
  findingCount: number;
  /** Whether this row came from a graded suspicious finding (vs. inspected lead). */
  verified: boolean;
  sourceState: string | null;
  reviewStatus: string | null;
  evidence: unknown;
  contact: unknown;
  detectionType: string | null;
}

/** Loose shape of the inspected-source rows returned by `getCopyrightScan`. */
export interface InspectedSourceInput {
  id: string;
  url: string;
  host?: string | null;
  page_title?: string | null;
  classification?: string | null;
  content_type?: string | null;
  domain_risk?: string | null;
  confidence?: number | null;
  checked?: boolean | null;
  status?: string | null;
  reason?: string | null;
  page_excerpt?: string | null;
  discovery_query?: string | null;
  identity_evidence?: string[] | null;
  access_evidence?: string[] | null;
  quality_tags?: string[] | null;
}

export const THREAT_SEVERITIES: ThreatSeverity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_META: Record<
  ThreatSeverity,
  { label: string; dot: string; badge: string; group: string }
> = {
  critical: {
    label: "Critical",
    dot: "bg-red-500",
    badge: "border-red-500/50 bg-red-500/10 text-red-300",
    group: "Critical threats",
  },
  high: {
    label: "High",
    dot: "bg-orange-500",
    badge: "border-orange-500/50 bg-orange-500/10 text-orange-300",
    group: "High threats",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-400",
    badge: "border-amber-400/50 bg-amber-400/10 text-amber-200",
    group: "Medium threats",
  },
  low: {
    label: "Low",
    dot: "bg-sky-400",
    badge: "border-sky-400/50 bg-sky-400/10 text-sky-200",
    group: "Low threats",
  },
};

export const CATEGORY_LABELS: Record<ThreatCategoryKey, string> = {
  download: "Movie download",
  streaming: "Streaming site",
  file_host: "File host",
  archive: "File archive",
  mirror: "Mirror domain",
  telegram: "Telegram",
  social: "Social media",
  torrent: "Torrent",
  other: "Re-upload",
};

const STREAMING_HOSTS = [
  "ok.ru",
  "vk.com",
  "dailymotion.com",
  "rumble.com",
  "bitchute.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "streamtape",
  "dood",
  "vidsrc",
  "filemoon",
  "mixdrop",
  "streamlare",
  "voe.sx",
];

const FILE_HOST_HOSTS = [
  "mega.nz",
  "mediafire",
  "anonfiles",
  "gofile",
  "pixeldrain",
  "1fichier",
  "krakenfiles",
  "zippyshare",
  "dropbox.com",
  "drive.google.com",
];

const ARCHIVE_HOSTS = ["archive.org", "web.archive.org", "archive.ph", "archive.today"];

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "threads.net",
  "pinterest.com",
  "snapchat.com",
];

const TORRENT_HINTS = [
  "torrent",
  "1337x",
  "yts",
  "rarbg",
  "piratebay",
  "nyaa",
  "magnet",
  "tamilmv",
  "tamilblasters",
];

const DOWNLOAD_HINTS = [
  "movies",
  "movie",
  "mkv",
  "hdhub",
  "filmy",
  "cinevood",
  "katmovie",
  "vegamovies",
  "mp4moviez",
  "moviesda",
  "isaimini",
  "ibomma",
  "movierulz",
  "dvdplay",
  "bolly",
  "mallumv",
  "ogomovies",
  "downloadhub",
];

const MIRROR_HINTS = ["mirror", "proxy", "unblock", "-clone", "alt."];

function normalizeHost(raw: string | null | undefined, url: string): string {
  const candidate = raw && raw.trim() ? raw : safeHost(url);
  return (candidate ?? url).replace(/^www\./i, "").toLowerCase();
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Classify a source into an operator-facing threat category. */
export function classifyThreatCategory(input: {
  domain: string;
  url: string;
  classification?: string | null;
  contentType?: string | null;
}): ThreatCategoryKey {
  const domain = input.domain.toLowerCase();
  const url = input.url.toLowerCase();
  const cls = (input.classification ?? "").toUpperCase();
  const contentType = (input.contentType ?? "").toLowerCase();

  if (domain === "t.me" || domain.endsWith(".t.me") || domain.includes("telegram")) {
    return "telegram";
  }
  if (matchesAny(domain, ARCHIVE_HOSTS)) return "archive";
  if (matchesAny(domain, SOCIAL_HOSTS)) return "social";
  if (matchesAny(domain, FILE_HOST_HOSTS)) return "file_host";
  if (matchesAny(domain, TORRENT_HINTS) || url.includes("magnet:")) return "torrent";
  if (matchesAny(domain, MIRROR_HINTS)) return "mirror";
  if (matchesAny(domain, STREAMING_HOSTS)) return "streaming";
  if (cls.includes("DOWNLOAD") || contentType.includes("download")) return "download";
  if (matchesAny(domain, DOWNLOAD_HINTS)) return "download";
  if (cls.includes("STREAM") || contentType.includes("stream")) return "streaming";
  return "other";
}

/** Severity from graded confidence plus evidence strength. */
export function severityFor(confidence: number, verified: boolean): ThreatSeverity {
  if (confidence >= 90 && verified) return "critical";
  if (confidence >= 90) return "high";
  if (confidence >= 70) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

function statusFromSuspicious(source: PublicSuspiciousSource): ThreatLiveStatus {
  if (source.source_state === "removed") return "removed";
  if (
    source.source_state === "historical_unreachable" ||
    source.current_reachability === "unreachable"
  ) {
    return "offline";
  }
  return "active";
}

function statusFromInspected(row: InspectedSourceInput): ThreatLiveStatus {
  if (row.status === "unreachable" || row.status === "historical_unreachable") return "offline";
  if (row.checked === false) return "offline";
  return "active";
}

function evidenceScreenshot(evidence: unknown): string | null {
  const ev = (evidence ?? {}) as Record<string, unknown>;
  const dist = (ev.distribution ?? {}) as Record<string, unknown>;
  const shot = dist.evidence_screenshot ?? ev.evidence_screenshot;
  return typeof shot === "string" && shot ? shot : null;
}

function evidenceExcerpt(evidence: unknown): string | null {
  const ev = (evidence ?? {}) as Record<string, unknown>;
  return typeof ev.page_excerpt === "string" && ev.page_excerpt ? ev.page_excerpt : null;
}

function rowFromSuspicious(source: PublicSuspiciousSource): ThreatResultRow {
  const domain = normalizeHost(source.domain, source.url);
  const confidence = Math.round(source.confidence ?? 0);
  const verified =
    source.source_state === "new_confirmed" ||
    source.source_state === "historical_reconfirmed";
  const categoryKey = classifyThreatCategory({
    domain,
    url: source.url,
    classification: source.classification,
  });
  return {
    id: source.id,
    domain,
    url: source.url,
    title: source.title,
    classification: source.classification,
    categoryKey,
    categoryLabel: CATEGORY_LABELS[categoryKey],
    severity: severityFor(confidence, verified),
    status: statusFromSuspicious(source),
    confidence,
    lastVerifiedAt: source.last_verified_at,
    evidenceSummary: source.evidence_summary,
    reason: source.reason,
    discoveryQuery: source.discovery_query,
    screenshotUrl: evidenceScreenshot(source.evidence),
    pageExcerpt: evidenceExcerpt(source.evidence),
    additionalUrls: [],
    findingCount: 1,
    verified,
    sourceState: source.source_state,
    reviewStatus: source.review_status ?? null,
    evidence: source.evidence ?? null,
    contact: source.contact ?? null,
    detectionType: source.detection_type ?? source.classification,
  };
}

function rowFromInspected(row: InspectedSourceInput): ThreatResultRow {
  const domain = normalizeHost(row.host, row.url);
  const confidence = Math.round(row.confidence ?? 0);
  const verified = row.status === "verified_piracy";
  const categoryKey = classifyThreatCategory({
    domain,
    url: row.url,
    classification: row.classification,
    contentType: row.content_type,
  });
  const evidenceSummary =
    [
      row.identity_evidence?.length ? "Title identity matched" : null,
      row.access_evidence?.length ? "Access evidence present" : null,
      row.quality_tags?.length ? row.quality_tags.slice(0, 3).join(", ") : null,
    ]
      .filter(Boolean)
      .join(" · ") || null;

  return {
    id: row.id,
    domain,
    url: row.url,
    title: row.page_title ?? null,
    classification: row.classification ?? "UNVERIFIED_LEAD",
    categoryKey,
    categoryLabel: CATEGORY_LABELS[categoryKey],
    severity: severityFor(confidence, verified),
    status: statusFromInspected(row),
    confidence,
    lastVerifiedAt: null,
    evidenceSummary,
    reason: row.reason ?? null,
    discoveryQuery: row.discovery_query ?? null,
    screenshotUrl: null,
    pageExcerpt: row.page_excerpt ?? null,
    additionalUrls: [],
    findingCount: 1,
    verified,
    sourceState: row.status ?? null,
    reviewStatus: null,
    evidence: null,
    contact: null,
    detectionType: row.classification ?? null,
  };
}

const SEVERITY_RANK: Record<ThreatSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Which of two rows should represent its domain in the list. */
function preferRow(a: ThreatResultRow, b: ThreatResultRow): ThreatResultRow {
  if (a.verified !== b.verified) return a.verified ? a : b;
  if (a.confidence !== b.confidence) return a.confidence >= b.confidence ? a : b;
  return SEVERITY_RANK[a.severity] <= SEVERITY_RANK[b.severity] ? a : b;
}

/**
 * Merge graded suspicious findings with every inspected source into one row per
 * unique domain. Nothing is truncated — callers page the returned list.
 */
export function buildThreatResultRows(input: {
  suspicious: PublicSuspiciousSource[];
  inspected?: InspectedSourceInput[];
  /** Include inspected leads that produced no evidence at all. Defaults to true. */
  includeUnverified?: boolean;
}): ThreatResultRow[] {
  const includeUnverified = input.includeUnverified ?? true;
  const byDomain = new Map<string, ThreatResultRow>();

  const push = (row: ThreatResultRow) => {
    if (!row.domain) return;
    const existing = byDomain.get(row.domain);
    if (!existing) {
      byDomain.set(row.domain, row);
      return;
    }
    const winner = preferRow(existing, row);
    const loser = winner === existing ? row : existing;
    const extra = new Set([...winner.additionalUrls, ...loser.additionalUrls]);
    if (loser.url !== winner.url) extra.add(loser.url);
    byDomain.set(row.domain, {
      ...winner,
      additionalUrls: [...extra].slice(0, 50),
      findingCount: existing.findingCount + row.findingCount,
      screenshotUrl: winner.screenshotUrl ?? loser.screenshotUrl,
      pageExcerpt: winner.pageExcerpt ?? loser.pageExcerpt,
      evidenceSummary: winner.evidenceSummary ?? loser.evidenceSummary,
      lastVerifiedAt: winner.lastVerifiedAt ?? loser.lastVerifiedAt,
      evidence: winner.evidence ?? loser.evidence,
      contact: winner.contact ?? loser.contact,
    });
  };

  for (const source of input.suspicious) push(rowFromSuspicious(source));

  for (const row of input.inspected ?? []) {
    const mapped = rowFromInspected(row);
    if (!includeUnverified && !mapped.verified && mapped.confidence < 50) {
      // Still merge into an existing domain row so counts stay accurate.
      if (!byDomain.has(mapped.domain)) continue;
    }
    push(mapped);
  }

  return [...byDomain.values()].sort((a, b) => {
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    }
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.domain.localeCompare(b.domain);
  });
}

export type ThreatFilterKey =
  | "all"
  | "active"
  | "removed"
  | ThreatCategoryKey;

export const THREAT_FILTERS: Array<{ key: ThreatFilterKey; label: string }> = [
  { key: "all", label: "All sources" },
  { key: "active", label: "Active" },
  { key: "removed", label: "Removed" },
  { key: "download", label: "Download sites" },
  { key: "streaming", label: "Streaming sites" },
  { key: "file_host", label: "File hosts" },
  { key: "archive", label: "Archive sites" },
  { key: "mirror", label: "Mirrors" },
  { key: "telegram", label: "Telegram" },
  { key: "social", label: "Social media" },
  { key: "torrent", label: "Torrents" },
];

/** Apply the active quick filter plus a free-text search. */
export function filterThreatRows(
  rows: ThreatResultRow[],
  options: { filter?: ThreatFilterKey; search?: string } = {},
): ThreatResultRow[] {
  const filter = options.filter ?? "all";
  const term = (options.search ?? "").trim().toLowerCase();

  return rows.filter((row) => {
    if (filter === "active" && row.status !== "active") return false;
    if (filter === "removed" && row.status === "active") return false;
    if (
      filter !== "all" &&
      filter !== "active" &&
      filter !== "removed" &&
      row.categoryKey !== filter
    ) {
      return false;
    }
    if (!term) return true;
    const haystack = [
      row.domain,
      row.url,
      row.title ?? "",
      row.categoryLabel,
      row.classification,
      row.evidenceSummary ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

/** Group rows by severity, preserving order and reporting counts. */
export function groupThreatRowsBySeverity(rows: ThreatResultRow[]): Array<{
  severity: ThreatSeverity;
  rows: ThreatResultRow[];
  count: number;
}> {
  return THREAT_SEVERITIES.map((severity) => {
    const bucket = rows.filter((row) => row.severity === severity);
    return { severity, rows: bucket, count: bucket.length };
  });
}

export function countThreatStatuses(rows: ThreatResultRow[]): {
  total: number;
  active: number;
  offline: number;
  removed: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === "active") acc.active += 1;
      else if (row.status === "removed") acc.removed += 1;
      else acc.offline += 1;
      return acc;
    },
    { total: 0, active: 0, offline: 0, removed: 0 },
  );
}

export function faviconUrlFor(domain: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}
