/**
 * Merge list + detail copyright scan poll payloads without losing live telemetry.
 * Canonical provider telemetry: stats.source_activity (and related count/timestamp fields).
 */

import { parseSourceActivity } from "@/lib/copyright/source-activity";

function sourceActivityTelemetryFields(
  stats: Record<string, unknown>,
): Record<string, unknown> | null {
  if (parseSourceActivity(stats).length === 0) return null;
  const out: Record<string, unknown> = {
    source_activity: stats.source_activity,
  };
  if (typeof stats.source_activity_count === "number") {
    out.source_activity_count = stats.source_activity_count;
  }
  if (typeof stats.source_activity_updated_at === "string") {
    out.source_activity_updated_at = stats.source_activity_updated_at;
  }
  return out;
}

function sourceActivityUpdatedAt(stats: Record<string, unknown>): string {
  const direct = stats.source_activity_updated_at;
  if (typeof direct === "string") return direct;
  const entries = parseSourceActivity(stats);
  return entries.reduce((max, e) => (e.updated_at > max ? e.updated_at : max), "");
}

/**
 * Merge list and detail poll stats. Provider telemetry is taken from whichever
 * source has a non-empty source_activity array; when both are non-empty, the
 * newer source_activity_updated_at wins so stale empty detail cannot erase list.
 */
export function mergeCopyrightPollStats(
  listStats: Record<string, unknown> | null | undefined,
  detailStats: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const list = (listStats ?? {}) as Record<string, unknown>;
  const detail = (detailStats ?? {}) as Record<string, unknown>;
  const listTelemetry = sourceActivityTelemetryFields(list);
  const detailTelemetry = sourceActivityTelemetryFields(detail);

  let telemetry: Record<string, unknown> | null = null;
  if (listTelemetry && !detailTelemetry) {
    telemetry = listTelemetry;
  } else if (detailTelemetry && !listTelemetry) {
    telemetry = detailTelemetry;
  } else if (listTelemetry && detailTelemetry) {
    telemetry =
      sourceActivityUpdatedAt(detail) >= sourceActivityUpdatedAt(list)
        ? detailTelemetry
        : listTelemetry;
  }

  return {
    ...list,
    ...detail,
    ...(telemetry ?? {}),
  };
}
