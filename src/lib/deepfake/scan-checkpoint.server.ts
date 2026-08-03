/**
 * Durable resumable checkpoints for interleaved deepfake scans.
 * Checkpoints are server-authored and strictly validated on resume.
 */

import {
  createDiscoveryFunnelMetrics,
  type DiscoveryFunnelMetrics,
} from "./scan-ownership.server";
import type { ScanStage } from "./scan-budget.server";

export const SCAN_CHECKPOINT_VERSION = 1 as const;

/** Hard caps so scan_checkpoint JSONB cannot grow without bound. */
export const CHECKPOINT_MAX_QUERIES = 60;
export const CHECKPOINT_MAX_COMPLETED_QUERY_IDS = 80;
export const CHECKPOINT_MAX_PENDING_URLS = 80;
export const CHECKPOINT_MAX_VERIFIED_URLS = 200;
export const CHECKPOINT_MAX_PROVIDER_LATENCY_KEYS = 40;
export const CHECKPOINT_MAX_SERPAPI_QUERIES = 5;
export const CHECKPOINT_MAX_SERPAPI_PAGES = 150;
export const CHECKPOINT_MAX_STRING_LEN = 2_000;
export const CHECKPOINT_MAX_BYTES = 262_144;

const STAGES: readonly ScanStage[] = [
  "discovering",
  "verifying",
  "classifying",
  "saving",
  "checkpoint",
  "done",
] as const;

export type ScanCheckpoint = {
  version: typeof SCAN_CHECKPOINT_VERSION;
  stage: ScanStage;
  queries: string[];
  next_query_index: number;
  completed_query_ids: string[];
  pending_candidate_urls: string[];
  verified_canonical_urls: string[];
  youtube_done: boolean;
  reddit_done: boolean;
  related_done: boolean;
  serpapi_queries: string[];
  serpapi_next_query_index: number;
  serpapi_completed_query_ids: string[];
  serpapi_seen_page_urls: string[];
  planned_query_count: number;
  initial_wave_count: number;
  average_provider_latency_ms: number;
  provider_latencies_ms: Record<string, number>;
  risk_counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  discovery_count: number;
  finding_count: number;
  client_visible_count: number;
  metrics: DiscoveryFunnelMetrics;
  pending_work: boolean;
  last_checkpoint_at: string;
  target_name: string;
  profile_id?: string | null;
  aliases: string[];
  handles: string[];
  per_query_limit: number;
  max_queries: number;
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, max = CHECKPOINT_MAX_STRING_LEN): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

function asStringArray(
  value: unknown,
  maxItems: number,
  maxLen = CHECKPOINT_MAX_STRING_LEN,
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, maxLen);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function asHttpUrlArray(value: unknown, maxItems: number): string[] {
  return asStringArray(value, maxItems).filter(isHttpUrl);
}

/** Prefer newest unique http(s) URLs when truncating (oldest dropped first). */
function asHttpUrlArrayKeepNewest(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let index = value.length - 1; index >= 0; index--) {
    const item = value[index];
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, CHECKPOINT_MAX_STRING_LEN);
    if (!trimmed || !isHttpUrl(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out.reverse();
}

function asStage(value: unknown): ScanStage {
  return STAGES.includes(value as ScanStage) ? (value as ScanStage) : "discovering";
}

function asMetrics(value: unknown): DiscoveryFunnelMetrics {
  const base = createDiscoveryFunnelMetrics();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const row = value as Record<string, unknown>;
  const numericKeys: Array<keyof DiscoveryFunnelMetrics> = [
    "queries_generated",
    "queries_executed",
    "provider_candidates",
    "unique_candidates",
    "crawl_succeeded",
    "crawl_failed",
    "identity_rejected",
    "page_type_rejected",
    "url_rejected",
    "dns_resolution_failed",
    "private_address_rejected",
    "tls_connection_failed",
    "request_timeout",
    "redirect_rejected",
    "crawl_provider_failed",
    "network_failed",
    "unverified",
    "probable",
    "verified",
    "client_visible",
    "provider_failures",
    "query_failures",
    "serpapi_requests",
    "serpapi_failures",
    "serpapi_candidates",
    "serpapi_unique_pages",
    "serpapi_face_rejected",
    "serpapi_verified",
    "serpapi_credits_used",
    "reference_images_count",
    "final_reference_images",
    "embeddings_indexed",
    "aliases_generated",
    "images_downloaded",
    "images_compared",
    "face_comparisons",
    "reference_google_images_found",
    "reference_bing_images_found",
    "reference_yandex_images_found",
  ];
  for (const key of numericKeys) {
    const fallback = base[key] as number;
    base[key] = clampInt(row[key], fallback, 0, 1_000_000) as (typeof base)[typeof key];
  }
  return base;
}

function asLatencies(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= CHECKPOINT_MAX_PROVIDER_LATENCY_KEYS) break;
    const name = asString(key, 80);
    if (!name) continue;
    out[name] = clampInt(raw, 0, 0, 600_000);
  }
  return out;
}

