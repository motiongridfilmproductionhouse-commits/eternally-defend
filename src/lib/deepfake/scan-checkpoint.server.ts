/**
 * Durable resumable checkpoints for interleaved deepfake scans.
 */

import type { DiscoveryFunnelMetrics } from "./scan-ownership.server";
import type { ScanStage } from "./scan-budget.server";

export const SCAN_CHECKPOINT_VERSION = 1 as const;

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
  return {
    version: SCAN_CHECKPOINT_VERSION,
    stage: "discovering",
    queries: input.queries,
    next_query_index: 0,
    completed_query_ids: [],
    pending_candidate_urls: [],
    verified_canonical_urls: [],
    youtube_done: false,
    reddit_done: false,
    related_done: false,
    planned_query_count: input.queries.length,
    initial_wave_count: input.initialWaveCount,
    average_provider_latency_ms: 0,
    provider_latencies_ms: {},
    risk_counts: { critical: 0, high: 0, medium: 0, low: 0 },
    discovery_count: 0,
    finding_count: 0,
    client_visible_count: 0,
    metrics: { ...input.metrics },
    pending_work: input.queries.length > 0,
    last_checkpoint_at: new Date().toISOString(),
    target_name: input.targetName,
    profile_id: input.profileId ?? null,
    aliases: input.aliases,
    handles: input.handles,
    per_query_limit: input.perQueryLimit,
    max_queries: input.maxQueries,
  };
}

export function parseScanCheckpoint(value: unknown): ScanCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<ScanCheckpoint>;
  if (row.version !== SCAN_CHECKPOINT_VERSION) return null;
  if (!Array.isArray(row.queries)) return null;
  if (typeof row.next_query_index !== "number") return null;
  return row as ScanCheckpoint;
}

export function checkpointHasPendingWork(checkpoint: ScanCheckpoint): boolean {
  return (
    checkpoint.next_query_index < checkpoint.queries.length ||
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
  }
}

export function recordProviderLatency(
  checkpoint: ScanCheckpoint,
  provider: string,
  latencyMs: number,
): void {
  const safe = Math.max(0, latencyMs);
  checkpoint.provider_latencies_ms[provider] = safe;
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
