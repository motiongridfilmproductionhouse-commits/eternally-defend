/**
 * Live provider telemetry for Copyright Intelligence scans.
 * Persisted in copyright_scans.stats.source_activity.
 */

export type SourceActivityStatus =
  | "starting"
  | "queued"
  | "searching"
  | "completed"
  | "failed"
  | "no_results";

export interface SourceActivityEntry {
  provider: string;
  label: string;
  status: SourceActivityStatus;
  requests: number;
  candidates: number;
  failures: number;
  updated_at: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  firecrawl: "Firecrawl",
  brightdata: "Bright Data",
  bright_data: "Bright Data",
  known_url: "Known URL",
  serpapi: "SerpApi",
  direct_retrieval: "Direct retrieval",
  youtube: "YouTube",
};

export function sourceActivityLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

export function mergeSourceActivityIntoStats(
  stats: Record<string, unknown>,
  entries: SourceActivityEntry[],
): Record<string, unknown> {
  return {
    ...stats,
    source_activity: entries,
    source_activity_count: entries.length,
    source_activity_updated_at: entries.reduce(
      (max, e) => (e.updated_at > max ? e.updated_at : max),
      entries[0]?.updated_at ??
        (typeof stats.last_progress_at === "string" ? stats.last_progress_at : new Date().toISOString()),
    ),
  };
}

export function parseSourceActivity(
  stats: Record<string, unknown> | null | undefined,
): SourceActivityEntry[] {
  const raw = stats?.source_activity;
  if (!Array.isArray(raw)) return [];
  const out: SourceActivityEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const provider = typeof r.provider === "string" ? r.provider : null;
    const label = typeof r.label === "string" ? r.label : null;
    const status = typeof r.status === "string" ? r.status : null;
    const updatedAt = typeof r.updated_at === "string" ? r.updated_at : null;
    if (!provider || !label || !status || !updatedAt) continue;
    const allowed: SourceActivityStatus[] = [
      "starting",
      "queued",
      "searching",
      "completed",
      "failed",
      "no_results",
    ];
    if (!allowed.includes(status as SourceActivityStatus)) continue;
    const num = (key: string) => {
      const v = r[key];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    out.push({
      provider,
      label,
      status: status as SourceActivityStatus,
      requests: num("requests"),
      candidates: num("candidates"),
      failures: num("failures"),
      updated_at: updatedAt,
    });
  }
  return out;
}

/** In-memory recorder for provider strip telemetry during an active scan. */
export class SourceActivityRecorder {
  private entries = new Map<string, SourceActivityEntry>();

  restoreFromStats(stats: Record<string, unknown> | null | undefined): void {
    this.entries.clear();
    for (const entry of parseSourceActivity(stats ?? {})) {
      this.entries.set(entry.provider, entry);
    }
  }

  upsert(input: {
    provider: string;
    label?: string;
    status: SourceActivityStatus;
    requests?: number;
    candidates?: number;
    failures?: number;
  }): void {
    const existing = this.entries.get(input.provider);
    this.entries.set(input.provider, {
      provider: input.provider,
      label: input.label ?? existing?.label ?? sourceActivityLabel(input.provider),
      status: input.status,
      requests: Math.max(input.requests ?? 0, existing?.requests ?? 0),
      candidates: Math.max(input.candidates ?? 0, existing?.candidates ?? 0),
      failures: Math.max(input.failures ?? 0, existing?.failures ?? 0),
      updated_at: new Date().toISOString(),
    });
  }

  mergeToStats(stats: Record<string, unknown>): Record<string, unknown> {
    const entries = [...this.entries.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    return mergeSourceActivityIntoStats(stats, entries);
  }

  count(): number {
    return this.entries.size;
  }
}