export function createEmptyCheckpoint(input: {
  queries: string[];
  targetName: string;
  profileId?: string | null;
  aliases: string[];
  handles: string[];
  perQueryLimit: number;
  maxQueries: number;
  initialWaveCount: number;
  metrics: DiscoveryFunnelMetrics;
}): ScanCheckpoint {
  const queries = asStringArray(input.queries, CHECKPOINT_MAX_QUERIES);
  return {
    version: SCAN_CHECKPOINT_VERSION,
    stage: "discovering",
    queries,
    next_query_index: 0,
    completed_query_ids: [],
    pending_candidate_urls: [],
    verified_canonical_urls: [],
    youtube_done: false,
    reddit_done: false,
    related_done: false,
    serpapi_queries: [],
    serpapi_next_query_index: 0,
    serpapi_completed_query_ids: [],
    serpapi_seen_page_urls: [],
    planned_query_count: queries.length,
    initial_wave_count: clampInt(input.initialWaveCount, 15, 1, CHECKPOINT_MAX_QUERIES),
    average_provider_latency_ms: 0,
    provider_latencies_ms: {},
    risk_counts: { critical: 0, high: 0, medium: 0, low: 0 },
    discovery_count: 0,
    finding_count: 0,
    client_visible_count: 0,
    metrics: { ...input.metrics },
    pending_work: queries.length > 0,
    last_checkpoint_at: new Date().toISOString(),
    target_name: asString(input.targetName, 200),
    profile_id: input.profileId ?? null,
    aliases: asStringArray(input.aliases, 20, 200),
    handles: asStringArray(input.handles, 20, 200),
    per_query_limit: clampInt(input.perQueryLimit, 20, 5, 20),
    max_queries: clampInt(input.maxQueries, 56, 1, CHECKPOINT_MAX_QUERIES),
  };
}

/**
 * Strict server-side checkpoint parse. Rejects hostile/incomplete payloads
 * rather than trusting client-shaped JSONB.
 */
