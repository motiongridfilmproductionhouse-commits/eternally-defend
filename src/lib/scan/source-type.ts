/**
 * Canonical `source_type` taxonomy for scan findings. `scan_hits.source` is a
 * free-text display label produced by `platformFromUrl` (e.g. "YouTube",
 * "Blogs", "Complaints") — this module derives one normalized, lowercase,
 * singular value from it so the /scan results filter, the DB query, and the
 * persisted `scan_hits.source_type` column all agree on the same set of
 * values instead of drifting (which is what let filters like "Forums" or
 * "Blogs" silently match nothing).
 */

export type CanonicalSourceType =
  | "youtube"
  | "news"
  | "reddit"
  | "x"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "blog"
  | "forum"
  | "review"
  | "archive"
  | "linkedin"
  | "podcast"
  | "complaint"
  | "web";

const LABEL_TO_TYPE: Record<string, CanonicalSourceType> = {
  youtube: "youtube",
  news: "news",
  reddit: "reddit",
  x: "x",
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
  blog: "blog",
  blogs: "blog",
  forum: "forum",
  forums: "forum",
  review: "review",
  reviews: "review",
  archive: "archive",
  linkedin: "linkedin",
  podcast: "podcast",
  podcasts: "podcast",
  complaint: "complaint",
  complaints: "complaint",
  web: "web",
};

/** Any unrecognized or missing label (e.g. legacy "AI Research") falls back to "web". */
export function canonicalSourceType(source: string | null | undefined): CanonicalSourceType {
  if (!source) return "web";
  return LABEL_TO_TYPE[source.trim().toLowerCase()] ?? "web";
}

/** Filter chip order + label, matching the reputation-damage priority used across /scan. */
export const SOURCE_TYPE_FILTERS: ReadonlyArray<{
  value: CanonicalSourceType | "";
  label: string;
}> = [
  { value: "", label: "All Sources" },
  { value: "youtube", label: "YouTube" },
  { value: "news", label: "News" },
  { value: "reddit", label: "Reddit" },
  { value: "x", label: "X" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "blog", label: "Blogs" },
  { value: "forum", label: "Forums" },
  { value: "review", label: "Reviews" },
  { value: "archive", label: "Archive" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "podcast", label: "Podcasts" },
  { value: "complaint", label: "Complaints" },
  { value: "web", label: "Web" },
];

const VALID_SOURCE_TYPES = new Set<string>(
  SOURCE_TYPE_FILTERS.map((f) => f.value).filter((v): v is CanonicalSourceType => v !== ""),
);

export function isCanonicalSourceType(value: string): value is CanonicalSourceType {
  return VALID_SOURCE_TYPES.has(value);
}

export function labelForSourceType(sourceType: string): string {
  return SOURCE_TYPE_FILTERS.find((f) => f.value === sourceType)?.label ?? sourceType;
}

/**
 * Defense-in-depth re-assertion of source exclusivity. The database query is
 * the primary filter (`scan_hits.source_type = :sourceType`), but findings
 * are re-checked here against the canonical type derived fresh from
 * `source` — never trusting a possibly-stale persisted `source_type` — so a
 * stale cache entry or a future query regression can never leak a
 * cross-source finding into the rendered list.
 */
export function filterHitsBySourceType<T extends { source: string }>(
  hits: T[],
  sourceType: string,
): T[] {
  if (!sourceType) return hits;
  return hits.filter((h) => canonicalSourceType(h.source) === sourceType);
}
