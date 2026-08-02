/**
 * Client-safe surface for Copyright Intelligence — strips vendor names,
 * internal endpoints, and admin-only diagnostics from API responses.
 */

import type { ScanActivityEvent } from "./scan-activity";
import type { SourceActivityEntry } from "./source-activity";

/** Public capability identifiers (safe to expose in browser). */
export type PublicCapabilityId =
  | "public_web"
  | "public_video"
  | "expanded_discovery"
  | "public_search"
  | "public_messaging"
  | "submitted_url"
  | "dynamic_webpage"
  | "direct_web"
  | "investigation";

const CAPABILITY_LABELS: Record<string, string> = {
  public_web: "Public Web",
  public_video: "Public Video",
  expanded_discovery: "Expanded Discovery",
  public_search: "Public Search",
  public_messaging: "Public Messaging",
  submitted_url: "Submitted URL",
  dynamic_webpage: "Dynamic Webpage",
  direct_web: "Direct Web Retrieval",
  investigation: "Eterna Investigation",
  // Legacy internal ids → public labels
  firecrawl: "Public Web",
  bright_data: "Expanded Discovery",
  brightdata: "Expanded Discovery",
  youtube: "Public Video",
  serpapi: "Public Search",
  telegram: "Public Messaging",
  known_url: "Submitted URL",
  crawl4ai: "Dynamic Webpage",
  crawl4ai_render: "Dynamic Webpage",
  direct_retrieval: "Direct Web Retrieval",
  playwright: "Dynamic Webpage",
  brave: "Public Web",
};

const INTERNAL_STAT_PREFIXES = [
  "firecrawl_",
  "brightdata_",
  "serpapi_",
  "crawl4ai_",
  "telegram_",
] as const;

const INTERNAL_STAT_KEYS = new Set([
  "firecrawl_env_diagnostic",
  "brightdata_diagnostic",
  "provider_failure_samples",
  "brightdata_failure_samples",
  "known_url_investigations",
  "verified_findings_by_provider",
  "candidates_by_provider",
  "distribution_summary",
  "executor_started_at",
  "scan_created_at",
  "discovery_never_started",
  "terminal_status",
  "failure_category",
  "failure_reason",
  "firecrawl_operator_action",
  "firecrawl_circuit_reason",
  "firecrawl_stopped_early_reason",
  "detail_follow_logs",
  "candidate_dedup_records",
  "browser_fallback_budget_remaining_ms",
]);

export function publicCapabilityLabel(providerOrCapability: string | null | undefined): string {
  if (!providerOrCapability) return "Investigation";
  const key = providerOrCapability.toLowerCase().replace(/-/g, "_");
  return CAPABILITY_LABELS[key] ?? "Investigation";
}

export function mapToPublicCapabilityId(provider: string | null | undefined): PublicCapabilityId {
  const key = (provider ?? "").toLowerCase().replace(/-/g, "_");
  switch (key) {
    case "firecrawl":
    case "brave":
      return "public_web";
    case "bright_data":
    case "brightdata":
      return "expanded_discovery";
    case "youtube":
      return "public_video";
    case "serpapi":
      return "public_search";
    case "telegram":
      return "public_messaging";
    case "known_url":
      return "submitted_url";
    case "crawl4ai":
    case "crawl4ai_render":
    case "playwright":
      return "dynamic_webpage";
    case "direct_retrieval":
      return "direct_web";
    default:
      return "investigation";
  }
}

export function publicSourceActivityStatusLabel(status: string): string {
  switch (status) {
    case "starting":
      return "Initializing";
    case "queued":
      return "Queued";
    case "searching":
      return "Searching";
    case "completed":
      return "Complete";
    case "failed":
      return "Limited";
    case "no_results":
      return "No results";
    default:
      return status.replace(/_/g, " ");
  }
}

export function sanitizeDiscoveryQueryForClient(
  query: string | null | undefined,
): string | null {
  if (!query?.trim()) return null;
  const q = query.trim();
  if (q === "known_url_seed") return "Submitted URL";
  if (q === "detail_follow") return "Title detail follow-up";
  if (/^brightdata:/i.test(q)) return "Expanded discovery";
  if (/^serpapi:/i.test(q)) return "Public search";
  if (/\btelegram\b/i.test(q)) return "Public messaging";
  if (/\bfirecrawl\b/i.test(q)) return "Public web";
  return q.length > 80 ? `${q.slice(0, 77)}…` : q;
}