export function parseScanCheckpoint(value: unknown): ScanCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== SCAN_CHECKPOINT_VERSION) return null;

  const queries = asStringArray(row.queries, CHECKPOINT_MAX_QUERIES);
  if (!queries.length) return null;

  const plannedIds = new Set(
    queries.map((query) => query.trim().toLowerCase()).filter(Boolean),
  );
  const completed = asStringArray(
    row.completed_query_ids,
    CHECKPOINT_MAX_COMPLETED_QUERY_IDS,
    500,
  )
    .map((id) => id.trim().toLowerCase())
    .filter((id) => plannedIds.has(id));
  const pending = asHttpUrlArray(row.pending_candidate_urls, CHECKPOINT_MAX_PENDING_URLS);
  const verified = asHttpUrlArray(
    row.verified_canonical_urls,
    CHECKPOINT_MAX_VERIFIED_URLS,
  );

  let nextIndex = clampInt(row.next_query_index, 0, 0, queries.length);
  // completed_query_ids may only advance the cursor — never rewind it below
  // the number of known completed queries that match the plan prefix.
  const completedFromPlan = queries
    .slice(0, nextIndex)
    .map((query) => query.trim().toLowerCase());
  const completedSet = new Set(completed);
  for (const id of completedFromPlan) {
    completedSet.add(id);
  }
  // If completed ids claim later queries, advance next_query_index safely.
  let inferred = nextIndex;
  for (let i = nextIndex; i < queries.length; i++) {
    const id = queries[i]!.trim().toLowerCase();
    if (!completedSet.has(id)) break;
    inferred = i + 1;
  }
  nextIndex = Math.max(nextIndex, inferred);

  const latencies = asLatencies(row.provider_latencies_ms);
  const latencyValues = Object.values(latencies);

  const checkpoint: ScanCheckpoint = {
    version: SCAN_CHECKPOINT_VERSION,
    stage: asStage(row.stage),
    queries,
    next_query_index: nextIndex,
    completed_query_ids: Array.from(completedSet).slice(
      0,
      CHECKPOINT_MAX_COMPLETED_QUERY_IDS,
    ),
    pending_candidate_urls: pending,
    verified_canonical_urls: verified,
    youtube_done: asBool(row.youtube_done),
    reddit_done: asBool(row.reddit_done),
    related_done: asBool(row.related_done),
    serpapi_queries: asStringArray(
      row.serpapi_queries,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
    ),
    serpapi_next_query_index: clampInt(
      row.serpapi_next_query_index,
      0,
      0,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
    ),
    serpapi_completed_query_ids: asStringArray(
      row.serpapi_completed_query_ids,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
      500,
    ),
    serpapi_seen_page_urls: asHttpUrlArrayKeepNewest(
      row.serpapi_seen_page_urls,
      CHECKPOINT_MAX_SERPAPI_PAGES,
    ),
    planned_query_count: queries.length,
    initial_wave_count: clampInt(row.initial_wave_count, 15, 1, CHECKPOINT_MAX_QUERIES),
    average_provider_latency_ms: latencyValues.length
      ? Math.round(
          latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length,
        )
      : clampInt(row.average_provider_latency_ms, 0, 0, 600_000),
    provider_latencies_ms: latencies,
    risk_counts: {
      critical: clampInt((row.risk_counts as any)?.critical, 0, 0, 1_000_000),
      high: clampInt((row.risk_counts as any)?.high, 0, 0, 1_000_000),
      medium: clampInt((row.risk_counts as any)?.medium, 0, 0, 1_000_000),
      low: clampInt((row.risk_counts as any)?.low, 0, 0, 1_000_000),
    },
    discovery_count: clampInt(row.discovery_count, 0, 0, 1_000_000),
    finding_count: clampInt(row.finding_count, 0, 0, 1_000_000),
    client_visible_count: clampInt(row.client_visible_count, 0, 0, 1_000_000),
    metrics: asMetrics(row.metrics),
    pending_work: asBool(row.pending_work, true),
    last_checkpoint_at: asString(row.last_checkpoint_at, 40) || new Date().toISOString(),
    target_name: asString(row.target_name, 200),
    profile_id:
      typeof row.profile_id === "string" || row.profile_id === null
        ? (row.profile_id as string | null)
        : null,
    aliases: asStringArray(row.aliases, 20, 200),
    handles: asStringArray(row.handles, 20, 200),
    per_query_limit: clampInt(row.per_query_limit, 20, 5, 20),
    max_queries: clampInt(row.max_queries, queries.length, 1, CHECKPOINT_MAX_QUERIES),
  };

  checkpoint.pending_work = checkpointHasPendingWork(checkpoint);
  return enforceCheckpointBounds(checkpoint);
}

export function estimateCheckpointBytes(checkpoint: ScanCheckpoint): number {
  return Buffer.byteLength(JSON.stringify(checkpoint), "utf8");
}

