/**
 * Application-side mirror of the deepfake_discoveries duplicate ranking used
 * by migration 20260801070000_deepfake_scan_runtime_ownership.sql.
 *
 * Keep the best/newest row; delete only redundant duplicates for non-null /
 * non-empty page_url keys.
 */

export type DiscoveryDedupeRow = {
  id: string;
  scan_id: string;
  page_url: string | null | undefined;
  analysis_status?: string | null;
  canonical_url?: string | null;
  page_title?: string | null;
  snippet?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  source_host?: string | null;
  media_type?: string | null;
  search_query?: string | null;
  updated_at?: string | null;
  discovered_at?: string | null;
};

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

/** Completeness score — higher means stronger/more complete evidence fields. */
export function discoveryEvidenceScore(row: DiscoveryDedupeRow): number {
  let score = 0;
  if (row.analysis_status === "url_verified") score += 4;
  else if (hasText(row.analysis_status)) score += 1;
  if (hasText(row.canonical_url)) score += 2;
  if (hasText(row.page_title)) score += 1;
  if (hasText(row.snippet)) score += 1;
  if (hasText(row.image_url)) score += 2;
  if (hasText(row.thumbnail_url)) score += 1;
  if (hasText(row.source_host)) score += 1;
  if (hasText(row.media_type)) score += 1;
  if (hasText(row.search_query)) score += 1;
  return score;
}

function compareNewestThenId(a: DiscoveryDedupeRow, b: DiscoveryDedupeRow): number {
  const aTs = a.updated_at ?? a.discovered_at ?? "";
  const bTs = b.updated_at ?? b.discovered_at ?? "";
  if (aTs !== bTs) return aTs < bTs ? 1 : -1;

  const aDiscovered = a.discovered_at ?? "";
  const bDiscovered = b.discovered_at ?? "";
  if (aDiscovered !== bDiscovered) {
    return aDiscovered < bDiscovered ? 1 : -1;
  }

  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function compareDiscoveryRowsForKeep(
  a: DiscoveryDedupeRow,
  b: DiscoveryDedupeRow,
): number {
  const scoreDiff = discoveryEvidenceScore(b) - discoveryEvidenceScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  return compareNewestThenId(a, b);
}

export function isIndexableDiscoveryPageUrl(
  pageUrl: string | null | undefined,
): boolean {
  return Boolean(pageUrl && pageUrl.trim());
}

/**
 * Returns ids that should be deleted before creating
 * deepfake_discoveries_unique_page. NULL/empty page_url rows are never
 * collapsed unless they share an identical non-empty page_url key (they don't).
 */
export function selectRedundantDiscoveryIds(
  rows: DiscoveryDedupeRow[],
): string[] {
  const groups = new Map<string, DiscoveryDedupeRow[]>();

  for (const row of rows) {
    if (!isIndexableDiscoveryPageUrl(row.page_url)) continue;
    const key = `${row.scan_id}\0${row.page_url!.trim()}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const deleteIds: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(compareDiscoveryRowsForKeep);
    for (const redundant of ranked.slice(1)) {
      deleteIds.push(redundant.id);
    }
  }
  return deleteIds;
}

export function requireNonEmptyDiscoveryPageUrl(input: {
  final_url?: unknown;
  page_url?: unknown;
}): string | null {
  const raw = input.final_url ?? input.page_url;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}