export function sanitizeSourceActivityEntryForClient(
  entry: SourceActivityEntry,
): SourceActivityEntry {
  const capability = mapToPublicCapabilityId(entry.provider);
  return {
    ...entry,
    provider: capability,
    label: publicCapabilityLabel(entry.provider),
  };
}

export function sanitizeScanActivityEventForClient(
  event: ScanActivityEvent,
): ScanActivityEvent {
  const capability = mapToPublicCapabilityId(event.provider);
  return {
    ...event,
    provider: capability as ScanActivityEvent["provider"],
    stage_label: event.stage_label,
    threat_label: event.threat_label,
  };
}

function stripInternalStatKeys(stats: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (INTERNAL_STAT_KEYS.has(key)) continue;
    if (INTERNAL_STAT_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeCrawlMetricsForClient(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out = { ...raw };
  delete out.crawl4ai_fallback_attempted;
  delete out.crawl4ai_fallback_succeeded;
  if (typeof out.browser_fallback_succeeded === "number") {
    out.dynamic_render_recovered = out.browser_fallback_succeeded;
  }
  return out;
}

function sanitizeFunnelLine(line: string): string {
  return line
    .replace(/\bFirecrawl\b/gi, "public web discovery")
    .replace(/\bCrawl4AI\b/gi, "dynamic webpage rendering")
    .replace(/\bBright Data\b/gi, "expanded discovery")
    .replace(/\bSerpApi\b/gi, "public search")
    .replace(/\bPlaywright\b/gi, "dynamic webpage rendering")
    .replace(/\bBrave\b/gi, "public web")
    .replace(/check Firecrawl configuration/gi, "check discovery configuration");
}

/** Remove vendor names and admin diagnostics from scan stats before browser delivery. */
export function sanitizeCopyrightStatsForClient(
  stats: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!stats || typeof stats !== "object") return {};

  const base = stripInternalStatKeys(stats);
  const crawlMetrics = sanitizeCrawlMetricsForClient(
    (base.crawl_metrics as Record<string, unknown> | undefined) ??
      (base as Record<string, unknown>),
  );

  const sourceActivity = Array.isArray(base.source_activity)
    ? (base.source_activity as SourceActivityEntry[]).map(sanitizeSourceActivityEntryForClient)
    : [];

  const sanitizeEvents = (key: string) => {
    const raw = base[key];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) =>
        row && typeof row === "object"
          ? sanitizeScanActivityEventForClient(row as ScanActivityEvent)
          : null,
      )
      .filter(Boolean);
  };

  const websiteActivity = sanitizeEvents("website_activity");
  const recentActivity = sanitizeEvents("recent_activity");

  const rejectionFunnel = Array.isArray(base.rejection_funnel)
    ? (base.rejection_funnel as string[]).map(sanitizeFunnelLine)
    : undefined;

  const providerFailuresByCategory =
    base.provider_failures_by_category &&
    typeof base.provider_failures_by_category === "object"
      ? Object.fromEntries(
          Object.entries(base.provider_failures_by_category as Record<string, number>).map(
            ([k, v]) => [k.replace(/firecrawl|brightdata|serpapi/gi, "discovery"), v],
          ),
        )
      : undefined;

  return {
    ...base,
    ...(crawlMetrics ? { crawl_metrics: crawlMetrics, ...crawlMetrics } : {}),
    source_activity: sourceActivity,
    source_activity_count: sourceActivity.length,
    website_activity: websiteActivity.length ? websiteActivity : recentActivity,
    recent_activity: recentActivity.length ? recentActivity : websiteActivity,
    ...(rejectionFunnel ? { rejection_funnel: rejectionFunnel } : {}),
    ...(providerFailuresByCategory
      ? { provider_failures_by_category: providerFailuresByCategory }
      : {}),
    discovery_channels_active: sourceActivity.filter((e) => e.status === "searching").length,
    investigation_platform: "Eterna Sentinel",
  };
}

export function sanitizeCopyrightScanRowForClient<T extends Record<string, unknown>>(
  row: T,
): T {
  const stats =
    row.stats && typeof row.stats === "object"
      ? sanitizeCopyrightStatsForClient(row.stats as Record<string, unknown>)
      : row.stats;
  const error =
    typeof row.error === "string"
      ? sanitizeFunnelLine(row.error)
      : row.error;
  return { ...row, stats, error } as T;
}