/** Trim arrays until serialized size fits the JSONB budget. */
export function enforceCheckpointBounds(checkpoint: ScanCheckpoint): ScanCheckpoint {
  const copy: ScanCheckpoint = {
    ...checkpoint,
    queries: checkpoint.queries.slice(0, CHECKPOINT_MAX_QUERIES),
    completed_query_ids: checkpoint.completed_query_ids.slice(
      0,
      CHECKPOINT_MAX_COMPLETED_QUERY_IDS,
    ),
    pending_candidate_urls: checkpoint.pending_candidate_urls
      .filter(isHttpUrl)
      .slice(0, CHECKPOINT_MAX_PENDING_URLS),
    verified_canonical_urls: checkpoint.verified_canonical_urls
      .filter(isHttpUrl)
      .slice(-CHECKPOINT_MAX_VERIFIED_URLS),
    serpapi_queries: (checkpoint.serpapi_queries ?? []).slice(
      0,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
    ),
    serpapi_completed_query_ids: (checkpoint.serpapi_completed_query_ids ?? []).slice(
      0,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
    ),
    serpapi_seen_page_urls: (checkpoint.serpapi_seen_page_urls ?? [])
      .filter(isHttpUrl)
      .slice(-CHECKPOINT_MAX_SERPAPI_PAGES),
    serpapi_next_query_index: clampInt(
      checkpoint.serpapi_next_query_index ?? 0,
      0,
      0,
      CHECKPOINT_MAX_SERPAPI_QUERIES,
    ),
    provider_latencies_ms: Object.fromEntries(
      Object.entries(checkpoint.provider_latencies_ms).slice(
        0,
        CHECKPOINT_MAX_PROVIDER_LATENCY_KEYS,
      ),
    ),
  };

  while (
    estimateCheckpointBytes(copy) > CHECKPOINT_MAX_BYTES &&
    copy.pending_candidate_urls.length > 0
  ) {
    copy.pending_candidate_urls.pop();
  }
  while (
    estimateCheckpointBytes(copy) > CHECKPOINT_MAX_BYTES &&
    copy.serpapi_seen_page_urls.length > 0
  ) {
    // Drop oldest seen pages first so newest discoveries survive bounds.
    copy.serpapi_seen_page_urls.shift();
  }
  while (
    estimateCheckpointBytes(copy) > CHECKPOINT_MAX_BYTES &&
    copy.verified_canonical_urls.length > 0
  ) {
    copy.verified_canonical_urls.shift();
  }
  while (
    estimateCheckpointBytes(copy) > CHECKPOINT_MAX_BYTES &&
    copy.completed_query_ids.length > 0
  ) {
    copy.completed_query_ids.shift();
  }

  copy.planned_query_count = copy.queries.length;
  copy.next_query_index = Math.min(copy.next_query_index, copy.queries.length);
  copy.serpapi_next_query_index = Math.min(
    copy.serpapi_next_query_index,
    copy.serpapi_queries.length,
  );
  copy.pending_work = checkpointHasPendingWork(copy);
  return copy;
}

export function checkpointHasPendingWork(checkpoint: ScanCheckpoint): boolean {
  const serpapiPending =
    (checkpoint.serpapi_queries?.length ?? 0) >
    (checkpoint.serpapi_next_query_index ?? 0);
  return (
    checkpoint.next_query_index < checkpoint.queries.length ||
    serpapiPending ||
    !checkpoint.youtube_done ||
    !checkpoint.reddit_done ||
    !checkpoint.related_done ||
    checkpoint.pending_candidate_urls.length > 0
  );
}

export function markQueryCompleted(
  checkpoint: ScanCheckpoint,
  query: string,
): void {
  const id = query.trim().toLowerCase();
  if (!checkpoint.completed_query_ids.includes(id)) {
    checkpoint.completed_query_ids.push(id);
    if (checkpoint.completed_query_ids.length > CHECKPOINT_MAX_COMPLETED_QUERY_IDS) {
      checkpoint.completed_query_ids.splice(
        0,
        checkpoint.completed_query_ids.length - CHECKPOINT_MAX_COMPLETED_QUERY_IDS,
      );
    }
  }
}

export function recordProviderLatency(
  checkpoint: ScanCheckpoint,
  provider: string,
  latencyMs: number,
): void {
  const safe = Math.max(0, latencyMs);
  checkpoint.provider_latencies_ms[provider] = safe;
  const entries = Object.entries(checkpoint.provider_latencies_ms);
  if (entries.length > CHECKPOINT_MAX_PROVIDER_LATENCY_KEYS) {
    checkpoint.provider_latencies_ms = Object.fromEntries(
      entries.slice(-CHECKPOINT_MAX_PROVIDER_LATENCY_KEYS),
    );
  }
  const values = Object.values(checkpoint.provider_latencies_ms);
  checkpoint.average_provider_latency_ms = values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

export function partialCheckpointReason(checkpoint: ScanCheckpoint): string {
  if (checkpointHasPendingWork(checkpoint)) {
    return (
      "Scan paused at the time budget after saving verified progress. " +
      "Saved results remain available — use Continue scan to resume from the checkpoint without repeating completed queries."
    );
  }
  return (
    "Scan reached the execution deadline with verified progress saved. " +
    "Partial results are available."
  );
}
