/**
 * Dedupe copyright match rows before upsert.
 *
 * Postgres rejects INSERT ... ON CONFLICT DO UPDATE when the same conflict
 * key appears twice in one batch ("cannot affect row a second time").
 */

import { canonicalUrl } from "./url.server";
import { isActionablePiracy } from "./taxonomy";

export interface CopyrightMatchRowLike {
  source_url: string;
  detection_type?: string | null;
  confidence?: number | null;
  evidence?: unknown;
}

function matchRowRank(row: CopyrightMatchRowLike): number {
  const ev = (row.evidence ?? {}) as Record<string, unknown>;
  const detectionType = row.detection_type ?? "";
  return (
    (ev.client_visible === true ? 1_000 : 0) +
    (isActionablePiracy(detectionType) ? 500 : 0) +
    (typeof row.confidence === "number" ? row.confidence : 0)
  );
}

/** Keep the highest-value row per canonical source_url. */
export function dedupeCopyrightMatchRows<T extends CopyrightMatchRowLike>(rows: T[]): T[] {
  const byUrl = new Map<string, T>();
  for (const row of rows) {
    const key = canonicalUrl(row.source_url);
    const normalized = { ...row, source_url: key } as T;
    const existing = byUrl.get(key);
    if (!existing || matchRowRank(normalized) >= matchRowRank(existing)) {
      byUrl.set(key, normalized);
    }
  }
  return [...byUrl.values()];
}
